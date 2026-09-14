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
const menuRenderer = require('./menuRenderer');

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
      menuRenderer.header({ title: CONFIG.bot.name, subtitle: '«WhatsApp Multi-Function System»', jid: ctx.remoteJid }),
      '',
      menuRenderer.statusBlock({
        jid: ctx.remoteJid,
        user: `@${digits}`,
        prefix: ctx.prefix,
        commands: registry.count(),
      }),
      '',
      menuRenderer.dividerLine(null, ctx.remoteJid),
      '',
      rows,
      '',
      menuRenderer.footer({
        jid: ctx.remoteJid,
        hints: [
          `Digite o número da categoria (${ctx.prefix}menu = voltar)`,
          `${ctx.prefix}menumode <modo> troca o visual`,
        ],
      }),
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
      menuRenderer.header({ title, subtitle: 'Categoria de comandos', jid: ctx.remoteJid }),
      '',
      menuRenderer.dividerFor(category, ctx.remoteJid),
      '',
      rows,
      '',
      menuRenderer.footer({ jid: ctx.remoteJid, hints: ['Digite o número do comando (0 = voltar)'] }),
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
  return settings.buttonsEnabled();
}

async function sendMainMenu(ctx) {
  if (useInteractiveMenu()) {
    return sendInteractiveMainMenu(ctx);
  }
  await sendTextMainMenu(ctx);
  return false;
}

module.exports = { sendMainMenu, sendInteractiveMainMenu, sendTextMainMenu, sendCategoryAsText, sendButtons: nav.sendButtons, useInteractiveMenu };
