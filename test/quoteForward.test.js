'use strict';

const assert = require('assert');
const { buildForwardContent, forwardQuoted } = require('../utils/quoteForward');

(async () => {
  const quoted = {
    extendedTextMessage: {
      text: 'Confira https://exemplo.com',
      contextInfo: {
        forwardingScore: 2,
        isForwarded: true,
        forwardedNewsletterMessageInfo: { newsletterJid: 'newsletter@newsletter' },
        stanzaId: 'original-id',
      },
    },
  };
  const sent = [];
  const ctx = {
    quoted,
    remoteJid: '120363@g.us',
    socket: { sendMessage: async (jid, content) => sent.push({ jid, content }) },
  };
  const content = buildForwardContent(ctx, ['5511@s.whatsapp.net']);
  assert.ok(content.forward);
  assert.deepStrictEqual(content.forward.message, quoted);
  assert.deepStrictEqual(content.mentions, ['5511@s.whatsapp.net']);
  assert.strictEqual(content.contextInfo.forwardingScore, 2);
  assert.ok(content.contextInfo.forwardedNewsletterMessageInfo);
  assert.strictEqual(content.contextInfo.stanzaId, undefined);
  const result = await forwardQuoted({ ctx, command: 'hidetag', mentions: ['5511@s.whatsapp.net'] });
  assert.strictEqual(result.sent, true);
  assert.strictEqual(sent.length, 1);
  assert.deepStrictEqual(sent[0].content.forward.message, quoted);
  console.log('quoteForward.test.js: OK');
})().catch((err) => { console.error(err); process.exitCode = 1; });
