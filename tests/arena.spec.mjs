import { test, expect } from '@playwright/test';

async function ready(page, url = '/') {
    await page.goto(url);
    await expect(page.locator('#setup')).toBeVisible();
    await expect(page.locator('#btn-run')).toBeEnabled();
    await expect(page.locator('#match-view')).toBeHidden();
    await expect(page.locator('header')).toHaveCount(0);
}

async function start(page, rounds = '1') {
    await page.selectOption('#game-count', rounds);
    await page.click('#btn-run');
    await expect(page.locator('#setup')).toBeHidden();
    await expect(page.locator('#match-view')).toBeVisible();
}

test('setup has models and rounds; completed matches return to setup before starting again', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await ready(page);
    await expect(page.locator('#play-mode')).toHaveValue('test');
    await expect(page.locator('#play-mode')).toBeDisabled();
    await expect(page.locator('#test-badge')).toBeVisible();
    await expect(page.locator('#gpt-model')).toHaveValue('default');
    await expect(page.locator('#claude-model')).toHaveValue('default');
    await expect(page.getByText('Great minds.', {exact: false})).toHaveCount(0);
    await page.selectOption('#game-count', '2');
    await page.locator('#btn-run').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#setup')).toBeHidden();
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    await expect(page.locator('#stats-body tr')).toHaveCount(2);
    await expect(page.locator('.cell.winner')).toHaveCount(3);
    await expect(page.locator('#gpt-reasoning')).toContainText('No LLM was called');
    await page.reload();
    await expect(page.locator('#setup')).toBeHidden();
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    await page.click('#btn-new');
    await expect(page.locator('#setup')).toBeVisible();
    await expect(page.locator('#match-view')).toBeHidden();
    await expect(page.locator('#game-count')).toHaveValue('2');
    await page.reload();
    await expect(page.locator('#setup')).toBeVisible();
    await start(page);
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    await expect(page.locator('#stats-body tr')).toHaveCount(1);
    expect(errors).toEqual([]);
});

test('pause waits for a move and reload restores the match view with its selected settings', async ({ page }) => {
    await ready(page);
    let moves = 0;
    await page.route('**/api/next-move', async route => {
        moves++;
        await new Promise(resolve => setTimeout(resolve, 250));
        await route.continue();
    });
    const requested = page.waitForRequest('**/api/next-move');
    await start(page, '2');
    await requested;
    await page.click('#btn-pause');
    await expect(page.locator('#session-title')).toHaveText('Match paused');
    await expect(page.locator('.cell.X,.cell.O')).toHaveCount(1);
    await page.waitForTimeout(400);
    expect(moves).toBe(1);
    await page.reload();
    await expect(page.locator('#setup')).toBeHidden();
    await expect(page.locator('#session-title')).toHaveText('Match paused');
    await expect(page.locator('.cell.X,.cell.O')).toHaveCount(1);
    await page.click('#btn-resume');
    await expect(page.locator('#session-title')).toHaveText('Series complete');
});

test('model selections reach the backend, survive errors, and can be changed in a new matchup', async ({ page }) => {
    await ready(page, 'http://127.0.0.1:5085');
    await expect(page.locator('#play-mode')).toHaveValue('local');
    await page.selectOption('#claude-model', 'claude-sonnet-5-5');
    await page.selectOption('#game-count', '1');
    if (process.env.ARENA_SCREENSHOTS) {
        await page.setViewportSize({width: 1440, height: 1000});
        await page.screenshot({path: 'static/img/image.png', fullPage: true});
        await page.setViewportSize({width: 390, height: 1000});
        await page.screenshot({path: '/tmp/tic-tac-toe-review/setup-mobile.png', fullPage: true});
        await page.setViewportSize({width: 1440, height: 1000});
    }
    const settingsRequest = page.waitForRequest('**/api/start-games');
    await page.click('#btn-run');
    const settings = (await settingsRequest).postDataJSON();
    expect(settings.claude_model).toBe('claude-sonnet-5-5');
    await expect(page.locator('#setup')).toBeHidden();
    await expect(page.locator('#claude-name')).toHaveText('Claude Sonnet 5.5');
    await expect(page.locator('#session-title')).toHaveText('Match interrupted');
    await expect(page.locator('#error-message')).toContainText('real LLM calls are disabled');
    await page.click('#btn-new');
    await expect(page.locator('#setup')).toBeVisible();
    await expect(page.locator('#claude-model')).toHaveValue('claude-haiku-4-5-20251001');
    await page.selectOption('#play-mode', 'api');
    await expect(page.locator('#gpt-model')).toHaveValue('gpt-5.2');
    await expect(page.locator('#mode-description')).toContainText('API keys');
    await page.selectOption('#play-mode', 'test');
    await start(page);
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    await expect(page.locator('#gpt-name')).toHaveText('Test player A');
    if (process.env.ARENA_SCREENSHOTS) await page.screenshot({path: 'static/img/match.png', fullPage: true});
});

