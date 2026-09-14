/**
 * utils/numberFallback.js — fallback de menus em texto.
 *
 * Quando a mensagem interativa (lista/botões) não é suportada, o menu é
 * enviado como texto numerado e o usuário responde com o número.
 * Aqui guardamos o mapeamento número -> ação por chat.
 */

'use strict';

const TTL = 10 * 60 * 1000; // 10 minutos

const menus = new Map(); // chatId -> { expires, items: [{ num, label, run }] }

function setNumberMenu(chatId, items) {
  menus.set(chatId, {
    expires: Date.now() + TTL,
    items: Array.isArray(items) ? items : [],
  });
}

function getNumberMenu(chatId) {
  const m = menus.get(chatId);
  if (!m) return null;
  if (Date.now() > m.expires) {
    menus.delete(chatId);
    return null;
  }
  return m;
}

function clearNumberMenu(chatId) {
  menus.delete(chatId);
}

/** Encontra uma ação pelo número digitado. */
function match(chatId, text) {
  const t = String(text || '').trim();
  const n = parseInt(t, 10);
  if (!Number.isFinite(n)) return null;
  const menu = getNumberMenu(chatId);
  if (!menu) return null;
  return menu.items.find((it) => it.num === n) || null;
}

module.exports = { setNumberMenu, getNumberMenu, clearNumberMenu, match };
