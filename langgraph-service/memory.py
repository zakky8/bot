from langchain_core.messages import HumanMessage, AIMessage, BaseMessage
from llm import converse

TURN_LIMIT = 10  # compress after 10 turns (20 messages)
KEEP_RECENT = 4  # always keep last 4 messages verbatim


def should_compress(messages: list[BaseMessage]) -> bool:
    return len(messages) > TURN_LIMIT * 2


def compress(messages: list[BaseMessage], existing_summary: str = "") -> tuple[str, list[BaseMessage]]:
    """
    Summarise older messages into a rolling summary.
    Returns (new_summary, trimmed_messages_to_keep).
    """
    to_summarise = messages[:-KEEP_RECENT]
    to_keep = messages[-KEEP_RECENT:]

    history_text = "\n".join(
        f"{'User' if isinstance(m, HumanMessage) else 'Bot'}: {m.content}"
        for m in to_summarise
    )

    if existing_summary:
        user_prompt = (
            f"Existing summary:\n{existing_summary}\n\n"
            f"Extend the summary with these new messages:\n{history_text}\n\n"
            "Return only the updated summary — 3 to 5 bullet points."
        )
    else:
        user_prompt = f"Summarise this conversation in 3 to 5 bullet points:\n{history_text}"

    try:
        new_summary = converse(
            system="You are a concise conversation summariser. Return bullet points only.",
            user=user_prompt,
            max_tokens=256,
            temperature=0.0,
        ).strip()
    except Exception:
        new_summary = existing_summary  # keep old summary on failure

    return new_summary, to_keep


def build_history_prefix(summary: str) -> str:
    if not summary:
        return ""
    return f"Summary of earlier conversation:\n{summary}\n\n"
