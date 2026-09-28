'use strict';

const assert = require('assert');
const { sendSupportContact } = require('../utils/supportContact');

async function run() {
  for (const jid of ['5511999999999@s.whatsapp.net', '120363000000000000@g.us']) {
    let call;
    const sock = { sendMessage: async (...args) => { call = args; return { key: { id: 'test' } }; } };
    await sendSupportContact(sock, jid, { quoted: { key: { id: 'quoted' } } });
    assert.strictEqual(call[0], jid);
    assert.strictEqual(call[1].contacts.displayName, 'Lua • Suporte');
    assert.strictEqual(call[1].contacts.contacts.length, 1);
    assert(call[1].contacts.contacts[0].vcard.includes('waid=5519981144235:+5519981144235'));
    assert.strictEqual(call[2].quoted.key.id, 'quoted');
    assert(!('text' in call[1]));
  }
  console.log('supportContact.test.js: PV/group native contact payload OK');
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
