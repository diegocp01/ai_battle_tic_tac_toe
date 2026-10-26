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
    await expect(page.locator('#stats-body tr')).toHaveCount(0);
    await expect(page.locator('#history-count')).toHaveText('0 matches');
    await expect(page.locator('#series-progress-text')).toHaveText('2 of 2 rounds complete');
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
    await expect(page.locator('#stats-body tr')).toHaveCount(0);
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
    await expect(page.locator('#gpt-effort-detail')).toHaveText('Ultra');
    await expect(page.locator('#claude-effort-detail')).toHaveText('Max');
    await page.reload();
    await expect(page.locator('#session-title')).toHaveText('Match paused');
    await expect(page.locator('#gpt-effort-detail')).toHaveText('Ultra');
    await expect(page.locator('#claude-effort-detail')).toHaveText('Max');
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
        if (width <= 1100) {
            const board = await page.locator('#board').boundingBox();
            for (const model of ['gpt', 'claude']) {
                const name = await page.locator(`#${model}-name`).boundingBox();
                const explanation = await page.locator(`#${model}-reasoning`).boundingBox();
                expect(name.y + name.height).toBeLessThan(board.y);
                expect(explanation.y).toBeGreaterThan(board.y + board.height);
            }
        }
    }
    await expect(page.locator('.cell[role="img"]')).toHaveCount(9);
    expect(await page.locator('.piece').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});


test('quiet side panels flank the board; the only bottom section is global history', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({width: 1440, height: 1000});
    await ready(page);
    await start(page);
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    const board = await page.locator('#board').boundingBox();
    const left = await page.locator('#gpt-panel').boundingBox();
    const right = await page.locator('#claude-panel').boundingBox();
    expect(board.width).toBeGreaterThanOrEqual(580);
    expect(left.width).toBeLessThanOrEqual(220);
    expect(right.width).toBeLessThanOrEqual(220);
    expect(left.x + left.width).toBeLessThan(board.x);
    expect(right.x).toBeGreaterThan(board.x + board.width);
    await expect(page.locator('.match-disclosures > *')).toHaveCount(1);
    await expect(page.locator('#history')).not.toHaveAttribute('open');
    await expect(page.locator('#history-count')).toHaveText('0 matches');
    await expect(page.locator('#gpt-stats')).toBeHidden();
    for (const model of ['gpt', 'claude']) {
        for (const field of ['name', 'provider', 'effort-detail', 'idle', 'last-move', 'reasoning']) {
            await expect(page.locator(`#${model}-${field}`)).toBeVisible();
        }
        await expect(page.locator(`#${model}-last-move`)).not.toHaveText('—');
        await page.locator(`#${model}-panel .player-more > summary`).click();
        for (const field of ['wins', 'draws', 'losses', 'last-time', 'total-time']) {
            await expect(page.locator(`#${model}-${field}`)).toBeVisible();
        }
    }
    await expect(page.locator('#series-progress')).toBeVisible();
    await expect(page.locator('.match-rules')).toContainText('Codex always plays X and Claude always plays O');
    await page.locator('#history > summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#history-empty')).toHaveText('No matches yet.');
    await expect(page.locator('#history-empty')).toBeVisible();
    await expect(page.locator('#history-table-wrap')).toBeHidden();
    await page.keyboard.press('Enter');
    for (const model of ['gpt', 'claude']) await page.locator(`#${model}-panel .player-more > summary`).click();
    if (process.env.ARENA_SCREENSHOTS) {
        await page.locator('#arena').focus();
        await page.evaluate(() => window.scrollTo({top: 0, behavior: 'instant'}));
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

test('history groups saved rounds into matches, shows all-time totals, and safely renders text', async ({ page }) => {
    const saved = {match_id: 'a1', rounds_total: 3, finished_at: '2026-10-20 10:00', gpt_name: '<img src=x onerror=alert(1)>', claude_name: 'Archive Claude'};
    await page.route('**/api/match-history', route => route.fulfill({json: {
        rounds: [{...saved, round: 1, winner: 'gpt'}, {...saved, round: 2, winner: 'draw'}],
        totals: {gpt: 7, claude: 4, draw: 2},
    }}));
    await ready(page);
    await start(page, '2');
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    await expect(page.locator('#history-count')).toHaveText('1 match');
    await page.locator('#history > summary').click();
    await expect(page.locator('#stats-body tr')).toHaveCount(1);
    await expect(page.locator('#stats-body')).toContainText('Archive Claude');
    await expect(page.locator('#stats-body')).toContainText('2 of 3');
    await expect(page.locator('#stats-body')).toContainText('1–0 · 1 draw');
    await expect(page.locator('#overall-gpt')).toHaveText('7');
    await expect(page.locator('#overall-claude')).toHaveText('4');
    await expect(page.locator('#overall-draw')).toHaveText('2');
    await expect(page.locator('#stats-body')).toContainText('<img src=x onerror=alert(1)>');
    await expect(page.locator('#stats-body img')).toHaveCount(0);
    await page.click('#btn-new');
    await start(page);
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    await expect(page.locator('#history-count')).toHaveText('1 match');
});

test('unavailable history does not interrupt a match', async ({ page }) => {
    await page.route('**/api/match-history', route => route.fulfill({status: 503, json: {error: 'Unavailable'}}));
    await ready(page);
    await start(page);
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    await page.locator('#history > summary').click();
    await expect(page.locator('#history-empty')).toHaveText('Match history is unavailable.');
    await expect(page.locator('#error-message')).toBeHidden();
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
            const color = mark === 'X' ? 'rgb(10, 132, 255)' : 'rgb(255, 69, 58)';
            expect(await strike.locator('line').evaluate(el => getComputedStyle(el).stroke)).toBe(color);
            expect(await page.locator('.cell.winner').first().evaluate(el => getComputedStyle(el).color)).toBe(color);
            const plainCell = await page.locator('.cell:not(.winner)').first().evaluate(el => getComputedStyle(el).backgroundColor);
            expect(await page.locator('.cell.winner').first().evaluate(el => getComputedStyle(el).backgroundColor)).toBe(plainCell);
        }
    }
    saved = {...base, board: Object.fromEntries(Object.keys(base.board).map((coord, index) => [coord, ['X','O','X','X','O','O','O','X','X'][index]])), winner: 'draw', game_over: true, all_games_complete: true};
    await page.goto('/');
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    await expect(page.locator('#winning-line')).not.toHaveClass(/is-visible/);
    await expect(page.locator('.cell.winner')).toHaveCount(0);
});
