from openai import OpenAI
from pydantic import BaseModel, Field
from dotenv import load_dotenv
load_dotenv()
client = OpenAI()

# Structured response template
class GameAnswer(BaseModel):
    # Coordinate format: A-C and 1-3, ex: "B2"
    move: str = Field(pattern=r"^[ABC][123]$")

# Function to call ChatGPT
def call_chatgpt(user_prompt: str) -> tuple[str, str | None]:
    response = client.responses.parse(
        model="gpt-5.2",
        input=[
            {"role": "system", "content": """
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
            """},
            {
                "role": "user",
                "content": user_prompt,
            },
        ],
        text_format=GameAnswer,
        reasoning={
            "effort": "high",
            "summary": "auto"
        },
    )
    
    # 1) The move (parsed)
    move = response.output_parsed.move

    # 2) The reasoning summary (separate)
    reasoning_summary = None
    for item in response.output:
        if getattr(item, "type", None) == "reasoning":
            # item.summary is usually a list; join if multiple parts exist
            parts = []
            for s in (item.summary or []):
                if getattr(s, "text", None):
                    parts.append(s.text)
            if parts:
                reasoning_summary = "\n".join(parts)
            break

    return move, reasoning_summary

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
# test
if __name__ == "__main__":
    board_state = """
    A1=O, B1=., C1=X
    A2=X, B2=., C2=O
    A3=O, B3=X, C3=.
    """

    move, summary = call_chatgpt(user_prompt_base + board_state)

    print("Move:", move)
    print("\n🧠 Reasoning Summary:\n", summary or "No reasoning summary found.")