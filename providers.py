"""Player adapters. Test mode never imports SDKs or starts subprocesses."""
import json
import os
import re
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
from functools import lru_cache
from claude_catalog import parse_catalog

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


VALID_EFFORTS = ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'persistent')


@lru_cache(maxsize=8)
def _claude_catalog(binary, modified, period):
    packet = {'type': 'control_request', 'request_id': 'arena-model-discovery', 'request': {'subtype': 'initialize'}}
    command = [binary, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
               '--verbose', '--tools', '', '--setting-sources', '', '--settings', '{"disableAllHooks":true}',
               '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence',
               '--permission-mode', 'dontAsk', '--no-chrome']
    messages = run_process(command, json.dumps(packet) + '\n', 'Claude model discovery', timeout=15, json_lines=True)
    return parse_catalog(messages)


def claude_model_catalog():
    binary = shutil.which(os.getenv('CLAUDE_BIN', 'claude'))
    if not binary:
        return {'models': [], 'default': '', 'aliases': {}, 'message': 'Install and sign in to Claude Code, then reload.'}
    try:
        return _claude_catalog(binary, Path(binary).stat().st_mtime_ns, int(time.monotonic() // 300))
    except (OSError, ProviderError):
        return {'models': [], 'default': '', 'aliases': {}, 'message': 'Claude model discovery failed. Check CLI sign-in and reload.'}


def _option(model_id, name, efforts=(), default_effort='default'):
    levels = ['default', *dict.fromkeys(efforts)]
    return {'id': model_id, 'name': name, 'efforts': levels,
            'default_effort': default_effort if default_effort in levels else 'default',
            'effort_supported': len(levels) > 1}


def codex_model_catalog(cache=None):
    """Read supported reasoning levels from the installed Codex metadata cache."""
    codex = [_option('default', 'CLI default')]
    cache = Path(cache) if cache else Path(os.getenv('CODEX_HOME') or Path.home() / '.codex') / 'models_cache.json'
    try:
        if cache.stat().st_size <= 1_000_000:
            cached = json.loads(cache.read_text())
            for item in cached.get('models', []):
                if not isinstance(item, dict) or item.get('visibility') == 'hide':
                    continue
                model_id = item.get('slug', '')
                if isinstance(model_id, str) and re.fullmatch(r'[a-zA-Z0-9_.:-]{1,100}', model_id):
                    efforts = [level.get('effort') for level in item.get('supported_reasoning_levels', [])
                               if isinstance(level, dict) and level.get('effort') in VALID_EFFORTS]
                    codex.append(_option(model_id, str(item.get('display_name') or model_id)[:100], efforts, item.get('default_reasoning_level')))
    except (OSError, ValueError, AttributeError):
        pass
    configured = os.getenv('CODEX_MODEL', '')
    if re.fullmatch(r'[a-zA-Z0-9_.:-]{1,100}', configured):
        if configured not in [item['id'] for item in codex]:
            codex.append(_option(configured, configured))
        codex_default = configured
    else:
        codex_default = 'default'
    return {'models': codex, 'default': codex_default}


def model_catalog(discover=True):
    """Use CLI metadata only. Discovery initializes Claude without sending a prompt."""
    codex = codex_model_catalog()
    claude = claude_model_catalog() if discover else {'models': [], 'default': '', 'aliases': {}, 'message': ''}
    configured_claude = os.getenv('CLAUDE_MODEL', '')
    resolved = claude.get('aliases', {}).get(configured_claude, configured_claude)
    if resolved in [item['id'] for item in claude['models']]:
        claude = {**claude, 'default': resolved}
    return {
        'local': {'gpt': codex, 'claude': claude},
        'api': {
            'gpt': {'models': [_option('gpt-5.2', 'GPT 5.2', ('none', 'low', 'medium', 'high', 'xhigh'), 'high')], 'default': 'gpt-5.2'},
            'claude': {'models': [_option('claude-opus-4-5-20251101', 'Claude Opus 4.5', ('low', 'medium', 'high'), 'high')], 'default': 'claude-opus-4-5-20251101'},
        },
        'test': {
            'gpt': {'models': [_option('default', 'Test player A')], 'default': 'default'},
            'claude': {'models': [_option('default', 'Test player B')], 'default': 'default'},
        },
    }


def select_models(mode, settings):
    catalog = model_catalog(discover=mode == 'local')[mode]
    selected = {}
    for key in ('gpt', 'claude'):
        requested = settings.get(key + '_model', catalog[key]['default'])
        if mode == 'test':
            requested = 'default'
        requested = catalog[key].get('aliases', {}).get(requested, requested) if isinstance(requested, str) else requested
        info = next((item for item in catalog[key]['models'] if item['id'] == requested), None)
        if not info:
            raise ProviderError(catalog[key].get('message') or 'Choose a model from the available options.')
        effort = settings.get(key + '_effort', info['default_effort'])
        if mode == 'test':
            effort = 'default'
        if effort not in info['efforts']:
            raise ProviderError('Choose an effort level supported by the selected model.')
        selected[key + '_model'] = requested
        selected[key + '_effort'] = effort
        selected[key + '_name'] = info['name'] if requested != 'default' else ('Codex' if key == 'gpt' and mode == 'local' else info['name'])
    return selected


def player_profiles(mode, settings=None):
    settings = settings or {}
    profiles = {
        'test': {'gpt': {'name': 'Test player A', 'detail': 'Simulated'}, 'claude': {'name': 'Test player B', 'detail': 'Simulated'}},
        'api': {'gpt': {'name': 'GPT 5.2', 'detail': 'OpenAI API'}, 'claude': {'name': 'Claude Opus 4.5', 'detail': 'Anthropic API'}},
        'local': {'gpt': {'name': 'Codex', 'detail': 'Codex SDK'}, 'claude': {'name': 'Claude', 'detail': 'Claude CLI'}},
    }[mode]
    for key in profiles:
        if settings.get(key + '_name') and mode != 'test':
            profiles[key]['name'] = settings[key + '_name']
        elif mode == 'local' and settings.get(key + '_model') not in (None, 'default'):
            profiles[key]['name'] = settings[key + '_model']
        effort = settings.get(key + '_effort', 'default')
        if mode != 'test' and effort != 'default':
            profiles[key]['detail'] += ' · ' + effort + ' effort'
    return profiles


def local_environment():
    """Keep CLI sign-in state, but never pass API credentials into local mode."""
    excluded = {
        'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL',
        'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
        'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
    }
    return {key: value for key, value in os.environ.items() if key not in excluded}


def run_process(command, payload, label, *, timeout=None, json_lines=False, environment=None):
    timeout = timeout or max(1, int(os.getenv('MODEL_TIMEOUT_SECONDS', '180')))
    # Empty working directory avoids loading this repository as an agent task.
    with tempfile.TemporaryDirectory(prefix='ai-arena-') as working_dir:
        try:
            process = subprocess.Popen(
                command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True, cwd=working_dir,
                env=environment if environment is not None else local_environment(), start_new_session=(os.name == 'posix'),
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
            if json_lines:
                return [json.loads(line) for line in output.splitlines() if line.strip()]
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


def call_local(model, prompt, selected_model=None, effort=None):
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
            json.dumps({'prompt': instructions, 'model': selected, 'effort': effort if effort != 'default' else None}), 'Codex SDK',
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
        if effort and effort != 'default':
            command += ['--effort', effort]
        environment = local_environment()
        if effort and effort != 'default':
            environment['CLAUDE_CODE_EFFORT_LEVEL'] = effort
        result = run_process(command, instructions, 'Claude CLI', environment=environment)
        if not isinstance(result, dict) or result.get('is_error'):
            raise ProviderError('Claude CLI could not complete the turn. Run claude to check sign-in and model access.')
        data = result.get('structured_output')
        if data is None:
            try:
                data = json.loads(result.get('result', ''))
            except (TypeError, json.JSONDecodeError) as error:
                raise ProviderError('Claude CLI did not return a structured move. Update the CLI and retry.') from error
    return parse_move(data)


def call_api(model, prompt, effort=None):
    key = 'OPENAI_API_KEY' if model == 'gpt' else 'ANTHROPIC_API_KEY'
    if not os.getenv(key):
        raise ProviderError(f'API mode needs {key} in .env. Choose Local or Test to play without API keys.')
    try:
        if model == 'gpt':
            from openai_model_v1 import call_chatgpt
            return call_chatgpt(prompt, effort=effort) if effort and effort != 'default' else call_chatgpt(prompt)
        from anthropic_model_v1 import call_claude
        return call_claude(prompt, effort=effort) if effort and effort != 'default' else call_claude(prompt)
    except Exception as error:
        raise ProviderError('API request failed. Check the selected provider’s API key, access, and quota.') from error


def choose_move(mode, model, prompt, board, selected_model=None, effort=None):
    if mode == 'test':
        # No imports, subprocesses, credentials, network, or fallback to real players.
        move = next((coord for coord in COORDS if board[coord] == '.'), None)
        if move is None:
            raise ProviderError('No legal moves remain.')
        return move, f'Test mode: chose the first empty square, {move}. No LLM was called.'
    if mode == 'local':
        return call_local(model, prompt, selected_model, effort)
    if mode == 'api':
        return call_api(model, prompt, effort)
    raise ProviderError('Unknown player mode.')