test('Local CLIs always opens with newest reported Luna and Haiku, without a default placeholder', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('tic-tac-toe-settings', JSON.stringify({
        mode: 'local', models: {local: {gpt_model: 'fixture-codex', claude_model: 'claude-opus-5-5', gpt_effort: 'ultra', claude_effort: 'max'}},
    })));
    await ready(page, 'http://127.0.0.1:5085');
    await expect(page.locator('#gpt-model')).toHaveValue('gpt-6-luna');
    await expect(page.locator('#claude-model')).toHaveValue('claude-haiku-4-5-20251001');
    expect(await page.locator('#gpt-model option').allTextContents()).toEqual(['GPT-6-Luna', 'Fixture Codex']);
    expect(await page.locator('#gpt-model option[value="default"]').count()).toBe(0);
    await expect(page.locator('#gpt-effort-value')).toHaveText('Low');
    await page.selectOption('#gpt-model', 'fixture-codex');
    await page.selectOption('#claude-model', 'claude-opus-5-5');
    await page.selectOption('#play-mode', 'test');
    await page.selectOption('#play-mode', 'local');
    await expect(page.locator('#gpt-model')).toHaveValue('gpt-6-luna');
    await expect(page.locator('#claude-model')).toHaveValue('claude-haiku-4-5-20251001');
});

test('exact model names and independent effort sliders are submitted and restored', async ({ page }) => {
    await ready(page, 'http://127.0.0.1:5085');
    const labels = await page.locator('#claude-model option').allTextContents();
    expect(labels).toEqual(['Claude Opus 5.5', 'Claude Fable 5.1 (1M)', 'Claude Sonnet 5.5', 'Claude Haiku 4.5']);
    await page.selectOption('#gpt-model', 'fixture-codex');
    await page.selectOption('#claude-model', 'claude-opus-5-5');
    await expect(page.getByRole('slider', {name: 'Codex reasoning effort'})).toBeEnabled();
    await expect(page.getByRole('slider', {name: 'Claude reasoning effort'})).toBeEnabled();
    await page.locator('#gpt-effort').press('End');
    await page.locator('#claude-effort').press('End');
    await page.locator('#claude-effort').press('ArrowLeft');
    await expect(page.locator('#gpt-effort-value')).toHaveText('Ultra');
    await expect(page.locator('#claude-effort-value')).toHaveText('X-high');
    await page.selectOption('#claude-model', 'claude-haiku-4-5-20251001');
    await expect(page.locator('#claude-effort')).toBeDisabled();
    await expect(page.locator('#claude-effort-value')).toHaveText('Not supported');
    await page.selectOption('#claude-model', 'claude-sonnet-5-5');
    await page.locator('#claude-effort').press('End');
    await expect(page.locator('#claude-effort')).toHaveAttribute('aria-valuetext', 'Max');
    const submitted = page.waitForRequest('**/api/start-games');
    await page.click('#btn-run');
    expect((await submitted).postDataJSON()).toMatchObject({gpt_effort: 'ultra', claude_effort: 'max', claude_model: 'claude-sonnet-5-5'});
    await expect(page.locator('#session-title')).toHaveText('Match interrupted');
    await expect(page.locator('#gpt-mode')).toContainText('ultra effort');
    await expect(page.locator('#claude-mode')).toContainText('max effort');
    await page.reload();
    await expect(page.locator('#session-title')).toHaveText('Match paused');
    await expect(page.locator('#gpt-mode')).toContainText('ultra effort');
    await expect(page.locator('#claude-mode')).toContainText('max effort');
    await page.click('#btn-new');
    await expect(page.locator('#gpt-model')).toHaveValue('gpt-6-luna');
    await expect(page.locator('#gpt-effort-value')).toHaveText('Low');
    await expect(page.locator('#claude-effort-value')).toHaveText('Not supported');
    await page.selectOption('#play-mode', 'test');
    await expect(page.locator('#gpt-effort')).toBeDisabled();
    await expect(page.locator('#claude-effort')).toBeDisabled();
    await expect(page.locator('#claude-effort-value')).toHaveText('Not used');
});

