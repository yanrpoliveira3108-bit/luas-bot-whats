'use strict';

/**
 * utils/stickerMeta.js — metadados ricos para stickers.
 *
 * Gera packname/author inteligentes com:
 * - nome do criador (pushName / DB)
 * - origem (PV ou nome do grupo)
 * - bot, dono, dev
 * - data opcional
 *
 * Usado por !s, !take, !pack, !stickertext, etc.
 */

const CONFIG = require('../config');

function safeTrim(s, max = 100) {
  let t = String(s || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  if (t.length > max) t = t.slice(0, max - 1).trim() + '…';
  return t;
}

function getCreatorName(ctx) {
  try {
    // pushName da mensagem atual
    const push = ctx && ctx.message && (ctx.message.pushName || ctx.message.verifiedBizName);
    if (push && String(push).trim().length >= 2) return safeTrim(push, 30);
  } catch (_) {}
  try {
    const users = require('../database/users');
    const u = ctx && ctx.sender ? users.get(ctx.sender) : null;
    if (u && u.name && String(u.name).trim().length >= 2) return safeTrim(u.name, 30);
  } catch (_) {}
  try {
    if (ctx && ctx.sender) {
      const raw = String(ctx.sender).split('@')[0];
      // não expor número completo — mostra só final mascarado ou apelido
      if (raw) return safeTrim('User ' + raw.slice(-4), 20);
    }
  } catch (_) {}
  return 'Usuário';
}

function getGroupName(ctx) {
  try {
    const { cache } = require('./cache');
    const meta = ctx && ctx.remoteJid ? cache.get('meta:' + ctx.remoteJid) : null;
    if (meta && meta.subject) return safeTrim(meta.subject, 28);
  } catch (_) {}
  try {
    const groups = require('../database/groups');
    const g = ctx && ctx.remoteJid ? groups.get(ctx.remoteJid) : null;
    if (g && g.name) return safeTrim(g.name, 28);
  } catch (_) {}
  return '';
}

function formatDateBR(d = new Date()) {
  try {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch (_) {
    return '';
  }
}

/**
 * Constrói metadados padrão ricos.
 * @param {object} ctx - contexto do comando (pode ser null para fallback)
 * @param {object} opts - { customPack, customAuthor, emoji, includeDate }
 */
function buildStickerMeta(ctx, opts = {}) {
  const botName = safeTrim(CONFIG.bot.name || 'Lua', 25) || 'Lua';
  const ownerName = safeTrim(CONFIG.owner.name || 'Dono', 25);
  const devName = safeTrim(CONFIG.bot.author || 'Lua Dev', 25);

  const creatorName = ctx ? getCreatorName(ctx) : 'Usuário';
  const groupName = ctx && ctx.isGroup ? getGroupName(ctx) : '';
  const isGroup = !!(ctx && ctx.isGroup);
  const originLabel = isGroup ? (groupName ? `Grupo: ${groupName}` : 'Grupo') : 'PV';

  const customPack = safeTrim(opts.customPack, 60);
  const customAuthor = safeTrim(opts.customAuthor, 120);

  // packname: se custom, usa custom. Senão: "☾ BOT • Criador" ou "☾ BOT"
  let packname;
  if (customPack) {
    packname = customPack;
  } else if (CONFIG.sticker && CONFIG.sticker.packname) {
    // permite template no .env: ex: "{bot} • {creator}"
    packname = CONFIG.sticker.packname
      .replace('{bot}', botName)
      .replace('{creator}', creatorName)
      .replace('{group}', groupName || 'Grupo')
      .replace('{origin}', originLabel);
    packname = safeTrim(packname, 60);
  } else {
    // padrão rico
    packname = `☾ ${botName} • ${creatorName}`;
    packname = safeTrim(packname, 50);
  }

  // author/publisher: se custom, usa custom. Senão monta bio rica.
  let author;
  if (customAuthor) {
    author = customAuthor;
  } else if (CONFIG.sticker && CONFIG.sticker.author) {
    author = CONFIG.sticker.author
      .replace('{bot}', botName)
      .replace('{creator}', creatorName)
      .replace('{owner}', ownerName)
      .replace('{dev}', devName)
      .replace('{group}', groupName || '')
      .replace('{origin}', originLabel)
      .replace('{date}', formatDateBR());
    author = safeTrim(author, 120);
  } else {
    const parts = [];
    // criador
    parts.push(`👤 ${creatorName}`);
    // origem
    if (isGroup && groupName) {
      parts.push(`👥 ${groupName}`);
    } else if (isGroup) {
      parts.push('👥 Grupo');
    } else {
      parts.push('💬 PV');
    }
    // bot
    parts.push(`🤖 ${botName}`);

    // dono (se diferente do bot)
    if (ownerName && ownerName.toLowerCase() !== botName.toLowerCase()) {
      parts.push(`👑 ${ownerName}`);
    }
    // dev (se diferente de dono e bot)
    if (
      devName &&
      devName.toLowerCase() !== ownerName.toLowerCase() &&
      devName.toLowerCase() !== botName.toLowerCase()
    ) {
      parts.push(`💻 ${devName}`);
    }

    // data opcional (desativada por padrão para não poluir, mas pode ativar via .env)
    const includeDate = opts.includeDate ?? (CONFIG.sticker ? CONFIG.sticker.includeDate : false);
    if (includeDate) {
      parts.push(`📅 ${formatDateBR()}`);
    }

    author = parts.join(' • ');
    author = safeTrim(author, 120);
  }

  // emoji opcional
  const emoji = opts.emoji ? String(opts.emoji).slice(0, 8) : undefined;

  return { packname, author, emoji };
}

/**
 * Para o comando !take / !roubar — se usuário passar pack|author custom,
 * respeita, mas se não passar, gera rico automaticamente.
 */
function buildTakeMeta(ctx, packArg, authorArg) {
  return buildStickerMeta(ctx, {
    customPack: packArg,
    customAuthor: authorArg,
  });
}

module.exports = {
  buildStickerMeta,
  buildTakeMeta,
  getCreatorName,
  getGroupName,
  formatDateBR,
};
