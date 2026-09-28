'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATABASE_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lua-premium-')), 'test.db');
const database = require('../database/database');
const premium = require('../database/premium');
database.open();

const user = '5511999999999@s.whatsapp.net';
const key = premium.createKey('USER', premium.parseDuration('30s'), 'owner@s.whatsapp.net');
assert(/^LUA-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(key.key));
assert.strictEqual(premium.getKey(key.id).status, 'UNUSED');
assert(!database.get().prepare('premium_plaintext_check', 'SELECT 1 FROM activation_keys WHERE key_hash=?').get(key.key));
const result = premium.redeem({ isGroup: false, sender: user, identidades: [user] }, key.key);
assert.strictEqual(result.scope, 'USER');
assert.strictEqual(premium.hasUserVip(user), true);
assert.throws(() => premium.redeem({ isGroup: false, sender: user, identidades: [user] }, key.key), /KEY_INVALID/);
assert.strictEqual(premium.getKey(key.id).status, 'REDEEMED');

const groupKey = premium.createKey('GROUP', premium.parseDuration('1m'), 'owner@s.whatsapp.net');
assert.throws(() => premium.redeem({ isGroup: false, sender: user }, groupKey.key), /GROUP_KEY_IN_GROUP/);
const group = '120363000000000001@g.us';
const groupResult = premium.redeem({ isGroup: true, remoteJid: group, sender: user, isAdmin: true }, groupKey.key);
assert.strictEqual(groupResult.scope, 'GROUP');
assert.strictEqual(premium.hasGroupVip(group), true);
console.log('premium.test.js: hashed keys, single-use, scope and group/user VIP OK');
