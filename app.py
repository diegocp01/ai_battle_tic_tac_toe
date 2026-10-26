from flask import Flask, render_template, jsonify, request, send_file, session
import random
from datetime import datetime
import time
import os
import threading
import uuid
import argparse
import json
import plistlib
import re
from pathlib import Path
from urllib.parse import urlparse
from dotenv import load_dotenv
from providers import MODES, ProviderError, choose_move, player_profiles, model_catalog, select_models

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY') or os.urandom(24)
app.config['TEST_MODE'] = os.getenv('ARENA_TEST_MODE', '').lower() in ('1', 'true', 'yes')
app.config['TRUSTED_HOSTS'] = ['localhost', '127.0.0.1', '[::1]']
app.config['MAX_CONTENT_LENGTH'] = 16384
# Every real (non-test) round is saved here as it ends; the file is local data, not tracked in git.
MATCH_HISTORY_PATH = Path(os.getenv('ARENA_HISTORY_PATH') or Path(__file__).resolve().parent / 'data' / 'round-history.json')
history_lock = threading.Lock()
WALLPAPER_STORE = Path.home() / 'Library' / 'Application Support' / 'com.apple.wallpaper'


@app.before_request
def local_requests_only():
    if request.method == 'POST' and request.headers.get('Origin'):
        if urlparse(request.headers['Origin']).netloc != request.host:
            return jsonify({'error': 'Use the app from its own localhost page.'}), 403


def effective_mode(mode=None):
    return 'test' if app.config['TEST_MODE'] else (mode or 'local')


@app.route('/api/config')
def configuration():
    return jsonify({
        'default_mode': effective_mode(), 'test_only': app.config['TEST_MODE'],
        'profiles': {mode: player_profiles(mode) for mode in MODES},
        'models': model_catalog(discover=not app.config['TEST_MODE']),
    })

def read_round_history():
    """All saved rounds. A missing file is an empty history; a damaged one raises ValueError and is left untouched."""
    try:
        archive = json.loads(MATCH_HISTORY_PATH.read_text())
    except FileNotFoundError:
        return []
    except OSError as error:
        raise ValueError('Round history is unreadable') from error
    if not isinstance(archive, dict) or not isinstance(archive.get('rounds'), list) or not all(isinstance(entry, dict) for entry in archive['rounds']):
        raise ValueError('Invalid round history')
    return archive['rounds']


def save_round(entry):
    """Append one finished round, writing the file atomically so a crash never leaves it half-written."""
    with history_lock:
        try:
            rounds = read_round_history()
        except ValueError:
            app.logger.warning('Round history at %s is damaged; this round was not saved.', MATCH_HISTORY_PATH)
            return
        MATCH_HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = MATCH_HISTORY_PATH.with_suffix('.tmp')
        temporary.write_text(json.dumps({'rounds': rounds + [entry]}, indent=2) + '\n')
        os.replace(temporary, MATCH_HISTORY_PATH)


@app.route('/api/match-history')
def match_history():
    """Saved rounds from every real match, plus the all-time tally of rounds won."""
    try:
        rounds = read_round_history()
    except ValueError:
        return jsonify({'error': 'Match history is unavailable.'}), 503
    totals = {'gpt': 0, 'claude': 0, 'draw': 0}
    for entry in rounds:
        if entry.get('winner') in totals:
            totals[entry['winner']] += 1
    response = jsonify({'rounds': rounds, 'totals': totals})
    response.cache_control.no_store = True
    return response


def current_aerial_video():
    """The aerial video macOS is using as this Mac's wallpaper, or None when the wallpaper is not an aerial."""
    try:
        index = plistlib.loads((WALLPAPER_STORE / 'Store' / 'Index.plist').read_bytes())
        displays = index['AllSpacesAndDisplays']
        content = (displays.get('Linked') or displays.get('Desktop'))['Content']
        asset = plistlib.loads(content['Choices'][0]['Configuration'])['assetID']
    except (OSError, KeyError, IndexError, TypeError, ValueError, plistlib.InvalidFileException):
        return None
    if not isinstance(asset, str) or not re.fullmatch(r'[0-9A-F-]{36}', asset):
        return None
    video = WALLPAPER_STORE / 'aerials' / 'videos' / f'{asset}.mov'
    return video if video.is_file() else None


