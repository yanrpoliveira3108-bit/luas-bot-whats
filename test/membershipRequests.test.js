'use strict';
const assert = require('assert');
const { tmpFile, rm } = require('./dbtmp');
const file = tmpFile('membership-requests.test.db');
rm(file); rm(`${file}-wal`); rm(`${file}-shm`); process.env.DATABASE_FILE = file;
const database = require('../database/database'); database.open();
const groups = require('../database/groups');
const membership = require('../utils/membershipRequests');
const captcha = require('../utils/captchaManager');
const A = '120363000000001@g.us'; const B = '120363000000002@g.us'; const U = '5511999999999@s.whatsapp.net';
const calls = [];
const sock = {
  groupRequestParticipantsList: async (g) => [{ jid: U }],
  groupRequestParticipantsUpdate: async (g, entries, action) => { calls.push({ g, entries, action }); return entries.map((jid) => ({ jid, status: '200' })); },
  groupMetadata: async () => ({ subject: 'Grupo teste' }),
  sendMessage: async (jid, body) => { calls.push({ jid, body }); },
  signalRepository: { lidMapping: { getPNForLID: async () => U } },
};
(async () => {
  groups.setSetting(A, 'autoaceitar', true); groups.setSetting(A, 'captcha', false);
  await membership.handleMessage(sock, { key: { remoteJid: A }, messageStubType: 172, messageStubParameters: [U, 'created', 'invite'] });
  assert.ok(calls.some((x) => x.action === 'approve'));
  groups.setSetting(B, 'autoaceitar', true); groups.setSetting(B, 'captcha', true);
  calls.length = 0;
  await membership.handleMessage(sock, { key: { remoteJid: B }, messageStubType: 172, messageStubParameters: [U, 'created', 'invite'] });
  assert.ok(calls.some((x) => x.jid === U && x.body && x.body.text.includes('Verificação')));
  assert.ok(!calls.some((x) => x.action === 'approve'));
  // Repetição do stub é idempotente: o mesmo par mantém um único desafio.
  await membership.handleMessage(sock, { key: { remoteJid: B }, messageStubType: 172, messageStubParameters: [U, 'created', 'invite'] });
  assert.strictEqual(captcha.pendingFor(B, U).length, 1);
  await membership.handleMessage(sock, { key: { remoteJid: B }, messageStubType: 172, messageStubParameters: [U, 'revoked'] });
  assert.strictEqual(captcha.pendingFor(B, U).length, 0);
  // O stub pode trazer LID enquanto listPending retorna PN: o match usa o mapa real.
  groups.setSetting(B, 'captcha', true);
  const lid = '1234567890@lid';
  await membership.handleMessage(sock, { key: { remoteJid: B }, messageStubType: 172, messageStubParameters: [lid, 'created', 'invite'] });
  assert.ok(calls.some((x) => x.jid === U && x.body && x.body.text.includes('Verificação')));
  await captcha.cancelFor(B, U, 'test-cleanup-lid');
  const C = '120363000000003@g.us';
  groups.setSetting(C, 'captcha', true);
  sock.sendMessage = async () => { throw Object.assign(new Error('dm unavailable'), { code: 'DM_TEST_FAILURE' }); };
  await membership.handleMessage(sock, { key: { remoteJid: C }, messageStubType: 172, messageStubParameters: [U, 'created', 'invite'] });
  const failed = database.prepare('delivery_status', 'SELECT status, delivery_status FROM captcha_challenges WHERE group_jid = ? AND participant_jid = ?').get(C, U);
  assert.strictEqual(failed.status, 'pending');
  assert.strictEqual(failed.delivery_status, 'delivery_failed');
  assert.strictEqual(calls.some((x) => x.action === 'approve'), false);
  assert.strictEqual(captcha.pendingFor(C, U).length, 1);
  await captcha.cancelFor(C, U, 'test-cleanup-delivery');
  database.close(); rm(file); rm(`${file}-wal`); rm(`${file}-shm`); console.log('membershipRequests.test.js: OK');
})().catch((e) => { try { database.close(); } catch (_) {} console.error(e); process.exitCode = 1; });
