"""Exercise API request shapes with mocked SDK methods; never perform network I/O."""
import inspect
from types import SimpleNamespace
import unittest
from unittest.mock import patch, create_autospec

import anthropic
from openai import OpenAI
import anthropic_model_v1
import openai_model_v1


class ApiContracts(unittest.TestCase):
    def test_anthropic_uses_current_structured_output_parameter(self):
        with anthropic.Anthropic(api_key='fixture-not-a-real-key') as reference:
            create = create_autospec(reference.messages.create, return_value=SimpleNamespace(content=[
                SimpleNamespace(type='text', text='{"move":"B2"}')
            ]))
            fake_client = SimpleNamespace(messages=SimpleNamespace(create=create))
            with patch.object(anthropic_model_v1.anthropic, 'Anthropic', return_value=fake_client):
                self.assertEqual(anthropic_model_v1.call_claude('board', effort='low'), ('B2', None))
            arguments = create.call_args.kwargs
            inspect.signature(reference.messages.create).bind(**arguments)
            self.assertEqual(arguments['output_config']['format']['type'], 'json_schema')
            self.assertEqual(arguments['output_config']['effort'], 'low')
            self.assertNotIn('output_format', arguments)
            self.assertNotIn('betas', arguments)

    def test_openai_preserves_structured_move_and_summary(self):
        with OpenAI(api_key='fixture-not-a-real-key') as reference:
            parse = create_autospec(reference.responses.parse, return_value=SimpleNamespace(
                output_parsed=SimpleNamespace(move='A1'),
                output=[SimpleNamespace(type='reasoning', summary=[SimpleNamespace(text='Fixture summary')])]
            ))
            with patch.object(openai_model_v1, 'OpenAI', return_value=SimpleNamespace(responses=SimpleNamespace(parse=parse))):
                self.assertEqual(openai_model_v1.call_chatgpt('board', effort='xhigh'), ('A1', 'Fixture summary'))
            inspect.signature(reference.responses.parse).bind(**parse.call_args.kwargs)
            self.assertEqual(parse.call_args.kwargs['model'], 'gpt-5.2')
            self.assertEqual(parse.call_args.kwargs['reasoning']['effort'], 'xhigh')