test('startup errors stay on setup; move errors stay on the match and can retry', async ({ page }) => {
    await ready(page);
    await page.selectOption('#game-count', '1');
    await page.route('**/api/start-games', route => route.fulfill({status: 500, body: 'Unavailable'}), {times: 1});
    await page.click('#btn-run');
    await expect(page.locator('#error-message')).toContainText('unexpected response');
    await expect(page.locator('#setup')).toBeVisible();
    await expect(page.locator('#match-view')).toBeHidden();
    await page.route('**/api/next-move', route => route.fulfill({status: 502, json: {error: 'Fixture failure'}}), {times: 1});
    await page.click('#btn-run');
    await expect(page.locator('#error-message')).toHaveText('Fixture failure');
    await expect(page.locator('#setup')).toBeHidden();
    await expect(page.locator('.is-thinking')).toHaveCount(0);
    await page.click('#btn-resume');
    await expect(page.locator('#session-title')).toHaveText('Series complete');
});

test('an initial model-configuration failure can retry from setup', async ({ page }) => {
    await page.route('**/api/config', route => route.fulfill({status: 503, json: {error: 'Fixture discovery unavailable'}}), {times: 1});
    await page.goto('/');
    await expect(page.locator('#error-message')).toHaveText('Fixture discovery unavailable');
    await expect(page.locator('#btn-run')).toBeEnabled();
    await page.click('#btn-run');
    await expect(page.locator('#btn-run')).toHaveText('Start match');
    await expect(page.locator('#gpt-model')).toHaveValue('default');
    await expect(page.locator('#match-view')).toBeHidden();
});

test('forced Test ignores a request for real models', async ({ request }) => {
    const response = await request.post('/api/start-games', {data: {mode: 'local', num_games: 1, gpt_model: 'real-model', claude_model: 'opus'}});
    const state = (await response.json()).game_state;
    expect(state.mode).toBe('test');
    expect(state.gpt_model).toBe('default');
    const data = await (await request.post('/api/next-move')).json();
    expect(data.game_state[data.model + '_reasoning']).toContain('No LLM was called');
});

test('setup and match fit mobile widths and respect reduced motion', async ({ page }) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await ready(page);
    for (const width of [1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({width, height: 1000});
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.locator('#btn-run')).toBeVisible();
        await expect(page.locator('#gpt-model')).toBeVisible();
    }
    await start(page);
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({width, height: 1000});
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await expect(page.locator('.cell[role="img"]')).toHaveCount(9);
    expect(await page.locator('.piece').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});


