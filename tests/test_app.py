import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from app import app, check_winner, init_game_state
import providers


class ArenaTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True, TEST_MODE=False, SECRET_KEY='test-only-secret')
        self.client = app.test_client()
        # Fail closed if a test accidentally reaches a real model adapter.
        self.local = patch('providers.call_local', side_effect=AssertionError('Real local player forbidden'))
        self.api = patch('providers.call_api', side_effect=AssertionError('Real API player forbidden'))
        self.local.start()
        self.api.start()
        self.addCleanup(patch.stopall)

    def start(self, mode='test', games=1):
        return self.client.post('/api/start-games', json={'mode': mode, 'num_games': games})

    def test_home_and_default_are_keyless_local(self):
        self.assertEqual(self.client.get('/').status_code, 200)
        self.assertEqual(self.client.get('/api/config').json['default_mode'], 'local')
        self.assertEqual(self.client.get('/api/game-state').json['players']['gpt']['name'], 'Codex')
        result = subprocess.run(
            [sys.executable, '-c', "import app, sys; assert 'openai_model_v1' not in sys.modules; assert 'anthropic_model_v1' not in sys.modules"],
            cwd=providers.ROOT, env=providers.local_environment(), capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_test_series_never_starts_processes_and_retains_mode(self):
        with patch('providers.subprocess.Popen', side_effect=AssertionError('No processes in Test')):
            self.assertEqual(self.start(games=2).status_code, 200)
            for game in range(1, 3):
                for turn in range(9):
                    response = self.client.post('/api/next-move')
                    self.assertEqual(response.status_code, 200)
                    state = response.json['game_state']
                    self.assertEqual(state['mode'], 'test')
                    self.assertIn('No LLM was called', state[response.json['model'] + '_reasoning'])
                    if state['game_over']:
                        break
                self.assertEqual(len(state['game_history']), game)
                if game == 1:
                    self.assertEqual(self.client.post('/api/next-game').status_code, 200)
            self.assertTrue(state['all_games_complete'])
            self.assertEqual(self.client.post('/api/next-game').status_code, 400)
            self.assertEqual(self.client.post('/api/next-move').status_code, 400)
            self.assertTrue(self.client.get('/api/game-state').json['all_games_complete'])
            self.assertEqual(self.start().json['game_state']['game_history'], [])

    def test_forced_test_overrides_local_and_api_requests(self):
        app.config['TEST_MODE'] = True
        for mode in ['local', 'api', 'test', 'bogus']:
            self.assertEqual(self.start(mode).json['game_state']['mode'], 'test')
            self.assertEqual(self.client.post('/api/next-move').status_code, 200)
        self.assertTrue(self.client.get('/api/config').json['test_only'])

    def test_force_test_applies_to_preexisting_local_state(self):
        self.start('local')
        app.config['TEST_MODE'] = True
        result = self.client.post('/api/next-move')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json['game_state']['mode'], 'test')

    def test_bad_input_and_game_transition(self):
        for payload in [[], None, {'num_games': 'bad'}, {'mode': 'shell'}]:
            self.assertEqual(self.client.post('/api/start-games', json=payload).status_code, 400)
        self.assertEqual(self.client.post('/api/next-move').status_code, 400)
        self.start(games=2)
        self.assertEqual(self.client.post('/api/next-game').status_code, 400)

    def test_invalid_move_does_not_change_saved_state(self):
        self.start('local')
        before = self.client.get('/api/game-state').json
        with patch('app.choose_move', return_value=('Z9', 'Invalid')):
            self.assertEqual(self.client.post('/api/next-move').status_code, 400)
        self.assertEqual(before, self.client.get('/api/game-state').json)

    def test_provider_error_can_be_retried(self):
        self.start('local')
        with patch('app.choose_move', side_effect=providers.ProviderError('Sign in to CLI')):
            result = self.client.post('/api/next-move')
        self.assertEqual(result.status_code, 502)
        self.assertEqual(result.json['error'], 'Sign in to CLI')
        with patch('app.choose_move', return_value=('B2', 'Take the center')):
            self.assertEqual(self.client.post('/api/next-move').status_code, 200)

    def test_draw_and_winning_line_rules(self):
        board = dict(zip(providers.COORDS, ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']))
        self.assertEqual(check_winner(board), 'draw')
        board.update(A1='O', B1='O', C1='O')
        self.assertEqual(check_winner(board), 'O')

    def test_cross_origin_post_is_rejected(self):
        response = self.client.post('/api/start-games', json={'mode': 'local'}, headers={'Origin': 'https://example.com'})
        self.assertEqual(response.status_code, 403)


class AdapterTests(unittest.TestCase):
    def test_no_api_key_is_needed_until_api_mode_is_used(self):
        with patch.dict(os.environ, {}, clear=True):
            for model in ['gpt', 'claude']:
                with self.assertRaisesRegex(providers.ProviderError, 'API mode needs'):
                    providers.call_api(model, 'board')

    def test_api_adapters_remain_available(self):
        import types
        for model, module_name, method in [('gpt', 'openai_model_v1', 'call_chatgpt'), ('claude', 'anthropic_model_v1', 'call_claude')]:
            module = types.ModuleType(module_name)
            setattr(module, method, lambda prompt: ('B2', 'API fixture'))
            with patch.dict(sys.modules, {module_name: module}), patch.dict(os.environ, {'OPENAI_API_KEY': 'fake', 'ANTHROPIC_API_KEY': 'fake'}):
                self.assertEqual(providers.call_api(model, 'board'), ('B2', 'API fixture'))

    def test_claude_structured_output_and_safe_command(self):
        result = {'is_error': False, 'structured_output': {'move': 'A1', 'explanation': 'Available'}}
        with patch('providers.shutil.which', return_value='/fake/claude'), patch('providers.run_process', return_value=result) as run:
            self.assertEqual(providers.call_local('claude', 'board'), ('A1', 'Available'))
            command = run.call_args.args[0]
            self.assertEqual(command[command.index('--tools') + 1], '')
            self.assertIn('--strict-mcp-config', command)
            self.assertNotIn('--bare', command)  # Bare mode disables subscription credentials.
            self.assertNotIn('--dangerously-skip-permissions', command)

    def test_claude_error_and_malformed_output(self):
        for response in [{'is_error': True}, {'result': 'not JSON'}, {'structured_output': {'move': 'Z9'}}]:
            with patch('providers.shutil.which', return_value='/fake/claude'), patch('providers.run_process', return_value=response):
                with self.assertRaises(providers.ProviderError):
                    providers.call_local('claude', 'board')

    def test_codex_bridge_routing(self):
        with patch('providers.shutil.which', return_value='/fake/node'), patch.object(Path, 'is_dir', return_value=True), patch('providers.run_process', return_value={'move': 'B2', 'explanation': 'Center'}) as run:
            self.assertEqual(providers.call_local('gpt', 'board'), ('B2', 'Center'))
            self.assertTrue(run.call_args.args[0][1].endswith('bridges/codex.mjs'))

    def test_missing_cli_actionable_message(self):
        with patch('providers.shutil.which', return_value=None):
            for model in ['gpt', 'claude']:
                with self.assertRaises(providers.ProviderError):
                    providers.call_local(model, 'board')

    def test_process_environment_and_stdin_without_real_clis(self):
        program = "import os,json,sys; print(json.dumps({'input':sys.stdin.read(),'key':os.getenv('OPENAI_API_KEY'),'cwd':os.getcwd()}))"
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'never-forward-this'}):
            response = providers.run_process([sys.executable, '-c', program], 'board input', 'Fixture')
        self.assertIsNone(response['key'])
        self.assertEqual(response['input'], 'board input')
        self.assertNotEqual(response['cwd'], str(providers.ROOT))
        self.assertFalse(Path(response['cwd']).exists())

    def test_timeout_and_bad_json_are_actionable(self):
        with patch.dict(os.environ, {'MODEL_TIMEOUT_SECONDS': '1'}):
            with self.assertRaisesRegex(providers.ProviderError, 'timed out'):
                providers.run_process([sys.executable, '-c', 'import time; time.sleep(10)'], '', 'Fixture')
        with self.assertRaisesRegex(providers.ProviderError, 'valid JSON'):
            providers.run_process([sys.executable, '-c', "print('not json')"], '', 'Fixture')

    def test_unknown_mode_never_falls_back(self):
        with self.assertRaises(providers.ProviderError):
            providers.choose_move('bad', 'gpt', 'board', {})


if __name__ == '__main__':
    unittest.main()
