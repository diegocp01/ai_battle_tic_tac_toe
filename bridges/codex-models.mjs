import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Metadata only: never create a thread or start a turn.
export async function listCodexModels(command, env = process.env) {
    const child = spawn(command[0], command.slice(1), {env, stdio: ['pipe', 'pipe', 'ignore']});
    const lines = createInterface({input: child.stdout});
    const pending = new Map();
    let nextId = 1;
    const closed = new Promise(resolve => child.once('close', resolve));
    const fail = () => {
        for (const item of pending.values()) item.reject(new Error('Codex model discovery failed.'));
        pending.clear();
    };
    child.on('error', fail);
    child.on('close', fail);
    child.stdin.on('error', fail);
    lines.on('line', line => {
        let response;
        try { response = JSON.parse(line); } catch { return; }
        const item = pending.get(response.id);
        if (!item) return;
        pending.delete(response.id);
        if (response.error) item.reject(new Error('Codex model discovery failed.'));
        else item.resolve(response.result);
    });
    const send = (method, params) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, {resolve, reject});
        child.stdin.write(JSON.stringify({id, method, params}) + '\n');
    });
    const timer = setTimeout(() => { fail(); child.kill(); }, 12000);
    try {
        await send('initialize', {clientInfo: {name: 'ai_arena_model_picker', title: 'AI Arena model picker', version: '1.0.0'}, capabilities: {}});
        child.stdin.write(JSON.stringify({method: 'initialized', params: {}}) + '\n');
        const models = [];
        const seenCursors = new Set();
        let cursor = null;
        do {
            const page = await send('model/list', {limit: 100, includeHidden: false, ...(cursor ? {cursor} : {})});
            if (!Array.isArray(page?.data)) throw new Error('Invalid Codex model list.');
            models.push(...page.data);
            cursor = page.nextCursor;
            if (cursor && seenCursors.has(cursor)) throw new Error('Repeated model-list cursor.');
            if (cursor) seenCursors.add(cursor);
        } while (cursor);
        return models;
    } finally {
        clearTimeout(timer);
        child.kill();
        await closed;
        lines.close();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const require = createRequire(import.meta.url);
        const options = ['-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"', '-c', 'mcp_servers={}', '-c', 'hooks={}', 'app-server'];
        const command = process.env.CODEX_CLI_PATH
            ? [process.env.CODEX_CLI_PATH, ...options]
            : [process.execPath, join(dirname(require.resolve('@openai/codex/package.json')), 'bin/codex.js'), ...options];
        process.stdout.write(JSON.stringify(await listCodexModels(command)));
    } catch {
        process.stderr.write('Could not read the Codex CLI model list.\n');
        process.exitCode = 1;
    }
}
