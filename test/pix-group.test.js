/**
 * test/pix-group.test.js — !pix em GRUPO com mentions de membros comuns.
 *
 * Casos obrigatórios (prompt da fase):
 *  1) 2 admins + 3 membros + 1 bot  → mentions = 3 JIDs
 *  2) 1 admin + 0 membros + 1 bot   → mentions = [] e o bot não quebra
 *  3) privado                       → não consulta participantes de grupo
 *  4) !pix em grupo                 → 1 mensagem ao JID do grupo,
 *                                     mentions = só membros comuns,
 *                                     NUNCA envio individual por participante
 *
 * Socket 100% mockado: nenhuma mensagem real é enviada.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

const DB = require('./dbtmp').tmpFile('lua-pix-group-test.db');

let failures = 0;
function ok(l) { console.log('✅ ' + l); }
function fail(l, e) { failures++; console.log('❌ ' + l + ' — ' + (e && e.message)); }

const BOT = '5511000000000@s.whatsapp.net';
const ADM1 = '5511111111111@s.whatsapp.net';
const ADM2 = '5522222222222@s.whatsapp.net';
const M1 = '5533333333333@s.whatsapp.net';
const M2 = '5544444444444@s.whatsapp.net';
const M3 = '5555555555555@s.whatsapp.net';

function mkSocket(participantsByJid) {
  const calls = { groupMetadata: 0, sent: [] };
  return {
    calls,
    user: { id: BOT },
    groupMetadata: async (jid) => {
      calls.groupMetadata += 1;
      return { id: jid, participants: participantsByJid[jid] || [] };
    },
    sendMessage: async (jid, content) => {
      calls.sent.push({ jid, content });
      return { key: { id: 'k' + calls.sent.length } };
    },
    sendPresenceUpdate: async () => {},
  };
}

function mkCtx(sock, { group, text }) {
  const replies = [];
  return {
    socket: sock,
    sender: ADM1,
    senderJid: ADM1,
    remoteJid: group || '5511999999999@s.whatsapp.net',
    isGroup: !!group,
    chat: group || '5511999999999@s.whatsapp.net',
    prefix: '!',
    text,
    args: [],
    mentionedJid: [],
    reply: async (t) => { replies.push(t); return {}; },
    replies,
  };
}

async function main() {
  try { fs.rmSync(DB, { force: true }); } catch (_) {}
  process.env.OWNER_NUMBER = '5511999999999';
  process.env.DATABASE_FILE = DB;

  const database = require('../database/database');
  database.open();
  require('../commands/loader').loadCommands(true);
  const { registry } = require('../engine/plugins');
  const pix = registry.resolveTrigger('pix');
  assert.ok(pix, 'trigger pix registrado');

  /* Caso 1: 2 admins + 3 membros + 1 bot → mentions = 3 */
  try {
    const G = '120363000001@g.us';
    const sock = mkSocket({ [G]: [
      { id: ADM1, admin: 'admin' },
      { id: ADM2, admin: 'superadmin' },
      { id: M1, admin: null },
      { id: M2 },
      { id: M3, admin: null },
      { id: BOT, admin: null },
    ] });
    const ctx = mkCtx(sock, { group: G, text: '!pix Teste PIX | 29,90 | BRL' });
    await pix.execute(ctx);
    assert.strictEqual(sock.calls.sent.length, 1, 'envia UMA vez');
    assert.strictEqual(sock.calls.sent[0].jid, G, 'destino é o grupo');
    const mentions = sock.calls.sent[0].content.mentions || [];
    assert.deepStrictEqual([...mentions].sort(), [M1, M2, M3].sort(), 'mentions = 3 membros comuns');
    assert.ok(sock.calls.sent[0].content.payment, 'payment preservado');
    ok('1: 2 adm + 3 membros + bot → mentions = 3 (1 envio ao grupo)');
  } catch (e) { fail('1', e); }

  /* Caso 2: 1 admin + 0 membros + 1 bot → mentions vazio, sem quebrar */
  try {
    const G = '120363000002@g.us';
    const sock = mkSocket({ [G]: [ { id: ADM1, admin: 'admin' }, { id: BOT } ] });
    const ctx = mkCtx(sock, { group: G, text: '!pix Teste | 1000 | BRL' });
    await pix.execute(ctx);
    assert.strictEqual(sock.calls.sent.length, 1, 'envia UMA vez mesmo sem membros');
    const mentions = sock.calls.sent[0].content.mentions;
    assert.ok(!mentions || mentions.length === 0, 'sem membros → sem mentions');
    ok('2: só admin + bot → mentions vazio e o bot não quebra');
  } catch (e) { fail('2', e); }

  /* Caso 3: privado → não consulta participantes de grupo */
  try {
    const sock = mkSocket({});
    const ctx = mkCtx(sock, { group: null, text: '!pix Teste | 10000 | BRL' });
    await pix.execute(ctx);
    assert.strictEqual(sock.calls.groupMetadata, 0, 'privado não consulta metadata de grupo');
    assert.strictEqual(sock.calls.sent.length, 1, 'envia payment no privado');
    assert.ok(!sock.calls.sent[0].content.mentions, 'privado sem mentions');
    ok('3: privado não tenta obter participantes de grupo');
  } catch (e) { fail('3', e); }

  /* Caso 4: group pix → payment + mentions; nunca envio individual */
  try {
    const G = '120363000003@g.us';
    const sock = mkSocket({ [G]: [
      { id: ADM1, admin: 'admin' },
      { id: M1 },
      { id: M2 },
      { id: BOT },
    ] });
    const ctx = mkCtx(sock, { group: G, text: '!pix Pagamento da mensalidade | 29,90 | BRL' });
    await pix.execute(ctx);
    const sentJids = sock.calls.sent.map((s) => s.jid);
    assert.deepStrictEqual(sentJids, [G], 'somente o JID do grupo recebe');
    const pay = sock.calls.sent[0].content.payment;
    assert.strictEqual(pay.note, 'Pagamento da mensalidade', 'note preservado');
    assert.strictEqual(pay.currency, 'BRL', 'currency preservada');
    const mentions = sock.calls.sent[0].content.mentions || [];
    assert.deepStrictEqual([...mentions].sort(), [M1, M2].sort(), 'mentions só membros comuns');
    assert.ok(!mentions.includes(ADM1) && !mentions.includes(BOT), 'admin e bot fora');
    ok('4: PIX ao grupo com mentions de membros comuns (sem envio individual)');
  } catch (e) { fail('4', e); }

  database.close();
  if (failures) {
    console.error(`\n❌ PIX-GROUP TEST: ${failures} falha(s)`);
    process.exit(1);
  }
  console.log('\n=== PIX-GROUP TEST: TUDO OK ===');
  process.exit(0);
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
