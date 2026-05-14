import os
import time
import asyncio
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException
from schemas import ChatRequest, ChatResponse
from graph import build_graph
from vectorstore import get_store
from escalation import escalate

# ── Checkpointer setup ────────────────────────────────────────────────────────
# Tries Redis Stack first, falls back to PostgreSQL, falls back to no persistence

_graph = None

def _build_with_postgres():
    from langgraph.checkpoint.postgres import PostgresSaver
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        return None
    try:
        checkpointer = PostgresSaver.from_conn_string(db_url)
        checkpointer.setup()
        print("[main] Using PostgreSQL checkpointer")
        return build_graph(checkpointer)
    except Exception as e:
        print(f"[main] PostgreSQL checkpointer failed: {e}")
        return None

def _build_with_redis():
    redis_url = os.environ.get("REDIS_URL", "")
    if not redis_url:
        return None
    try:
        from langgraph.checkpoint.redis import RedisSaver
        checkpointer = RedisSaver.from_conn_string(redis_url)
        checkpointer.setup()
        print("[main] Using Redis checkpointer")
        return build_graph(checkpointer)
    except Exception as e:
        print(f"[main] Redis checkpointer failed (needs Redis Stack): {e}")
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _graph

    # Pre-load vector store at startup
    store = get_store()
    print(f"[main] Vector store ready — {len(store.all_docs)} chunks")

    # Try checkpointers in order
    _graph = _build_with_redis() or _build_with_postgres() or build_graph()
    if _graph:
        print("[main] LangGraph ready")

    yield
    print("[main] Shutting down")


app = FastAPI(title="LangGraph AI Service", lifespan=lifespan)


@app.get("/health")
async def health():
    store = get_store()
    return {
        "status": "ok",
        "chunks": len(store.all_docs),
        "graph": "ready" if _graph else "no checkpointer",
    }


@app.post("/reload")
async def reload_vectorstore():
    """
    Reload vector_db.json + faq_data.json into memory.
    Called automatically after /adddoc or /updatedocs in the bot.
    """
    import vectorstore as vs
    from vectorstore import VectorStore, _load_faq_into_store
    path = os.environ.get(
        "VECTOR_DB_PATH",
        os.path.expanduser("~/bot/telegram-bot/storage/vectors/vector_db.json")
    )
    new_store = VectorStore(path)
    _load_faq_into_store(new_store)
    vs._store = new_store
    return {"status": "reloaded", "chunks": len(vs._store.all_docs)}


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    if _graph is None:
        raise HTTPException(status_code=503, detail="Graph not initialised")

    config = {"configurable": {"thread_id": str(req.chat_id)}}

    initial_state = {
        "user_message": req.message,
        "chat_id": req.chat_id,
        "username": req.username,
        "language": req.language,
        "messages": [],
        "summary": "",
        "intent": "general",
        "sentiment": "neutral",
        "negative_count": 0,
        "chunks": [],
        "rewrite_count": 0,
        "grade_score": 0.0,
        "response": "",
        "sources": [],
        "escalate": False,
        "escalate_reason": "",
        "_start_time": time.time(),
    }

    try:
        result = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None,
                lambda: _graph.invoke(initial_state, config=config)
            ),
            timeout=25.0,
        )
    except asyncio.TimeoutError:
        return ChatResponse(
            response=(
                "I'm still processing your question — please wait a moment and try again. "
                "You can also check https://t.me/Astarteranncmnt for the latest updates."
            ),
            intent="general",
            sentiment="neutral",
            escalate=False,
            sources=[],
        )
    except Exception as e:
        print(f"[main] Graph error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Fire escalation async (does not block response)
    if result.get("escalate"):
        messages = result.get("messages", [])
        asyncio.create_task(escalate(
            chat_id=req.chat_id,
            username=req.username,
            intent=result.get("intent", "general"),
            sentiment=result.get("sentiment", "neutral"),
            reason=result.get("escalate_reason", "unknown"),
            summary=result.get("summary", ""),
            messages=messages,
        ))

    # Memory compression (async, does not block response)
    messages = result.get("messages", [])
    if len(messages) > 20:
        from memory import compress
        asyncio.create_task(
            asyncio.get_event_loop().run_in_executor(
                None,
                lambda: compress(messages, result.get("summary", ""))
            )
        )

    return ChatResponse(
        response=result.get("response", ""),
        intent=result.get("intent", "general"),
        sentiment=result.get("sentiment", "neutral"),
        escalate=result.get("escalate", False),
        sources=result.get("sources", []),
    )
