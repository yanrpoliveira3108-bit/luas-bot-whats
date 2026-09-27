'use strict';

const assert = require('assert');
const { tmpFile, rm } = require('./dbtmp');
const file = tmpFile('group-access.test.db');
rm(file); rm(`${file}-wal`); rm(`${file}-shm`);
process.env.DATABASE_FILE = file;

(async () => {
  const db = require('../database/database');
  db.open();
  const access = require('../utils/groupAccess');
  const group = '120363046296961148@g.us';
  assert.strictEqual(access.extractInviteCode('https://chat.whatsapp.com/ABC_123'), 'ABC_123');
  assert.strictEqual(access.extractInviteCode('https://example.com/ABC_123'), null);
  access.block(group, 'owner@s.whatsapp.net', 'Grupo teste');
  assert.strictEqual(access.isBlocked(group), true);
  assert.strictEqual(access.list()[0].groupJid, group);
  assert.strictEqual(access.unblock(group), true);
  assert.strictEqual(access.isBlocked(group), false);
  let accepted = 0;
  const sock = {
    groupGetInviteInfo: async () => ({ id: group, subject: 'Grupo teste' }),
    groupAcceptInvite: async () => { accepted++; return group; },
    groupLeave: async () => {},
  };
  const joined = await access.join(sock, 'ABC_123');
  assert.strictEqual(joined.groupJid, group);
  assert.strictEqual(accepted, 1);
  access.block(group, 'owner', 'Grupo teste');
  const blocked = await access.join(sock, 'ABC_123');
  assert.strictEqual(blocked.blocked, true);
  assert.strictEqual(accepted, 1);
  db.close();
  rm(file); rm(`${file}-wal`); rm(`${file}-shm`);
  console.log('groupAccess.test.js: OK');
})().catch((err) => { try { require('../database/database').close(); } catch (_) {} console.error(err); process.exitCode = 1; });
