'use strict';

const $ = (id) => document.getElementById(id);
const names = { gpt: 'Codex', claude: 'Claude' };
let configuration = null;
const effortLevels = {gpt: ['default'], claude: ['default']};
const effortLabels = {default: 'Default', none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-high', max: 'Max', ultra: 'Ultra', persistent: 'Persistent'};
const settingsKey = 'tic-tac-toe-settings';
let preferences = {};
try { preferences = JSON.parse(localStorage.getItem(settingsKey)) || {}; } catch {}
const winningLines = [
    ['A1', 'B1', 'C1'], ['A2', 'B2', 'C2'], ['A3', 'B3', 'C3'],
    ['A1', 'A2', 'A3'], ['B1', 'B2', 'B3'], ['C1', 'C2', 'C3'],
    ['A1', 'B2', 'C3'], ['C1', 'B2', 'A3']
];
let mode = 'loading';
let state = null;
let loopActive = false;
let timer = null;
let renderedGame = null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setStatus(title, detail) {
    $('game-status').textContent = title;
    $('status-detail').textContent = detail;
}

function setMode(next) {
    mode = next;
    const active = ['running', 'pausing'].includes(mode);
    const loading = ['loading', 'starting'].includes(mode);
    $('game-count').disabled = active || loading;
    for (const key of Object.keys(names)) {
        $(key + '-model').disabled = active || loading || !$(key + '-model').value;
        $(key + '-effort').disabled = active || loading || effortLevels[key].length <= 1;
    }
    $('play-mode').disabled = active || loading || Boolean(configuration?.test_only);
    $('btn-run').disabled = loading || (configuration ? !['gpt', 'claude'].every(key => $(key + '-model').value) : mode !== 'error');
    $('btn-run').querySelector('span').textContent = ({loading: 'Loading…', starting: 'Starting…', error: 'Try again'})[mode] || 'Start match';
    $('btn-pause').classList.toggle('hidden', !active);
    $('btn-pause').disabled = mode === 'pausing';
    $('btn-pause').textContent = mode === 'pausing' ? 'Pausing…' : 'Pause';
    $('btn-resume').classList.toggle('hidden', !(state && ['paused', 'error'].includes(mode)));
    $('btn-resume').textContent = mode === 'error' ? 'Retry move' : 'Resume match';
    $('btn-new').disabled = active || loading;
    $('session-title').textContent = ({loading: 'Loading', idle: 'Ready', starting: 'Starting', running: 'Match in progress', pausing: 'Finishing turn', paused: 'Match paused', error: 'Match interrupted', complete: 'Series complete'})[mode];
    $('session-indicator').className = 'status-dot ' + mode;
}

function showMatch() {
    $('setup').classList.add('hidden');
    $('match-view').classList.remove('hidden');
    $('history-link').classList.remove('hidden');
    document.querySelector('.skip-link').href = '#arena';
    document.querySelector('.skip-link').textContent = 'Skip to match';
}

function selectedModel(key) {
    return configuration?.models[$('play-mode').value]?.[key]?.models.find(model => model.id === $(key + '-model').value);
}

function readEffort(key) {
    return effortLevels[key][Number($(key + '-effort').value)] || 'default';
}

function updateEffortLabel(key) {
    const value = readEffort(key);
    const text = effortLabels[value] || value;
    $(key + '-effort-value').textContent = effortLevels[key].length > 1 ? text
        : $('play-mode').value === 'test' ? 'Not used' : !selectedModel(key) ? 'Unavailable'
        : 'Not supported';
    $(key + '-effort').setAttribute('aria-valuetext', $(key + '-effort-value').textContent);
}

function populateEffort(key, preferred) {
    const model = selectedModel(key);
    effortLevels[key] = model?.efforts || ['default'];
    const value = effortLevels[key].includes(preferred) ? preferred : model?.default_effort || 'default';
    const slider = $(key + '-effort');
    slider.max = effortLevels[key].length - 1;
    slider.value = Math.max(0, effortLevels[key].indexOf(value));
    slider.disabled = effortLevels[key].length <= 1 || ['loading', 'starting', 'running', 'pausing'].includes(mode);
    $(key + '-effort-max').textContent = effortLevels[key].length > 1 ? effortLabels[effortLevels[key].at(-1)] : '';
    updateEffortLabel(key);
}

function populateModels(selectedMode, preferred = {}) {
    const saved = selectedMode === 'local' ? {} : preferences.models?.[selectedMode] || {};
    for (const key of Object.keys(names)) {
        const info = configuration.models[selectedMode][key];
        const select = $(key + '-model');
        select.replaceChildren();
        for (const model of info.models) {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.name;
            select.appendChild(option);
        }
        if (!info.models.length) {
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = 'Unavailable';
            select.appendChild(empty);
        }
        const previous = preferred[key + '_model'] || saved[key + '_model'] || info.default;
        const requested = info.aliases?.[previous] || previous;
        select.value = info.models.some(item => item.id === requested) ? requested : info.default;
        $(key + '-model-note').textContent = info.message || '';
        $(key + '-model-note').classList.toggle('hidden', !info.message);
        populateEffort(key, preferred[key + '_effort'] || saved[key + '_effort']);
    }
}

function rememberSettings() {
    const selected = $('play-mode').value;
    preferences.mode = selected;
    preferences.num_games = Number($('game-count').value);
    preferences.models = preferences.models || {};
    preferences.models[selected] = {gpt_model: $('gpt-model').value, claude_model: $('claude-model').value, gpt_effort: readEffort('gpt'), claude_effort: readEffort('claude')};
    try { localStorage.setItem(settingsKey, JSON.stringify(preferences)); } catch {}
}

async function newMatch() {
    if (loopActive) return;
    $('btn-new').disabled = true;
    try {
        await request('reset', {method: 'POST'});
        state = null;
        renderedGame = null;
        clearThinking();
        $('error-message').classList.add('hidden');
        $('match-view').classList.add('hidden');
        $('history-link').classList.add('hidden');
        $('setup').classList.remove('hidden');
        document.querySelector('.skip-link').href = '#setup';
        document.querySelector('.skip-link').textContent = 'Skip to setup';
        populateModels($('play-mode').value);
        setMode('idle');
        $('setup-title').focus({preventScroll: true});
        window.scrollTo(0, 0);
    } catch (error) { showError(error); }
}

async function request(path, options = {}) {
    const response = await fetch('/api/' + path, options);
    let data;
    try {
        data = await response.json();
    } catch {
        throw new Error('The server returned an unexpected response. Check that the app is running, then try again.');
    }
    if (!response.ok || data.success === false || data.error) {
        throw new Error(data.error || 'The request could not be completed. Please try again.');
    }
    return data;
}

function showError(error) {
    $('error-message').textContent = error.message || 'Connection lost. Check that the app is running, then try again.';
    $('error-message').classList.remove('hidden');
    setMode('error');
    setStatus('Match interrupted.', 'Retry the move or start a new match.');
}

function clearThinking() {
    clearInterval(timer);
    timer = null;
    for (const model of Object.keys(names)) {
        $(model + '-thinking').classList.add('hidden');
        $(model + '-idle').classList.remove('hidden');
        $(model + '-panel').classList.remove('is-thinking');
    }
}

function showThinking(model) {
    clearThinking();
    $(model + '-thinking').classList.remove('hidden');
    $(model + '-idle').classList.add('hidden');
    $(model + '-panel').classList.add('is-thinking');
    $(model + '-timer').textContent = '0.0s';
    const start = performance.now();
    timer = setInterval(() => {
        $(model + '-timer').textContent = ((performance.now() - start) / 1000).toFixed(1) + 's';
    }, 100);
    setStatus(names[model] + ' is thinking.', '');
}

function renderBoard(current) {
    const line = winningLines.find((coords) => current.winner && current.winner !== 'draw' && coords.every((coord) => current.board[coord] === current.winner)) || [];
    $('board').setAttribute('aria-label', 'Tic-tac-toe board. Game ' + current.current_game + ' of ' + current.total_games + '.');
    for (const cell of $('board').children) {
        const value = current.board[cell.dataset.coord];
        const previous = cell.dataset.value || '.';
        cell.dataset.value = value;
        cell.className = 'cell';
        cell.setAttribute('aria-label', cell.dataset.coord + ': ' + (value === '.' ? 'empty' : value) + (line.includes(cell.dataset.coord) ? ', winning square' : ''));
        if (value === 'X' || value === 'O') {
            cell.classList.add(value);
            if (previous !== value) cell.classList.add('new-move');
            // Only fixed SVG markup is inserted; all model text uses textContent.
            cell.innerHTML = value === 'X'
                ? '<svg class="piece" viewBox="0 0 48 48" aria-hidden="true"><path d="m9 9 30 30M39 9 9 39"/></svg>'
                : '<svg class="piece" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="17"/></svg>';
        } else {
            cell.innerHTML = '<span class="cell-placeholder" aria-hidden="true"></span>';
        }
        cell.classList.toggle('winner', line.includes(cell.dataset.coord));
    }
}

function renderProfiles(profiles) {
    for (const model of Object.keys(names)) {
        names[model] = profiles[model].name;
        $(model + '-name').textContent = names[model];
        $(model + '-mode').textContent = profiles[model].detail;
        $(model + '-provider').textContent = names[model].startsWith('Test ') ? 'Simulated' : model === 'gpt' ? 'OpenAI' : 'Anthropic';
        $(model + '-panel').querySelector('.stats-box').setAttribute('aria-label', names[model] + ' results');
        $(model + '-time-heading').textContent = names[model] + ' time';
    }
}

function renderMode(selected) {
    $('play-mode').value = selected;
    $('test-badge').classList.toggle('hidden', selected !== 'test');
    $('mode-description').textContent = configuration?.test_only
        ? 'Test mode · simulated players'
        : ({local: 'Signed-in CLIs', api: 'API keys required', test: 'Simulated players'})[selected];
}

function render(current) {
    const changedGame = renderedGame !== current.current_game;
    state = current;
    renderProfiles(current.players);
    renderMode(current.mode);
    renderedGame = current.current_game;
    $('game-counter').classList.remove('hidden');
    $('game-number').textContent = current.current_game;
    $('total-games').textContent = current.total_games;
    renderBoard(current);
    for (const model of Object.keys(names)) {
        const mark = current[model + '_mark'];
        $(model + '-mark').textContent = mark;
        $(model + '-mark').className = 'mark ' + mark;
        $(model + '-mark').setAttribute('aria-label', 'Playing as ' + mark);
        for (const result of ['wins', 'losses', 'draws']) {
            $(model + '-' + result).textContent = current[model + '_stats'][result];
        }
        $(model + '-last-time').textContent = Number(current[model + '_last_time'] || 0).toFixed(1) + 's';
        $(model + '-total-time').textContent = Number(current[model + '_total_time'] || 0).toFixed(1) + 's';
        $(model + '-reasoning').textContent = current[model + '_reasoning'] || 'No moves yet.';
        $(model + '-idle').textContent = current.game_over ? 'Game finished' : current.current_model === model ? 'Up next' : 'Waiting for its turn';
        if (changedGame) $(model + '-last-move').textContent = '—';
    }
    renderHistory(current.game_history);
    $('series-progress').classList.remove('hidden');
    $('series-progress').max = current.total_games;
    $('series-progress').value = current.game_history.length;
    $('series-progress-text').textContent = current.game_history.length + ' of ' + current.total_games + ' rounds complete';
    if (current.game_over) {
        setStatus(current.winner === 'draw' ? 'Draw.' : names[current.winner === current.gpt_mark ? 'gpt' : 'claude'] + ' wins.', current.all_games_complete ? '' : 'Next round starting…');
    }
}

function renderHistory(history) {
    $('history-empty').classList.toggle('hidden', history.length > 0);
    $('history-table-wrap').classList.toggle('hidden', history.length === 0);
    $('history-count').textContent = history.length + (history.length === 1 ? ' round' : ' rounds');
    $('stats-body').replaceChildren();
    for (const game of [...history].reverse()) {
        const row = document.createElement('tr');
        const values = [String(game.game).padStart(2, '0'), game.time, game.winner, Number(game.gpt_time || 0).toFixed(1) + 's', Number(game.claude_time || 0).toFixed(1) + 's'];
        values.forEach((value, index) => {
            const cell = document.createElement('td');
            cell.textContent = value;
            if (index === 2) cell.className = game.winner_model === 'gpt' ? 'winner-gpt' : game.winner_model === 'claude' ? 'winner-claude' : 'winner-draw';
            row.appendChild(cell);
        });
        $('stats-body').appendChild(row);
    }
}

function finishSeries() {
    setMode('complete');
    const gptWins = state.gpt_stats.wins;
    const claudeWins = state.claude_stats.wins;
    const result = gptWins === claudeWins ? 'Series tied.' : names[gptWins > claudeWins ? 'gpt' : 'claude'] + ' wins the series.';
    setStatus(result, `${gptWins} ${names.gpt} wins · ${claudeWins} ${names.claude} wins · ${state.gpt_stats.draws} draws`);
}

async function runGameLoop() {
    if (loopActive) return;
    loopActive = true;
    setMode('running');
    try {
        while (mode === 'running') {
            const current = await request('game-state');
            render(current);
            if (current.all_games_complete) {
                finishSeries();
                break;
            }
            if (mode !== 'running') break;
            if (current.game_over) {
                await sleep(state.mode === 'test' ? 350 : 1800);
                if (mode !== 'running') break;
                const next = await request('next-game', { method: 'POST' });
                render(next.game_state);
                continue;
            }
            showThinking(current.current_model);
            const move = await request('next-move', { method: 'POST' });
            clearThinking();
            render(move.game_state);
            $(move.model + '-last-move').textContent = move.move;
            if (state.all_games_complete) {
                finishSeries();
                break;
            }
            if (!state.game_over) setStatus(names[move.model] + ' played ' + move.move + '.', '');
            if (mode !== 'running') break;
            await sleep(state.mode === 'test' ? 250 : 1000);
        }
    } catch (error) {
        showError(error);
    } finally {
        clearThinking();
        loopActive = false;
        if (mode === 'pausing') {
            setMode('paused');
            setStatus('Paused.', '');
        }
    }
}

async function startGames(event) {
    event?.preventDefault();
    if (loopActive || ['loading', 'starting'].includes(mode)) return;
    $('error-message').classList.add('hidden');
    if (!configuration) {
        await restoreSession();
        return;
    }
    const settings = {
        num_games: Number($('game-count').value), mode: $('play-mode').value,
        gpt_model: $('gpt-model').value, claude_model: $('claude-model').value,
        gpt_effort: readEffort('gpt'), claude_effort: readEffort('claude'),
    };
    setMode('starting');
    try {
        const data = await request('start-games', {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(settings),
        });
        rememberSettings();
        renderedGame = null;
        render(data.game_state);
        showMatch();
        $('arena').focus({preventScroll: true});
        window.scrollTo(0, 0);
        await runGameLoop();
    } catch (error) { showError(error); }
}

$('setup-form').addEventListener('submit', startGames);
$('btn-new').addEventListener('click', newMatch);
$('btn-resume').addEventListener('click', () => {
    if (loopActive) return;
    $('error-message').classList.add('hidden');
    runGameLoop();
});
$('btn-pause').addEventListener('click', () => {
    if (mode !== 'running') return;
    setMode('pausing');
    setStatus('Pausing after this turn.', '');
});
$('play-mode').addEventListener('change', () => {
    const selected = $('play-mode').value;
    renderMode(selected);
    populateModels(selected);
    setMode(mode);
});
for (const key of Object.keys(names)) {
    $(key + '-model').addEventListener('change', () => {
        populateEffort(key);
        setMode(mode);
    });
    $(key + '-effort').addEventListener('input', () => updateEffortLabel(key));
}

async function restoreSession() {
    setMode('loading');
    try {
        configuration = await request('config');
        const selected = configuration.test_only ? 'test' : configuration.models[preferences.mode] ? preferences.mode : configuration.default_mode;
        renderMode(selected);
        populateModels(selected);
        const rounds = Number(preferences.num_games);
        if (Number.isInteger(rounds) && rounds >= 1 && rounds <= 10) $('game-count').value = rounds;
        const saved = await request('game-state');
        if (saved.started || saved.game_history.length || Object.values(saved.board).some(value => value !== '.')) {
            $('game-count').value = saved.total_games;
            populateModels(saved.mode, saved);
            render(saved);
            showMatch();
            if (saved.all_games_complete) finishSeries();
            else {
                setMode('paused');
                setStatus('Match paused.', '');
            }
        } else setMode('idle');
    } catch (error) { showError(error); }
}
restoreSession();
