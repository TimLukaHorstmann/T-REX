# backend/api/main.py
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from schemas import GenerateRequest
from inference import build_prompt, stream_inference

app = FastAPI()

# These are the allowed models.
ALLOWED_MODELS = ["deepseek-r1:latest", "gemma3", "phi3", "llama3.2"]
# For non-English languages, only allow a subset (adjust as needed).
NON_ENGLISH_ALLOWED = ["gemma3", "llama3.2"]

# URL for your underlying inference engine (Ollama).
# Adjust the port and path according to your setup.
OLLAMA_API_URL = "http://localhost:11434/api/generate"

# --- API Endpoint ---
@app.post("/api/generate")
async def generate(req: GenerateRequest):
    # Validate model choice.
    if req.language != "en" and req.model not in NON_ENGLISH_ALLOWED:
        raise HTTPException(status_code=400, detail="Selected model not allowed for non-English language.")
    if req.model not in ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail="Invalid model selection.")
    # Build the prompt on the backend.
    prompt = build_prompt(req)
    # (Optional) Log the prompt or save to a file in backend/logs if needed.
    # Stream the response back to the client.
    return StreamingResponse(stream_inference(prompt, req, OLLAMA_API_URL), media_type="application/json")