# backend/api/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from backend.api.schemas import InferenceRequest, InferenceResponse
from backend.api.inference import get_model, perform_inference, stream_inference

app = FastAPI()

# Configure CORS – adjust allowed origins in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/inference", response_model=InferenceResponse)
async def inference_endpoint(request: InferenceRequest):
    """
    Synchronous endpoint for table fact checking.
    Returns the final answer with reasoning.
    """
    try:
        response = perform_inference(request)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/inference/stream")
async def inference_stream_endpoint(request: InferenceRequest):
    """
    Streaming endpoint for live table fact checking.
    Streams the generated tokens (e.g., for live UI updates).
    """
    try:
        generator = stream_inference(request)
        return StreamingResponse(generator, media_type="text/event-stream")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

@app.post("/model/load")
async def load_model_endpoint(request: InferenceRequest):
    """
    Endpoint to preload a model.
    The request only needs the 'model_name'; table and claim can be empty.
    """
    try:
        _ = get_model(request.model_name)
        return {"status": "loaded", "model_name": request.model_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

