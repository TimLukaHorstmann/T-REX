# backend/api/inference.py
from threading import Thread
from transformers import TextIteratorStreamer
from backend.api.schemas import InferenceRequest
from backend.models.model_loader import load_model
from backend.api.utils import format_table_to_markdown

# In-memory model cache to avoid reloading on every request.
model_cache = {}

def get_model(model_name: str):
    if model_name not in model_cache:
        model_cache[model_name] = load_model(model_name)
    return model_cache[model_name]

def run_inference(request: InferenceRequest):
    # Convert the CSV table to Markdown.
    table_md = format_table_to_markdown(request.table)
    
    # If using deepseek, enforce a chain-of-thought block.
    extra_instruction = ""
    if "deepseek" in request.model_name.lower():
        extra_instruction = (
            "\n<think>"
        )
    
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
{extra_instruction}"""
    
    model = get_model(request.model_name)
    streamer = TextIteratorStreamer(model.tokenizer
                                    , skip_prompt=True
                                    , skip_special_tokens=True
                                    , timeout=10.0)
    
    def generate():
        model(
            prompt,
            max_new_tokens=1024,
            do_sample=True,
            streamer=streamer
        )
    thread = Thread(target=generate)
    thread.start()
    
    for token in streamer:
        yield token