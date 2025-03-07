# backend/api/inference.py
import asyncio
import json
import re
from fastapi.concurrency import run_in_threadpool
from transformers import TextIteratorStreamer
from backend.models.model_loader import load_model
from backend.api.schemas import InferenceRequest, InferenceResponse
from backend.api.utils import format_table_to_markdown

# In-memory model cache to avoid reloading models for every request.
model_cache = {}

def get_model(model_name: str):
    if model_name not in model_cache:
        model_cache[model_name] = load_model(model_name)
    return model_cache[model_name]

def extract_json_from_response(text: str) -> dict:
    """
    Tries to extract a JSON object from the generated text.
    """
    try:
        # Extract the first JSON object found in the text.
        json_str = re.search(r'({.*})', text, re.DOTALL).group(1)
        return json.loads(json_str)
    except Exception:
        return {"answer": "FALSE", "relevant_cells": []}

def perform_inference(request: InferenceRequest) -> InferenceResponse:
    """
    Synchronous inference: generates the complete output and extracts the final answer.
    We now enable sampling so that tokens are generated step-by-step.
    """
    table_md = format_table_to_markdown(request.table)
    prompt = f"""
You are tasked with determining whether a claim about the following table (in Markdown format) is TRUE or FALSE.
Before giving your final answer, explain your reasoning step-by-step.

#### Table (Markdown):
{table_md}

#### Claim:
"{request.claim}"

Instructions:
After your explanation, output a final answer in valid JSON format:
{{"answer": "TRUE" or "FALSE", "relevant_cells": [{{"row_index": int, "column_name": "str"}}]}}
    """
    model = get_model(request.model_name)
    # Enable sampling so that tokens are generated step-by-step.
    result = model(
        prompt,
        max_new_tokens=1024,
        do_sample=False
    )[0]['generated_text']
    json_output = extract_json_from_response(result)
    reasoning = result.split("{", 1)[0].strip()  # All text before the JSON block
    return InferenceResponse(
        answer=json_output.get("answer", "FALSE"),
        relevant_cells=json_output.get("relevant_cells", []),
        reasoning=reasoning
    )

async def stream_inference(request: InferenceRequest):
    """
    Asynchronous streaming inference using Hugging Face's TextIteratorStreamer.
    Generates tokens on the fly and yields them formatted as SSE events.
    """
    table_md = format_table_to_markdown(request.table)
    prompt = f"""
You are tasked with determining whether a claim about the following table (in Markdown format) is TRUE or FALSE.
Before giving your final answer, explain your reasoning step-by-step.

#### Table (Markdown):
{table_md}

#### Claim:
"{request.claim}"

Instructions:
After your explanation, output a final answer in valid JSON format:
{{"answer": "TRUE" or "FALSE", "relevant_cells": [{{"row_index": int, "column_name": "str"}}]}}
    """
    model = get_model(request.model_name)
    
    # Create a streamer instance that will yield tokens as they are generated.
    streamer = TextIteratorStreamer(model.tokenizer, skip_prompt=True)
    
    # Run model generation in a thread so as not to block the async event loop.
    await run_in_threadpool(
        model,
        prompt,
        max_new_tokens=1024,
        do_sample=False,
        streamer=streamer
    )
    
    # Yield tokens as they become available, formatted as SSE events.
    async for token in _stream_tokens(streamer):
        yield token

async def _stream_tokens(streamer: TextIteratorStreamer):
    """
    Wraps the synchronous iterator from the streamer in an async generator.
    Each token is sent as an SSE-formatted message.
    """
    for token in streamer:
        await asyncio.sleep(0)  # Yield control to the event loop.
        yield token
