/**
 * test/delete-msg.test.js — comando !d / !delete (apagar a mensagem respondida).
 *
 * Regras validadas:
 *   • Admin/dono apaga qualquer mensagem (inclusive de outro admin).
 *   • Não-admin apaga apenas a PRÓPRIA mensagem.
 *   • Não-admin NÃO apaga mensagem de outro membro nem de admin.
 *   • Sem resposta → pede para responder; bot não-admin → não apaga.
 *   • Triggers: d/delete → delete; "apagar" segue o purge (sem conflito).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

process.env.OWNER_NUMBER = '5511999999999';
process.env.DATABASE_FILE = require('./dbtmp').tmpFile('lua-delete-msg-test.db');

let failures = 0;
function ok(l) { console.log('✅ ' + l); }
function fail(l, e) { failures++; console.log('❌ ' + l + ' — ' + (e && e.message)); }

const ADMIN = '5511111111111@s.whatsapp.net';   // admin que usa o comando
const ADMIN2 = '5544444444444@s.whatsapp.net';  // outro admin (alvo)
const MEMBER = '5522222222222@s.whatsapp.net';  // membro comum
const MEMBER2 = '5533333333333@s.whatsapp.net'; // outro membro comum
const BOT = '5511000000000@s.whatsapp.net';
const G = '120363000040@g.us';

function makeSock(deletes, replies, botAdmin, GJ) {
  return {
    user: { id: BOT },
    groupMetadata: async () => ({ id: GJ || G, participants: [
      { id: ADMIN, admin: 'admin' },
      { id: ADMIN2, admin: 'admin' },
      { id: BOT, admin: botAdmin ? 'admin' : null },
      { id: MEMBER, admin: null },
      { id: MEMBER2, admin: null },
    ] }),
    sendMessage: async (jid, c) => {
      if (c && c.delete) deletes.push(c.delete);
      if (c && c.text) replies.push(c.text);
      return { key: { id: 'k' } };
    },
    sendPresenceUpdate: async () => {},
  };
}

async function run(sender, opts) {
  const GJ = opts.group || G;
  const deletes = [];
  const replies = [];
  const sock = makeSock(deletes, replies, opts.botAdmin !== false, GJ);
  const handler = require('../handlers/commandHandler');
  const cooldown = require('../utils/cooldown');
  cooldown.reset('user', sender, 'delete');
  cooldown.reset('group', GJ, 'delete');
  cooldown.reset('global', '*', 'delete');
  const msg = {
    key: { remoteJid: GJ, fromMe: false, id: 'M', participant: sender, participantAlt: sender },
    message: opts.quoted
      ? { extendedTextMessage: { text: '!d', contextInfo: { stanzaId: 'S', participant: opts.quoted, quotedMessage: { conversation: 'x' } } } }
      : { conversation: '!d' },
    pushName: 'U',
  };
  await handler.handleMessage(sock, msg);
  return { deletes, replies, text: replies.join(' ') };
}

async function main() {
  try { fs.rmSync(process.env.DATABASE_FILE, { force: true }); } catch (_) {}
  require('../database/database').open();
  require('../commands/loader').loadCommands(true);
  const { registry } = require('../engine/plugins');

  /* 0) triggers */
  try {
    assert.strictEqual(registry.resolveTrigger('d').name, 'delete', 'd → delete');
    assert.strictEqual(registry.resolveTrigger('delete').name, 'delete', 'delete → delete');
    assert.strictEqual(registry.resolveTrigger('apagar').name, 'apagar', 'apagar segue o purge');
    ok('0: triggers d/delete → delete; "apagar" segue o purge (sem conflito)');
  } catch (e) { fail('0', e); }

  /* 1) admin apaga mensagem de membro comum */
  try {
    const r = await run(ADMIN, { quoted: MEMBER });
    assert.strictEqual(r.deletes.length, 1, 'admin apagou a do membro');
    ok('1: admin apaga mensagem de membro comum');
  } catch (e) { fail('1', e); }

  /* 2) admin apaga mensagem de OUTRO admin */
  try {
    const r = await run(ADMIN, { quoted: ADMIN2 });
    assert.strictEqual(r.deletes.length, 1, 'admin apagou a de outro admin');
    ok('2: admin apaga mensagem de outro admin');
  } catch (e) { fail('2', e); }

  /* 3) não-admin apaga a PRÓPRIA mensagem */
  try {
    const r = await run(MEMBER, { quoted: MEMBER });
    assert.strictEqual(r.deletes.length, 1, 'não-admin apagou a própria');
    ok('3: não-admin apaga a própria mensagem');
  } catch (e) { fail('3', e); }

  /* 4) não-admin NÃO apaga mensagem de outro membro comum */
  try {
    const r = await run(MEMBER, { quoted: MEMBER2 });
    assert.strictEqual(r.deletes.length, 0, 'não apagou a de outro membro');
    assert.ok(/própria/.test(r.text), 'avisa que só apaga a própria: ' + r.text);
    ok('4: não-admin NÃO apaga mensagem de outro membro');
  } catch (e) { fail('4', e); }

  /* 5) não-admin NÃO apaga mensagem de admin */
  try {
    const r = await run(MEMBER, { quoted: ADMIN });
    assert.strictEqual(r.deletes.length, 0, 'não apagou a do admin');
    ok('5: não-admin NÃO apaga mensagem de admin');
  } catch (e) { fail('5', e); }

  /* 6) sem mensagem respondida → pede para responder */
  try {
    const r = await run(ADMIN, { quoted: null });
    assert.strictEqual(r.deletes.length, 0, 'não apagou nada');
    assert.ok(/Responda/.test(r.text), 'pede para responder: ' + r.text);
    ok('6: sem resposta → pede para responder');
  } catch (e) { fail('6', e); }

  /* 7) bot não-admin → não apaga (mesmo o comando vindo de um admin) */
  try {
    const r = await run(ADMIN, { quoted: MEMBER, botAdmin: false, group: '120363000041@g.us' });
    assert.strictEqual(r.deletes.length, 0, 'não apagou sem bot admin');
    assert.ok(/admin do grupo/.test(r.text), 'avisa que o bot precisa ser admin: ' + r.text);
    ok('7: bot não-admin → não apaga (avisa)');
  } catch (e) { fail('7', e); }

  require('../database/database').close();
  if (failures) { console.error(`\n❌ DELETE-MSG TEST: ${failures} falha(s)`); process.exit(1); }
  console.log('\n=== DELETE-MSG TEST: TUDO OK ===');
  process.exit(0);
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
