"""
clean_export.py
Run once: python clean_export.py
Input:  result.json  (Telegram Desktop JSON export)
Output: cleaned.json (ready for chunking)
"""

import json
import re
import os
import sys

INPUT_FILE  = os.environ.get("INPUT_FILE",  "../../../Users/rog/Downloads/ChatExport_2026-05-07 (1)/result.json")
OUTPUT_FILE = os.environ.get("OUTPUT_FILE", "cleaned.json")

def extract_text(raw):
    """Handle both string and array text format from Telegram export."""
    if isinstance(raw, str):
        return raw.strip()
    if isinstance(raw, list):
        parts = []
        for part in raw:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                parts.append(part.get("text", ""))
        return " ".join(parts).strip()
    return ""

def is_usable(text):
    """Filter out noise — too short, pure URLs, pure emoji, spam."""
    if len(text) < 20:
        return False
    # Pure URL
    if re.match(r'^https?://\S+$', text):
        return False
    # Pure emoji / unicode symbols
    if re.match(r'^[\U00010000-\U0010ffff\s\U0001F300-\U0001FFFF]+$', text):
        return False
    # Forwarded spam with no content
    if text.startswith("Forwarded from") and len(text) < 50:
        return False
    return True

def clean():
    # Resolve absolute path
    script_dir = os.path.dirname(os.path.abspath(__file__))
    input_path = os.path.abspath(os.path.join(script_dir, INPUT_FILE))
    output_path = os.path.abspath(os.path.join(script_dir, OUTPUT_FILE))

    print(f"Loading: {input_path}")

    if not os.path.exists(input_path):
        print(f"\nERROR: {input_path} not found.")
        print("Pass the correct path via INPUT_FILE env var:")
        print('  set INPUT_FILE=C:\\path\\to\\result.json && python clean_export.py')
        sys.exit(1)

    with open(input_path, encoding="utf-8") as f:
        data = json.load(f)

    messages = data.get("messages", [])
    chat_name = data.get("name", "Unknown")
    print(f"Chat: {chat_name}")
    print(f"Total raw messages: {len(messages)}")

    cleaned = []
    skipped = 0

    for msg in messages:
        # Skip service messages (joins, pins, calls, etc.)
        if msg.get("type") != "message":
            skipped += 1
            continue

        text = extract_text(msg.get("text", ""))

        if not is_usable(text):
            skipped += 1
            continue

        cleaned.append({
            "id":       msg.get("id"),
            "date":     msg.get("date", ""),
            "from":     msg.get("from", "Unknown"),
            "text":     text,
            "reply_to": msg.get("reply_to_message_id")
        })

    print(f"Usable messages: {len(cleaned)}")
    print(f"Skipped: {skipped} (service / noise / short)")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(cleaned, f, ensure_ascii=False, indent=2)

    print(f"Saved -> {output_path}")
    return cleaned

if __name__ == "__main__":
    clean()
