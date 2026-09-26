'use strict';

const assert = require('assert');
const { tmpFile, rm } = require('./dbtmp');
const dbFile = tmpFile('ai-long-input.test.db');
rm(dbFile); rm(`${dbFile}-wal`); rm(`${dbFile}-shm`);
process.env.DATABASE_FILE = dbFile;
process.env.GROQ_API_KEY = 'TEST_ONLY_NOT_REAL';
process.env.GROQ_MODEL = 'openai/gpt-oss-20b';

(async () => {
  const oldFetch = global.fetch;
  let payload;
  global.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) };
  };
  const database = require('../database/database');
  database.open();
  const character = require('../ai/character');
  const input = 'entrada grande🙂 '.repeat(1200); // > 20k chars, intentionally not truncated
  const result = await character.ask({ chatId: 'long@g.us', userId: 'user@s.whatsapp.net', text: input });
  assert.strictEqual(result.ok, true);
  const userMessage = payload.messages[payload.messages.length - 1];
  assert.strictEqual(userMessage.content, input);
  assert.ok(userMessage.content.length > 20000);
  assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'max_tokens'));
  database.close();
  global.fetch = oldFetch;
  rm(dbFile); rm(`${dbFile}-wal`); rm(`${dbFile}-shm`);
  console.log('aiLongInput.test.js: OK');
})().catch((err) => { try { require('../database/database').close(); } catch (_) {} console.error(err); process.exitCode = 1; });
