"""
embed_chunks.py
Embeds all chunks using AWS Bedrock Titan v2 and writes them to the bot's
vector_db.json format (compatible with VectorStoreService.ts).

Run ONCE. Takes ~5-15 min depending on chunk count.
Do NOT run again unless rebuilding - it overwrites the existing vector store.

Usage:
  python embed_chunks.py

Environment (reads from ../.env or environment variables):
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

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
CHUNKS_FILE  = os.path.join(SCRIPT_DIR, "chunks.json")
OUTPUT_FILE  = os.path.join(SCRIPT_DIR, "..", "telegram-bot", "storage", "vectors", "vector_db.json")
EMBED_MODEL  = "amazon.titan-embed-text-v2:0"
BATCH_SIZE   = 10   # Small batches to stay under Bedrock rate limits
MAX_TEXT_LEN = 8000 # Titan v2 max input chars

# ── Load AWS creds from bot's .env ────────────────────────────────────────────

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

def get_embedding(text: str) -> list[float]:
    """Embed text using Amazon Titan v2 (1024 dims). Retries on throttle."""
    text = text.strip()[:MAX_TEXT_LEN]  # truncate to model limit
    payload = json.dumps({"inputText": text})

    for attempt in range(4):
        try:
            response = bedrock.invoke_model(
                modelId=EMBED_MODEL,
                contentType="application/json",
                accept="application/json",
                body=payload,
            )
            result = json.loads(response["body"].read())
            return result["embedding"]
        except ClientError as e:
            code = e.response["Error"]["Code"]
            if code in ("ThrottlingException", "ServiceUnavailableException"):
                wait = 2 ** attempt * 3
                print(f"  Throttled (attempt {attempt + 1}). Waiting {wait}s...")
                time.sleep(wait)
            else:
                raise
    raise RuntimeError(f"Embedding failed after 4 retries")

# ── Main ──────────────────────────────────────────────────────────────────────

def embed():
    # Load chunks
    if not os.path.exists(CHUNKS_FILE):
        print(f"ERROR: {CHUNKS_FILE} not found. Run chunk_messages.py first.")
        sys.exit(1)

    with open(CHUNKS_FILE, encoding="utf-8") as f:
        chunks = json.load(f)

    print(f"Embedding {len(chunks)} chunks with {EMBED_MODEL} on {AWS_REGION}...")
    print(f"Output -> {OUTPUT_FILE}\n")

    # Load existing docs (FAQ + any other manual docs) to preserve them
    existing_docs = []
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, encoding="utf-8") as f:
                existing = json.load(f)
            # Keep docs NOT sourced from telegram_history (preserve /adddoc entries)
            existing_docs = [
                d for d in existing
                if d.get("metadata", {}).get("type") != "telegram_history"
            ]
            print(f"Preserving {len(existing_docs)} existing non-chat docs.")
        except Exception as e:
            print(f"Warning: could not load existing vector_db.json: {e}")

    # Ensure output directory exists
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

    new_docs = []
    total    = len(chunks)
    failed   = 0

    start_time = time.time()

    for batch_start in range(0, total, BATCH_SIZE):
        batch_end   = min(batch_start + BATCH_SIZE, total)
        batch       = chunks[batch_start:batch_end]
        batch_num   = batch_start // BATCH_SIZE + 1
        total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE

        print(f"Batch {batch_num}/{total_batches} (chunks {batch_start}–{batch_end - 1})...", end=" ", flush=True)

        for chunk in batch:
            try:
                embedding = get_embedding(chunk["text"])
                new_docs.append({
                    "pageContent": chunk["text"],
                    "metadata": {
                        "source":     "telegram_history",
                        "type":       "telegram_history",
                        "chunk_id":   chunk["chunk_id"],
                        "start_date": chunk["start_date"],
                        "end_date":   chunk["end_date"],
                        "msg_count":  chunk["msg_count"],
                    },
                    "embedding": embedding,
                })
                # Tiny delay to avoid throttling
                time.sleep(0.05)
            except Exception as e:
                print(f"\n  ERROR on {chunk['chunk_id']}: {e} - skipping.")
                failed += 1

        print(f"OK ({len(new_docs)} done so far)")

        # Save checkpoint every 5 batches in case of interruption
        if batch_num % 5 == 0:
            all_docs = existing_docs + new_docs
            with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                json.dump(all_docs, f, ensure_ascii=False)
            print(f"  [checkpoint saved - {len(all_docs)} total vectors]")

        # Brief pause between batches
        time.sleep(0.3)

    # Final save
    all_docs = existing_docs + new_docs
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(all_docs, f, ensure_ascii=False)

    elapsed = time.time() - start_time
    mins    = int(elapsed // 60)
    secs    = int(elapsed % 60)

    print(f"\n{'=' * 50}")
    print(f"Done in {mins}m {secs}s")
    print(f"  Chat chunks embedded:    {len(new_docs)}")
    print(f"  Existing docs preserved: {len(existing_docs)}")
    print(f"  Total vectors in store:  {len(all_docs)}")
    print(f"  Failed chunks:           {failed}")
    print(f"  Saved: {OUTPUT_FILE}")
    print(f"\nBot will auto-load the new knowledge base on next restart.")

if __name__ == "__main__":
    embed()
