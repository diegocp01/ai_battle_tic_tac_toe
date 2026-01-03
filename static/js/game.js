// DOM Elements
const modalOverlay = document.getElementById('modal-overlay');
const gameCountSelect = document.getElementById('game-count');
const btnRun = document.getElementById('btn-run');
const gameContainer = document.getElementById('game-container');
const statsSection = document.getElementById('stats-section');

// Game state display elements
const gameNumberEl = document.getElementById('game-number');
const totalGamesEl = document.getElementById('total-games');
const boardEl = document.getElementById('board');
const gameStatusEl = document.getElementById('game-status');

// GPT elements
const gptThinkingEl = document.getElementById('gpt-thinking');
const gptMarkEl = document.getElementById('gpt-mark');
const gptWinsEl = document.getElementById('gpt-wins');
const gptLossesEl = document.getElementById('gpt-losses');
const gptDrawsEl = document.getElementById('gpt-draws');
const gptReasoningEl = document.getElementById('gpt-reasoning');
const gptTimerEl = document.getElementById('gpt-timer');
const gptLastTimeEl = document.getElementById('gpt-last-time');
const gptTotalTimeEl = document.getElementById('gpt-total-time');

// Claude elements
const claudeThinkingEl = document.getElementById('claude-thinking');
const claudeMarkEl = document.getElementById('claude-mark');
const claudeWinsEl = document.getElementById('claude-wins');
const claudeLossesEl = document.getElementById('claude-losses');
const claudeDrawsEl = document.getElementById('claude-draws');
const claudeReasoningEl = document.getElementById('claude-reasoning');
const claudeTimerEl = document.getElementById('claude-timer');
const claudeLastTimeEl = document.getElementById('claude-last-time');
const claudeTotalTimeEl = document.getElementById('claude-total-time');
const gptLastMoveEl = document.getElementById('gpt-last-move');
const claudeLastMoveEl = document.getElementById('claude-last-move');

// Stats table
const statsBody = document.getElementById('stats-body');

// Game state
let isRunning = false;
let timerInterval = null;
let timerStartTime = null;
let currentTimerEl = null;

// Initialize
btnRun.addEventListener('click', startGames);

function startTimer(timerEl) {
    stopTimer();
    timerStartTime = Date.now();
    currentTimerEl = timerEl;
    timerEl.textContent = '0.0s';

    timerInterval = setInterval(() => {
        const elapsed = (Date.now() - timerStartTime) / 1000;
        timerEl.textContent = elapsed.toFixed(1) + 's';
    }, 100);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

async function startGames() {
    const numGames = parseInt(gameCountSelect.value);

    try {
        const response = await fetch('/api/start-games', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ num_games: numGames })
        });

        const data = await response.json();
        if (data.success) {
            modalOverlay.classList.add('hidden');
            gameContainer.classList.remove('hidden');
            statsSection.classList.remove('hidden');

            updateUI(data.game_state);
            runGameLoop();
        }
    } catch (error) {
        console.error('Error starting games:', error);
        alert('Failed to start games. Check console for details.');
    }
}

