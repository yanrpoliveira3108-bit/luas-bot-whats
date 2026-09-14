/**
 * utils/menuImage.js — resolução de imagem de cabeçalho dos menus.
 *
 * Config: MENU_IMAGE (fallback) + MENU_IMAGE_ADMIN / _RPG / _DOWNLOAD /
 * _PROFILE. Se uma imagem específica não existir, usa MENU_IMAGE; se nenhuma
 * existir, retorna null (menu segue sem imagem — nunca quebra).
 */

'use strict';

const fs = require('fs');
const CONFIG = require('../config');

/** Caminho de imagem resolvido para uma chave, ou null. */
function resolve(key) {
  const map = CONFIG.menu.images || {};
  const candidates = [];
  if (key !== 'main' && map[key]) candidates.push(map[key]);
  if (map.main) candidates.push(map.main);
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {
      /* segue */
    }
  }
  return null;
}

/** Envia a imagem de cabeçalho, se houver. Retorna true se enviou. */
async function sendHeaderImage(ctx, key, caption) {
  const img = resolve(key);
  if (!img) return false;
  try {
    await ctx.sendImage(img, caption || `${CONFIG.bot.name} v${CONFIG.bot.version}`);
    return true;
  } catch (_) {
    return false; // imagem quebrada nunca derruba o menu
  }
}

module.exports = { resolve, sendHeaderImage };
