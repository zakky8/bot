"""
chunk_messages.py
Groups cleaned messages into semantic chunks for embedding.
Run after clean_export.py.
"""

import json
import os

INPUT_FILE  = os.environ.get("INPUT_FILE",  "cleaned.json")
OUTPUT_FILE = os.environ.get("OUTPUT_FILE", "chunks.json")

# 30 messages per chunk ≈ 400-600 tokens — safe for all embedding models
CHUNK_SIZE  = int(os.environ.get("CHUNK_SIZE", "30"))

def chunk():
    script_dir  = os.path.dirname(os.path.abspath(__file__))
    input_path  = os.path.abspath(os.path.join(script_dir, INPUT_FILE))
    output_path = os.path.abspath(os.path.join(script_dir, OUTPUT_FILE))

    with open(input_path, encoding="utf-8") as f:
        messages = json.load(f)

    print(f"Chunking {len(messages)} messages into groups of {CHUNK_SIZE}...")

    chunks = []
    for i in range(0, len(messages), CHUNK_SIZE):
        group = messages[i:i + CHUNK_SIZE]

        lines = []
        for m in group:
            date   = m["date"][:10]   # YYYY-MM-DD
            sender = m["from"]
            text   = m["text"]
            lines.append(f"[{date}] {sender}: {text}")

        block      = "\n".join(lines)
        start_date = group[0]["date"][:10]
        end_date   = group[-1]["date"][:10]

        chunks.append({
            "chunk_id":   f"chunk_{i // CHUNK_SIZE:05d}",
            "start_date": start_date,
            "end_date":   end_date,
            "msg_count":  len(group),
            "text":       block
        })

    print(f"Total chunks: {len(chunks)}")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(chunks, f, ensure_ascii=False, indent=2)

    print(f"Saved -> {output_path}")
    return chunks

if __name__ == "__main__":
    chunk()
