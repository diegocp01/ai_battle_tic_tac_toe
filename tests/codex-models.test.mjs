import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listCodexModels } from '../bridges/codex-models.mjs';

test('model discovery reads every page without starting a thread or inference turn', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arena-model-list-'));
    try {
        const file = join(dir, 'fake-cli.mjs');
        const log = join(dir, 'methods.jsonl');
        await writeFile(file, `
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
createInterface({input: process.stdin}).on('line', line => {
 const message = JSON.parse(line);
 appendFileSync(${JSON.stringify(log)}, JSON.stringify(message) + '\\n');
 if (message.method === 'initialize') console.log(JSON.stringify({id:message.id,result:{}}));
 else if (message.method === 'initialized') return;
 else if (message.method === 'model/list') {
  const second = !!message.params.cursor;
  console.log(JSON.stringify({id:message.id,result:{data:[{model:second?'gpt-6-luna':'gpt-6-sol',displayName:second?'GPT-6-Luna':'GPT-6-Sol'}],nextCursor:second?null:'second-page'}}));
 } else process.exit(2);
});
`);
        const models = await listCodexModels([process.execPath, file]);
        assert.deepEqual(models.map(model => model.model), ['gpt-6-sol', 'gpt-6-luna']);
        const messages = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
        assert.deepEqual(messages.map(message => message.method), ['initialize', 'initialized', 'model/list', 'model/list']);
        assert.equal(messages[2].params.includeHidden, false);
        assert.equal(messages[3].params.cursor, 'second-page');
    } finally { await rm(dir, {recursive:true, force:true}); }
});

test('failed metadata process is reported without hanging', async () => {
    await assert.rejects(listCodexModels([process.execPath, '-e', 'process.exit(1)']), /discovery failed/);
});
