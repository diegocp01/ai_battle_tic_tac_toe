import json
from pathlib import Path
import unittest
from unittest.mock import patch

from claude_catalog import parse_catalog
from catalog_fixtures import claude
import providers

FIXTURE = Path(__file__).with_name('fixtures').joinpath('claude-init.json')


class ClaudeCatalogTests(unittest.TestCase):
    def tearDown(self):
        providers._claude_catalog.cache_clear()

    def test_exact_versions_and_effort_support_come_from_cli_metadata(self):
        catalog = claude()
        self.assertEqual(catalog['default'], 'claude-opus-5-5')
        self.assertEqual(catalog['aliases']['opus'], 'claude-opus-5-5')
        self.assertEqual(catalog['aliases']['haiku'], 'claude-haiku-4-5-20251001')
        options = {model['id']: model for model in catalog['models']}
        self.assertEqual(len(options), 4)
        self.assertEqual(options['claude-opus-5-5']['name'], 'Claude Opus 5.5')
        self.assertEqual(options['claude-fable-5-1[1m]']['name'], 'Claude Fable 5.1 (1M)')
        self.assertEqual(options['claude-haiku-4-5-20251001']['name'], 'Claude Haiku 4.5')
        self.assertFalse(options['claude-haiku-4-5-20251001']['effort_supported'])
        self.assertEqual(options['claude-opus-5-5']['efforts'], ['default', 'low', 'medium', 'high', 'xhigh', 'max'])
        self.assertNotIn('opus', options)

    def test_no_exact_metadata_does_not_invent_a_version(self):
        result = parse_catalog([{'type': 'control_response', 'response': {'request_id': 'arena-model-discovery', 'response': {'models': [{'value': 'opus', 'displayName': 'Opus'}]}}}])
        self.assertEqual(result['models'], [])
        self.assertIn('exact model versions', result['message'])

    def test_discovery_sends_only_initialize_and_is_cached(self):
        with patch('providers.run_process', return_value=json.loads(FIXTURE.read_text())) as run:
            catalog = providers._claude_catalog('/fake/claude', 1, 1)
            self.assertEqual(catalog['default'], 'claude-opus-5-5')
            packet = json.loads(run.call_args.args[1])
            self.assertEqual(packet['type'], 'control_request')
            self.assertEqual(packet['request'], {'subtype': 'initialize'})
            self.assertNotIn('prompt', packet)
            self.assertEqual(run.call_args.kwargs['timeout'], 15)
            providers._claude_catalog('/fake/claude', 1, 1)
            self.assertEqual(run.call_count, 1)

    def test_discovery_failure_is_visible_instead_of_alias_fallback(self):
        with patch('providers.shutil.which', return_value=None):
            catalog = providers.claude_model_catalog()
        self.assertEqual(catalog['models'], [])
        self.assertTrue(catalog['message'])
