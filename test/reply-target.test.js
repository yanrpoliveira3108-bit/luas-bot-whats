/**
 * test/reply-target.test.js — alvo por RESPOSTA (responder à mensagem) em vez de @número.
 *
 * Cobre:
 *  1) getQuotedSender: PN, LID→PN e '' quando não é resposta.
 *  2) resolveTarget (admin): ordem menção → resposta → argumento.
 *  3) interações (!beijo): responder à mensagem define o alvo (não "si mesmo").
 *  4) admin ponta a ponta (!promover): responder ao alvo promove o autor da
 *     mensagem citada, sem digitar @número.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

process.env.OWNER_NUMBER = '5511999999999';
process.env.DATABASE_FILE = require('./dbtmp').tmpFile('lua-reply-target-test.db');

let failures = 0;
function ok(l) { console.log('✅ ' + l); }
function fail(l, e) { failures++; console.log('❌ ' + l + ' — ' + (e && e.message)); }

const A = '5511111111111@s.whatsapp.net'; // autor/admin
const B = '5522222222222@s.whatsapp.net'; // alvo
const BOT = '5511000000000@s.whatsapp.net';

async function main() {
  try { fs.rmSync(process.env.DATABASE_FILE, { force: true }); } catch (_) {}
  require('../database/database').open();
  require('../commands/loader').loadCommands(true);
  const { registry } = require('../engine/plugins');
  const { getQuotedSender } = require('../utils/messages');
  const { resolveTarget } = require('../commands/_shared/admin');

  /* 1) getQuotedSender */
  try {
    const pn = { message: { extendedTextMessage: { text: 'x', contextInfo: { participant: B } } } };
    assert.strictEqual(getQuotedSender(pn), B, 'PN direto');
    const lid = { message: { extendedTextMessage: { text: 'x', contextInfo: { participant: '123456@lid', participantAlt: B } } } };
    assert.strictEqual(getQuotedSender(lid), B, 'LID→PN');
    const none = { message: { conversation: 'oi' } };
    assert.strictEqual(getQuotedSender(none), '', 'sem resposta → vazio');
    ok('1: getQuotedSender (PN, LID→PN, sem resposta)');
  } catch (e) { fail('1', e); }

  /* 2) resolveTarget: menção > resposta > arg */
  try {
    assert.strictEqual(resolveTarget({ mentionedJid: [A], quotedSender: B, args: [] }), A, 'menção vence');
    assert.strictEqual(resolveTarget({ mentionedJid: [], quotedSender: B, args: [] }), B, 'resposta usada');
    assert.strictEqual(resolveTarget({ mentionedJid: [], quotedSender: '', args: [A] }), A, 'arg como último recurso');
    assert.strictEqual(resolveTarget({ mentionedJid: [], quotedSender: '', args: [] }), null, 'sem alvo → null');
    ok('2: resolveTarget prioriza menção → resposta → arg');
  } catch (e) { fail('2', e); }

  /* 3) interação !beijo por resposta */
  try {
    const beijo = registry.resolveTrigger('beijo');
    const users = require('../database/users');
    users.upsert(A, 'Alice'); users.upsert(B, 'Bob');
    const replies = [];
    const ctx = { sender: A, senderJid: A, remoteJid: '120363000030@g.us', isGroup: true,
      socket: { user: { id: BOT } }, mentionedJid: [], quotedSender: B, args: [], prefix: '!',
      reply: async (t) => { replies.push(t); return {}; } };
    await beijo.execute(ctx);
    const txt = replies.join(' ');
    assert.ok(/Bob/.test(txt), 'alvo = autor da resposta (Bob): ' + txt);
    assert.ok(!/si mesmo|espelho/.test(txt), 'não é auto-interação: ' + txt);
    ok('3: !beijo respondendo à mensagem beija o autor citado');
  } catch (e) { fail('3', e); }

  /* 4) admin ponta a ponta: !promover por resposta */
  try {
    const G = '120363000031@g.us';
    const promoted = [];
    const sock = {
      user: { id: BOT },
      groupMetadata: async () => ({ id: G, participants: [
        { id: A, admin: 'admin' }, { id: BOT, admin: 'admin' }, { id: B, admin: null },
      ] }),
      groupParticipantsUpdate: async (jid, jids, action) => { promoted.push({ jid, jids, action }); return {}; },
      sendMessage: async (jid, c) => ({ key: { id: 'k' } }),
      sendPresenceUpdate: async () => {},
    };
    const handler = require('../handlers/commandHandler');
    const cooldown = require('../utils/cooldown');
    cooldown.reset('user', A, 'promover'); cooldown.reset('global', '*', 'promover');
    const msg = {
      key: { remoteJid: G, fromMe: false, id: 'MR1', participant: A },
      message: { extendedTextMessage: { text: '!promover', contextInfo: { stanzaId: 'S1', participant: B, quotedMessage: { conversation: 'oi' } } } },
      pushName: 'Alice',
    };
    await handler.handleMessage(sock, msg);
    assert.strictEqual(promoted.length, 1, 'promoveu uma vez');
    assert.deepStrictEqual(promoted[0].jids, [B], 'promoveu o autor da mensagem citada');
    assert.strictEqual(promoted[0].action, 'promote');
    ok('4: !promover respondendo à mensagem promove o citado (sem @número)');
  } catch (e) { fail('4', e); }

  require('../database/database').close();
  if (failures) { console.error(`\n❌ REPLY-TARGET TEST: ${failures} falha(s)`); process.exit(1); }
  console.log('\n=== REPLY-TARGET TEST: TUDO OK ===');
  process.exit(0);
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
