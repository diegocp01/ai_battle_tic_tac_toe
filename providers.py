"""Player adapters. Test mode never imports SDKs or starts subprocesses."""
import json
import os
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


def player_profiles(mode):
    if mode == 'test':
        return {
            'gpt': {'name': 'Test player A', 'detail': 'Simulated player · no LLM'},
            'claude': {'name': 'Test player B', 'detail': 'Simulated player · no LLM'},
        }
    if mode == 'api':
        return {
            'gpt': {'name': 'GPT 5.2', 'detail': 'OpenAI API · high reasoning'},
            'claude': {'name': 'Claude Opus 4.5', 'detail': 'Anthropic API · thinking'},
        }
    return {
        'gpt': {'name': 'Codex', 'detail': os.getenv('CODEX_MODEL') or 'Codex SDK · CLI default model'},
        'claude': {'name': 'Claude', 'detail': os.getenv('CLAUDE_MODEL') or 'Claude CLI · CLI default model'},
    }


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


def call_local(model, prompt):
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
            json.dumps({'prompt': instructions, 'model': os.getenv('CODEX_MODEL')}), 'Codex SDK',
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
        if os.getenv('CLAUDE_MODEL'):
            command += ['--model', os.environ['CLAUDE_MODEL']]
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


def choose_move(mode, model, prompt, board):
    if mode == 'test':
        # No imports, subprocesses, credentials, network, or fallback to real players.
        move = next((coord for coord in COORDS if board[coord] == '.'), None)
        if move is None:
            raise ProviderError('No legal moves remain.')
        return move, f'Test mode: chose the first empty square, {move}. No LLM was called.'
    if mode == 'local':
        return call_local(model, prompt)
    if mode == 'api':
        return call_api(model, prompt)
    raise ProviderError('Unknown player mode.')
