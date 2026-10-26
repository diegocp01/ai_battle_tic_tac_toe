"""Player adapters. Test mode never imports SDKs or starts subprocesses."""
import json
import os
import re
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
MODES = ('local', 'api', 'test')
COORDS = ('A1', 'B1', 'C1', 'A2', 'B2', 'C2', 'A3', 'B3', 'C3')
MOVE_SCHEMA = {
    'type': 'object',
    'properties': {
        'move': {'type': 'string', 'enum': list(COORDS)},
        'explanation': {'type': 'string'},
    },
    'required': ['move', 'explanation'],
    'additionalProperties': False,
}


class ProviderError(RuntimeError):
    pass


def model_catalog():
    """Read local model metadata only; never start a CLI or make an inference call."""
    codex = [{'id': 'default', 'name': 'CLI default'}]
    cache = Path(os.getenv('CODEX_HOME') or Path.home() / '.codex') / 'models_cache.json'
    try:
        if cache.stat().st_size <= 1_000_000:
            cached = json.loads(cache.read_text())
            for item in cached.get('models', []):
                if not isinstance(item, dict) or item.get('visibility') == 'hide':
                    continue
                model_id = item.get('slug', '')
                if isinstance(model_id, str) and re.fullmatch(r'[a-zA-Z0-9_.:-]{1,100}', model_id):
                    codex.append({'id': model_id, 'name': str(item.get('display_name') or model_id)[:100]})
    except (OSError, ValueError, AttributeError):
        pass
    claude = [{'id': 'default', 'name': 'CLI default'}, {'id': 'opus', 'name': 'Opus'},
              {'id': 'sonnet', 'name': 'Sonnet'}, {'id': 'haiku', 'name': 'Haiku'}]
    defaults = {}
    for key, options, variable in [('gpt', codex, 'CODEX_MODEL'), ('claude', claude, 'CLAUDE_MODEL')]:
        configured = os.getenv(variable, '')
        if re.fullmatch(r'[a-zA-Z0-9_.:-]{1,100}', configured):
            if configured not in [item['id'] for item in options]:
                options.append({'id': configured, 'name': configured})
            defaults[key] = configured
        else:
            defaults[key] = 'default'
    return {
        'local': {key: {'models': options, 'default': defaults[key]} for key, options in [('gpt', codex), ('claude', claude)]},
        'api': {
            'gpt': {'models': [{'id': 'gpt-5.2', 'name': 'GPT 5.2'}], 'default': 'gpt-5.2'},
            'claude': {'models': [{'id': 'claude-opus-4-5-20251101', 'name': 'Claude Opus 4.5'}], 'default': 'claude-opus-4-5-20251101'},
        },
        'test': {
            'gpt': {'models': [{'id': 'default', 'name': 'Test player A'}], 'default': 'default'},
            'claude': {'models': [{'id': 'default', 'name': 'Test player B'}], 'default': 'default'},
        },
    }


def select_models(mode, settings):
    catalog = model_catalog()[mode]
    selected = {}
    for key in ('gpt', 'claude'):
        requested = settings.get(key + '_model', catalog[key]['default'])
        if mode == 'test':
            requested = 'default'
        if requested not in [item['id'] for item in catalog[key]['models']]:
            raise ProviderError('Choose a model from the available options.')
        selected[key + '_model'] = requested
    return selected


def player_profiles(mode, settings=None):
    settings = settings or {}
    profiles = {
        'test': {'gpt': {'name': 'Test player A', 'detail': 'Simulated'}, 'claude': {'name': 'Test player B', 'detail': 'Simulated'}},
        'api': {'gpt': {'name': 'GPT 5.2', 'detail': 'OpenAI API'}, 'claude': {'name': 'Claude Opus 4.5', 'detail': 'Anthropic API'}},
        'local': {'gpt': {'name': 'Codex', 'detail': 'Codex SDK'}, 'claude': {'name': 'Claude', 'detail': 'Claude CLI'}},
    }[mode]
    if mode == 'local':
        for key in profiles:
            selected = settings.get(key + '_model')
            if selected and selected != 'default':
                profiles[key]['name'] = selected
    return profiles


def local_environment():
    """Keep CLI sign-in state, but never pass API credentials into local mode."""
    excluded = {
        'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL',
        'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
        'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
    }
    return {key: value for key, value in os.environ.items() if key not in excluded}


