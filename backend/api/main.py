# backend/api/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from backend.api.schemas import InferenceRequest, InferenceResponse
from backend.api.inference import get_model, run_inference

app = FastAPI()

# Configure CORS – adjust allowed origins in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/inference/stream")
async def inference_stream_endpoint(table: str, claim: str, model_name: str):
    try:
        # Build an InferenceRequest from query parameters.
        request_obj = InferenceRequest(table=table, claim=claim, model_name=model_name)
        stream_generator = run_inference(request_obj)
        return StreamingResponse(
            stream_generator,
            media_type="text/plain",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no"
            }
        )
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

