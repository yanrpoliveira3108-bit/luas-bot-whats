'use strict';

const assert = require('assert');
const { tmpFile, rm } = require('./dbtmp');
const dbFile = tmpFile('ai-layers.test.db');
rm(dbFile); rm(`${dbFile}-wal`); rm(`${dbFile}-shm`);
process.env.DATABASE_FILE = dbFile;
process.env.GROQ_API_KEY = 'TEST_ONLY_NOT_A_REAL_KEY';
process.env.GROQ_MODEL = 'openai/gpt-oss-20b';

(async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) });
  const database = require('../database/database');
  database.open();
  const groq = require('../ai/providers/groq');
  const router = require('../ai/router');
  const character = require('../ai/character');
  const direct = await groq.handle({ messages: [{ role: 'user', content: 'Responda somente OK' }] });
  assert.strictEqual(direct.provider, 'groq');
  assert.strictEqual(direct.ok, true);
  const routed = await router.ask({ chatId: 'layer-router@g.us', text: 'Responda OK', mode: 'chat', messages: [{ role: 'user', content: 'Responda OK' }] });
  assert.strictEqual(routed.provider, 'groq');
  const result = await character.ask({ chatId: 'layer-character@g.us', userId: 'user@s.whatsapp.net', text: 'Responda OK' });
  assert.strictEqual(result.provider, 'groq');
  assert.strictEqual(character.status('layer-character@g.us').lastAiStatus, 'success');
  global.fetch = oldFetch;
  database.close();
  rm(dbFile); rm(`${dbFile}-wal`); rm(`${dbFile}-shm`);
  console.log('aiLayers.test.js: OK');
})().catch((err) => { try { require('../database/database').close(); } catch (_) {} console.error(err); process.exitCode = 1; });
