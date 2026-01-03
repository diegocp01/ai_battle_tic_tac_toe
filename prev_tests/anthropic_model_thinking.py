# API call with thinking enabled
import anthropic
from dotenv import load_dotenv
load_dotenv()
client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-haiku-4-5-20251001",   # use the exact model name you have access to
    max_tokens=2048,
    thinking={
        "type": "enabled",
        "budget_tokens": 1024
    },
    messages=[
        {
            "role": "user",
            "content": "are you a robot?"
        }
    ],
)

thinking_summaries: list[str] = []
text_parts: list[str] = []

for block in response.content:
    block_type = getattr(block, "type", None)

    if block_type == "thinking":
        # Anthropic returns *summarized* thinking when enabled.
        summary = getattr(block, "thinking", None) or getattr(block, "summary", None) or ""
        if summary:
            thinking_summaries.append(summary)

    elif block_type == "text":
        txt = getattr(block, "text", "")
        if txt:
            text_parts.append(txt)

# If you only want the final assistant answer text:
final_text = "".join(text_parts).strip()

# Optional: print thinking summaries (if present)
if thinking_summaries:
    print("\n=== THINKING (summary) ===")
    for i, t in enumerate(thinking_summaries, 1):
        print(f"{i}. {t}")

print("\n=== RESPONSE ===")
print(final_text)