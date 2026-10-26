import { defineConfig } from '@playwright/test';

const python = process.env.ARENA_PYTHON || '.venv/bin/python';
export default defineConfig({
    testDir: './tests',
    testMatch: '**/*.spec.mjs',
    workers: 1,
    timeout: 30000,
    expect: { timeout: 15000 },
    use: { baseURL: 'http://127.0.0.1:5084', headless: true },
    webServer: [
        { command: `${python} app.py --test --port 5084`, url: 'http://127.0.0.1:5084/api/config', reuseExistingServer: false },
        { command: `${python} tests/ui_server.py`, url: 'http://127.0.0.1:5085/api/config', reuseExistingServer: false },
    ],
});
