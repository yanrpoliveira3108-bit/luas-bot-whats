/**
 * test/theme.test.js — identidade visual, UI, temas, perf, flood, ping2, debug.
 *
 * Cobre:
 *  1) config/themes.js — 10 presets, default, resolução e CSS vars
 *  2) utils/ui.js — componentes de texto (header/divider/linha de comando)
 *  3) utils/perf.js — contadores/timing/snapshot
 *  4) utils/flood.js — rate limiting (limiar generoso, clear)
 *  5) !tema — lista presets; troca é owner-only e persiste
 *  6) utils/pingHtml.js — HTML roxo (sem verde), payload botForwardedMessage
 *     (mesma estrutura do !tigrinho) e fallback quando relayMessage não existe
 *  7) !ping2 — ponta a ponta (com e sem relayMessage)
 *  8) !debug — roda sem derrubar
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

const DB = require('./dbtmp').tmpFile('lua-theme-test.db');

let failures = 0;
function ok(l) { console.log('✅ ' + l); }
function fail(l, e) { failures++; console.log('❌ ' + l + ' — ' + (e && e.message)); }

async function main() {
  try { fs.rmSync(DB, { force: true }); } catch (_) {}
  process.env.OWNER_NUMBER = '5511999999999';
  process.env.DATABASE_FILE = DB;
  process.env.BUTTONS_ENABLED = 'true';
  // Valida o FORMATO do card HTML (botForwardedMessage + richResponseMessage)
  // e do menu interativo com o PADRÃO do bot (SAFE_MODE não definido =
  // liberado). O comportamento com o modo seguro ligado tem teste próprio em
  // test/sendguard.test.js.

  const database = require('../database/database');
  database.open();
  require('../commands/loader').loadCommands(true);

  /* 1) temas */
  try {
    const themes = require('../config/themes');
    const list = themes.list();
    assert.strictEqual(list.length, 10, '10 presets');
    assert.ok(list.some((t) => t.id === 'LUA_NIGHT'), 'LUA_NIGHT presente');
    assert.ok(list.some((t) => t.id === 'LUA_AMOLED'), 'LUA_AMOLED presente');
    assert.strictEqual(themes.get('lua_night').id, 'LUA_NIGHT', 'resolução case-insensitive');
    assert.strictEqual(themes.get('NAO_EXISTE').id, 'LUA_NIGHT', 'fallback default');
    const night = themes.colorsOf('LUA_NIGHT');
    assert.strictEqual(night.primary, '#8B5CF6', 'roxo principal');
    assert.strictEqual(night.neon, '#C084FC', 'roxo neon');
    assert.strictEqual(night.primaryDark, '#4C1D95', 'roxo escuro');
    assert.ok(themes.cssVars('LUA_NIGHT').includes('--lua-primary:#8B5CF6'), 'CSS vars centralizadas');
    ok('1: temas — 10 presets + paleta central');
  } catch (e) { fail('1: temas', e); }

  /* 2) utils/ui */
  try {
    const ui = require('../utils/ui');
    const header = ui.createHeader('🌙 LUA', 'sub');
    assert.ok(header.includes('╭') && header.includes('╰'), 'cabeçalho em caixa');
    assert.ok(header.includes('🌙 LUA'), 'título no cabeçalho');
    assert.strictEqual(ui.createDivider(), '━'.repeat(20), 'divisória');
    assert.strictEqual(ui.createCategory('🌙', 'Principal', 1), '🌙 01 • Principal', 'categoria numerada');
    assert.strictEqual(ui.createCommandRow('!', 'ping', 'testa'), '▸ !ping — testa', 'linha de comando');
    assert.strictEqual(ui.bold('x'), '*x*', 'negrito markdown');
    assert.strictEqual(ui.mono('x'), '```x```', 'mono markdown');
    ok('2: utils/ui — componentes de texto');
  } catch (e) { fail('2: ui', e); }

  /* 3) perf */
  try {
    const perf = require('../utils/perf');
    perf.reset();
    perf.add('messages', 3);
    perf.add('commands');
    perf.timing('command', 10);
    perf.timing('command', 20);
    assert.strictEqual(perf.get('messages'), 3, 'contador');
    assert.strictEqual(perf.avg('command'), 15, 'média');
    const snap = perf.snapshot();
    assert.strictEqual(snap.messages, 3, 'snapshot messages');
    assert.strictEqual(snap.commands, 1, 'snapshot commands');
    ok('3: utils/perf — métricas');
  } catch (e) { fail('3: perf', e); }

  /* 4) flood */
  try {
    const flood = require('../utils/flood');
    const jid = '5511222333444@s.whatsapp.net';
    for (let i = 0; i < flood.MAX_HITS; i++) {
      assert.strictEqual(flood.hit(jid), false, 'dentro do limite');
    }
    assert.strictEqual(flood.hit(jid), true, 'estoura o limite');
    assert.strictEqual(flood.isBlocked(jid), true, 'bloqueado');
    flood.clear(jid);
    assert.strictEqual(flood.isBlocked(jid), false, 'liberado');
    ok('4: utils/flood — rate limiting');
  } catch (e) { fail('4: flood', e); }

  /* 5) !tema */
  try {
    const commandHandler = require('../handlers/commandHandler');
    const cooldown = require('../utils/cooldown');
    const theme = require('../utils/theme');
    const OWNER = '5511999999999@s.whatsapp.net';
    const STRANGER = '5521888877777@s.whatsapp.net';
    const sent = [];
    const sock = {
      user: { id: '5511999999998@s.whatsapp.net' },
      sendMessage: async (jid, c) => { sent.push({ jid, content: c }); return { key: { id: 'k' + sent.length } }; },
      sendPresenceUpdate: async () => {},
    };
    const mkMsg = (from, text) => ({ key: { remoteJid: from, fromMe: false, id: 'M' + Math.random().toString(36).slice(2) }, message: { conversation: text }, pushName: from.split('@')[0] });
    const reset = (who) => { cooldown.reset('user', who, 'tema'); cooldown.reset('global', '*', 'tema'); };

    // lista
    sent.length = 0;
    await commandHandler.handleMessage(sock, mkMsg(OWNER, '!tema'));
    const txt = sent.filter((s) => s.content.text).map((s) => s.content.text).join('\n');
    assert.ok(/TEMAS DO LUA/.test(txt), 'lista de temas');
    assert.ok(/LUA_NIGHT/.test(txt), 'mostra o id do preset');

    // troca (dono) → persiste
    reset(OWNER);
    sent.length = 0;
    await commandHandler.handleMessage(sock, mkMsg(OWNER, '!tema LUA_VIOLET'));
    assert.strictEqual(theme.activeId(), 'LUA_VIOLET', 'tema trocado e persistido');
    assert.ok(sent.some((s) => s.content.text && /Lua Violet/.test(s.content.text)), 'confirma troca');

    // não-dono não troca
    reset(STRANGER);
    sent.length = 0;
    await commandHandler.handleMessage(sock, mkMsg(STRANGER, '!tema LUA_NEON'));
    assert.strictEqual(theme.activeId(), 'LUA_VIOLET', 'não-dono não altera');
    assert.ok(sent.some((s) => s.content.text && /Apenas o dono/.test(s.content.text)), 'nega para não-dono');

    // preset inexistente
    reset(OWNER);
    sent.length = 0;
    await commandHandler.handleMessage(sock, mkMsg(OWNER, '!tema NAO_EXISTE'));
    assert.ok(sent.some((s) => s.content.text && /não existe/.test(s.content.text)), 'preset inválido rejeitado');

    // volta ao padrão para não vazar estado
    theme.setActive('LUA_NIGHT');
    ok('5: !tema — lista + troca owner-only + persistência');
  } catch (e) { fail('5: tema', e); }

  /* 6) pingHtml */
  try {
    const pingHtml = require('../utils/pingHtml');
    const html = pingHtml.buildPingHtml({ theme: 'LUA_NIGHT', usuario: 'Fulano', ping: '42ms', totalcmd: '70' });
    assert.ok(html.includes('🌙 LUA • SYSTEM PING'), 'título LUA');
    assert.ok(html.includes('#8B5CF6'), 'roxo principal aplicado');
    assert.ok(html.includes('#05030A') || html.includes('#000000'), 'fundo AMOLED');
    assert.ok(!html.includes('#6affaa') && !html.includes('#06100a'), 'verde removido');
    assert.ok(!html.includes('NEFFER'), 'identidade antiga removida');
    assert.ok(html.includes('pingChart'), 'gráfico de latência preservado');

    const msg = pingHtml.buildRichMessage(html);
    assert.ok(msg.botForwardedMessage && msg.botForwardedMessage.message && msg.botForwardedMessage.message.richResponseMessage, 'wrapper botForwardedMessage (mesma estrutura do !tigrinho)');
    const rich = msg.botForwardedMessage.message.richResponseMessage;
    assert.ok(rich.contextInfo && rich.contextInfo.forwardedAiBotMessageInfo, 'contextInfo de bot IA presente');
    const data = rich.unifiedResponse.data;
    const parsed = JSON.parse(Buffer.from(data).toString('utf8'));
    assert.ok(JSON.stringify(parsed).includes('GenAIaeacdsnwHtmlPrimitive'), 'HTML primitive preservado');

    // envio com relayMessage (padrão comprovado: botForwardedMessage + opções vazias)
    let relayed = null;
    let relayOpts = null;
    const sockOk = {
      relayMessage: async (jid, m, o) => { relayed = m; relayOpts = o; return {}; },
      profilePictureUrl: async () => { throw new Error('sem foto'); },
    };
    const optsEmpty = (o) => o && o.AI === undefined &&
      (!o.additionalNodes || (Array.isArray(o.additionalNodes) && o.additionalNodes.length === 0));
    const sentOk = await pingHtml.sendHtmlPing(sockOk, '5511@s.whatsapp.net', { theme: 'LUA_NIGHT' });
    assert.strictEqual(sentOk, true, 'enviou via relayMessage');
    assert.ok(relayed && relayed.botForwardedMessage && relayed.botForwardedMessage.message.richResponseMessage, 'payload relayado correto (wrapper botForwardedMessage)');
    assert.ok(optsEmpty(relayOpts), 'relayMessage com opções vazias (sem AI/additionalNodes — padrão cobrinha)');

    // grupo → mesmo padrão
    relayOpts = null;
    const sentGroup = await pingHtml.sendHtmlPing(sockOk, '120363411784060909@g.us', { theme: 'LUA_NIGHT' });
    assert.strictEqual(sentGroup, true, 'grupo → tenta o card HTML');
    assert.ok(optsEmpty(relayOpts), 'grupo → opções vazias (padrão comprovado)');

    // fallback sem relayMessage
    const sockNo = { sendMessage: async () => ({}) };
    const sentNo = await pingHtml.sendHtmlPing(sockNo, '5511@s.whatsapp.net', { theme: 'LUA_NIGHT' });
    assert.strictEqual(sentNo, false, 'sem relayMessage → false (fallback no comando)');

    // utils/richHtml usa o mesmo padrão (opções vazias, privado E grupo)
    const richHtml = require('../utils/richHtml');
    let richOpts = null;
    const sockRich = { relayMessage: async (jid, m, o) => { richOpts = o; return {}; } };
    await richHtml.sendHtml(sockRich, '5511@s.whatsapp.net', '<b>oi</b>');
    assert.ok(optsEmpty(richOpts), 'richHtml privado → opções vazias');
    richOpts = null;
    await richHtml.sendHtml(sockRich, '120363411784060909@g.us', '<b>oi</b>');
    assert.ok(optsEmpty(richOpts), 'richHtml grupo → opções vazias');

    ok('6: pingHtml — HTML roxo + botForwardedMessage + opções vazias (padrão cobrinha)');
  } catch (e) { fail('6: pingHtml', e); }

  /* 7) !ping2 ponta a ponta */
  try {
    const commandHandler = require('../handlers/commandHandler');
    const cooldown = require('../utils/cooldown');
    const PRIV = '5511999999999@s.whatsapp.net';
    const sent = [];
    const mkMsg = (text) => ({ key: { remoteJid: PRIV, fromMe: false, id: 'M' + Math.random().toString(36).slice(2) }, message: { conversation: text }, pushName: 'Owner' });

    // com relayMessage → envia HTML (sem fallback de texto)
    const sockOk = {
      user: { id: '5511999999998@s.whatsapp.net' },
      relayMessage: async () => ({ key: { id: 'x' } }),
      profilePictureUrl: async () => { throw new Error('x'); },
      sendMessage: async (jid, c) => { sent.push(c); return { key: { id: 'k' } }; },
      sendPresenceUpdate: async () => {},
    };
    sent.length = 0;
    cooldown.reset('user', PRIV, 'ping2');
    cooldown.reset('global', '*', 'ping2');
    await commandHandler.handleMessage(sockOk, mkMsg('!ping2'));
    assert.ok(!sent.some((s) => s.text), 'com relayMessage não cai no fallback de texto');

    // sem relayMessage → fallback textual
    const sockNo = {
      user: { id: '5511999999998@s.whatsapp.net' },
      sendMessage: async (jid, c) => { sent.push(c); return { key: { id: 'k' } }; },
      sendPresenceUpdate: async () => {},
    };
    sent.length = 0;
    cooldown.reset('user', PRIV, 'ping2');
    cooldown.reset('global', '*', 'ping2');
    await commandHandler.handleMessage(sockNo, mkMsg('!ping2'));
    const fallback = sent.filter((s) => s.text).map((s) => s.text).join('\n');
    assert.ok(/SYSTEM PING/.test(fallback), 'fallback textual com identidade LUA');
    assert.ok(/Beyond the ordinary/.test(fallback), 'tagline no fallback');

    // em GRUPO com relayMessage → também tenta o card HTML (mesmo padrão cobrinha)
    const GROUP = '120363411784060909@g.us';
    let grupoRelayed = null;
    let grupoOpts = null;
    const sockGroup = {
      user: { id: '5511999999998@s.whatsapp.net' },
      relayMessage: async (jid, m, o) => { grupoRelayed = m; grupoOpts = o; return { key: { id: 'x' } }; },
      profilePictureUrl: async () => { throw new Error('x'); },
      sendMessage: async (jid, c) => { sent.push(c); return { key: { id: 'k' } }; },
      sendPresenceUpdate: async () => {},
      groupMetadata: async () => ({ id: GROUP, participants: [] }),
    };
    const mkGroupMsg = (text) => ({ key: { remoteJid: GROUP, fromMe: false, id: 'G' + Math.random().toString(36).slice(2) }, message: { conversation: text }, pushName: 'Membro' });
    sent.length = 0;
    cooldown.reset('user', GROUP, 'ping2');
    cooldown.reset('global', '*', 'ping2');
    await commandHandler.handleMessage(sockGroup, mkGroupMsg('!ping2'));
    assert.ok(grupoRelayed && grupoRelayed.botForwardedMessage && grupoRelayed.botForwardedMessage.message.richResponseMessage, 'grupo → card HTML relayado (wrapper botForwardedMessage)');
    assert.ok(grupoOpts && grupoOpts.AI === undefined && (!grupoOpts.additionalNodes || grupoOpts.additionalNodes.length === 0), 'grupo → opções vazias (padrão cobrinha)');
    assert.ok(!sent.some((s) => s.text), 'grupo → sem fallback de texto (HTML enviado)');
    ok('7: !ping2 — ponta a ponta (HTML privado E grupo + fallback sem relayMessage)');
  } catch (e) { fail('7: ping2', e); }

  /* 8) !debug roda sem derrubar */
  try {
    const commandHandler = require('../handlers/commandHandler');
    const cooldown = require('../utils/cooldown');
    const PRIV = '5511999999999@s.whatsapp.net';
    const sent = [];
    const sock = {
      user: { id: '5511999999998@s.whatsapp.net' },
      sendMessage: async (jid, c) => { sent.push(c); return { key: { id: 'k' } }; },
      sendPresenceUpdate: async () => {},
    };
    cooldown.reset('user', PRIV, 'debug');
    cooldown.reset('global', '*', 'debug');
    await commandHandler.handleMessage(sock, {
      key: { remoteJid: PRIV, fromMe: false, id: 'M' + Math.random().toString(36).slice(2) },
      message: { conversation: '!debug' },
      pushName: 'Owner',
    });
    const txt = sent.filter((s) => s.text).map((s) => s.text).join('\n');
    assert.ok(/LUA DEBUG/.test(txt), 'painel de debug');
    assert.ok(/Baileys/.test(txt) && /Memória/.test(txt) && /Cache/.test(txt), 'seções do debug');
    ok('8: !debug — painel roda sem derrubar');
  } catch (e) { fail('8: debug', e); }

  database.close();
  if (failures) {
    console.error(`\n❌ THEME TEST: ${failures} falha(s)`);
    process.exit(1);
  }
  console.log('\n=== THEME TEST: TUDO OK ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
