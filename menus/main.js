/**
 * menus/main.js — menu principal do Lua.
 *
 * Dispatch central: LISTA interativa quando BUTTONS_ENABLED está ativo,
 * ou menu textual numerado como modo de compatibilidade.
 * A lógica vive em utils/buttons.js (IDs estáveis, handlers compartilhados).
 */

'use strict';

const CONFIG = require('../config');
const settings = require('../database/settings');

async function mainMenu(ctx) {
  const { sendMainMenu } = require('../utils/buttons');
  await sendMainMenu(ctx);
}

/** Cabeçalho informativo usado pelo menu (mantido para compatibilidade). */
function buildHeader(ctx) {
  return (
    `🌙 *${CONFIG.bot.name}* v${CONFIG.bot.version}\n` +
    `▸ Prefixo: ${settings.effectivePrefix()}\n` +
    `▸ Chat: ${ctx.isGroup ? 'grupo' : 'privado'}\n\n` +
    `_Escolha uma opção._`
  );
}

module.exports = mainMenu;
module.exports.buildHeader = buildHeader;
