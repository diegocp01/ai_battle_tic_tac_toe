"""Normalize Claude Code initialization metadata without guessing model versions."""
import re

EFFORTS = ('low', 'medium', 'high', 'xhigh', 'max')
MODEL_ID = re.compile(r'^claude-[a-z][a-z0-9]*-\d+(?:-\d+)*(?:\[1m\])?$')


def model_name(model_id):
    context = ' (1M)' if model_id.endswith('[1m]') else ''
    parts = model_id.removesuffix('[1m]').removeprefix('claude-').split('-')
    if len(parts[-1]) == 8 and parts[-1].isdigit():
        parts.pop()
    family = parts.pop(0).capitalize()
    return 'Claude ' + family + (' ' + '.'.join(parts) if parts else '') + context


def parse_catalog(messages):
    response = {}
    for message in messages:
        if not isinstance(message, dict) or message.get('type') != 'control_response':
            continue
        envelope = message.get('response')
        if isinstance(envelope, dict) and envelope.get('request_id') == 'arena-model-discovery':
            response = envelope.get('response') or {}
            if not isinstance(response, dict):
                response = {}
            break
    models, aliases, default = [], {}, None
    reported_models = response.get('models')
    for item in reported_models if isinstance(reported_models, list) else []:
        if not isinstance(item, dict):
            continue
        value = item.get('value', '')
        if not isinstance(value, str):
            continue
        resolved = item.get('resolvedModel') or (value if value.startswith('claude-') else '')
        if not isinstance(resolved, str):
            continue
        if value.endswith('[1m]') and not resolved.endswith('[1m]'):
            resolved += '[1m]'
        if not MODEL_ID.fullmatch(resolved):
            continue
        aliases[value] = resolved
        if value == 'default':
            default = resolved
        if any(model['id'] == resolved for model in models):
            continue
        reported_efforts = item.get('supportedEffortLevels')
        efforts = [effort for effort in EFFORTS if effort in reported_efforts] if item.get('supportsEffort') and isinstance(reported_efforts, list) else []
        models.append({
            'id': resolved, 'name': model_name(resolved),
            'efforts': ['default', *efforts], 'default_effort': 'default',
            'effort_supported': bool(efforts),
        })
    return {
        'models': models, 'default': default or (models[0]['id'] if models else ''),
        'aliases': aliases,
        'message': '' if models else 'Claude did not report exact model versions. Update Claude Code and reload.',
    }
