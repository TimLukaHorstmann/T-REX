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

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        try:
            async with client.stream("POST", OLLAMA_API_URL, json=payload) as response:
                response.raise_for_status()
                async for chunk in response.aiter_lines():
                    if chunk:
                        # Clean the chunk by removing unwanted tokens
                        cleaned_chunk = unwanted_token_pattern.sub('', chunk)
                        if cleaned_chunk: # Only yield if something remains after cleaning
                            yield cleaned_chunk + "\n"
                        try:
                            # Still parse the original chunk for control data like "done"
                            data = json.loads(chunk)
                            if data.get("done", False):
                                break
                        except json.JSONDecodeError:
                            # If the original chunk wasn't JSON, continue (it was likely just text)
                            continue
                yield ""  # Signal end of stream
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"Ollama API error: {str(e)}")
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=f"Ollama returned: {e.response.text}")