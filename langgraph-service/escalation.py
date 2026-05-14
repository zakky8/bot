import os
import json
import asyncio
import httpx
import asyncpg
from datetime import datetime, timezone
from langchain_core.messages import BaseMessage, HumanMessage


async def save_to_postgres(
    chat_id: int,
    username: str | None,
    intent: str,
    sentiment: str,
    reason: str,
    summary: str,
    last_messages: list[BaseMessage],
) -> None:
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        print("[escalation] No DATABASE_URL — skipping PG save")
        return

    # Build last 6 messages as JSON
    history = [
        {"role": "user" if isinstance(m, HumanMessage) else "bot", "content": m.content}
        for m in last_messages[-6:]
    ]

    try:
        conn = await asyncpg.connect(db_url)
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS escalations (
                id SERIAL PRIMARY KEY,
                chat_id BIGINT NOT NULL,
                username TEXT,
                intent TEXT,
                sentiment TEXT,
                reason TEXT,
                summary TEXT,
                history JSONB,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
            """
        )
        await conn.execute(
            """
            INSERT INTO escalations (chat_id, username, intent, sentiment, reason, summary, history)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            chat_id,
            username,
            intent,
            sentiment,
            reason,
            summary,
            json.dumps(history),
        )
        await conn.close()
        print(f"[escalation] Saved to PG — chat_id={chat_id}")
    except Exception as e:
        print(f"[escalation] PG save failed: {e}")


async def notify_moderator(
    chat_id: int,
    username: str | None,
    intent: str,
    sentiment: str,
    reason: str,
    summary: str,
    last_messages: list[BaseMessage],
) -> None:
    bot_token = os.environ.get("BOT_TOKEN", "")
    moderator_chat_id = os.environ.get("HUMAN_MODERATOR_CHAT_ID", "")
    if not bot_token or not moderator_chat_id:
        print("[escalation] No BOT_TOKEN or HUMAN_MODERATOR_CHAT_ID — skipping Telegram alert")
        return

    user_ref = f"@{username}" if username else f"chat_id: {chat_id}"
    recent = "\n".join(
        f"{'👤' if isinstance(m, HumanMessage) else '🤖'} {m.content[:120]}"
        for m in last_messages[-6:]
    )

    text = (
        f"⚠️ <b>Escalation Alert</b>\n\n"
        f"<b>User:</b> {user_ref}\n"
        f"<b>Chat ID:</b> <code>{chat_id}</code>\n"
        f"<b>Intent:</b> {intent}\n"
        f"<b>Sentiment:</b> {sentiment}\n"
        f"<b>Reason:</b> {reason}\n\n"
        f"<b>Summary:</b>\n{summary or 'No summary yet'}\n\n"
        f"<b>Last messages:</b>\n{recent}"
    )

    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={
                    "chat_id": moderator_chat_id,
                    "text": text[:4096],
                    "parse_mode": "HTML",
                },
                timeout=10,
            )
        print(f"[escalation] Telegram alert sent for chat_id={chat_id}")
    except Exception as e:
        print(f"[escalation] Telegram alert failed: {e}")


async def escalate(
    chat_id: int,
    username: str | None,
    intent: str,
    sentiment: str,
    reason: str,
    summary: str,
    messages: list[BaseMessage],
) -> None:
    """Run PG save + Telegram alert concurrently."""
    await asyncio.gather(
        save_to_postgres(chat_id, username, intent, sentiment, reason, summary, messages),
        notify_moderator(chat_id, username, intent, sentiment, reason, summary, messages),
    )
