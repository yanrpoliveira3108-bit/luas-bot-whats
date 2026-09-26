'use strict';

const assert = require('assert');
const { tmpFile, rm } = require('./dbtmp');
const file = tmpFile('captcha-manager.test.db');
rm(file); rm(`${file}-wal`); rm(`${file}-shm`);
process.env.DATABASE_FILE = file;
const database = require('../database/database');
database.open();
const captcha = require('../utils/captchaManager');
const G1 = '120363000000001@g.us';
const G2 = '120363000000002@g.us';
const U = '5511999999999@s.whatsapp.net';
const socket = {
  groupRequestParticipantsList: async (g) => g === G1 ? [{ jid: U }, { jid: '5511888888888@s.whatsapp.net' }] : [{ jid: U }, { jid: '5511777777777@s.whatsapp.net' }],
  groupRequestParticipantsUpdate: async (g, entries) => entries.map((jid) => ({ jid, status: '200' })),
};

(async () => {
  assert.strictEqual(captcha.CAPTCHA_TTL_MS, 3 * 60 * 1000);
  const a = captcha.create(G1, U);
  const b = captcha.create(G2, U);
  assert.notStrictEqual(a.challengeId, b.challengeId);
  assert.notStrictEqual(a.expectedAnswer, b.expectedAnswer);
  assert.strictEqual(a.status, 'pending');
  assert.ok(a.expiresAt - a.createdAt === captcha.CAPTCHA_TTL_MS);

  let sent = [];
  captcha.setSocket(socket);
  // Resposta errada não reinicia o expiresAt.
  const before = captcha.publicRow(database.prepare('captcha_a', 'SELECT * FROM captcha_challenges WHERE challenge_id = ?').get(a.challengeId)).expiresAt;
  const tag = a.challengeId.slice(-6).toUpperCase();
  await captcha.onResponse(socket, U, `${tag} errada`, (m) => sent.push(m));
  await captcha.onResponse(socket, U, `${tag} errada`, (m) => sent.push(m));
  await captcha.onResponse(socket, U, `${tag} errada`, (m) => sent.push(m));
  const after = captcha.publicRow(database.prepare('captcha_b', 'SELECT * FROM captcha_challenges WHERE challenge_id = ?').get(a.challengeId));
  assert.strictEqual(after.status, 'rejected');
  assert.strictEqual(after.expiresAt, before);
  assert.ok(sent.some((m) => m.includes('Três')));

  const c = captcha.create(G1, '5511888888888@s.whatsapp.net');
  const response = await captcha.onResponse(socket, '5511888888888@s.whatsapp.net', c.expectedAnswer, () => {});
  assert.strictEqual(response, true);
  assert.strictEqual(database.prepare('captcha_c', 'SELECT status FROM captcha_challenges WHERE challenge_id = ?').get(c.challengeId).status, 'verified');
  const replay = await captcha.onResponse(socket, '5511888888888@s.whatsapp.net', c.expectedAnswer, () => {});
  assert.strictEqual(replay, false);

  const d = captcha.create(G2, '5511777777777@s.whatsapp.net');
  await captcha.cancelFor(G2, '5511777777777@s.whatsapp.net', 'test');
  assert.strictEqual(database.prepare('captcha_d', 'SELECT status FROM captcha_challenges WHERE challenge_id = ?').get(d.challengeId).status, 'cancelled');
  await captcha.reconcile(socket);
  await captcha.cancelFor(G2, U, 'test-cleanup');
  database.close();
  rm(file); rm(`${file}-wal`); rm(`${file}-shm`);
  console.log('captchaManager.test.js: OK');
})().catch((err) => { try { database.close(); } catch (_) {} console.error(err); process.exitCode = 1; });
