import json
import anthropic
from dotenv import load_dotenv

load_dotenv()
client = anthropic.Anthropic()

SYSTEM_PROMPT = """
You are a Tic Tac Toe move generator.
Rules:
Game is 3x3 with coordinates: rows 1,2,3 and columns A,B,C.
I will provide the current board state and the list of legal moves.
You must choose exactly one legal move.
You are playing as the mark I specify (X or O).
Output format (strict):
Do not explain your reasoning.
Reply with exactly one coordinate for example: A1, B2, C3.
Total possible coordinates are 9 (A1, A2, A3, B1, B2, B3, C1, C2, C3).
No extra text, no punctuation, no quotes, no spaces, no newlines.
""".strip()

# --- Anthropic structured output schema (forces {"move": "B2"} etc) ---
MOVE_SCHEMA = {
    "type": "object",
    "properties": {
        "move": {"type": "string", "pattern": "^[ABC][123]$"}
    },
    "required": ["move"],
    "additionalProperties": False
}

def call_claude(user_prompt: str) -> tuple[str, str | None]:
    """
    Returns:
      move: str (e.g., "B2")
      reasoning_summary: str | None (thinking summary if present)
    """

    # If you don't want thinking summaries, remove `thinking=...`
    response = client.beta.messages.create(
        model="claude-opus-4-5-20251101",  # use the exact model you have access to
        max_tokens=2048,

        # Extended thinking (summary blocks show up in response.content)
        thinking={
            "type": "enabled",
            "budget_tokens": 1024,  # must be >= 1024
        },

        betas=["structured-outputs-2025-11-13"],

        # System + user, same idea as OpenAI
        system=SYSTEM_PROMPT,
        messages=[
            {"role": "user", "content": user_prompt}
        ],

        output_format={
            "type": "json_schema",
            "schema": MOVE_SCHEMA
        }
    )

    # 1) Grab thinking summary (if any)
    thinking_summary = None
    thinking_parts: list[str] = []
    for block in response.content:
        if getattr(block, "type", None) == "thinking":
            s = getattr(block, "thinking", None) or getattr(block, "summary", None) or ""
            if s:
                thinking_parts.append(s)
    if thinking_parts:
        thinking_summary = "\n".join(thinking_parts).strip()

    # 2) Grab the structured JSON text and parse it
    # With structured outputs, the model response is typically a JSON string in a text block.
    json_text = ""
    for block in response.content:
        if getattr(block, "type", None) == "text":
            t = getattr(block, "text", "") or ""
            if t.strip():
                json_text += t

    try:
        data = json.loads(json_text)
    except json.JSONDecodeError:
        # Fallback: if something unexpected happens, raise with helpful context
        raise RuntimeError(f"Expected JSON from model, got:\n{json_text}")

    move = data["move"]
    return move, thinking_summary


# ---- Same prompt structure you used for OpenAI ----
user_prompt_base = """You are X.

Coordinates:
Rows: 1,2,3
Cols: A,B,C

Board:
A1 B1 C1
A2 B2 C2
A3 B3 C3

Your turn. Output one move only.

Here is the board state:

"""

if __name__ == "__main__":
    board_state = """
    A1=O, B1=., C1=X
    A2=X, B2=., C2=O
    A3=O, B3=X, C3=.
    """

    move, summary = call_claude(user_prompt_base + board_state)

    print("Move:", move)
    print("\n🧠 Reasoning Summary:\n", summary or "No reasoning summary found.")