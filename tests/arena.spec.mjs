import { test, expect } from '@playwright/test';

async function ready(page, url = '/') {
    await page.goto(url);
    await expect(page.locator('#session-title')).toHaveText('Ready when you are');
}

test('forced Test mode completes a series, restores results, and restarts', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await ready(page);
    await expect(page.locator('#play-mode')).toHaveValue('test');
    await expect(page.locator('#play-mode')).toBeDisabled();
    await expect(page.locator('#test-badge')).toBeVisible();
    await page.selectOption('#game-count', '2');
    await page.locator('#btn-run').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    await expect(page.locator('#stats-body tr')).toHaveCount(2);
    await expect(page.locator('.cell.winner')).toHaveCount(3);
    await expect(page.locator('#gpt-reasoning')).toContainText('No LLM was called');
    await page.reload();
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    await page.selectOption('#game-count', '1');
    await page.click('#btn-run');
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    await expect(page.locator('#stats-body tr')).toHaveCount(1);
    expect(errors).toEqual([]);
});

test('pause waits for an in-flight move and reload resumes the saved board', async ({ page }) => {
    await ready(page);
    let moves = 0;
    await page.route('**/api/next-move', async route => {
        moves++;
        await new Promise(resolve => setTimeout(resolve, 250));
        await route.continue();
    });
    const started = page.waitForRequest('**/api/next-move');
    await page.click('#btn-run');
    await started;
    await page.click('#btn-pause');
    await expect(page.locator('#session-title')).toHaveText('Match paused');
    await expect(page.locator('.cell.X,.cell.O')).toHaveCount(1);
    await page.waitForTimeout(400);
    expect(moves).toBe(1);
    await page.reload();
    await expect(page.locator('#session-title')).toHaveText('Match paused');
    await expect(page.locator('.cell.X,.cell.O')).toHaveCount(1);
    await page.click('#btn-run');
    await expect(page.locator('#session-title')).toHaveText('Series complete');
});

test('Local and API stay optional; failed local matches can switch to Test', async ({ page }) => {
    await ready(page, 'http://127.0.0.1:5085');
    await expect(page.locator('#play-mode')).toHaveValue('local');
    await expect(page.locator('#gpt-name')).toHaveText('Codex');
    if (process.env.ARENA_SCREENSHOTS) {
        await page.setViewportSize({width: 1440, height: 1150});
        await page.screenshot({path: 'static/img/image.png', fullPage: true});
        await page.setViewportSize({width: 390, height: 1000});
        await page.screenshot({path: '/tmp/tic-tac-toe-review/local-mobile.png', fullPage: true});
        await page.setViewportSize({width: 1440, height: 1150});
    }
    await page.selectOption('#play-mode', 'api');
    await expect(page.locator('#gpt-name')).toHaveText('GPT 5.2');
    await expect(page.locator('#mode-description')).toContainText('API keys');
    await page.selectOption('#play-mode', 'local');
    // This server replaces both real adapters with a failure fixture.
    await page.click('#btn-run');
    await expect(page.locator('#session-title')).toHaveText('Match interrupted');
    await expect(page.locator('#error-message')).toContainText('real LLM calls are disabled');
    await page.selectOption('#play-mode', 'test');
    await expect(page.locator('#btn-run')).toHaveText('Start new match');
    await page.selectOption('#game-count', '1');
    await page.click('#btn-run');
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    await expect(page.locator('#gpt-name')).toHaveText('Test player A');
    await expect(page.locator('#stats-body tr')).toHaveCount(1);
});

test('malformed response and model failure recover without losing controls', async ({ page }) => {
    await ready(page);
    await page.selectOption('#game-count', '1');
    await page.route('**/api/start-games', route => route.fulfill({status: 500, body: 'Unavailable'}), {times: 1});
    await page.click('#btn-run');
    await expect(page.locator('#error-message')).toContainText('unexpected response');
    await page.route('**/api/next-move', route => route.fulfill({status: 502, json: {error: 'Fixture failure'}}), {times: 1});
    await page.click('#btn-run');
    await expect(page.locator('#error-message')).toHaveText('Fixture failure');
    await expect(page.locator('.is-thinking')).toHaveCount(0);
    await page.click('#btn-run');
    await expect(page.locator('#session-title')).toHaveText('Series complete');
});

test('server test lock cannot be overridden by a local-mode request', async ({ request }) => {
    const response = await request.post('/api/start-games', {data: {mode: 'local', num_games: 1}});
    expect((await response.json()).game_state.mode).toBe('test');
    const move = await request.post('/api/next-move');
    const data = await move.json();
    expect(data.game_state[data.model + '_reasoning']).toContain('No LLM was called');
});

test('responsive layouts and reduced motion retain all controls', async ({ page }) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await ready(page);
    for (const width of [1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({width, height: 1000});
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.locator('#btn-run')).toBeVisible();
        await expect(page.locator('#test-badge')).toBeVisible();
    }
    await expect(page.locator('.cell[role="img"]')).toHaveCount(9);
    await page.selectOption('#game-count', '1');
    await page.click('#btn-run');
    await expect(page.locator('#session-title')).toHaveText('Series complete');
    expect(await page.locator('.piece').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});
