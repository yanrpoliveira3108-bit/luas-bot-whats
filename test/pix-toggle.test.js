/**
 * test/pix-toggle.test.js — comando !pixfiltro (liga/desliga o filtro seletivo).
 *
 * Cobre:
 *  1) registro + ownerOnly (gate central já testado em outras suítes)
 *  2) off  → settings pix:selective=false + resposta DESLIGADO
 *  3) on   → settings pix:selective=true  + resposta LIGADO
 *  4) sem arg → status reflete o estado atual
 *  5) arg inválido → aviso de uso
 *  6) o toggle CONTROLA o !pix: on + relayMessage → caminho seletivo;
 *     off → envio normal com mentions (1x ao grupo)
 *
 * Socket 100% mockado; nenhuma mensagem real.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

process.env.OWNER_NUMBER = '5511999999999';
process.env.DATABASE_FILE = require('./dbtmp').tmpFile('lua-pix-toggle-test.db');
delete process.env.PIX_SELECTIVE; // garante que o default venha do settings/CONFIG

let failures = 0;
function ok(l) { console.log('✅ ' + l); }
function fail(l, e) { failures++; console.log('❌ ' + l + ' — ' + (e && e.message)); }

const BOT = '5511000000000@s.whatsapp.net';
const ADM = '5511111111111@s.whatsapp.net';
const M1 = '5533333333333@s.whatsapp.net';
const M2 = '5544444444444@s.whatsapp.net';

function mkSock({ withRelay, parts }) {
  const calls = { relay: [], sent: [] };
  return {
    calls, user: { id: BOT },
    groupMetadata: async (jid) => ({ id: jid, participants: parts || [] }),
    relayMessage: withRelay ? async (jid, m, o) => { calls.relay.push({ jid, o }); return {}; } : undefined,
    sendMessage: async (jid, c) => { calls.sent.push({ jid, c }); return {}; },
    sendPresenceUpdate: async () => {},
  };
}

function mkCtx(sock, { group, text, sender }) {
  const replies = [];
  return {
    socket: sock, sender: sender || ADM, senderJid: sender || ADM,
    remoteJid: group || '5511999999999@s.whatsapp.net', isGroup: !!group, chat: group || 'p',
    prefix: '!', text, args: text.replace(/^!\S+\s*/, '').split(/\s+/).filter(Boolean),
    mentionedJid: [], reply: async (t) => { replies.push(t); return {}; }, replies,
  };
}

async function main() {
  try { fs.rmSync(process.env.DATABASE_FILE, { force: true }); } catch (_) {}
  require('../database/database').open();
  require('../commands/loader').loadCommands(true);
  const { registry } = require('../engine/plugins');
  const settings = require('../database/settings');
  const cmd = registry.resolveTrigger('pixfiltro');
  const pix = registry.resolveTrigger('pix');

  /* 1) registro + ownerOnly */
  try {
    assert.ok(cmd, 'pixfiltro registrado');
    assert.strictEqual(cmd.ownerOnly, true, 'ownerOnly deve ser true');
    assert.strictEqual((registry.resolveTrigger('filtro') || {}).name, 'pixfiltro', 'alias filtro');
    ok('1: registrado, ownerOnly e alias filtro');
  } catch (e) { fail('1', e); }

  /* 2) off */
  try {
    const ctx = mkCtx(null, { text: '!pixfiltro off' });
    await cmd.execute(ctx);
    assert.strictEqual(settings.getBool('pix:selective', true), false, 'settings=false');
    assert.ok(/DESLIGADO/.test(ctx.replies.join('')), 'resposta DESLIGADO');
    ok('2: off → settings false + resposta');
  } catch (e) { fail('2', e); }

  /* 3) on */
  try {
    const ctx = mkCtx(null, { text: '!pixfiltro on' });
    await cmd.execute(ctx);
    assert.strictEqual(settings.getBool('pix:selective', false), true, 'settings=true');
    assert.ok(/LIGADO/.test(ctx.replies.join('')), 'resposta LIGADO');
    ok('3: on → settings true + resposta');
  } catch (e) { fail('3', e); }

  /* 4) status sem arg */
  try {
    const ctx = mkCtx(null, { text: '!pixfiltro' });
    await cmd.execute(ctx);
    assert.ok(/FILTRO PIX SELETIVO/.test(ctx.replies.join('')), 'mostra status');
    assert.ok(/LIGADO/.test(ctx.replies.join('')), 'reflete estado on');
    ok('4: sem arg mostra status');
  } catch (e) { fail('4', e); }

  /* 5) arg inválido */
  try {
    const ctx = mkCtx(null, { text: '!pixfolio'.replace('folio', 'filtro') + ' xyz' });
    await cmd.execute(ctx);
    assert.ok(/Use .*pixfiltro on \| off/.test(ctx.replies.join('')), 'aviso de uso');
    ok('5: arg inválido → aviso');
  } catch (e) { fail('5', e); }

  /* 6) toggle controla o !pix */
  const PARTS = [ { id: ADM, admin: 'admin' }, { id: M1 }, { id: M2 }, { id: BOT } ];
  try {
    // ON + relay → caminho seletivo (sem sendMessage)
    settings.set('pix:selective', 'true');
    let sock = mkSock({ withRelay: true, parts: PARTS });
    await pix.execute(mkCtx(sock, { group: '120363000020@g.us', text: '!pix X | 29,90 | BRL' }));
    assert.strictEqual(sock.calls.relay.length, 1, 'on usa relay (seletivo)');
    assert.strictEqual(sock.calls.sent.length, 0, 'on não usa sendMessage');

    // OFF → envio normal com mentions (1x ao grupo)
    settings.set('pix:selective', 'false');
    sock = mkSock({ withRelay: true, parts: PARTS });
    await pix.execute(mkCtx(sock, { group: '120363000021@g.us', text: '!pix X | 29,90 | BRL' }));
    assert.strictEqual(sock.calls.sent.length, 1, 'off envia normal');
    assert.deepStrictEqual([...(sock.calls.sent[0].c.mentions || [])].sort(), [M1, M2].sort(), 'off mantém mentions');
    assert.strictEqual(sock.calls.relay.length, 0, 'off não usa relay');
    ok('6: toggle controla o !pix (on→seletivo, off→normal com mentions)');
  } catch (e) { fail('6', e); }

  require('../database/database').close();
  if (failures) { console.error(`\n❌ PIX-TOGGLE TEST: ${failures} falha(s)`); process.exit(1); }
  console.log('\n=== PIX-TOGGLE TEST: TUDO OK ===');
  process.exit(0);
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
