/**
 * test/pix-selective.test.js — TESTE D: entrega seletiva REAL (transporte).
 *
 * Com PIX_SELECTIVE=true e um socket que expõe relayMessage (o mecanismo real do
 * vendor), o !pix em grupo deve usar selectiveParticipants = membros comuns e NÃO
 * fazer sendMessage. Sem relayMessage, deve cair no envio normal com mentions.
 *
 * Socket 100% mockado; generateWAMessage é o código REAL do vendor (offline).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

// DEVE ser definido antes de carregar config/pix
process.env.PIX_SELECTIVE = 'true';
process.env.OWNER_NUMBER = '5511999999999';
process.env.DATABASE_FILE = require('./dbtmp').tmpFile('lua-pix-selective-test.db');

let failures = 0;
function ok(l) { console.log('✅ ' + l); }
function fail(l, e) { failures++; console.log('❌ ' + l + ' — ' + (e && e.message)); }

const BOT = '5511000000000@s.whatsapp.net';
const ADM1 = '5511111111111@s.whatsapp.net';
const SUP = '5522222222222@s.whatsapp.net';
const M1 = '5533333333333@s.whatsapp.net';
const M2 = '5544444444444@s.whatsapp.net';
const M3 = '5555555555555@s.whatsapp.net';

function mkSock({ withRelay, participantsByJid }) {
  const calls = { relay: [], sent: [] };
  return {
    calls,
    user: { id: BOT },
    groupMetadata: async (jid) => ({ id: jid, participants: participantsByJid[jid] || [] }),
    relayMessage: withRelay
      ? async (jid, message, opts) => { calls.relay.push({ jid, opts }); return { key: { id: 'r1' } }; }
      : undefined,
    sendMessage: async (jid, content) => { calls.sent.push({ jid, content }); return { key: { id: 's1' } }; },
    sendPresenceUpdate: async () => {},
  };
}

function mkCtx(sock, group, text) {
  const replies = [];
  return {
    socket: sock, sender: ADM1, senderJid: ADM1,
    remoteJid: group, isGroup: !!group, chat: group,
    prefix: '!', text, args: [], mentionedJid: [],
    reply: async (t) => { replies.push(t); return {}; }, replies,
  };
}

async function main() {
  try { fs.rmSync(process.env.DATABASE_FILE, { force: true }); } catch (_) {}
  require('../database/database').open();
  require('../commands/loader').loadCommands(true);
  const { registry } = require('../engine/plugins');
  const pix = registry.resolveTrigger('pix');
  const CONFIG = require('../config');
  assert.strictEqual(CONFIG.pix.selective, true, 'PIX_SELECTIVE=true carregado');

  const PARTS = (g) => ({ [g]: [
    { id: ADM1, admin: 'admin' }, { id: SUP, admin: 'superadmin' },
    { id: M1 }, { id: M2, admin: null }, { id: M3, admin: null }, { id: BOT },
  ] });

  /* D1: com relayMessage → usa selectiveParticipants = membros comuns, sem sendMessage */
  try {
    const G = '120363000010@g.us';
    const sock = mkSock({ withRelay: true, participantsByJid: PARTS(G) });
    await pix.execute(mkCtx(sock, G, '!pix Mensalidade | 29,90 | BRL'));
    assert.strictEqual(sock.calls.relay.length, 1, 'relayMessage chamado 1x');
    const sel = sock.calls.relay[0].opts.selectiveParticipants;
    assert.deepStrictEqual([...sel].sort(), [M1, M2, M3].sort(), 'selectiveParticipants = só membros comuns');
    assert.strictEqual(sock.calls.relay[0].jid, G, 'destino = grupo');
    assert.strictEqual(sock.calls.sent.length, 0, 'não usa sendMessage no caminho seletivo');
    ok('D1: seletivo REAL usa selectiveParticipants (3 membros) e não faz sendMessage');
  } catch (e) { fail('D1', e); }

  /* D2: sem relayMessage → fallback ao envio normal com mentions */
  try {
    const G = '120363000011@g.us';
    const sock = mkSock({ withRelay: false, participantsByJid: PARTS(G) });
    await pix.execute(mkCtx(sock, G, '!pix Mensalidade | 29,90 | BRL'));
    assert.strictEqual(sock.calls.sent.length, 1, 'fallback envia 1x');
    assert.strictEqual(sock.calls.sent[0].jid, G, 'destino = grupo');
    const mentions = sock.calls.sent[0].content.mentions || [];
    assert.deepStrictEqual([...mentions].sort(), [M1, M2, M3].sort(), 'fallback mantém mentions');
    ok('D2: sem relayMessage → fallback normal com mentions (não quebra)');
  } catch (e) { fail('D2', e); }

  require('../database/database').close();
  if (failures) { console.error(`\n❌ PIX-SELECTIVE TEST: ${failures} falha(s)`); process.exit(1); }
  console.log('\n=== PIX-SELECTIVE TEST: TUDO OK ===');
  process.exit(0);
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