test('the board leads the match; all player details and history remain behind toggles', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({width: 1440, height: 1000});
    await ready(page);
    await start(page);
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    const board = await page.locator('#board').boundingBox();
    const players = await page.locator('.player-bar').boundingBox();
    expect(board.width).toBeGreaterThanOrEqual(580);
    expect(players.height).toBeLessThan(90);
    expect(board.height).toBeGreaterThan(players.height * 6);
    await expect(page.locator('#gpt-name')).toBeVisible();
    await expect(page.locator('#claude-name')).toBeVisible();
    await expect(page.locator('#match-details')).not.toHaveAttribute('open');
    await expect(page.locator('#history')).not.toHaveAttribute('open');
    await expect(page.locator('#gpt-stats')).toBeHidden();
    await expect(page.locator('#history-table-wrap')).toBeHidden();
    await expect(page.locator('#gpt-reasoning')).toBeVisible();
    await page.locator('#explanations > summary').click();
    await expect(page.locator('#gpt-reasoning')).toBeHidden();
    await page.locator('#explanations > summary').click();
    await page.locator('#match-details > summary').click();
    for (const model of ['gpt', 'claude']) {
        for (const field of ['provider', 'mode', 'wins', 'draws', 'losses', 'idle', 'last-move', 'last-time', 'total-time']) {
            await expect(page.locator(`#${model}-${field}`)).toBeVisible();
        }
        await expect(page.locator(`#${model}-last-move`)).not.toHaveText('—');
    }
    await expect(page.locator('#series-progress')).toBeVisible();
    await expect(page.locator('.match-rules')).toContainText('X plays first, O plays second');
    await page.locator('#history > summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#history-table-wrap')).toBeVisible();
    await expect(page.locator('#stats-body tr')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await page.locator('#match-details > summary').click();
    if (process.env.ARENA_SCREENSHOTS) {
        await page.locator('#arena').focus();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({path: 'static/img/match.png', fullPage: true});
        await page.setViewportSize({width: 390, height: 1000});
        await page.screenshot({path: '/tmp/tic-tac-toe-review/match-mobile.png', fullPage: true});
    }
    await page.click('#btn-new');
    await page.route('**/api/next-move', route => route.fulfill({status: 502, json: {error: 'Fixture stopped before first move'}}));
    await start(page);
    await expect(page.locator('#session-title')).toHaveText('Match interrupted');
    await expect(page.locator('#winning-line')).not.toHaveClass(/is-visible/);
    await expect(page.locator('.cell.winner')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('wins draw a line through all eight patterns in the winning mark color; draws have no line', async ({ page }) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    const response = await page.request.post('/api/start-games', {data: {mode: 'test', num_games: 1}});
    const base = (await response.json()).game_state;
    let saved = base;
    await page.route('**/api/game-state', route => route.fulfill({json: saved}));
    const cases = [
        [['A1', 'B1', 'C1'], [26, 50, 274, 50]],
        [['A2', 'B2', 'C2'], [26, 150, 274, 150]],
        [['A3', 'B3', 'C3'], [26, 250, 274, 250]],
        [['A1', 'A2', 'A3'], [50, 26, 50, 274]],
        [['B1', 'B2', 'B3'], [150, 26, 150, 274]],
        [['C1', 'C2', 'C3'], [250, 26, 250, 274]],
        [['A1', 'B2', 'C3'], [26, 26, 274, 274]],
        [['C1', 'B2', 'A3'], [274, 26, 26, 274]],
    ];
    for (const mark of ['X', 'O']) {
        for (const [coords, endpoints] of cases) {
            saved = {...base, board: Object.fromEntries(Object.keys(base.board).map(coord => [coord, coords.includes(coord) ? mark : '.'])), winner: mark, game_over: true, all_games_complete: true};
            await page.goto('/');
            const strike = page.locator('#winning-line');
            await expect(strike).toHaveClass(/is-visible/);
            await expect(strike).toHaveAttribute('data-winner', mark);
            for (const [index, attribute] of ['x1', 'y1', 'x2', 'y2'].entries()) {
                await expect(strike.locator('line')).toHaveAttribute(attribute, String(endpoints[index]));
            }
            await expect(page.locator('.cell.winner')).toHaveCount(3);
            const color = mark === 'X' ? 'rgb(0, 113, 227)' : 'rgb(220, 53, 69)';
            expect(await strike.locator('line').evaluate(el => getComputedStyle(el).stroke)).toBe(color);
            expect(await page.locator('.cell.winner').first().evaluate(el => getComputedStyle(el).color)).toBe(color);
            expect(await page.locator('.cell.winner').first().evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
        }
    }
    saved = {...base, board: Object.fromEntries(Object.keys(base.board).map((coord, index) => [coord, ['X','O','X','X','O','O','O','X','X'][index]])), winner: 'draw', game_over: true, all_games_complete: true};
    await page.goto('/');
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    await expect(page.locator('#winning-line')).not.toHaveClass(/is-visible/);
    await expect(page.locator('.cell.winner')).toHaveCount(0);
});
