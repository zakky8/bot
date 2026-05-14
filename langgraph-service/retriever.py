import json
import re
from llm import converse
from vectorstore import get_store

THRESHOLD = 0.35

def retrieve(query: str, intent: str, k: int = 5) -> list[dict]:
    return get_store().query(query, k=k, intent=intent)

def grade_chunks(query: str, chunks: list[dict]) -> float:
    """Score all chunks in ONE Bedrock call. Returns average relevance score."""
    if not chunks:
        return 0.0

    chunk_list = "\n\n".join(
        f"[{i+1}] {c['content'][:300]}" for i, c in enumerate(chunks)
    )
    user_prompt = (
        f"Rate how relevant each chunk is to the query on a scale of 0.0 to 1.0.\n"
        f"Query: {query}\n\n"
        f"Chunks:\n{chunk_list}\n\n"
        f'Reply ONLY with valid JSON: {{"scores": [0.0, 0.0, ...]}} — one score per chunk.'
    )
    try:
        raw = converse(
            system="You are a relevance grader. Reply only with JSON.",
            user=user_prompt,
            max_tokens=128,
            temperature=0.0,
        )
        raw = re.sub(r"```json|```", "", raw).strip()
        data = json.loads(raw)
        scores = data.get("scores", [])
        if not scores:
            return 0.5
        return sum(scores) / len(scores)
    except Exception:
        return 0.5

def rewrite_query(original: str) -> str:
    """Expand/clarify the query for a retry."""
    try:
        return converse(
            system="Rewrite the user query to be more specific and searchable. Return only the rewritten query, nothing else.",
            user=original,
            max_tokens=64,
            temperature=0.0,
        ).strip()
    except Exception:
        return original