def run_process(command, payload, label):
    timeout = max(1, int(os.getenv('MODEL_TIMEOUT_SECONDS', '180')))
    # Empty working directory avoids loading this repository as an agent task.
    with tempfile.TemporaryDirectory(prefix='ai-arena-') as working_dir:
        try:
            process = subprocess.Popen(
                command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True, cwd=working_dir,
                env=local_environment(), start_new_session=(os.name == 'posix'),
            )
        except OSError as error:
            raise ProviderError(f'{label} could not start. Check its installation and PATH.') from error
        try:
            output, _ = process.communicate(payload, timeout=timeout)
        except subprocess.TimeoutExpired as error:
            if os.name == 'posix':
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
            process.communicate()
            raise ProviderError(f'{label} timed out after {timeout}s. Retry or increase MODEL_TIMEOUT_SECONDS.') from error
        if process.returncode:
            # CLI diagnostics can contain credentials or private configuration.
            raise ProviderError(f'{label} failed. Open its CLI to check sign-in and model access, then retry.')
        try:
            return json.loads(output)
        except (TypeError, json.JSONDecodeError) as error:
            raise ProviderError(f'{label} did not return a valid JSON response. Update the CLI and retry.') from error


def parse_move(data):
    if not isinstance(data, dict) or data.get('move') not in COORDS:
        raise ProviderError('The player returned an invalid move.')
    explanation = data.get('explanation', '')
    if not isinstance(explanation, str):
        raise ProviderError('The player returned an invalid explanation.')
    return data['move'], explanation[:600]


def call_local(model, prompt, selected_model=None):
    selected = selected_model if selected_model is not None else os.getenv('CODEX_MODEL' if model == 'gpt' else 'CLAUDE_MODEL')
    if selected == 'default':
        selected = None
    instructions = (
        'Play tic-tac-toe using only the supplied board. Do not use tools, files, '
        'or external information. Return JSON with a legal move and a brief '
        'one-sentence explanation of the move, not internal reasoning.\n\n' + prompt
    )
    if model == 'gpt':
        node = shutil.which('node')
        if not node or not (ROOT / 'node_modules/@openai/codex-sdk').is_dir():
            raise ProviderError('Codex SDK is not ready. Install Node.js and run npm ci in the app folder.')
        data = run_process(
            [node, str(ROOT / 'bridges/codex.mjs')],
            json.dumps({'prompt': instructions, 'model': selected}), 'Codex SDK',
        )
    else:
        claude = shutil.which(os.getenv('CLAUDE_BIN', 'claude'))
        if not claude:
            raise ProviderError('Claude CLI was not found. Install claude, sign in, and restart the app.')
        command = [
            claude, '-p', '--output-format', 'json', '--json-schema', json.dumps(MOVE_SCHEMA),
            '--tools', '', '--permission-mode', 'dontAsk', '--no-session-persistence',
            '--setting-sources', '', '--settings', '{"disableAllHooks":true}',
            '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-chrome',
        ]
        if selected:
            command += ['--model', selected]
        result = run_process(command, instructions, 'Claude CLI')
        if not isinstance(result, dict) or result.get('is_error'):
            raise ProviderError('Claude CLI could not complete the turn. Run claude to check sign-in and model access.')
        data = result.get('structured_output')
        if data is None:
            try:
                data = json.loads(result.get('result', ''))
            except (TypeError, json.JSONDecodeError) as error:
                raise ProviderError('Claude CLI did not return a structured move. Update the CLI and retry.') from error
    return parse_move(data)


def call_api(model, prompt):
    key = 'OPENAI_API_KEY' if model == 'gpt' else 'ANTHROPIC_API_KEY'
    if not os.getenv(key):
        raise ProviderError(f'API mode needs {key} in .env. Choose Local or Test to play without API keys.')
    try:
        if model == 'gpt':
            from openai_model_v1 import call_chatgpt
            return call_chatgpt(prompt)
        from anthropic_model_v1 import call_claude
        return call_claude(prompt)
    except Exception as error:
        raise ProviderError('API request failed. Check the selected provider’s API key, access, and quota.') from error


def choose_move(mode, model, prompt, board, selected_model=None):
    if mode == 'test':
        # No imports, subprocesses, credentials, network, or fallback to real players.
        move = next((coord for coord in COORDS if board[coord] == '.'), None)
        if move is None:
            raise ProviderError('No legal moves remain.')
        return move, f'Test mode: chose the first empty square, {move}. No LLM was called.'
    if mode == 'local':
        return call_local(model, prompt, selected_model)
    if mode == 'api':
        return call_api(model, prompt)
    raise ProviderError('Unknown player mode.')
