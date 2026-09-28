'use strict';

const assert = require('assert');
const CONFIG = require('../config');
const components = require('../menus/html/components');
const { SUPPORT_NAME, supportNumber, supportVcard } = require('../utils/supportContact');

assert.strictEqual(CONFIG.support.number, '5519981144235');
assert(!CONFIG.owner.numbers.includes(CONFIG.support.number));

const footer = components.rodape({ prefix: ',' });
assert(footer.includes('SUPORTE'));
assert(footer.includes('Digite ,suporte'));
assert(!footer.includes('<a'));
assert(!footer.includes('wa.me'));
assert(!footer.includes('data-copy'));
assert(!footer.includes('onclick'));

assert.strictEqual(SUPPORT_NAME, 'Lua • Suporte');
assert.strictEqual(supportNumber(), '5519981144235');
const vcard = supportVcard();
assert(vcard.includes('FN:Lua • Suporte'));
assert(vcard.includes('waid=5519981144235:+5519981144235'));
assert(vcard.startsWith('BEGIN:VCARD\n'));
assert(vcard.endsWith('\nEND:VCARD'));

console.log('supportButton.test.js: native-contact fallback protected');
