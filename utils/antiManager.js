'use strict';

/**
 * utils/antiManager.js — sistema avançado de antis com ação configurável.
 *
 * Cada anti pode ter:
 * - enabled: boolean
 * - action: 'delete' | 'warn' | 'mute' | 'ban' | 'kick' (kick = ban sem banlist)
 * - purge: boolean (apaga histórico recente do usuário quando aciona)
 * - purgeLimit: number (quantas mensagens apagar, padrão 10)
 * - warnReason: string (motivo da advertência)
 *
 * Compatibilidade: lê o formato antigo `filters` (boolean) e migra para `anti`.
 */

const groups = require('../database/groups');
const logger = require('./logger').child('anti');

// histórico de mensagens por grupo/usuário para purge
// Map<groupJid, Map<userJid, Array<{key, timestamp}>>>
const messageHistory = new Map();
const MAX_HISTORY_PER_USER = 50;

function getGroupHistory(groupJid) {
  if (!messageHistory.has(groupJid)) messageHistory.set(groupJid, new Map());
  return messageHistory.get(groupJid);
}

function addToHistory(groupJid, userJid, messageKey) {
  try {
    const gh = getGroupHistory(groupJid);
    if (!gh.has(userJid)) gh.set(userJid, []);
    const arr = gh.get(userJid);
    arr.push({ key: messageKey, ts: Date.now() });
    if (arr.length > MAX_HISTORY_PER_USER) arr.shift();
  } catch (_) {}
}

function getUserHistory(groupJid, userJid) {
  const gh = messageHistory.get(groupJid);
  if (!gh) return [];
  return gh.get(userJid) || [];
}

function clearUserHistory(groupJid, userJid) {
  const gh = messageHistory.get(groupJid);
  if (gh) gh.delete(userJid);
}

const DEFAULT_ANTI = {
  enabled: false,
  action: 'delete',
  purge: false,
  purgeLimit: 10,
  warnReason: '',
};

const ANTI_TYPES = [
  'antilink',
  'antiinvite',
  'antipix',
  'antispam',
  'antiflood',
  'antiparentese',
  'antifake',
  'antibot',
  'antimedia',
  'antiimagem',
  'antivideo',
  'antiaudio',
  'antidocumento',
  'antisticker',
  'antiviewonce',
  'antilocalizacao',
  'anticontato',
  'antitoxic',
  'antipalavrao',
];

function normalizeAction(raw) {
  const a = String(raw || '').toLowerCase().trim();
  if (['ban', 'banir', 'remover'].includes(a)) return 'ban';
  if (['kick', 'expulsar', 'chutar'].includes(a)) return 'kick';
  if (['mute', 'mutar', 'silenciar'].includes(a)) return 'mute';
  if (['warn', 'adv', 'advertencia', 'advertência', 'aviso'].includes(a)) return 'warn';
  if (['delete', 'del', 'apagar', 'apenas'].includes(a)) return 'delete';
  return null;
}

function getAntiConfig(groupJid, type) {
  const key = String(type || '').toLowerCase();
  if (!ANTI_TYPES.includes(key)) return null;
  const settings = groups.getSettings(groupJid);
  // novo formato: settings.anti[type]
  if (settings.anti && settings.anti[key]) {
    return { ...DEFAULT_ANTI, ...settings.anti[key] };
  }
  // compat: formato antigo filters[type] boolean
  const oldFilters = settings.filters || {};
  if (oldFilters[key]) {
    return { ...DEFAULT_ANTI, enabled: true, action: 'delete', purge: false };
  }
  return { ...DEFAULT_ANTI };
}

function getAllAntiConfig(groupJid) {
  const result = {};
  for (const t of ANTI_TYPES) {
    result[t] = getAntiConfig(groupJid, t);
  }
  return result;
}

function setAntiConfig(groupJid, type, patch) {
  const key = String(type || '').toLowerCase();
  if (!ANTI_TYPES.includes(key)) return false;
  const settings = groups.getSettings(groupJid);
  if (!settings.anti) settings.anti = {};
  const current = settings.anti[key] || { ...DEFAULT_ANTI };
  const next = { ...current, ...patch };
  // sanitiza
  next.enabled = !!next.enabled;
  next.action = normalizeAction(next.action) || 'delete';
  next.purge = !!next.purge;
  next.purgeLimit = Math.min(50, Math.max(1, parseInt(next.purgeLimit, 10) || 10));
  next.warnReason = String(next.warnReason || '').slice(0, 200);
  settings.anti[key] = next;
  // também atualiza filters para compat
  if (!settings.filters) settings.filters = {};
  settings.filters[key] = next.enabled;
  groups.setSetting(groupJid, 'anti', settings.anti);
  groups.setSetting(groupJid, 'filters', settings.filters);
  return true;
}

function enableAnti(groupJid, type, action = 'delete', opts = {}) {
  return setAntiConfig(groupJid, type, {
    enabled: true,
    action: action || 'delete',
    purge: !!opts.purge,
    purgeLimit: opts.purgeLimit || 10,
    warnReason: opts.warnReason || '',
  });
}

