# AI Arena

Configure a Codex-versus-Claude tic-tac-toe match, then follow its moves, timings, and results.

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

Open [localhost:5001](http://localhost:5001). Choose the connection, Codex model, Claude model, and number of rounds, then select **Start match**. The board and results appear after the match starts; **New match** returns to setup.

- **Codex:** the installed `@openai/codex-sdk` uses its bundled Codex CLI and your existing ChatGPT sign-in. If needed, run `npx codex login` and choose ChatGPT. An existing Codex CLI login is reused. Local mode enforces ChatGPT authentication rather than API-key authentication.
- **Claude:** uses your installed `claude` command and existing subscription sign-in. Run `claude` once to sign in if needed.
- Local means the CLI runs on your computer; model inference still uses the providers’ services and your plan’s usage allowance. No API keys are required by this mode.

The Codex selector reads exact model IDs and supported reasoning levels from the local CLI metadata cache. **CLI default** stays available when no cache exists. Claude’s selector uses the installed `claude` command’s initialization response, resolves aliases to full model IDs, and shows the exact version (for example, the version reported by your own CLI rather than a moving “Opus” alias). Initialization sends no prompt and performs no model inference. Model metadata is cached in memory for up to five minutes and refreshed after CLI updates. A discovery failure is shown instead of substituting guessed versions.

Each player has a **Reasoning effort** slider with that model’s supported levels. The chosen effort is saved with the match and sent to Codex as `modelReasoningEffort`, Claude as `--effort`, or the optional APIs as their effort parameter. **Default** keeps the adapter’s existing effort setting. The slider is disabled for models that don’t support effort, for Test players, and for a Codex CLI-default choice whose capabilities aren’t known. Select a specific cached Codex model to enable its slider.

Optional `CODEX_MODEL` and `CLAUDE_MODEL` values in `.env` select catalog defaults; Claude aliases are resolved to exact CLI-reported IDs. Setup choices are remembered in this browser. Copy `.env.example` for other settings. `CODEX_CLI_PATH` selects a different installed Codex binary; otherwise the SDK uses its pinned runtime. No existing CLI configuration or credentials are changed.

## Choose a mode

| Connection | Players | Credentials |
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
- Failed starts stay on setup; failed moves stay on the match with a retry action. **New match** returns to model and round selection, where you can switch to Test.
- The match view shows winning squares, explanations, timing, and history. [View the match screenshot](static/img/match.png). Explanations are capped at 600 characters to keep browser sessions compact.
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

Tests use captured model metadata and fake CLI initialization responses; no test invokes live discovery or real inference. The browser suite starts and stops its own servers on ports 5084/5085: one forced-Test server and one selector fixture with both real adapters blocked. It covers series completion, pause/resume, reload, provider switching, retry, responsive layouts, and reduced motion. Set `ARENA_PYTHON` if your Python environment is elsewhere. SDK tests never invoke the real Codex binary. Live provider inference is intentionally outside this suite.

Integration references: [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [Codex authentication](https://learn.chatgpt.com/docs/auth), and [Claude CLI automation](https://code.claude.com/docs/en/headless).
