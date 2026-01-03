from flask import Flask, render_template, jsonify, request, session
import random
from datetime import datetime
import time
import os

# Import the model functions
from openai_model_v1 import call_chatgpt
from anthropic_model_v1 import call_claude

app = Flask(__name__)
app.secret_key = os.urandom(24)

# Board coordinate mapping
COORDS = ['A1', 'B1', 'C1', 'A2', 'B2', 'C2', 'A3', 'B3', 'C3']

def init_game_state():
    """Initialize a fresh game state."""
    # Randomly assign X/O to models
    gpt_is_x = random.choice([True, False])
    return {
        'board': {coord: '.' for coord in COORDS},
        'gpt_mark': 'X' if gpt_is_x else 'O',
        'claude_mark': 'O' if gpt_is_x else 'X',
        'current_turn': 'X',  # X always goes first
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

Your turn. Output one move only.

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
    data = request.get_json()
    num_games = int(data.get('num_games', 1))
    num_games = max(1, min(10, num_games))  # Clamp to 1-10
    
    state = init_game_state()
    state['total_games'] = num_games
    session['game_state'] = state
    
    return jsonify({
        'success': True,
        'game_state': get_client_state(state)
    })

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
    
    # Determine which model's turn
    if state['gpt_mark'] == current_turn:
        model = 'gpt'
        prompt = board_to_string(state['board'], current_turn)
        
        start_time = time.time()
        try:
            move, reasoning = call_chatgpt(prompt)
        except Exception as e:
            return jsonify({'error': f'GPT API error: {str(e)}'}), 500
        elapsed = time.time() - start_time
        
        state['gpt_reasoning'] = reasoning or 'No reasoning provided.'
        state['gpt_last_time'] = round(elapsed, 2)
        state['gpt_total_time'] = round(state['gpt_total_time'] + elapsed, 2)
    else:
        model = 'claude'
        prompt = board_to_string(state['board'], current_turn)
        
        start_time = time.time()
        try:
            move, reasoning = call_claude(prompt)
        except Exception as e:
            return jsonify({'error': f'Claude API error: {str(e)}'}), 500
        elapsed = time.time() - start_time
        
        state['claude_reasoning'] = reasoning or 'No reasoning provided.'
        state['claude_last_time'] = round(elapsed, 2)
        state['claude_total_time'] = round(state['claude_total_time'] + elapsed, 2)
    
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
            winner_name = 'GPT 5.2 High'
        else:
            state['claude_stats']['wins'] += 1
            state['gpt_stats']['losses'] += 1
            winner_name = 'Claude Opus 4.5 Thinking'
        
        # Add to history with timing data
        state['game_history'].append({
            'game': state['current_game'],
            'time': datetime.now().strftime('%H:%M:%S'),
            'winner': winner_name,
            'gpt_time': state['gpt_total_time'],
            'claude_time': state['claude_total_time']
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
    
    if state['current_game'] >= state['total_games']:
        return jsonify({'error': 'All games completed'}), 400
    
    # Save stats and history
    gpt_stats = state['gpt_stats']
    claude_stats = state['claude_stats']
    history = state['game_history']
    total_games = state['total_games']
    current_game = state['current_game'] + 1
    
    # Reset for next game with random X/O assignment
    gpt_is_x = random.choice([True, False])
    state['board'] = {coord: '.' for coord in COORDS}
    state['gpt_mark'] = 'X' if gpt_is_x else 'O'
    state['claude_mark'] = 'O' if gpt_is_x else 'X'
    state['current_turn'] = 'X'
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
    app.run(debug=True, port=5001)
