# backend/api/inference.py
import json
import httpx
from fastapi import HTTPException
from schemas import GenerateRequest
from utils import csv_to_naturalized
import re

# Map language codes to full names for better model understanding
LANGUAGE_MAP = {
    "en": "English",
    "fr": "French",
    "de": "German",
    "es": "Spanish",
    "pt": "Portuguese",
    "zh": "Chinese",
    "ar": "Arabic",
    "ru": "Russian"
}

# when using Cogito
DEEP_THINKING_INSTRUCTION = "Enable deep thinking subroutine."

def build_prompt(req: GenerateRequest) -> str:

    # If user wants deep thinking with Cogito, inject that first:
    if req.model == "cogito" and req.includeThinking:
        prompt = DEEP_THINKING_INSTRUCTION + "\n\n"
    else:
        prompt = ""

    # Get the full language name from the code
    language_name = LANGUAGE_MAP.get(req.language, "English")  # Default to English if not found

    # Start with a strong language directive
    prompt += f"You are an AI assistant responding in {language_name}. All your explanations and outputs must be in {language_name}, regardless of the input language.\n\n"
    prompt += "You are tasked with determining whether a claim about the following table is TRUE or FALSE.\n"
    
    if req.includeTitle and req.tableTitle:
        prompt += f'Table Title: "{req.tableTitle}"\n'

    # Get non-empty lines
    lines = [line for line in req.tableText.strip().split("\n") if line.strip()]
    if not lines:
        raise HTTPException(status_code=400, detail="Table text is empty.")

    # Detect delimiter by checking the first line
    first_line = lines[0]
    delimiter = '#' if first_line.count('#') > first_line.count(',') else ','

    # Use the detected delimiter for splitting
    table_data = [line.split(delimiter) for line in lines]

    # Add a row_index column to the header and data rows
    headers = ["row_index"] + table_data[0]
    indexed_rows = [headers] + [[str(i)] + row for i, row in enumerate(table_data[1:])]

    # Joining the rows for naturalization
    indexed_csv = "\n".join(delimiter.join(row) for row in indexed_rows)
    table_description = csv_to_naturalized(indexed_csv)

    prompt += f"#### Table (Naturalized):\n{table_description}\n\n"
    prompt += f"#### Claim:\n\"{req.claimText}\"\n\n"
    prompt += "Instructions:\n"
    prompt += "- Use the 'row_index' column (starting at 0 for the first data row, excluding header) to identify rows.\n"
    prompt += "- Match column names exactly as they appear in the table, including case and spacing.\n"
    prompt += f"- Provide your explanation and reasoning in {language_name}.\n"
    prompt += "- When writing mathematical expressions, always enclose them in dollar signs ($) for inline math (e.g., $x^2 + y^2$) or double dollar signs ($$) for display math (e.g., $$\\frac{a}{b}$$).\n"
    prompt += "- After your explanation, output a final answer in valid JSON format:\n"
    prompt += '{"answer": "TRUE" or "FALSE", "relevant_cells": [{"row_index": int, "column_name": "str"}]}\n'
    prompt += "- Ensure row_index corresponds to the 'row_index' column value, not the physical row number in the table.\n"
    
    if req.language == "en" and "deepseek" in req.model.lower():
        prompt += "\n<think>"
    
    if req.model == "cogito" and req.includeThinking:
        prompt += "\nYour first token must be <think>\n"

    return prompt.strip()

