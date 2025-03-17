# backend/api/schemas.py
from pydantic import BaseModel

class GenerateRequest(BaseModel):
    tableText: str
    claimText: str
    language: str
    model: str
    includeTitle: bool = False
    tableTitle: str = ""
    max_tokens: int = 2048
    keep_alive: int = 0
    stream: bool = True