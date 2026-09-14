/**
 * utils/buttons.js — ponto único de entrada do menu principal.
 *
 * - buttons ON  → navegação por botões (utils/nav.js; telas em menus/screens.js)
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
const { registry } = require('../engine/plugins');
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
  const lines = items.map((it) => `${it.num}. ${it.label}`).join('\n');
  await ctx.reply(`*LUA MENU*\n\n${lines}\n\n_Digite o número._`);
}

async function sendCategoryAsText(ctx, category, title) {
  const cmds = (registry.byCategory().get(category) || []).filter((c) => !c.hidden);
  if (!cmds.length) {
    await ctx.reply(`📂 Nenhum comando carregado em *${title}*.`);
    return;
  }
  const lines = cmds.map((c) => `${ctx.prefix}${c.name} — ${(c.description || '').slice(0, 48)}`).join('\n');
  const { maybeReadMore } = require('./readmore');
  await ctx.reply(maybeReadMore(`*${title}*\n\n${lines}\n\n_Use ${ctx.prefix}menu para voltar._`));
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
 * buttons ON → botões interativos; OFF → texto numerado.
 */
async function sendMainMenu(ctx) {
  if (settings.buttonsEnabled()) {
    return sendInteractiveMainMenu(ctx);
  }
  await sendTextMainMenu(ctx);
  return false;
}

module.exports = { sendMainMenu, sendInteractiveMainMenu, sendTextMainMenu, sendCategoryAsText, sendButtons: nav.sendButtons };
