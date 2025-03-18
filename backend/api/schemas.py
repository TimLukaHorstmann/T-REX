# backend/api/schemas.py
from pydantic import BaseModel
from fastapi import Form

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

class OCRRequest(BaseModel):
    engine: str
    model: str = "granite3.2-vision"

    @classmethod
    def as_form(cls, engine: str = Form(...), model: str = Form("granite3.2-vision")):
        return cls(engine=engine, model=model)