# backend/api/schemas.py
from pydantic import BaseModel
from typing import List, Dict, Any

class InferenceRequest(BaseModel):
    table: str         # The table as CSV text (using "#" as delimiter)
    claim: str
    model_name: str = "microsoft/Phi-4-mini-instruct"  # Default model name; change as needed

class InferenceResponse(BaseModel):
    answer: str
    relevant_cells: List[Dict[str, Any]]
    reasoning: str = ""  # Optional: additional reasoning output
