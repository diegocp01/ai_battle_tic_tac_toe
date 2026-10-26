import { test, expect } from '@playwright/test';

async function ready(page, url = '/') {
    await page.goto(url);
    await expect(page.locator('#setup')).toBeVisible();
    await expect(page.locator('#btn-run')).toBeEnabled();
    await expect(page.locator('#match-view')).toBeHidden();
    await expect(page.locator('#history-link')).toBeHidden();
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
    await expect(page.locator('#claude-model')).toHaveValue('claude-sonnet-5-5');
    await page.selectOption('#play-mode', 'api');
    await expect(page.locator('#gpt-model')).toHaveValue('gpt-5.2');
    await expect(page.locator('#mode-description')).toContainText('API keys');
    await page.selectOption('#play-mode', 'test');
    await start(page);
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    await expect(page.locator('#gpt-name')).toHaveText('Test player A');
    if (process.env.ARENA_SCREENSHOTS) await page.screenshot({path: 'static/img/match.png', fullPage: true});
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
    await page.click('#btn-new');
    await expect(page.locator('#gpt-effort-value')).toHaveText('Ultra');
    await expect(page.locator('#claude-effort-value')).toHaveText('Max');
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
