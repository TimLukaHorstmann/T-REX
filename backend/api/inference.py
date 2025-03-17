import json
import httpx
from fastapi import HTTPException
from schemas import GenerateRequest
from utils import csv_to_markdown

def build_prompt(req: GenerateRequest) -> str:
    prompt = "You are tasked with determining whether a claim about the following table is TRUE or FALSE.\n"
    if req.includeTitle and req.tableTitle:
        prompt += f'Table Title: "{req.tableTitle}"\n'
    table_md = csv_to_markdown(req.tableText)
    prompt += f"#### Table (Markdown):\n{table_md}\n\n"
    prompt += f"#### Claim:\n\"{req.claimText}\"\n\n"
    prompt += "Instructions:\nAfter your explanation, output a final answer in valid JSON format:\n"
    prompt += '{"answer": "TRUE" or "FALSE", "relevant_cells": [{"row_index": int, "column_name": "str"}]}\n'
    prompt += "Please consider the header of the table as row_index=0.\n"
    if req.language != "en":
        prompt += f"Please provide your response in {req.language}.\n"
    elif req.language == "en" and "deepseek" in req.model.lower():
        prompt += "\n<think>"
    return prompt.strip()

async def stream_inference(prompt: str, req: GenerateRequest, OLLAMA_API_URL: str):
    payload = {
        "model": req.model,
        "prompt": prompt,
        "max_tokens": req.max_tokens,
        "stream": req.stream,
        "keep_alive": req.keep_alive
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:  # Add explicit timeout
        try:
            async with client.stream("POST", OLLAMA_API_URL, json=payload) as response:
                response.raise_for_status()
                async for chunk in response.aiter_lines():
                    if chunk:
                        yield chunk + "\n"
                        try:
                            data = json.loads(chunk)
                            if data.get("done", False):
                                break
                        except json.JSONDecodeError:
                            continue  # Skip malformed lines
                yield ""  # Signal end of stream
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"Ollama API error: {str(e)}")
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=f"Ollama returned: {e.response.text}")