function disableAnti(groupJid, type) {
  return setAntiConfig(groupJid, type, { enabled: false });
}

function isAntiEnabled(groupJid, type) {
  const cfg = getAntiConfig(groupJid, type);
  return !!(cfg && cfg.enabled);
}

/**
 * Executa a ação configurada do anti
 * @param {object} sock - socket Baileys
 * @param {object} ctx - contexto
 * @param {string} antiType - tipo do anti
 * @param {string} reason - motivo legível
 */
async function executeAntiAction(sock, ctx, antiType, reason) {
  const cfg = getAntiConfig(ctx.remoteJid, antiType);
  if (!cfg || !cfg.enabled) return { deleted: false, action: null };

  const action = cfg.action || 'delete';
  let deleted = false;
  let extra = {};

  // 1) sempre tenta apagar a mensagem que acionou
  try {
    if (ctx.isBotAdmin) {
      await sock.sendMessage(ctx.remoteJid, { delete: ctx.message.key });
      deleted = true;
    }
  } catch (err) {
    logger.warn({ err: err.message, anti: antiType }, 'falha ao apagar mensagem do anti');
  }

  // 2) purge histórico se configurado
  if (cfg.purge && ctx.isBotAdmin) {
    try {
      const history = getUserHistory(ctx.remoteJid, ctx.sender);
      const limit = Math.min(cfg.purgeLimit, history.length);
      // apaga do mais recente ao mais antigo, com delay para não tomar rate limit
      for (let i = history.length - 1; i >= Math.max(0, history.length - limit); i--) {
        const item = history[i];
        try {
          await sock.sendMessage(ctx.remoteJid, { delete: item.key });
          await new Promise((r) => setTimeout(r, 300));
        } catch (_) {}
      }
      extra.purged = limit;
    } catch (err) {
      logger.warn({ err: err.message }, 'falha no purge do anti');
    }
  }

  // 3) ação extra
  try {
    if (action === 'warn') {
      groups.addWarning(ctx.remoteJid, ctx.sender, reason || `Anti ${antiType}: ${cfg.warnReason || 'conteúdo não permitido'}`, 'anti-system');
      extra.warned = true;
    } else if (action === 'mute') {
      const { muteUser } = require('../handlers/groupHandler');
      muteUser(ctx.remoteJid, ctx.sender);
      extra.muted = true;
      // se purge não estava ativo, ainda apaga histórico recente por padrão no mute
      if (!cfg.purge && ctx.isBotAdmin) {
        const history = getUserHistory(ctx.remoteJid, ctx.sender);
        for (let i = history.length - 2; i >= Math.max(0, history.length - 6); i--) {
          try {
            await sock.sendMessage(ctx.remoteJid, { delete: history[i].key });
            await new Promise((r) => setTimeout(r, 200));
          } catch (_) {}
        }
        extra.purged = Math.min(5, history.length - 1);
      }
    } else if (action === 'ban' || action === 'kick') {
      // adiciona à banlist se for ban
      if (action === 'ban') {
        const s = groups.getSettings(ctx.remoteJid);
        const banned = Array.isArray(s.banned) ? s.banned : [];
        if (!banned.includes(ctx.sender)) {
          banned.push(ctx.sender);
          groups.setSetting(ctx.remoteJid, 'banned', banned);
        }
      }
      try {
        await sock.groupParticipantsUpdate(ctx.remoteJid, [ctx.sender], 'remove');
        extra.banned = true;
      } catch (err) {
        logger.warn({ err: err.message }, 'falha ao banir/kick no anti');
      }
    }
  } catch (err) {
    logger.warn({ err: err.message, anti: antiType, action }, 'falha na ação do anti');
  }

  return { deleted, action, ...extra };
}

/**
 * Purge manual: apaga N mensagens recentes de um usuário
 */
async function purgeUserHistory(sock, groupJid, userJid, limit = 10, isBotAdmin = true) {
  if (!isBotAdmin) return { ok: false, reason: 'bot_not_admin' };
  const history = getUserHistory(groupJid, userJid);
  if (!history.length) return { ok: false, reason: 'no_history', count: 0 };
  const toDelete = Math.min(limit, history.length);
  let deleted = 0;
  for (let i = history.length - 1; i >= Math.max(0, history.length - toDelete); i--) {
    try {
      await sock.sendMessage(groupJid, { delete: history[i].key });
      deleted++;
      await new Promise((r) => setTimeout(r, 300));
    } catch (_) {}
  }
  return { ok: true, count: deleted };
}

module.exports = {
  ANTI_TYPES,
  DEFAULT_ANTI,
  messageHistory,
  addToHistory,
  getUserHistory,
  clearUserHistory,
  getAntiConfig,
  getAllAntiConfig,
  setAntiConfig,
  enableAnti,
  disableAnti,
  isAntiEnabled,
  normalizeAction,
  executeAntiAction,
  purgeUserHistory,
};
