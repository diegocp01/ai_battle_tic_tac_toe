import json
from pathlib import Path
from claude_catalog import parse_catalog


def claude():
    return parse_catalog(json.loads(Path(__file__).with_name('fixtures').joinpath('claude-init.json').read_text()))


def codex(**kwargs):
    return {'default': 'gpt-6-luna', 'aliases': {'default': 'gpt-6-luna'}, 'models': [
        {'id': 'gpt-6-luna', 'name': 'GPT-6-Luna', 'efforts': ['default', 'low', 'medium', 'high', 'xhigh', 'max'], 'default_effort': 'low', 'effort_supported': True},
        {'id': 'fixture-codex', 'name': 'Fixture Codex', 'efforts': ['default', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'default_effort': 'low', 'effort_supported': True},
    ]}
