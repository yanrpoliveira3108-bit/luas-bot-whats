/**
 * utils/buttons.js — ponto único de entrada do menu principal.
 *
 * - buttons ON  → navegação por LISTA interativa (utils/nav.js; telas em menus/screens.js)
 * - buttons OFF → menu textual numerado (modo de compatibilidade)
 *
 * Mantém os handlers LEGADOS (lua_commands, lua_config, …) registrados para
 * compatibilidade com mensagens antigas; o motor de navegação é o utils/nav.js.
 */

'use strict';

const CONFIG = require('../config');
const settings = require('../database/settings');
const logger = require('./logger').child('buttons');
const buttonHandler = require('../handlers/buttonHandler');
const commandHandler = require('../handlers/commandHandler');
const numberFallback = require('./numberFallback');
const nav = require('./nav');
const ui = require('./ui');
const { registry } = require('../engine/plugins');
const { commandEmoji } = require('./commandEmoji');
const MENUS = require('../menus');

let registered = false;

/* --------------------------- registro único -------------------------- */

function ensureRegistered() {
  if (registered) return;
  registered = true;
  // handlers legados (cliques antigos continuam funcionando)
  buttonHandler.register('lua_commands', (ctx) => nav.openScreen(ctx, 'lua_commands'));
  buttonHandler.register('lua_admin', (ctx) => nav.openScreen(ctx, 'lua_admin'));
  buttonHandler.register('lua_config', (ctx) => commandHandler.runByName(ctx, 'config'));
  buttonHandler.register('lua_help', (ctx) => commandHandler.runByName(ctx, 'help'));
  buttonHandler.register('lua_back', (ctx) => sendMainMenu(ctx));
  buttonHandler.register('lua_cat_fun', (ctx) => sendCategoryAsText(ctx, 'fun', '🎮 Diversão'));
  buttonHandler.register('lua_cat_utility', (ctx) => sendCategoryAsText(ctx, 'utility', '🛠️ Utilidades'));
  buttonHandler.register('lua_cat_members', (ctx) => sendCategoryAsText(ctx, 'members', '👥 Membros'));
}

/* --------------------------- modo textual ---------------------------- */

async function sendTextMainMenu(ctx) {
  ensureRegistered();
  const items = MENUS.map((m, i) => ({
    num: i + 1,
    label: `${m.emoji} ${m.title}`,
    run: (c) => sendCategoryAsText(c, m.id, `${m.emoji} ${m.title}`),
  }));
  numberFallback.setNumberMenu(ctx.remoteJid, items);
  const rows = items.map((it) => ui.createButton(it.num, it.label)).join('\n');
  const digits = String(ctx.sender || '').split('@')[0];
  await ctx.reply(
    [
      ui.createHeader('🌙 LUA', '«WhatsApp Multi-Function System»'),
      ui.createDivider(),
      `👤 Usuário: @${digits}`,
      `⚡ Prefixo: ${ctx.prefix}`,
      `📦 Comandos: ${registry.count()}`,
      `🟢 Status: Online`,
      ui.createDivider(),
      rows,
      ui.createDivider(),
      '_Digite o número da categoria (menu = voltar)._',
    ].join('\n')
  );
}

async function sendCategoryAsText(ctx, category, title) {
  const cmds = (registry.byCategory().get(category) || []).filter((c) => !c.hidden);
  if (!cmds.length) {
    await ctx.reply(`📂 Nenhum comando carregado em *${title}*.`);
    return;
  }
  const items = cmds.map((c, i) => ({
    num: i + 1,
    label: `${commandEmoji(c)} ${ctx.prefix}${c.name} — ${(c.description || '').slice(0, 48)}`,
    run: (cc) => commandHandler.runByName(cc, c.name),
  }));
  items.push({ num: 0, label: '⬅ Voltar ao menu', run: (cc) => sendMainMenu(cc) });
  numberFallback.setNumberMenu(ctx.remoteJid, items);
  const rows = items.map((it) => ui.createButton(it.num, it.label)).join('\n');
  await ctx.reply(
    [
      ui.createHeader(title, 'Categoria de comandos'),
      ui.createDivider(),
      rows,
      ui.createDivider(),
      '_Digite o número do comando (0 = voltar)._',
    ].join('\n')
  );
}

/* ----------------------------- dispatch ------------------------------ */

async function sendInteractiveMainMenu(ctx) {
  ensureRegistered();
  // garante que as telas estão registradas (side-effect do require)
  require('../menus/screens');
  await nav.openScreen(ctx, 'lua_main');
  return true;
}

/**
 * Ponto único de entrada do menu principal.
 * uiMode 'text' força o texto; 'buttons'/'auto' seguem o suporte
 * (buttonsEnabled). Nunca envia menu duplicado.
 */
function useInteractiveMenu() {
  if (CONFIG.ui && CONFIG.ui.uiMode === 'text') return false;
  // Modo seguro: o menu por lista/botões é um payload que o cliente oficial
  // do WhatsApp não produz (foi o gatilho da restrição no !menu). Com o modo
  // seguro ligado, o menu sai no modo textual numerado — mesmas funções.
  if (require('./safety').blocksInteractive()) return false;
  return settings.buttonsEnabled();
}

async function sendMainMenu(ctx) {
  // 1) formato HTML (só com !modohtml on e fora do modo seguro)
  // 2) lista/botões interativos (comportamento de sempre)
  // 3) menu textual numerado (compatibilidade)
  const menuFormat = require('./menuFormat');
  if (await menuFormat.abrir(ctx, { kind: 'main', forceText: ctx && ctx.forceTextMenu })) {
    return true;
  }
  if (useInteractiveMenu()) {
    return sendInteractiveMainMenu(ctx);
  }
  await sendTextMainMenu(ctx);
  return false;
}

module.exports = { sendMainMenu, sendInteractiveMainMenu, sendTextMainMenu, sendCategoryAsText, sendButtons: nav.sendButtons, useInteractiveMenu };
