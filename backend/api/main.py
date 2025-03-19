# backend/api/main.py
from fastapi import FastAPI, HTTPException, File, UploadFile, Depends, Request, Query
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

import os
import json
from schemas import GenerateRequest, OCRRequest
from ocr import process_ocr
from inference import build_prompt, stream_inference

app = FastAPI()

ALLOWED_MODELS = ["phi4", "deepseek-r1:latest", "gemma3", "phi3", "llama3.2"]
NON_ENGLISH_ALLOWED = ["gemma3", "llama3.2"]
OLLAMA_API_URL = "http://localhost:11434/api/generate"

# --- Static Files ---
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
data_path = os.path.join(BASE_DIR, "data")
app.mount("/static/data", StaticFiles(directory=data_path), name="data")

# --- Rate Limiting ---
limiter = Limiter(key_func=get_remote_address, default_limits=["20/minute"])
app.state.limiter = limiter

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded. Please try again later."}
    )

# --- API Endpoints ---
@app.get("/api/dataset_ids")
async def get_dataset_ids(offset: int = Query(0, ge=0), limit: int = Query(100, gt=0)):
    file_path = os.path.join(BASE_DIR, "data", "all_csv_ids.json")
    try:
        with open(file_path, "r") as f:
            data = json.load(f)
        data.sort()
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to load dataset IDs")
    total = len(data)
    start = min(offset, total)
    end = min(offset + limit, total)
    return {"total": total, "ids": data[start:end]}

@app.post("/api/inference")
async def generate(req: GenerateRequest):
    if req.language != "en" and req.model not in NON_ENGLISH_ALLOWED:
        raise HTTPException(status_code=400, detail="Selected model not allowed for non-English language.")
    if req.model not in ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail="Invalid model selection.")
    prompt = build_prompt(req)
    return StreamingResponse(stream_inference(prompt, req, OLLAMA_API_URL), media_type="application/json")

@app.post("/api/ocr")
async def ocr(
    file: UploadFile = File(...),
    req: OCRRequest = Depends(OCRRequest.as_form)
):
    if req.engine not in ["tesseract", "ollama"]:
        raise HTTPException(status_code=400, detail="Invalid OCR engine. Choose 'tesseract' or 'ollama'.")
    if req.engine == "ollama" and req.model != "granite3.2-vision":
        raise HTTPException(status_code=400, detail="Ollama OCR requires model 'granite3.2-vision'.")

    image_bytes = await file.read()
    try:
        csv_text = await process_ocr(req.engine, req.model, image_bytes)
        return JSONResponse(content={"csv_text": csv_text})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR processing failed: {str(e)}")