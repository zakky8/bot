"""
embed_deck.py
Embeds the Astarter project deck as high-priority knowledge docs into vector_db.json.
Run after any deck content update to keep the knowledge base current.

This script ADDS to the existing vector store — it does not overwrite telegram_history chunks.
Existing 'astarter_deck' docs are removed first to avoid duplicates on re-runs.

Usage:
  python embed_deck.py

Environment (reads from ../telegram-bot/.env):
  AWS_ACCESS_KEY   - AWS access key ID
  AWS_SECRET_KEY   - AWS secret access key
  AWS_REGION       - AWS region (default: eu-north-1)
"""

import json
import os
import sys
import time

import boto3
from botocore.exceptions import ClientError

# ── Config ────────────────────────────────────────────────────────────────────

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(SCRIPT_DIR, "..", "telegram-bot", "storage", "vectors", "vector_db.json")
EMBED_MODEL = "amazon.titan-embed-text-v2:0"

# ── Load AWS creds ────────────────────────────────────────────────────────────

def load_env():
    env_path = os.path.join(SCRIPT_DIR, "..", "telegram-bot", ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

load_env()

AWS_KEY    = os.environ.get("AWS_ACCESS_KEY", "")
AWS_SECRET = os.environ.get("AWS_SECRET_KEY", "")
AWS_REGION = os.environ.get("AWS_REGION", "eu-north-1")

if not AWS_KEY or AWS_KEY.startswith("your_"):
    print("ERROR: AWS_ACCESS_KEY not configured. Check telegram-bot/.env")
    sys.exit(1)

# ── AWS Bedrock client ────────────────────────────────────────────────────────

bedrock = boto3.client(
    "bedrock-runtime",
    region_name=AWS_REGION,
    aws_access_key_id=AWS_KEY,
    aws_secret_access_key=AWS_SECRET,
)

def get_embedding(text: str) -> list:
    text = text.strip()[:8000]
    payload = json.dumps({"inputText": text})
    for attempt in range(4):
        try:
            response = bedrock.invoke_model(
                modelId=EMBED_MODEL,
                contentType="application/json",
                accept="application/json",
                body=payload,
            )
            return json.loads(response["body"].read())["embedding"]
        except ClientError as e:
            code = e.response["Error"]["Code"]
            if code in ("ThrottlingException", "ServiceUnavailableException"):
                wait = 2 ** attempt * 3
                print(f"  Throttled (attempt {attempt + 1}). Waiting {wait}s...")
                time.sleep(wait)
            else:
                raise
    raise RuntimeError("Embedding failed after 4 retries")

# ── Deck knowledge chunks ─────────────────────────────────────────────────────
# Each entry is a focused, self-contained piece of knowledge.
# Smaller chunks = more precise RAG retrieval.

DECK_CHUNKS = [
    {
        "id": "deck_overview",
        "text": """Astarter — Infrastructure for the Autonomous AI Economy (Web4)

Astarter is a decentralized AI network designed for Web4. It combines DePIN infrastructure with on-chain execution to enable autonomous AI agents to operate, coordinate, and create real economic value.

Core mission: Build the foundation for a global AI agent economy.
Backed by: OKX Ventures and EMURGO (lead investors).
Tags: Web4, AI, DePIN, autonomous agents, on-chain execution.

Astarter solves three core problems:
1. AI remains centralized — today's AI platforms are controlled by a few companies; users cannot truly own, deploy, or monetize AI.
2. DePIN lacks an AI coordination layer — existing DePIN networks provide compute but not an AI-native application layer.
3. AI is not natively economic on-chain — AI cannot autonomously execute trades; blockchains lack truly intelligent execution actors.

Astarter's solution: Three pillars:
- Decentralized AI Agent Network: transforms AI from a centralized tool into autonomous, user-owned agents anyone can deploy.
- On-Chain Execution Layer: enables AI agents to execute trades, strategies, and complex actions on-chain.
- ABox + DePIN Node Network: ABox nodes provide compute and execution environment connecting agent operations, revenue distribution, and network incentives."""
    },
    {
        "id": "deck_abox",
        "text": """ABox — Astarter's Core AI Node Device

ABox is the core AI node device of the Astarter network. It enables anyone to run AI agents and join the global AI economy.

ABox Key Features:
- Open Protocol: powered by OpenClaw, compatible with major open-source AI agent frameworks (LangChain, AutoGPT, etc.)
- On-chain Execution Capability: built-in engine for smart contract calls, DeFi trades, and economic actions
- Plug-and-Play Node: connects to Astarter network out of the box, no technical setup needed
- Multi-Agent Runtime: supports multiple AI agents running in parallel for coordinated strategies

OpenClaw: The open protocol powering ABox. Makes ABox compatible with major open-source AI agent frameworks, allowing developers to build and deploy any type of AI agent on the Astarter network.

ABox nodes sit at Layer 2 (Node Layer) of Astarter's four-layer architecture, providing compute and execution environment for the entire network."""
    },
    {
        "id": "deck_node_tiers",
        "text": """ABox Node Tiers and Pricing

ABox nodes come in three tiers. All tiers include: Revenue sharing + ABox presale whitelist.

LITE Tier:
- Price: $500
- Token allocation: 1,333 tokens
- Available slots: 12,000 slots

PRO Tier:
- Price: $1,000
- Token allocation: 2,900 tokens
- Available slots: 4,137 slots

MAX Tier:
- Price: $3,000
- Token allocation: 10,500 tokens
- Available slots: 1,142 slots

Revenue Sources for all node operators:
- AI agent execution fees
- ABox compute rewards
- Agent Marketplace revenue
- AI DEX trading fees
- Prediction Market fees

Revenue is generated from execution fees, trading profits, and protocol revenue sharing across the network."""
    },
    {
        "id": "deck_architecture",
        "text": """Astarter Four-Layer AI Economy Architecture

Layer 1 — Infrastructure Layer:
High-performance blockchain with AI-native execution environment for on-chain agent operation and settlement.

Layer 2 — Node Layer (ABox):
ABox DePIN nodes provide compute and execution, run AI agents and network tasks, and share in network revenue. This is where ABox hardware sits.

Layer 3 — Agent Layer (CORE):
CORE is Astarter's autonomous AI agent platform. Agents execute trades, strategies, and predictions while generating revenue. CORE is the intelligence and execution brain of the Astarter network, sitting between the ABox node infrastructure and the application layer.

Layer 4 — Application Layer:
- AI DEX: Execute trading, market-making, and arbitrage to improve on-chain liquidity
- Prediction Market: Analyze on-chain and external data for accurate predictions
- Data Market: AI agents generate, process, and trade data
- Agent App Store (Agent Marketplace): Users can buy, deploy, or rent AI agents

Economic Flywheel: Applications provide tasks -> AI Agents execute and generate revenue -> Revenue incentivizes ABox Nodes -> Nodes provide more compute -> supports more agents and larger demand (self-reinforcing growth cycle)."""
    },
    {
        "id": "deck_tokenomics",
        "text": """Astarter Token Economics (Tokenomics)

Total Supply: 1,000,000,000 (1 billion tokens)

Token Allocation:
- Ecosystem & Community: 42% — early user incentives, marketing, ecosystem development rewards
- Ecosystem Development: 38% — includes Staking Mining (ABF node and staking rewards: 250,000 tokens/day, with 10% reduction every 6 months)
- Market Cap Management: 10%
- Research & Development: 5%
- Node Airdrop: 4%
- Community Incentives: 1%

Vesting for Team and Investment Institutions:
- 1-year cliff period
- 4-year linear vesting after cliff

Staking Mining Details:
- ABF node and staking rewards: 250,000 tokens per day
- Reduction schedule: 10% reduction every 6 months"""
    },
    {
        "id": "deck_roadmap",
        "text": """Astarter Roadmap

2025 Q3-Q4:
- Launch ABox node deployment
- Testnet launch

2026 Q2-Q3:
- Mainnet launch
- Launch Astarter Grant program
- Enable native interaction between AI agents and DePIN nodes

2026 Q4:
- Launch ABox Agent App Store
- Integrate with major blockchains
- Add more compute nodes

2027 and beyond:
- Enable automated agent-to-agent execution
- Build the next-generation Web4 agent economy"""
    },
    {
        "id": "deck_investors_team",
        "text": """Astarter Investors, Backers, and Advisors

Lead Investors:
- OKX Ventures (major crypto venture fund)
- EMURGO (official Cardano ecosystem venture arm)

Other Investors:
- Adaverse
- MH Ventures
- Avatar Capital
- 316VC
- CRT Capital
- Megala Ventures

Advisors:
- Sergio Sanchez — Head of Product at EMURGO, associated with Yoroi Wallet
- John O'Connor — Director of African Operations at IOHK/Cardano
- Darren Camas — CEO of IPOR Labs"""
    },
    {
        "id": "deck_use_cases",
        "text": """Astarter AI Agent Use Cases

AI DEX:
AI agents execute trading, market-making, and arbitrage strategies to improve on-chain liquidity. Agents operate 24/7 and optimize for best execution across DEX pools.

Prediction Market:
AI agents analyze on-chain data and external data feeds to participate in and improve prediction markets. Higher accuracy prediction means better outcomes for participants.

Data Market:
AI agents generate, process, and trade data to power a decentralized data network. Data becomes a monetizable asset within the Astarter economy.

Agent Marketplace (Agent App Store):
Users can buy, deploy, or rent AI agents. Developers can monetize their AI agent capabilities. Anyone can access specialized agents without needing to build from scratch.

All use cases are powered by ABox nodes at Layer 2 and CORE agents at Layer 3, with Layer 4 applications providing the interfaces and markets."""
    },
    {
        "id": "deck_earning",
        "text": """How to Earn with Astarter / ABox Node Revenue Streams

ABox node operators earn from multiple revenue streams:

1. AI Agent Execution Fees — fees paid when AI agents execute trades, strategies, or actions
2. ABox Compute Rewards — rewards for providing compute power to the network
3. Agent Marketplace Revenue — share of fees from the Agent App Store
4. AI DEX Trading Fees — share of fees from AI-powered decentralized exchange
5. Prediction Market Fees — share of fees from prediction market activity

All three node tiers (LITE/PRO/MAX) participate in revenue sharing.
Higher tier = more tokens allocated = larger share of network revenue.

Node pricing summary: LITE $500, PRO $1,000, MAX $3,000.
Token allocation: LITE 1,333 / PRO 2,900 / MAX 10,500 tokens."""
    },
]

# ── Main ──────────────────────────────────────────────────────────────────────

def embed():
    # Load existing vector store
    existing_docs = []
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, encoding="utf-8") as f:
                existing_docs = json.load(f)
            # Remove old deck docs (to avoid duplicates on re-run)
            before = len(existing_docs)
            existing_docs = [d for d in existing_docs if d.get("metadata", {}).get("type") != "astarter_deck"]
            removed = before - len(existing_docs)
            if removed:
                print(f"Removed {removed} old deck docs (will re-embed).")
            print(f"Existing docs preserved: {len(existing_docs)}")
        except Exception as e:
            print(f"Warning: could not load existing vector_db.json: {e}")

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

    print(f"\nEmbedding {len(DECK_CHUNKS)} deck knowledge chunks...")
    print(f"Model: {EMBED_MODEL} | Region: {AWS_REGION}\n")

    new_docs = []
    for i, chunk in enumerate(DECK_CHUNKS):
        print(f"  [{i+1}/{len(DECK_CHUNKS)}] {chunk['id']}...", end=" ", flush=True)
        try:
            embedding = get_embedding(chunk["text"])
            new_docs.append({
                "pageContent": chunk["text"],
                "metadata": {
                    "source": "astarter_deck",
                    "type":   "astarter_deck",
                    "doc_id": chunk["id"],
                },
                "embedding": embedding,
            })
            print("OK")
            time.sleep(0.1)
        except Exception as e:
            print(f"ERROR: {e}")

    all_docs = existing_docs + new_docs
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(all_docs, f, ensure_ascii=False)

    print(f"\nDone!")
    print(f"  Deck chunks embedded:    {len(new_docs)}")
    print(f"  Existing docs preserved: {len(existing_docs)}")
    print(f"  Total vectors in store:  {len(all_docs)}")
    print(f"  Saved -> {OUTPUT_FILE}")
    print(f"\nBot will use new deck knowledge on next restart.")

if __name__ == "__main__":
    embed()
