import json
import os
import numpy as np
from llm import embed

INTENT_KEYWORDS: dict[str, list[str]] = {
    "project":      ["astarter", "depin", "web4", "abox", "core agent", "architecture", "use case", "flywheel", "what is"],
    "nodes":        ["node", "pioneer", "alliance", "community", "abox", "slot", "tier", "price", "earn", "revenue", "nft"],
    "token":        ["aa", "token", "tokenomics", "tge", "supply", "vesting", "emission", "airdrop", "allocation"],
    "mulan":        ["mulan", "point", "nft", "star", "referral", "airdrop", "30%", "bnb", "redeem"],
    "partnerships": ["partner", "paygo", "zeus", "eni", "eniac", "zbtc", "collaboration"],
    "roadmap":      ["roadmap", "when", "timeline", "launch", "mainnet", "q2", "q3", "2026", "phase", "milestone"],
    "team":         ["team", "investor", "okx", "emurgo", "advisor", "founder", "backed", "who"],
    "developers":   ["developer", "sdk", "api", "langchain", "framework", "build", "grant", "autogpt"],
    "links":        ["link", "website", "telegram", "twitter", "discord", "medium", "gitbook", "social", "official"],
    "general":      [],
}

class VectorStore:
    def __init__(self, path: str):
        self.docs: list[str] = []
        self.metadata: list[dict] = []
        self.matrix: np.ndarray | None = None
        self._load(path)

    def _load(self, path: str) -> None:
        if not os.path.exists(path):
            print(f"[vectorstore] WARNING: {path} not found — KB empty")
            return
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        self.docs = [d["pageContent"] for d in data]
        self.metadata = [d.get("metadata", {}) for d in data]
        raw = np.array([d["embedding"] for d in data], dtype="float32")
        norms = np.linalg.norm(raw, axis=1, keepdims=True)
        self.matrix = raw / np.clip(norms, 1e-10, None)
        print(f"[vectorstore] Loaded {len(self.docs)} chunks from {path}")

    def query(self, text: str, k: int = 5, intent: str = "general") -> list[dict]:
        if self.matrix is None or len(self.docs) == 0:
            return []

        emb = embed(text)
        q = np.array(emb, dtype="float32")
        q /= np.linalg.norm(q) + 1e-10
        scores = self.matrix @ q

        # Boost chunks matching intent keywords
        keywords = INTENT_KEYWORDS.get(intent, [])
        if keywords:
            for i, doc in enumerate(self.docs):
                doc_lower = doc.lower()
                if any(kw in doc_lower for kw in keywords):
                    scores[i] = min(scores[i] * 1.15, 1.0)

        top_k = np.argsort(scores)[::-1][:k]
        return [
            {
                "content": self.docs[i],
                "metadata": self.metadata[i],
                "score": float(scores[i]),
            }
            for i in top_k
        ]

    @property
    def all_docs(self) -> list[str]:
        return self.docs


_store: VectorStore | None = None

def _load_faq_into_store(store: VectorStore) -> None:
    """
    Load faq_data.json entries directly into the in-memory vector store.
    The TypeScript bot injects these as system prompt text — Python needs them
    embedded so they're searchable via vector similarity.
    """
    faq_candidates = [
        os.environ.get("FAQ_DATA_PATH", ""),
        os.path.join(os.path.dirname(__file__), "..", "telegram-bot", "faq_data.json"),
        os.path.join(os.path.dirname(__file__), "..", "faq_data.json"),
        os.path.expanduser("~/bot/telegram-bot/faq_data.json"),
        os.path.expanduser("~/bot/faq_data.json"),
    ]

    faq_path = next((p for p in faq_candidates if p and os.path.exists(p)), None)
    if not faq_path:
        print("[vectorstore] faq_data.json not found — skipping FAQ load")
        return

    with open(faq_path, encoding="utf-8") as f:
        entries = json.load(f)

    new_docs = []
    new_meta = []
    new_embeddings = []

    for entry in entries:
        q = entry.get("q", "").strip()
        a = entry.get("a", "").strip()
        if not q or not a:
            continue
        text = f"Q: {q}\nA: {a}"

        # Skip if already in store (avoid duplicates on reload)
        if any(text in doc for doc in store.docs):
            continue

        try:
            emb = embed(text)
            new_docs.append(text)
            new_meta.append({"source": "faq_data.json", "type": "faq", "q": q[:80]})
            new_embeddings.append(emb)
        except Exception as e:
            print(f"[vectorstore] FAQ embed failed for '{q[:40]}': {e}")

    if not new_docs:
        print("[vectorstore] FAQ entries already in store or nothing to add")
        return

    raw_new = np.array(new_embeddings, dtype="float32")
    norms = np.linalg.norm(raw_new, axis=1, keepdims=True)
    raw_new = raw_new / np.clip(norms, 1e-10, None)

    store.docs.extend(new_docs)
    store.metadata.extend(new_meta)

    if store.matrix is not None:
        store.matrix = np.vstack([store.matrix, raw_new])
    else:
        store.matrix = raw_new

    print(f"[vectorstore] Loaded {len(new_docs)} FAQ entries from {faq_path}")


def get_store() -> VectorStore:
    global _store
    if _store is None:
        path = os.environ.get(
            "VECTOR_DB_PATH",
            os.path.expanduser("~/bot/telegram-bot/storage/vectors/vector_db.json")
        )
        _store = VectorStore(path)
        _load_faq_into_store(_store)
    return _store
