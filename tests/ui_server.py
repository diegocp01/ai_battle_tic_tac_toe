"""UI fixture: normal mode selector, but every real player is replaced before serving."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import app
import providers


def forbidden(*args, **kwargs):
    raise providers.ProviderError('Fixture: real LLM calls are disabled. Choose Test.')


providers.call_local = forbidden
providers.call_api = forbidden
app.config['TEST_MODE'] = False
app.run(host='127.0.0.1', port=5085, debug=False)