@app.route('/wallpaper/video')
def wallpaper_video():
    """Stream the Mac's own wallpaper video in place; nothing is copied into the project."""
    video = current_aerial_video()
    if video is None:
        return '', 404
    return send_file(video, mimetype='video/mp4', conditional=True, max_age=86400)


# Board coordinate mapping
COORDS = ['A1', 'B1', 'C1', 'A2', 'B2', 'C2', 'A3', 'B3', 'C3']

def init_game_state(mode=None):
    """Initialize a fresh game state."""
    # Codex always plays X and Claude always plays O; a new match randomly picks who moves first
    gpt_starts = random.choice([True, False])
    first = 'X' if gpt_starts else 'O'
    return {
        'board': {coord: '.' for coord in COORDS},
        'mode': effective_mode(mode),
        'started': False,
        'gpt_mark': 'X',
        'claude_mark': 'O',
        'current_turn': first,
        'round_starter': first,
        'game_over': False,
        'winner': None,
        'gpt_reasoning': '',
        'claude_reasoning': '',
        'gpt_stats': {'wins': 0, 'losses': 0, 'draws': 0},
        'claude_stats': {'wins': 0, 'losses': 0, 'draws': 0},
        'current_game': 1,
        'total_games': 1,
        'game_history': [],
        # Timing for current game
        'gpt_total_time': 0.0,
        'claude_total_time': 0.0,
        'gpt_last_time': 0.0,
        'claude_last_time': 0.0,
    }

def board_to_string(board, player_mark):
    """Convert board dict to string prompt for the models."""
    lines = []
    for row in [1, 2, 3]:
        row_parts = []
        for col in ['A', 'B', 'C']:
            coord = f"{col}{row}"
            row_parts.append(f"{coord}={board[coord]}")
        lines.append(", ".join(row_parts))
    
    return f"""You are {player_mark}.

Coordinates:
Rows: 1,2,3
Cols: A,B,C

Board:
A1 B1 C1
A2 B2 C2
A3 B3 C3

Your turn. Choose one legal move. Empty squares are marked with a dot.

Here is the board state:

""" + "\n".join(lines)

