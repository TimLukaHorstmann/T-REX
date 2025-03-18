# backend/api/main.py
from fastapi import FastAPI, HTTPException, File, UploadFile, Depends
from fastapi.responses import StreamingResponse, JSONResponse
import json
from schemas import GenerateRequest, OCRRequest
from ocr import process_ocr
from inference import build_prompt, stream_inference

app = FastAPI()

ALLOWED_MODELS = ["deepseek-r1:latest", "gemma3", "phi3", "llama3.2"]
NON_ENGLISH_ALLOWED = ["gemma3", "llama3.2"]
OLLAMA_API_URL = "http://localhost:11434/api/generate"

# --- API Endpoints ---
@app.post("/api/generate")
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