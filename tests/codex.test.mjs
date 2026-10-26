import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodex, moveSchema } from '../bridges/codex.mjs';

test('SDK options use CLI sign-in, a read-only sandbox, and structured output', async () => {
    let clientOptions, threadOptions, runOptions;
    class FakeCodex {
        constructor(options) { clientOptions = options; }
        startThread(options) {
            threadOptions = options;
            return {run: async (prompt, options) => {
                runOptions = options;
                return {finalResponse: '{"move":"B2","explanation":"Take the center."}'};
            }};
        }
    }
    const result = await runCodex({prompt: 'Board', model: 'configured-model'}, FakeCodex);
    assert.equal(result.move, 'B2');
    assert.equal(clientOptions.config.forced_login_method, 'chatgpt');
    assert.equal(clientOptions.env.OPENAI_API_KEY, undefined);
    assert.equal(clientOptions.env.CODEX_API_KEY, undefined);
    assert.equal(threadOptions.sandboxMode, 'read-only');
    assert.equal(threadOptions.approvalPolicy, 'never');
    assert.equal(threadOptions.model, 'configured-model');
    assert.deepEqual(runOptions.outputSchema, moveSchema);
});

test('invalid SDK output fails instead of fabricating a move', async () => {
    class FakeCodex {
        startThread() { return {run: async () => ({finalResponse: '{"move":"Z9","explanation":"bad"}'})}; }
    }
    await assert.rejects(runCodex({prompt: 'Board'}, FakeCodex), /invalid move/);
    await assert.rejects(runCodex({prompt: ''}, FakeCodex), /required/);
});

test('installed real SDK parses a fake CLI event stream without calling an LLM', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arena-sdk-test-'));
    const executable = join(dir, 'fake-codex.mjs');
    const argsFile = join(dir, 'args.json');
    const saved = {path: process.env.CODEX_CLI_PATH, key: process.env.CODEX_API_KEY};
    try {
        await writeFile(executable, `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
if (process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY) process.exit(2);
writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
for await (const chunk of process.stdin) {}
for (const event of [
 {type:'thread.started',thread_id:'fixture'},
 {type:'turn.started'},
 {type:'item.completed',item:{id:'answer',type:'agent_message',text:'{"move":"A1","explanation":"Fixture only."}'}},
 {type:'turn.completed',usage:{input_tokens:0,cached_input_tokens:0,output_tokens:0}}
]) console.log(JSON.stringify(event));
`, {mode: 0o755});
        process.env.CODEX_CLI_PATH = executable;
        process.env.CODEX_API_KEY = 'fake-must-not-be-forwarded';
        assert.equal((await runCodex({prompt: 'Fixture board'})).move, 'A1');
        const args = JSON.parse(await readFile(argsFile, 'utf8'));
        assert(args.includes('--output-schema'));
        assert(args.includes('read-only'));
        assert(args.includes('forced_login_method="chatgpt"'));
        assert(!args.includes('--model'), 'CLI default is preserved when no model is specified');
    } finally {
        if (saved.path === undefined) delete process.env.CODEX_CLI_PATH; else process.env.CODEX_CLI_PATH = saved.path;
        if (saved.key === undefined) delete process.env.CODEX_API_KEY; else process.env.CODEX_API_KEY = saved.key;
        await rm(dir, {recursive: true, force: true});
    }
});
