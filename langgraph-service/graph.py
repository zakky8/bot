import json
import re
import time
from typing import Annotated, Literal
import operator
from typing_extensions import TypedDict

from langchain_core.messages import HumanMessage, AIMessage, BaseMessage
from langgraph.graph import StateGraph, START, END

from llm import converse
from retriever import retrieve, grade_chunks, rewrite_query
from prompts import get_prompt
from memory import should_compress, compress, build_history_prefix

ANN_CHANNEL = "https://t.me/Astarteranncmnt"
WALL_CLOCK_LIMIT = 22  # seconds — force-exit before Telegram's 30s limit


# ── State ─────────────────────────────────────────────────────────────────────

class AgentState(TypedDict):
    # Input
    user_message: str
    chat_id: int
    username: str | None
    language: str | None  # user's detected language e.g. "Russian"

    # Conversation history (persisted via checkpointer)
    messages: Annotated[list[BaseMessage], operator.add]
    summary: str

    # Classification
    intent: str
    sentiment: str
    negative_count: int

    # Retrieval
    chunks: list[dict]
    rewrite_count: int
    grade_score: float

    # Output
    response: str
    sources: list[str]
    escalate: bool
    escalate_reason: str

    # Internal timing
    _start_time: float


# ── Node 1+2: Intent + Sentiment in ONE call (saves 1 Bedrock call per message) ──

def intent_classifier(state: AgentState) -> dict:
    prompt = (
        "Analyse the user message and return BOTH the topic category AND sentiment.\n\n"
        "Categories:\n"
        "- project: what Astarter is, how it works, use cases, architecture, CORE agents\n"
        "- nodes: ABox nodes, Pioneer/Alliance/Community tiers, prices, earning, slots\n"
        "- token: AA token, tokenomics, TGE, vesting, supply, emission\n"
        "- mulan: MULAN points, airdrop, NFT star levels, referrals, 30% pool, node revenue tiers\n"
        "- partnerships: PayGo, Zeus Network, ENI/ENIAC, MULAN Labs partnership details\n"
        "- roadmap: timeline, milestones, mainnet date, phases\n"
        "- team: investors, advisors, OKX Ventures, EMURGO, founders\n"
        "- developers: SDK, API, AI Agents Framework, Grant Program, building on Astarter\n"
        "- links: official website, social media, Telegram, Discord, Gitbook links\n"
        "- general: bot usage, community help, anything else\n\n"
        "Sentiment: positive | neutral | negative\n\n"
        f'Reply ONLY with valid JSON: {{"intent": "<category>", "sentiment": "<sentiment>"}}\n\n'
        f"Message: {state['user_message']}"
    )
    try:
        raw = converse(
            system="You are a classifier. Reply only with JSON.",
            user=prompt,
            max_tokens=64,
            temperature=0.0,
        )
        raw = re.sub(r"```json|```", "", raw).strip()
        data = json.loads(raw)

        valid_intents = {"project", "nodes", "token", "mulan", "partnerships", "roadmap", "team", "developers", "links", "general"}
        intent = data.get("intent", "general")
        if intent not in valid_intents:
            intent = "general"

        sentiment = data.get("sentiment", "neutral")
        if sentiment not in {"positive", "neutral", "negative"}:
            sentiment = "neutral"
    except Exception:
        intent = "general"
        sentiment = "neutral"

    return {"intent": intent, "sentiment": sentiment}


# ── Node 2: Sentiment escalation check (uses result from Node 1, no extra call) ──

def sentiment_analyzer(state: AgentState) -> dict:
    sentiment = state.get("sentiment", "neutral")
    neg_count = state.get("negative_count", 0)
    if sentiment == "negative":
        neg_count += 1
    return {
        "negative_count": neg_count,
        "escalate": neg_count >= 2,
        "escalate_reason": "2 consecutive negative sentiment turns" if neg_count >= 2 else state.get("escalate_reason", ""),
    }


# ── Node 3: Retriever ─────────────────────────────────────────────────────────

def retriever_node(state: AgentState) -> dict:
    chunks = retrieve(state["user_message"], intent=state.get("intent", "general"), k=5)
    sources = [c["content"][:80] for c in chunks]
    return {"chunks": chunks, "sources": sources}


# ── Node 4: Grader ────────────────────────────────────────────────────────────

def grader_node(state: AgentState) -> dict:
    # Wall-clock guard — if we're running out of time, skip grading
    elapsed = time.time() - state.get("_start_time", time.time())
    if elapsed > 15:
        return {"grade_score": 1.0}  # force-pass, let generator handle it

    score = grade_chunks(state["user_message"], state.get("chunks", []))
    return {"grade_score": score}


def route_after_grader(state: AgentState) -> Literal["retriever_node", "generator_node", "escalation_node"]:
    score = state.get("grade_score", 0.0)
    rewrite_count = state.get("rewrite_count", 0)

    if score >= 0.35:
        return "generator_node"

    if rewrite_count < 2:
        # Rewrite query and retry
        new_query = rewrite_query(state["user_message"])
        state["user_message"] = new_query
        state["rewrite_count"] = rewrite_count + 1
        return "retriever_node"

    # Max retries exhausted
    return "escalation_node"


# ── Node 5: Generator ─────────────────────────────────────────────────────────

