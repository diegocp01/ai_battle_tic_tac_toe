# AI Arena

Configure a Codex-versus-Claude tic-tac-toe match, then follow its moves, timings, and results. Every real round is saved locally, so the all-time record builds up match by match.

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

Open [localhost:5001](http://localhost:5001). Choose the connection, Codex model, Claude model, and number of rounds, then select **Start match**. The board and results appear after the match starts; **New match** returns to setup. Below the setup form, **Universal stats** shows the all-time record from every saved match (see [Round history and universal stats](#round-history-and-universal-stats)).

- **Codex:** the installed `@openai/codex-sdk` uses its bundled Codex CLI and your existing ChatGPT sign-in. If needed, run `npx codex login` and choose ChatGPT. An existing Codex CLI login is reused. Local mode enforces ChatGPT authentication rather than API-key authentication.
- **Claude:** uses your installed `claude` command and existing subscription sign-in. Run `claude` once to sign in if needed.
- Local means the CLI runs on your computer; model inference still uses the providers’ services and your plan’s usage allowance. No API keys are required by this mode.

The selectors show concrete, versioned models reported by the CLIs. **Local CLIs** automatically selects the newest reported **Luna** and **Haiku**, including when switching back from another connection or creating a new match. These product defaults take precedence over older browser-saved choices and CLI recommendations for other model families. You can select any other listed model before starting; an existing match keeps its chosen models when refreshed.

Codex uses the SDK’s bundled CLI (or `CODEX_CLI_PATH`) and its paginated `model/list` catalog, including all models visible in that CLI’s picker. If live discovery is unavailable, it can use the CLI’s last metadata cache. Claude uses the installed command’s initialization metadata and resolves aliases to full model IDs. Model discovery sends no prompts and starts no inference turns. Metadata is cached in memory for up to five minutes. If no models are reported, the UI shows an unavailable state instead of a “CLI default” option. Defaults advance when the catalogs report newer Luna/Haiku versions; no unreported model is invented.

Each player has a **Reasoning effort** slider with that model’s supported levels. A vertical tick marks each stop, and the selected tick is highlighted. The chosen effort is saved with the match and sent to Codex as `modelReasoningEffort`, Claude as `--effort`, or the optional APIs as their effort parameter. **Default** on this slider keeps the adapter’s existing effort setting. The slider is disabled for models that don’t support effort and for Test players.

Copy `.env.example` for optional connection settings. `CODEX_CLI_PATH` selects a different installed Codex binary; otherwise the SDK uses its pinned runtime. No existing CLI configuration or credentials are changed.

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

- **Who goes first:** Codex always plays X and Claude always plays O. Each new match randomly picks who moves first in round 1; every later round the other player starts, so the first player alternates (for example Claude, Codex, Claude). Starting a new match picks at random again.
- **Round memory:** from round 2 on, both players get the same short summary of the earlier rounds in this match: who moved first, every square in play order, and the result. It is capped at 100 words and keeps the most recent rounds that fit, the way a person remembers the last few games. Round 1 prompts have no summary, and nothing carries over between matches.
- **Pause** finishes a move already in progress, then stops. **Resume match** continues the same series.
- Refreshing restores an unfinished board in a paused state. Completed series stay visible until a new match begins.
- Failed starts stay on setup; failed moves stay on the match with a retry action. **New match** returns to model and round selection, where you can switch to Test.
- The board is the focus, with blue X / red O marks and a line through the winning three. Compact side panels show each model, connection, effort, current activity, last move, and latest explanation. **Statistics & timing** expands within each panel for current-series results and timing. On smaller screens, player names sit above the board and their details follow below. [View the match screenshot](static/img/match.png). Explanations are capped at 600 characters to keep browser sessions compact.
- Keyboard focus, screen-reader status announcements, and reduced motion are supported. The frontend needs no build or external fonts.

## Round history and universal stats

- **Saved as you play:** every real round (Local CLIs or API) is added to `data/round-history.json` the moment it ends, so an interrupted match keeps the rounds it finished. Each entry records its match ID, round number and match length, finish time, connection, both models and efforts, who moved first, the winner, every move in play order, and each player's thinking time for that round. Test mode and the automated tests never write to it.
- **Local data:** the app creates the file empty (`{"rounds": []}`) the first time it starts, so the all-time count begins at zero on each machine. It is ignored by git; delete it to start the history over, or set `ARENA_HISTORY_PATH` to keep it somewhere else. Each save rewrites the file atomically. If the file is damaged, the app leaves it untouched, skips saving new rounds, and shows history as unavailable; matches keep playing.
- **Counted by match:** saved rounds are grouped back into their matches, and a match goes to whoever won more of its rounds (equal round wins is a tie). A match counts once all of its rounds are saved; until then it is listed as unfinished and left out of the tally.
- **Universal stats** on the setup page shows matches won by Codex, tied, and won by Claude; how many matches and rounds are saved; the all-time round tally; and every match, newest first, with its result, players and efforts, a marker per round, and the round score.
- **Match history** is the only section below the desktop arena. Its title shows the same all-time match tally, and its table lists every match with its last round, players, rounds played, and score (with draws). Both views refresh as each round ends.
- `/api/match-history` returns the saved rounds plus an all-time tally of rounds won by Codex, by Claude, and drawn.

The app binds to localhost and runs local processes under your account. The CLI adapters use an empty temporary working directory, disable command/web tools where supported, and time out after 180 seconds by default (`MODEL_TIMEOUT_SECONDS`). API credentials are removed from local child environments. Codex uses read-only permissions; Claude runs with tools disabled. Raw CLI diagnostics are not returned to the browser.

Flask stores the current series in a signed browser cookie. Without a stable `FLASK_SECRET_KEY`, restarting the server resets saved matches. Use one active match tab at a time; simultaneous tabs share the browser session.

## Tests — no real LLMs

```sh
# Backend game flow, round history and memory, and CLI adapter fixtures
.venv/bin/python -m unittest discover -s tests -v

# Installed Codex SDK against fake clients and a fake CLI event stream
npm test

# Browser checks; installs Chromium once
npx playwright install chromium --only-shell
npm run test:ui
```

Tests use captured model metadata and fake CLI initialization responses; no test invokes live discovery or real inference. The browser suite starts and stops its own servers on ports 5084/5085: one forced-Test server and one selector fixture with both real adapters blocked. It covers series completion, pause/resume, reload, provider switching, retry, compact side panels, universal stats and match history counted by match, all eight winning-line patterns in both mark colors, responsive layouts, and reduced motion. The unit tests save rounds to a temporary file, and both browser servers set `ARENA_HISTORY_PATH` to `test-results/round-history.json`, so `data/round-history.json` is never touched. Set `ARENA_PYTHON` if your Python environment is elsewhere. SDK tests never invoke the real Codex binary. Live provider inference is intentionally outside this suite.

Integration references: [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [Codex authentication](https://learn.chatgpt.com/docs/auth), and [Claude CLI automation](https://code.claude.com/docs/en/headless).
