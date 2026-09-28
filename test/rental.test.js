'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lua-rental-')), 'test.db');
process.env.DATABASE_FILE = dbFile;
const database = require('../database/database');
const rental = require('../database/rental');
database.open();

assert.strictEqual(rental.parseMoney('7'), 700);
assert.strictEqual(rental.parseMoney('7,50'), 750);
assert.strictEqual(rental.parseMoney('7.50'), 750);
assert.throws(() => rental.parseMoney('-1'), /MONEY_INVALID/);
assert.strictEqual(rental.parseDuration('30m'), 1800000);
assert.strictEqual(rental.parseDuration('1d'), 86400000);
assert.strictEqual(rental.parseDuration('infinito'), null);

const a = '120363000000000001@g.us';
const b = '120363000000000002@g.us';
let state = rental.setGroupPlan(a, 'RENTAL', { durationMs: 86400000, activatedBy: 'owner@s.whatsapp.net' });
assert.strictEqual(state.plan, 'RENTAL');
assert.strictEqual(state.status, 'ACTIVE');
assert(state.expires_at);
rental.setRentalMode(a, true);
rental.setGroupBotEnabled(a, false);
assert.strictEqual(rental.getGroupSubscription(a).rentalModeEnabled, true);
assert.strictEqual(rental.isGroupBotEnabled(a), false);
assert.strictEqual(rental.isGroupBotEnabled(b), true);
assert.strictEqual(rental.getGroupSubscription(b).plan, 'FREE');
assert.strictEqual(rental.canUseRentalFeature(a).ok, true);
rental.setGroupPlan(a, 'RENTAL', { durationMs: 1, activatedBy: 'owner@s.whatsapp.net' });
assert.strictEqual(rental.getGroupSubscription(a, Date.now() + 5).status, 'EXPIRED');
console.log('rental.test.js: catalog, plans, expiry and group isolation OK');
