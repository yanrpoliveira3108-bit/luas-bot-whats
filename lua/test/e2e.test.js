/**
 * test/e2e.test.js — ponta a ponta do pipeline (socket fake).
 *
 * Simula: !vida (criação), !menu (botões nativos), !trabalho (tela de
 * profissões), clique em botão (nativeFlowResponseMessage) → !emprego,
 * !minerar, !menu textual (botões OFF) e gate de admin (não-dono negado).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

const DB = '/tmp/lua-e2e-test.db';

function clearCache() {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
}

let failures = 0;
function ok(l) { console.log('✅ ' + l); }
function fail(l, e) { failures++; console.log('❌ ' + l + ' — ' + (e && e.message)); }

async function main() {
  try { fs.rmSync(DB, { force: true }); } catch (_) {}
  process.env.OWNER_NUMBER = '5511999999999';
  process.env.DATABASE_FILE = DB;
  process.env.BUTTONS_ENABLED = 'true';

  const database = require('../database/database');
  database.open();
  const { loadCommands } = require('../commands/loader');
  const { registry } = require('../engine/plugins');
  loadCommands(true);

  const commandHandler = require('../handlers/commandHandler');
  const buttonHandler = require('../handlers/buttonHandler');
  const rpg = require('../database/rpg');
  const economy = require('../database/economy');
  const settings = require('../database/settings');

  const OWNER = '5511999999999@s.whatsapp.net';
  const STRANGER = '5521888877777@s.whatsapp.net';
  const sent = [];

  const sock = {
    user: { id: '5511999999998@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      return { key: { id: '3EB0' + 'A'.repeat(18), remoteJid: jid } };
    },
    groupMetadata: async () => ({ id: 'g', participants: [] }),
    sendPresenceUpdate: async () => {},
  };

  const mkMsg = (over = {}) => Object.assign(
    { key: { remoteJid: OWNER, fromMe: false, id: 'AAA' }, message: { conversation: '!menu' }, pushName: 'Owner' },
    over
  );

  const ctxFor = (sock2, msg) => commandHandler.buildContext(sock2, msg);

  /* 1) !vida cria o personagem */
  try {
    const ctx = await ctxFor(sock, mkMsg({ message: { conversation: '!vida Ana 25 Sumaré' } }));
    await commandHandler.runByName(ctx, 'vida', ['Ana', '25', 'Sumaré']);
    const last = sent[sent.length - 1];
    assert.ok(last && /BEM-VINDO AO LUA LIFE/.test(last.content.text), 'resposta de criação');
    assert.strictEqual(economy.get(OWNER).wallet > 0, true, 'dinheiro inicial');
    ok('1: !vida cria personagem');
  } catch (e) { fail('1: !vida', e); }

  /* 2) !menu (botões ON) envia botões nativos */
  try {
    sent.length = 0;
    const ctx = await ctxFor(sock, mkMsg({ message: { conversation: '!menu' } }));
    await commandHandler.runByName(ctx, 'menu');
    const btn = sent.find((s) => s.content && s.content.interactiveButtons);
    assert.ok(btn, 'enviou interactiveButtons');
    assert.ok(btn.content.interactiveButtons.length >= 3, 'botões suficientes');
    assert.strictEqual(btn.content.title, 'LUA BOT', 'título do menu');
    ok('2: !menu com botões nativos');
  } catch (e) { fail('2: !menu botões', e); }

  /* 3) !trabalho abre tela de profissões */
  try {
    sent.length = 0;
    const ctx = await ctxFor(sock, mkMsg({ message: { conversation: '!trabalho' } }));
    await commandHandler.runByName(ctx, 'trabalho');
    const btn = sent.find((s) => s.content && s.content.interactiveButtons);
    assert.ok(btn, 'tela de profissões com botões');
    const ids = btn.content.interactiveButtons.map((b) => b.id);
    assert.ok(ids.some((i) => i.includes('job_faxineiro')), 'botão de profissão presente');
    ok('3: !trabalho abre profissões');
  } catch (e) { fail('3: !trabalho', e); }

  /* 4) clique em botão → !emprego executa */
  try {
    const click = mkMsg({
      message: {
        interactiveResponseMessage: {
          nativeFlowResponseMessage: {
            name: 'quick_reply',
            paramsJson: JSON.stringify({ id: 'lua_nav_lua_jobs_job_faxineiro', display_text: '🧹 Faxineiro' }),
            version: 1,
          },
        },
      },
    });
    const ctx = await ctxFor(sock, click);
    const handled = await buttonHandler.process(ctx);
    assert.strictEqual(handled, true, 'clique processado');
    assert.strictEqual(rpg.getPlayer(OWNER).profession, 'Faxineiro', 'profissão definida pelo clique');
    ok('4: clique em botão → !emprego');
  } catch (e) { fail('4: clique botão', e); }

  /* 5) !minerar (com picareta) funciona ponta a ponta */
  try {
    sent.length = 0;
    economy.addItem(OWNER, 'picareta_simples', 1);
    const ctx = await ctxFor(sock, mkMsg({ message: { conversation: '!minerar' } }));
    await commandHandler.runByName(ctx, 'minerar');
    const last = sent[sent.length - 1];
    assert.ok(last && /MINERAÇÃO/.test(last.content.text), 'resposta de mineração');
    ok('5: !minerar funciona');
  } catch (e) { fail('5: !minerar', e); }

  /* 6) botões OFF → menu textual numerado */
  try {
    const cooldown = require('../utils/cooldown');
    cooldown.reset('user', OWNER, 'menu');
    cooldown.reset('global', '*', 'menu');
    settings.setButtonsEnabled(false);
    sent.length = 0;
    const ctx = await ctxFor(sock, mkMsg({ message: { conversation: '!menu' } }));
    await commandHandler.runByName(ctx, 'menu');
    const txt = sent.find((s) => s.content && /LUA MENU/.test(s.content.text || ''));
    assert.ok(txt, 'menu textual numerado');
    assert.ok(!sent.some((s) => s.content && s.content.interactiveButtons), 'sem botões interativos');
    settings.setButtonsEnabled(true);
    ok('6: menu textual (botões OFF)');
  } catch (e) { fail('6: menu textual', e); }

  /* 7) não-dono é barrado em comando admin */
  try {
    sent.length = 0;
    const ctx = await ctxFor(sock, mkMsg({ key: { remoteJid: STRANGER, fromMe: false, id: 'BBB' }, message: { conversation: '!givecoin' } }));
    await commandHandler.runByName(ctx, 'givecoin', ['@x', '999']);
    const last = sent[sent.length - 1];
    assert.ok(last && /apenas o dono|dono/i.test(last.content.text || ''), 'dono negado');
    ok('7: não-dono barrado em admin');
  } catch (e) { fail('7: gate admin', e); }

  /* 8) !lermais on|off|status persiste a configuração */
  try {
    sent.length = 0;
    const ctxOn = await ctxFor(sock, mkMsg({ message: { conversation: '!lermais on' } }));
    await commandHandler.runByName(ctxOn, 'lermais', ['on']);
    const st = require('../database/settings');
    assert.strictEqual(st.getBool('readmore', false), true, 'readmore ON persistido');
    const cooldown = require('../utils/cooldown');
    cooldown.reset('user', OWNER, 'lermais');
    cooldown.reset('global', '*', 'lermais');
    const ctxOff = await ctxFor(sock, mkMsg({ message: { conversation: '!lermais off' } }));
    await commandHandler.runByName(ctxOff, 'lermais', ['off']);
    assert.strictEqual(st.getBool('readmore', false), false, 'readmore OFF persistido');
    ok('8: !lermais on/off');
  } catch (e) { fail('8: !lermais', e); }

  /* 9) !help e !help play respondem */
  try {
    sent.length = 0;
    await commandHandler.runByName(await ctxFor(sock, mkMsg({ message: { conversation: '!help' } })), 'help');
    assert.ok(sent.some((s) => /AJUDA|COMANDOS|HELP/i.test(s.content.text || '')), '!help responde');
    sent.length = 0;
    await commandHandler.runByName(await ctxFor(sock, mkMsg({ message: { conversation: '!help play' } })), 'help', ['play']);
    assert.ok(sent.length > 0, '!help play responde');
    ok('9: !help e !help play');
  } catch (e) { fail('9: !help', e); }

  /* 10) download com URL inválida → mensagem de erro, sem crash */
  try {
    sent.length = 0;
    const ctx = await ctxFor(sock, mkMsg({ message: { conversation: '!download nao-e-uma-url' } }));
    await commandHandler.runByName(ctx, 'download', ['nao-e-uma-url']);
    const last = sent[sent.length - 1];
    assert.ok(last && /link|válid|suportad|indispon/i.test(last.content.text || ''), 'erro amigável');
    ok('10: download com URL inválida');
  } catch (e) { fail('10: download inválido', e); }

  /* 11) persistência pós-reinício */
  try {
    database.close();
    clearCache();
    process.env.DATABASE_FILE = DB;
    const db2 = require('../database/database');
    db2.open();
    const life2 = require('../database/life');
    const p = life2.getPlayer(OWNER);
    assert.ok(p && p.name === 'Ana', 'personagem persistiu após reinício');
    const econ2 = require('../database/economy');
    assert.strictEqual(econ2.get(OWNER).wallet > 0, true, 'carteira persistiu');
    ok('11: persistência pós-reinício');
    db2.close();
  } catch (e) { fail('11: persistência', e); }

  console.log(`\n=== E2E TEST: ${failures === 0 ? 'TUDO OK' : failures + ' falha(s)'} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ erro fatal:', err);
  process.exit(1);
});