def generator_node(state: AgentState) -> dict:
    intent = state.get("intent", "general")
    system_prompt = get_prompt(intent)

    # Append language instruction if detected
    lang = state.get("language")
    if lang:
        system_prompt += f"\n\nIMPORTANT: The user communicates in {lang}. Reply in {lang}."

    # Build context from chunks
    chunks = state.get("chunks", [])
    if chunks:
        context = "\n\n---\n\n".join(c["content"] for c in chunks)
        context_block = f"Relevant knowledge base context:\n{context}\n\n"
    else:
        context_block = ""

    # Build memory prefix
    history_prefix = build_history_prefix(state.get("summary", ""))

    # Build conversation history for the prompt
    recent_messages = state.get("messages", [])[-8:]  # last 4 turns
    history_block = ""
    if recent_messages:
        history_block = "Recent conversation:\n" + "\n".join(
            f"{'User' if isinstance(m, HumanMessage) else 'Bot'}: {m.content}"
            for m in recent_messages
        ) + "\n\n"

    user_prompt = (
        f"{history_prefix}"
        f"{history_block}"
        f"{context_block}"
        f"User: {state['user_message']}"
    )

    try:
        response = converse(
            system=system_prompt,
            user=user_prompt,
            max_tokens=1024,
            temperature=0.4,
        ).strip()
    except Exception:
        response = f"I'm having trouble processing that right now. Please check the announcements channel: {ANN_CHANNEL}"

    # Append to message history
    new_messages = [
        HumanMessage(content=state["user_message"]),
        AIMessage(content=response),
    ]

    return {"response": response, "messages": new_messages}


# ── Node 6: Output Check (no LLM call) ───────────────────────────────────────

ALLOWED_URLS = {
    "https://www.astarter.io",
    "https://astarter.gitbook.io",
    "https://t.me/AstarterDefiHubOfficial",
    "https://t.me/Astarteranncmnt",
    "https://x.com/AstarterDefiHub",
    "https://twitter.com/AstarterDefiHub",
    "https://discord.gg/XXDEjFPrgR",
    "https://medium.com/@AstarterDefiHub",
    "https://www.reddit.com/r/Astarter/",
    "https://youtube.com/c/astartertv",
    "https://zealy.io/cw/astarterdefihub/leaderboard",
    "https://linktr.ee/Astarter",
    "https://mulan.meme",
    "https://www.paygo.ac",
    "https://x.com/PayGo402",
    "https://t.me/Paygo_eni",
    "https://zeusnetwork.xyz",
    "https://x.com/ZeusNetworkHQ",
    "https://discord.gg/zeusnetwork",
    "https://eniac.network",
    "https://docs.eniac.network",
    "https://x.com/ENI__Official",
    "https://t.me/ENI_Channel",
    "https://t.me/ENI_Community",
}

def output_check(state: AgentState) -> dict:
    response = state.get("response", "")

    # Strip disallowed URLs
    url_pattern = re.compile(r'https?://[^\s<>"\']+')
    def replace_url(m: re.Match) -> str:
        url = m.group(0).rstrip(".,;)")
        return url if url in ALLOWED_URLS else "[link removed]"
    response = url_pattern.sub(replace_url, response)

    # If response is empty or too short, use dead-end fallback
    if len(response.strip()) < 20:
        response = (
            f"I don't have confirmed details on that yet. "
            f"Check the announcements channel for the latest updates: {ANN_CHANNEL}"
        )

    return {"response": response}


# ── Escalation Node ───────────────────────────────────────────────────────────

def escalation_node(state: AgentState) -> dict:
    reason = state.get("escalate_reason", "low retrieval confidence after max retries")
    return {
        "response": (
            "I wasn't able to find a confident answer for your question. "
            "A human moderator has been notified and will follow up with you shortly. "
            f"You can also check the announcements channel for updates: {ANN_CHANNEL}"
        ),
        "escalate": True,
        "escalate_reason": reason,
    }


def route_after_sentiment(state: AgentState) -> Literal["retriever_node", "escalation_node"]:
    if state.get("escalate"):
        return "escalation_node"
    return "retriever_node"


# ── Graph Assembly ────────────────────────────────────────────────────────────

def build_graph(checkpointer=None):
    g = StateGraph(AgentState)

    g.add_node("intent_classifier", intent_classifier)
    g.add_node("sentiment_analyzer", sentiment_analyzer)
    g.add_node("retriever_node", retriever_node)
    g.add_node("grader_node", grader_node)
    g.add_node("generator_node", generator_node)
    g.add_node("output_check", output_check)
    g.add_node("escalation_node", escalation_node)

    # Parallel fan-out from START
    g.add_edge(START, "intent_classifier")
    g.add_edge(START, "sentiment_analyzer")

    # Intent goes straight to retriever
    g.add_edge("intent_classifier", "retriever_node")

    # Sentiment: escalate immediately if 2× negative, else wait for retriever
    g.add_conditional_edges(
        "sentiment_analyzer",
        route_after_sentiment,
        {"retriever_node": "retriever_node", "escalation_node": "escalation_node"},
    )

    g.add_edge("retriever_node", "grader_node")

    g.add_conditional_edges(
        "grader_node",
        route_after_grader,
        {
            "retriever_node": "retriever_node",
            "generator_node": "generator_node",
            "escalation_node": "escalation_node",
        },
    )

    g.add_edge("generator_node", "output_check")
    g.add_edge("output_check", END)
    g.add_edge("escalation_node", END)

    kwargs = {}
    if checkpointer:
        kwargs["checkpointer"] = checkpointer

    return g.compile(**kwargs)