async def stream_inference(prompt: str, req: GenerateRequest, OLLAMA_API_URL: str):
    payload = {
        "model": req.model,
        "prompt": prompt,
        "max_tokens": req.max_tokens,
        "stream": req.stream,
        "keep_alive": req.keep_alive
    }
    # Define a regex pattern to match tokens like <|...|>
    unwanted_token_pattern = re.compile(r'\s*<\|[^>]+>\|\s*')

    # Track Harmony-style thinking block state for gpt-oss models
    thinking_open = False

    def emit_response(text: str):
        # Frontend expects JSON lines with a 'response' field
        return json.dumps({"response": text}, ensure_ascii=False)

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        try:
            async with client.stream("POST", OLLAMA_API_URL, json=payload) as response:
                response.raise_for_status()
                async for raw_line in response.aiter_lines():
                    if not raw_line:
                        continue

                    # Try to parse JSON; Harmony/openai-responses-like events are JSON
                    try:
                        evt = json.loads(raw_line)
                    except json.JSONDecodeError:
                        # Not JSON (unlikely for Ollama); forward as-is after cleanup
                        cleaned_text = unwanted_token_pattern.sub('', raw_line)
                        if cleaned_text:
                            yield emit_response(cleaned_text) + "\n"
                        continue

                    # Stop condition (Ollama)
                    if evt.get("done", False):
                        break

                    # gpt-oss: prioritize Harmony-style keys exposed by Ollama: 'thinking' and 'response'
                    if req.model.startswith("gpt-oss"):
                        # Direct fields observed from Ollama: { response: "", thinking: "...", done: false }
                        thinking_text = evt.get("thinking")
                        response_text = evt.get("response")
                        emitted_any = False
                        if isinstance(thinking_text, str) and thinking_text:
                            cleaned = unwanted_token_pattern.sub('', thinking_text)
                            if cleaned:
                                if not thinking_open:
                                    yield emit_response("<think>") + "\n"
                                    thinking_open = True
                                yield emit_response(cleaned) + "\n"
                                emitted_any = True
                        if isinstance(response_text, str) and response_text:
                            cleaned_r = unwanted_token_pattern.sub('', response_text)
                            if cleaned_r:
                                if thinking_open:
                                    yield emit_response("</think>") + "\n"
                                    thinking_open = False
                                yield emit_response(cleaned_r) + "\n"
                                emitted_any = True
                        if emitted_any:
                            continue

                    # Standard Ollama streaming token
                    if "response" in evt and isinstance(evt["response"], str):
                        text = unwanted_token_pattern.sub('', evt["response"])
                        if text:
                            # If we were in a thinking block for any reason, close it when normal response starts
                            if thinking_open:
                                yield emit_response("</think>") + "\n"
                                thinking_open = False
                            yield emit_response(text) + "\n"
                        continue

                    # Harmony-style handling for gpt-oss:20b (other event shapes)
                    if req.model.startswith("gpt-oss"):
                        # Several possible shapes; try common ones
                        text_piece = None
                        evt_type = evt.get("type") or evt.get("event")
                        channel = evt.get("channel") or evt.get("role")

                        # OpenAI Responses API-like
                        if evt_type in ("response.thinking.delta", "reasoning.delta", "thinking.delta"):
                            text_piece = (evt.get("delta") or evt.get("content") or "")
                        elif evt_type in ("response.output_text.delta", "output_text.delta", "message.delta"):
                            text_piece = (evt.get("delta") or evt.get("content") or "")
                            # Close a thinking block if it was open and we switched to output
                            if thinking_open:
                                yield emit_response("</think>") + "\n"
                                thinking_open = False
                        # Channel-based
                        elif channel in ("thinking", "reasoning"):
                            text_piece = (evt.get("delta") or evt.get("content") or evt.get("text") or "")
                        elif channel in ("assistant", "output"):
                            text_piece = (evt.get("delta") or evt.get("content") or evt.get("text") or "")
                            if thinking_open:
                                yield emit_response("</think>") + "\n"
                                thinking_open = False

                        # Nested message formats (e.g., { message: { content: [{type, text}] } })
                        if text_piece is None and isinstance(evt.get("message"), dict):
                            parts = evt["message"].get("content")
                            if isinstance(parts, list) and parts:
                                part = parts[0]
                                ptype = part.get("type")
                                ptext = part.get("text") or part.get("content")
                                if ptype in ("thinking", "reasoning"):
                                    text_piece = ptext or ""
                                elif ptype in ("output_text", "text"):
                                    text_piece = ptext or ""
                                    if thinking_open:
                                        yield emit_response("</think>") + "\n"
                                        thinking_open = False

                        if text_piece is not None:
                            text_piece = unwanted_token_pattern.sub('', str(text_piece))
                            if not text_piece:
                                continue
                            # If this is a thinking piece, open block once
                            if evt_type in ("response.thinking.delta", "reasoning.delta", "thinking.delta") or channel in ("thinking", "reasoning"):
                                if not thinking_open:
                                    yield emit_response("<think>") + "\n"
                                    thinking_open = True
                                yield emit_response(text_piece) + "\n"
                            else:
                                yield emit_response(text_piece) + "\n"
                            continue

                    # Fallback: if unknown JSON shape, try stringifying a 'response' if present-like
                    for key in ("text", "delta", "content"):
                        if isinstance(evt.get(key), str) and evt.get(key):
                            yield emit_response(unwanted_token_pattern.sub('', evt[key])) + "\n"
                            break
                # Ensure we close any open thinking block
                if thinking_open:
                    yield emit_response("</think>") + "\n"
                yield ""  # Signal end of stream
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"Ollama API error: {str(e)}")
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=f"Ollama returned: {e.response.text}")