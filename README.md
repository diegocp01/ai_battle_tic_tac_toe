# AI Arena

An Apple-inspired tic-tac-toe arena for Codex and Claude. Follow the board, move explanations, timings, and results in a responsive interface.

![AI Arena](static/img/image.png)

## Quickstart: local CLIs, no API keys

Requires Python 3.10+, Node.js 20+, and Claude Code (`claude`) installed on your PATH.

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm ci
python app.py
```

Open [localhost:5001](http://localhost:5001), leave **Play with → Local CLIs** selected, choose the series length, and start a match.

- **Codex:** the installed `@openai/codex-sdk` uses its bundled Codex CLI and your existing ChatGPT sign-in. If needed, run `npx codex login` and choose ChatGPT. An existing Codex CLI login is reused. Local mode enforces ChatGPT authentication rather than API-key authentication.
- **Claude:** uses your installed `claude` command and existing subscription sign-in. Run `claude` once to sign in if needed.
- Local means the CLI runs on your computer; model inference still uses the providers’ services and your plan’s usage allowance. No API keys are required by this mode.

The adapters preserve each CLI’s configured default model. Optional `CODEX_MODEL` and `CLAUDE_MODEL` overrides can go in `.env`; the model cards show them. Copy `.env.example` for other optional settings. `CODEX_CLI_PATH` selects a different installed Codex binary; otherwise the SDK uses its pinned runtime. No existing CLI configuration or credentials are changed.

## Choose a mode

| Play with | Players | Credentials |
| --- | --- | --- |
| **Local CLIs** (default) | Codex SDK + Claude CLI | Existing CLI sign-ins |
| **API keys** | Existing GPT 5.2 + Claude Opus 4.5 adapters | `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` in `.env` |
| **Test** | Deterministic simulated players | None; no CLI, API, or LLM calls |

API clients are imported only when an API move is requested. You can start the app and play Local or Test games without configuring any API keys. A failed adapter never falls back to another provider or starts using API keys.

**Test without any real models:**

```sh
python app.py --test
```

`--test` (or `ARENA_TEST_MODE=1`) forces simulated players on the server, even if a client asks for Local or API mode. The UI shows a Test badge and locks the mode selector. Test moves always choose the first empty square; they exercise the game flow, not model quality. Use this option for manual testing and automation.

## Match controls

- **Pause** finishes a move already in progress, then stops. **Resume match** continues the same series.
- Refreshing restores an unfinished board in a paused state. Completed series stay visible until a new match begins.
- Failed requests show an inline error and a retry action. You can switch a failed match to Test and start a fresh series.
- Winning squares, explanations, timing, and history update automatically. Explanations are capped at 600 characters to keep browser sessions compact.
- Keyboard focus, screen-reader status announcements, and reduced motion are supported. The frontend needs no build or external fonts.

The app binds to localhost and runs local processes under your account. The CLI adapters use an empty temporary working directory, disable command/web tools where supported, and time out after 180 seconds by default (`MODEL_TIMEOUT_SECONDS`). API credentials are removed from local child environments. Codex uses read-only permissions; Claude runs with tools disabled. Raw CLI diagnostics are not returned to the browser.

Flask stores the current series in a signed browser cookie. Without a stable `FLASK_SECRET_KEY`, restarting the server resets saved matches. Use one active match tab at a time; simultaneous tabs share the browser session.

## Tests — no real LLMs

```sh
# Backend/game routing and CLI adapter fixtures
.venv/bin/python -m unittest discover -s tests -v

# Installed Codex SDK against fake clients and a fake CLI event stream
npm test

# Browser checks; installs Chromium once
npx playwright install chromium --only-shell
npm run test:ui
```

The browser suite starts and stops its own servers on ports 5084/5085: one forced-Test server and one selector fixture with both real adapters blocked. It covers series completion, pause/resume, reload, provider switching, retry, responsive layouts, and reduced motion. Set `ARENA_PYTHON` if your Python environment is elsewhere. SDK tests never invoke the real Codex binary. Live provider inference is intentionally outside this suite.

Integration references: [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [Codex authentication](https://learn.chatgpt.com/docs/auth), and [Claude CLI automation](https://code.claude.com/docs/en/headless).