async function runGameLoop() {
    if (isRunning) return;
    isRunning = true;

    while (isRunning) {
        // Get current state
        const stateResponse = await fetch('/api/game-state');
        const state = await stateResponse.json();

        if (state.all_games_complete) {
            gameStatusEl.textContent = '🏆 All games complete!';
            isRunning = false;
            break;
        }

        if (state.game_over) {
            // Show result briefly, then start next game
            await sleep(2000);

            const nextResponse = await fetch('/api/next-game', { method: 'POST' });
            const nextData = await nextResponse.json();

            if (nextData.success) {
                updateUI(nextData.game_state);
                // Reset reasoning displays and last moves
                gptReasoningEl.textContent = 'Waiting for move...';
                claudeReasoningEl.textContent = 'Waiting for move...';
                gptLastMoveEl.textContent = '—';
                claudeLastMoveEl.textContent = '—';
            } else {
                isRunning = false;
                break;
            }

            await sleep(1000);
            continue;
        }

        // Show thinking indicator for current model and start timer
        if (state.current_model === 'gpt') {
            gptThinkingEl.classList.remove('hidden');
            claudeThinkingEl.classList.add('hidden');
            gameStatusEl.textContent = "GPT 5.2 High's turn...";
            startTimer(gptTimerEl);
        } else {
            claudeThinkingEl.classList.remove('hidden');
            gptThinkingEl.classList.add('hidden');
            gameStatusEl.textContent = "Claude Opus 4.5 Thinking's turn...";
            startTimer(claudeTimerEl);
        }

        // Make the move
        try {
            const moveResponse = await fetch('/api/next-move', { method: 'POST' });
            const moveData = await moveResponse.json();

            // Stop timer and hide thinking indicators
            stopTimer();
            gptThinkingEl.classList.add('hidden');
            claudeThinkingEl.classList.add('hidden');

            if (moveData.success) {
                updateUI(moveData.game_state);

                // Update last move display
                if (moveData.model === 'gpt') {
                    gptLastMoveEl.textContent = moveData.move;
                } else {
                    claudeLastMoveEl.textContent = moveData.move;
                }

                // Show which move was made
                if (moveData.game_state.game_over) {
                    const winner = moveData.game_state.winner;
                    if (winner === 'draw') {
                        gameStatusEl.textContent = "🤝 It's a draw!";
                    } else if (winner === moveData.game_state.gpt_mark) {
                        gameStatusEl.textContent = '🎉 GPT 5.2 High wins!';
                    } else {
                        gameStatusEl.textContent = '🎉 Claude Opus 4.5 Thinking wins!';
                    }
                }
            } else {
                console.error('Move error:', moveData.error);
                gameStatusEl.textContent = 'Error: ' + moveData.error;
                isRunning = false;
                break;
            }
        } catch (error) {
            console.error('API error:', error);
            gameStatusEl.textContent = 'API Error - check console';
            stopTimer();
            gptThinkingEl.classList.add('hidden');
            claudeThinkingEl.classList.add('hidden');
            isRunning = false;
            break;
        }

        // Small delay between moves for visibility
        await sleep(1500);
    }
}

function updateUI(state) {
    // Update game number
    gameNumberEl.textContent = state.current_game;
    totalGamesEl.textContent = state.total_games;

    // Update board
    const cells = boardEl.querySelectorAll('.cell');
    cells.forEach(cell => {
        const coord = cell.dataset.coord;
        const value = state.board[coord];

        cell.textContent = value === '.' ? '' : value;
        cell.className = 'cell';
        if (value !== '.') {
            cell.classList.add(value);
        }
    });

    // Update marks
    gptMarkEl.textContent = state.gpt_mark;
    gptMarkEl.className = 'mark ' + state.gpt_mark;
    claudeMarkEl.textContent = state.claude_mark;
    claudeMarkEl.className = 'mark ' + state.claude_mark;

    // Update stats
    gptWinsEl.textContent = state.gpt_stats.wins;
    gptLossesEl.textContent = state.gpt_stats.losses;
    gptDrawsEl.textContent = state.gpt_stats.draws;

    claudeWinsEl.textContent = state.claude_stats.wins;
    claudeLossesEl.textContent = state.claude_stats.losses;
    claudeDrawsEl.textContent = state.claude_stats.draws;

    // Update timing
    gptLastTimeEl.textContent = state.gpt_last_time + 's';
    gptTotalTimeEl.textContent = state.gpt_total_time + 's';
    claudeLastTimeEl.textContent = state.claude_last_time + 's';
    claudeTotalTimeEl.textContent = state.claude_total_time + 's';

    // Update reasoning
    if (state.gpt_reasoning) {
        gptReasoningEl.textContent = state.gpt_reasoning;
    }
    if (state.claude_reasoning) {
        claudeReasoningEl.textContent = state.claude_reasoning;
    }

    // Update game history table
    updateStatsTable(state.game_history);
}

function updateStatsTable(history) {
    statsBody.innerHTML = '';

    history.forEach(game => {
        const row = document.createElement('tr');

        let winnerClass = '';
        if (game.winner === 'GPT 5.2 High') winnerClass = 'winner-gpt';
        else if (game.winner === 'Claude Opus 4.5 Thinking') winnerClass = 'winner-claude';
        else winnerClass = 'winner-draw';

        row.innerHTML = `
            <td>${game.game}</td>
            <td>${game.time}</td>
            <td class="${winnerClass}">${game.winner}</td>
            <td>${game.gpt_time || 0}</td>
            <td>${game.claude_time || 0}</td>
        `;

        statsBody.appendChild(row);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
