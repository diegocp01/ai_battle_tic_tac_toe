import json
from pathlib import Path
from claude_catalog import parse_catalog


def claude():
    return parse_catalog(json.loads(Path(__file__).with_name('fixtures').joinpath('claude-init.json').read_text()))


def codex():
    return {'default': 'default', 'models': [
        {'id': 'default', 'name': 'CLI default', 'efforts': ['default'], 'default_effort': 'default', 'effort_supported': False},
        {'id': 'fixture-codex', 'name': 'Fixture Codex', 'efforts': ['default', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'default_effort': 'low', 'effort_supported': True},
    ]}
