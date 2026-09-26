'use strict';
const assert = require('assert');
const { tmpFile, rm } = require('./dbtmp');
const file = tmpFile('membership-monitor.test.db');
rm(file); rm(`${file}-wal`); rm(`${file}-shm`); process.env.DATABASE_FILE = file;
const database = require('../database/database'); database.open();
const groups = require('../database/groups');
const captcha = require('../utils/captchaManager');
const monitor = require('../utils/membershipMonitor');
const A = '120363000000011@g.us'; const B = '120363000000012@g.us';
const U = '5511999999999@s.whatsapp.net';
const approved = []; const sent = [];
const sock = {
  groupRequestParticipantsList: async (group) => group === A ? [{ jid: U }] : [{ jid: U }],
  groupRequestParticipantsUpdate: async (group, entries, action) => { approved.push({ group, entries, action }); return entries.map((jid) => ({ jid, status: '200' })); },
  groupMetadata: async () => ({ subject: 'Monitor test' }),
  sendMessage: async (jid, body) => sent.push({ jid, body }),
};
(async () => {
  groups.setSetting(A, 'autoaceitar', true); groups.setSetting(A, 'captcha', false);
  await monitor.scanOnce(sock);
  assert.strictEqual(approved.length, 1);
  await monitor.scanOnce(sock);
  assert.strictEqual(approved.length, 1, 'pedido persistente não deve ser processado duas vezes');

  groups.setSetting(A, 'autoaceitar', false);
  await monitor.scanOnce(sock); // remove A da lista de grupos ativos
  groups.setSetting(B, 'captcha', true);
  await monitor.scanOnce(sock);
  assert.ok(sent.some((x) => x.jid === U && x.body.text.includes('Verificação')));
  assert.strictEqual(captcha.pendingFor(B, U).length, 1);
  await monitor.scanOnce(sock);
  assert.strictEqual(captcha.pendingFor(B, U).length, 1, 'scan não deve duplicar CAPTCHA');
  await captcha.cancelFor(B, U, 'test-cleanup');
  monitor.reset(); database.close(); rm(file); rm(`${file}-wal`); rm(`${file}-shm`);
  console.log('membershipMonitor.test.js: OK');
})().catch((err) => { try { database.close(); } catch (_) {} console.error(err); process.exitCode = 1; });
