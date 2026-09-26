'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  const oldFetch = global.fetch;
  const oldKey = process.env.GROQ_API_KEY;
  const oldModel = process.env.GROQ_MODEL;
  const groq = require('../ai/providers/groq');
  const aiConfig = require('../utils/aiConfig');
  const originalFile = aiConfig.ENV_FILE;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lua-groq-'));
  const envFile = path.join(dir, '.env');
  aiConfig._setEnvFileForTests(envFile);
  process.env.GROQ_API_KEY = 'TEST_GROQ_SECRET_928471';
  process.env.GROQ_MODEL = 'test-model';
  let request;
  global.fetch = async (_url, options) => {
    request = { url: _url, options };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  const first = await groq.handle({ messages: [{ role: 'user', content: 'oi' }] });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.provider, 'groq');
  assert.strictEqual(request.options.body.includes('test-model'), true);
  assert.strictEqual(request.options.headers.Authorization, 'Bearer TEST_GROQ_SECRET_928471');

  const statuses = [401, 403, 429, 500];
  for (const status of statuses) {
    global.fetch = async () => ({ ok: false, status, json: async () => ({}) });
    const r = await groq.handle({ messages: [{ role: 'user', content: 'oi' }] });
    assert.strictEqual(r.ok, false);
    assert.ok(r.code.startsWith('GROQ_'));
  }
  global.fetch = async () => new Promise((_, reject) => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  const timeout = await groq.handle({ messages: [{ role: 'user', content: 'oi' }], timeoutMs: 1 });
  assert.strictEqual(timeout.code, 'GROQ_TIMEOUT');

  fs.writeFileSync(envFile, 'OTHER=value\nGROQ_API_KEY=old\n');
  aiConfig.persistGroqApiKey('TEST_GROQ_SECRET_928471');
  const saved = fs.readFileSync(envFile, 'utf8');
  assert.match(saved, /OTHER=value/);
  assert.match(saved, /GROQ_API_KEY=TEST_GROQ_SECRET_928471/);
  assert.strictEqual(process.env.GROQ_API_KEY, 'TEST_GROQ_SECRET_928471');
  assert.strictEqual(saved.includes('Authorization'), false);

  global.fetch = oldFetch;
  if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey;
  if (oldModel === undefined) delete process.env.GROQ_MODEL; else process.env.GROQ_MODEL = oldModel;
  aiConfig._setEnvFileForTests(originalFile);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('groqProvider.test.js: OK');
})().catch((err) => { console.error(err); process.exitCode = 1; });
