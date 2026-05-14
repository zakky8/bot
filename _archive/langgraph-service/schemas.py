from pydantic import BaseModel
from typing import Optional

class ChatRequest(BaseModel):
    chat_id: int
    message: str
    username: Optional[str] = None
    first_name: Optional[str] = None
    language: Optional[str] = None  # e.g. "Russian", "Arabic" — from aiService.getUserLang()

class ChatResponse(BaseModel):
    response: str
    intent: str
    sentiment: str
    escalate: bool
    sources: list[str]
