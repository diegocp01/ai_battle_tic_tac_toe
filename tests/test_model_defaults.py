import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import providers
from catalog_fixtures import claude


class ModelDefaultTests(unittest.TestCase):
    def test_newest_luna_is_selected_numerically(self):
        models = [{'id': value} for value in ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-6.1-luna', 'gpt-6.1-sol']]
        self.assertEqual(providers.newest_family(models, 'luna'), 'gpt-6.1-luna')
        models += [{'id': 'gpt-9.9-luna'}, {'id': 'gpt-10-luna'}]
        self.assertEqual(providers.newest_family(models, 'luna'), 'gpt-10-luna')

    def test_newest_haiku_comes_from_the_catalog_not_a_pinned_version(self):
        models = [{'id': value} for value in ['claude-haiku-4-5-20251001', 'claude-haiku-5-5[1m]', 'claude-haiku-5-5']]
        self.assertEqual(providers.newest_family(models, 'haiku'), 'claude-haiku-5-5')
        self.assertIsNone(providers.newest_family([{'id': 'claude-opus-5-5'}], 'haiku'))

    def test_live_catalog_keeps_all_picker_models_and_chooses_luna(self):
        data = [{'model': value, 'displayName': value, 'supportedReasoningEfforts': [{'reasoningEffort':'low'}], 'defaultReasoningEffort':'low'}
                for value in ['gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-luna']]
        with patch('providers.shutil.which', return_value='/fake/node'), patch.object(Path, 'is_dir', return_value=True), patch('providers._live_codex_models', return_value=data):
            catalog = providers.codex_model_catalog()
        self.assertEqual(catalog['default'], 'gpt-6.1-luna')
        self.assertEqual(len(catalog['models']), 3)
        self.assertNotIn('default', [model['id'] for model in catalog['models']])
        self.assertTrue(all(model['name'] != 'CLI default' for model in catalog['models']))

    def test_local_product_default_is_haiku_even_when_cli_recommends_opus(self):
        codex = {'models': [providers._option('gpt-6-luna', 'GPT-6-Luna')], 'default': 'gpt-6-luna'}
        with patch('providers.codex_model_catalog', return_value=codex), patch('providers.claude_model_catalog', side_effect=claude), patch.dict('os.environ', {'CLAUDE_MODEL': 'opus', 'CODEX_MODEL': 'gpt-6-sol'}):
            local = providers.model_catalog()['local']
            settings = providers.select_models('local', {})
        self.assertEqual(local['claude']['default'], 'claude-haiku-4-5-20251001')
        self.assertEqual(settings['gpt_model'], 'gpt-6-luna')
        self.assertEqual(settings['claude_model'], 'claude-haiku-4-5-20251001')

    def test_empty_cache_does_not_create_a_cli_default_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory, 'models.json')
            cache.write_text(json.dumps({'models': []}))
            catalog = providers.codex_model_catalog(cache, discover=False)
        self.assertEqual(catalog['models'], [])
        self.assertEqual(catalog['default'], '')
        self.assertTrue(catalog['message'])