def check_winner(board):
    """Check if there's a winner. Returns 'X', 'O', 'draw', or None."""
    # Win patterns
    lines = [
        ['A1', 'B1', 'C1'],  # Row 1
        ['A2', 'B2', 'C2'],  # Row 2
        ['A3', 'B3', 'C3'],  # Row 3
        ['A1', 'A2', 'A3'],  # Col A
        ['B1', 'B2', 'B3'],  # Col B
        ['C1', 'C2', 'C3'],  # Col C
        ['A1', 'B2', 'C3'],  # Diagonal
        ['C1', 'B2', 'A3'],  # Anti-diagonal
    ]
    
    for line in lines:
        vals = [board[c] for c in line]
        if vals[0] != '.' and vals[0] == vals[1] == vals[2]:
            return vals[0]
    
    # Check for draw
    if all(board[c] != '.' for c in COORDS):
        return 'draw'
    
    return None

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/start-games', methods=['POST'])
def start_games():
    """Start a new series of games."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'error': 'Send a JSON object with num_games and mode.'}), 400
    try:
        num_games = int(data.get('num_games', 1))
    except (TypeError, ValueError):
        return jsonify({'error': 'Number of games must be an integer.'}), 400
    mode = effective_mode(data.get('mode'))
    if mode not in MODES:
        return jsonify({'error': 'Choose Local, API, or Test mode.'}), 400
    try:
        selected = select_models(mode, data)
    except ProviderError as error:
        return jsonify({'error': str(error)}), 400
    num_games = max(1, min(10, num_games))  # Clamp to 1-10
    
    state = init_game_state(mode)
    state.update(selected)
    state['started'] = True
    state['total_games'] = num_games
    state['match_id'] = uuid.uuid4().hex[:12]
    session['game_state'] = state
    
    return jsonify({
        'success': True,
        'game_state': get_client_state(state)
    })

@app.route('/api/reset', methods=['POST'])
def reset_match():
    session.pop('game_state', None)
    return jsonify({'success': True})


@app.route('/api/game-state', methods=['GET'])
def get_game_state():
    """Get current game state."""
    state = session.get('game_state')
    if not state:
        state = init_game_state()
        session['game_state'] = state
    return jsonify(get_client_state(state))

@app.route('/api/next-move', methods=['POST'])
def next_move():
    """Execute the next move."""
    state = session.get('game_state')
    if not state:
        return jsonify({'error': 'No game in progress'}), 400
    
    if state['game_over']:
        return jsonify({'error': 'Game is over'}), 400
    
    current_turn = state['current_turn']
    
    model = 'gpt' if state['gpt_mark'] == current_turn else 'claude'
    mode = effective_mode(state.get('mode'))
    state['mode'] = mode
    prompt = board_to_string(state['board'], current_turn)
    start_time = time.monotonic()
    try:
        move, reasoning = choose_move(mode, model, prompt, state['board'], selected_model=state.get(model + '_model'), effort=state.get(model + '_effort'))
    except ProviderError as error:
        return jsonify({'error': str(error)}), 502
    elapsed = time.monotonic() - start_time
    state[model + '_reasoning'] = (reasoning or 'No explanation provided.')[:600]
    state[model + '_last_time'] = round(elapsed, 2)
    state[model + '_total_time'] = round(state[model + '_total_time'] + elapsed, 2)

    # Validate and apply move
    if move not in COORDS or state['board'][move] != '.':
        return jsonify({'error': f'Invalid move: {move}'}), 400
    
    state['board'][move] = current_turn
    
    # Check for winner
    result = check_winner(state['board'])
    if result:
        state['game_over'] = True
        state['winner'] = result
        
        # Update stats
        if result == 'draw':
            state['gpt_stats']['draws'] += 1
            state['claude_stats']['draws'] += 1
            winner_name = 'Draw'
        elif result == state['gpt_mark']:
            state['gpt_stats']['wins'] += 1
            state['claude_stats']['losses'] += 1
            winner_name = player_profiles(mode, state)['gpt']['name']
        else:
            state['claude_stats']['wins'] += 1
            state['gpt_stats']['losses'] += 1
            winner_name = player_profiles(mode, state)['claude']['name']
        
        # Add to history with timing data
        state['game_history'].append({
            'game': state['current_game'],
            'time': datetime.now().strftime('%H:%M:%S'),
            'winner': winner_name,
            'winner_model': None if result == 'draw' else model,
            'mode': mode,
            'gpt_time': state['gpt_total_time'],
            'claude_time': state['claude_total_time']
        })
        # Real rounds count toward the all-time history the moment they end; Test mode never does.
        if mode != 'test':
            profiles = player_profiles(mode, state)
            save_round({
                'match_id': state.get('match_id'),
                'round': state['current_game'],
                'rounds_total': state['total_games'],
                'finished_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
                'mode': mode,
                'gpt_name': profiles['gpt']['name'],
                'claude_name': profiles['claude']['name'],
                'gpt_effort': state.get('gpt_effort', 'default'),
                'claude_effort': state.get('claude_effort', 'default'),
                'starter': 'gpt' if state.get('round_starter') == state['gpt_mark'] else 'claude',
                'winner': 'draw' if result == 'draw' else model,
                'moves': sum(value != '.' for value in state['board'].values()),
                'gpt_time': state['gpt_total_time'],
                'claude_time': state['claude_total_time'],
            })
    else:
        # Switch turns
        state['current_turn'] = 'O' if current_turn == 'X' else 'X'
    
    session['game_state'] = state
    return jsonify({
        'success': True,
        'move': move,
        'model': model,
        'elapsed_time': round(elapsed, 2),
        'game_state': get_client_state(state)
    })

@app.route('/api/next-game', methods=['POST'])
def next_game():
    """Start the next game in the series."""
    state = session.get('game_state')
    if not state:
        return jsonify({'error': 'No game in progress'}), 400
    
    if not state['game_over']:
        return jsonify({'error': 'Finish this game before starting the next one.'}), 400

    if state['current_game'] >= state['total_games']:
        return jsonify({'error': 'All games completed'}), 400
    
    # Save stats and history
    gpt_stats = state['gpt_stats']
    claude_stats = state['claude_stats']
    history = state['game_history']
    total_games = state['total_games']
    current_game = state['current_game'] + 1
    
    # Whoever went second last round goes first this round
    state['board'] = {coord: '.' for coord in COORDS}
    state['round_starter'] = 'O' if state.get('round_starter', 'X') == 'X' else 'X'
    state['current_turn'] = state['round_starter']
    state['game_over'] = False
    state['winner'] = None
    state['gpt_reasoning'] = ''
    state['claude_reasoning'] = ''
    state['gpt_stats'] = gpt_stats
    state['claude_stats'] = claude_stats
    state['game_history'] = history
    state['current_game'] = current_game
    state['total_games'] = total_games
    # Reset timing for new game
    state['gpt_total_time'] = 0.0
    state['claude_total_time'] = 0.0
    state['gpt_last_time'] = 0.0
    state['claude_last_time'] = 0.0
    
    session['game_state'] = state
    return jsonify({
        'success': True,
        'game_state': get_client_state(state)
    })

def get_client_state(state):
    """Get state formatted for the client."""
    # Determine whose turn (model name)
    if state['game_over']:
        current_model = None
    elif state['gpt_mark'] == state['current_turn']:
        current_model = 'gpt'
    else:
        current_model = 'claude'
    
    return {
        'board': state['board'],
        'mode': effective_mode(state.get('mode')),
        'players': player_profiles(effective_mode(state.get('mode')), state),
        'started': state.get('started', False),
        'gpt_model': state.get('gpt_model', 'default'),
        'claude_model': state.get('claude_model', 'default'),
        'gpt_effort': state.get('gpt_effort', 'default'),
        'claude_effort': state.get('claude_effort', 'default'),
        'gpt_mark': state['gpt_mark'],
        'claude_mark': state['claude_mark'],
        'current_turn': state['current_turn'],
        'current_model': current_model,
        'game_over': state['game_over'],
        'winner': state['winner'],
        'gpt_reasoning': state['gpt_reasoning'],
        'claude_reasoning': state['claude_reasoning'],
        'gpt_stats': state['gpt_stats'],
        'claude_stats': state['claude_stats'],
        'current_game': state['current_game'],
        'total_games': state['total_games'],
        'game_history': state['game_history'],
        'all_games_complete': state['game_over'] and state['current_game'] >= state['total_games'],
        # Timing data
        'gpt_total_time': state.get('gpt_total_time', 0.0),
        'claude_total_time': state.get('claude_total_time', 0.0),
        'gpt_last_time': state.get('gpt_last_time', 0.0),
        'claude_last_time': state.get('claude_last_time', 0.0),
    }

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='AI Arena — local CLI, optional API, or Test players')
    parser.add_argument('--test', action='store_true', help='Force Test mode; never call real LLMs')
    parser.add_argument('--port', type=int, default=5001)
    args = parser.parse_args()
    if args.test:
        app.config['TEST_MODE'] = True
    app.run(host='127.0.0.1', debug=False, port=args.port)
