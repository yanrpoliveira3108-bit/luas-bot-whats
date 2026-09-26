'use strict';

const assert = require('assert');

(async () => {
  const oldKey = process.env.GROQ_API_KEY;
  const oldModel = process.env.GROQ_MODEL;
  const oldFetch = global.fetch;
  const router = require('../ai/router');
  process.env.GROQ_MODEL = 'openai/gpt-oss-20b';

  delete process.env.GROQ_API_KEY;
  let result = await router.ask({ chatId: 'groq-only', text: 'oi' });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'GROQ_NOT_CONFIGURED');
  assert.strictEqual(result.provider, 'groq');

  process.env.GROQ_API_KEY = 'TEST_ONLY_NOT_REAL';
  global.fetch = async () => ({ ok: false, status: 401, headers: { get: () => 'application/json' } });
  result = await router.ask({ chatId: 'groq-only', text: 'oi' });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'GROQ_UNAUTHORIZED');
  assert.strictEqual(result.provider, 'groq');

  global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) });
  result = await router.ask({ chatId: 'groq-only', text: 'oi' });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.provider, 'groq');
  assert.strictEqual(result.text, 'OK');

  global.fetch = oldFetch;
  if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey;
  if (oldModel === undefined) delete process.env.GROQ_MODEL; else process.env.GROQ_MODEL = oldModel;
  console.log('groqOnly.test.js: OK');
})().catch((err) => { console.error(err); process.exitCode = 1; });
