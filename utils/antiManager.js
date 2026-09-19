/**
 * utils/antiManager.js — sistema avançado de antis (ação configurável).
 *
 * Cada anti pode ter:
 * - enabled: boolean
 * - action: 'delete' | 'warn' | 'mute' | 'ban' | 'kick' (kick = ban sem banlist)
 * - purge: boolean (apaga histórico recente do usuário quando aciona)
 * - purgeLimit: number (quantas mensagens apagar, padrão 10)
 * - warnReason: string (motivo da advertência)
 *
 * O LIGA/DESLIGA agora é responsabilidade do núcleo do AutoBot
 * (utils/autobot.js): aqui ficam só a CONFIGURAÇÃO da ação e a EXECUÇÃO.
 * Assim `!anti antilink on ban` e `!antilink on` mexem no MESMO estado — não
 * existem mais duas verdades sobre "o anti está ligado?".
 *
 * Compatibilidade: continua lendo o formato antigo `filters` (boolean) e
 * `anti` (objeto), além do novo `autobot`.
 */

'use strict';

const groups = require('../database/groups');
const autobot = require('./autobot');
const logger = require('./logger').child('anti');
const janitor = require('./janitor');

/* ------------------------------- tipos --------------------------------- */

const DEFAULT_ANTI = {
  enabled: false,
  action: 'delete',
  purge: false,
  purgeLimit: 10,
  warnReason: '',
};

/** Ids canônicos dos antis (a fonte é o registro do AutoBot). */
const ANTI_TYPES = autobot.antiIds();

/** Motivos legíveis por anti (usado em logs, advertências e avisos). */
const REASONS = {
  antilink: 'Link não permitido',
  antilink2: 'Link não permitido',
  antilinkgp: 'Link de convite não permitido',
  antipalavrao: 'Palavrão não permitido',
  antitoxic: 'Conteúdo tóxico/ofensivo',
  antipix: 'Conteúdo de pagamento/PIX não permitido',
  anticatalogo: 'Catálogo/produto não permitido',
  antistatus: 'Conteúdo de status não permitido',
  anticomunidade: 'Conteúdo de comunidade não permitido',
  anticanal: 'Conteúdo de canal não permitido',
  antienquete: 'Enquetes não permitidas',
  antiencaminhamento: 'Mensagem encaminhada não permitida',
  antimencaomassa: 'Menção em massa não permitida',
  antigif: 'GIFs não permitidos',
  antilive: 'Convites de evento/live não permitidos',
  antilocalizacaotemp: 'Localização em tempo real não permitida',
  antilocalizacao: 'Localização não permitida',
  antiapk: 'Documento APK não permitido',
  antizip: 'Arquivo compactado não permitido',
  antiexe: 'Executável não permitido',
  antipdf: 'Documento PDF não permitido',
  antiimagem: 'Imagens não permitidas',
  antivideo: 'Vídeos não permitidos',
  antiaudio: 'Áudios não permitidos',
  antidocumento: 'Documentos não permitidos',
  antisticker: 'Figurinhas não permitidas',
  anticontato: 'Contatos não permitidos',
  antimedia: 'Mídias não permitidas',
  antiviewonce: 'Mídia de visualização única não permitida',
  antispam: 'Spam (mensagem repetida)',
  antiflood: 'Flood (muitas mensagens)',
  antiparentese: 'Mensagem com excesso de símbolos',
  antifake: 'Número estrangeiro (fake)',
  antibot: 'Possível bot',
  antieditarmensagem: 'Mensagem editada após o envio',
  antiapagarmensagem: 'Mensagem apagada para todos',
  antireacao: 'Reações não permitidas',
  antichamada: 'Chamadas não permitidas',
  limitecaracteres: 'Mensagem acima do limite de caracteres',
  antitextogigante: 'Texto absurdamente longo',
  antiemojispam: 'Excesso de emojis',
};

function reasonFor(antiType) {
  return REASONS[antiType] || `Filtro ${antiType}`;
}

/* ------------------------- histórico p/ purge --------------------------- */

// Map<groupJid, Map<userJid, Array<{key, ts}>>>
const messageHistory = new Map();
const MAX_HISTORY_PER_USER = 50;
const HISTORY_TTL_MS = 30 * 60 * 1000; // 30 min
const MAX_GROUPS = 500;

function getGroupHistory(groupJid) {
  if (!messageHistory.has(groupJid)) {
    if (messageHistory.size >= MAX_GROUPS) {
      const oldest = messageHistory.keys().next().value;
      messageHistory.delete(oldest);
    }
    messageHistory.set(groupJid, new Map());
  }
  return messageHistory.get(groupJid);
}

function addToHistory(groupJid, userJid, messageKey) {
  if (!groupJid || !userJid || !messageKey) return false;
  try {
    const gh = getGroupHistory(groupJid);
    if (!gh.has(userJid)) gh.set(userJid, []);
    const arr = gh.get(userJid);
    const now = Date.now();
    const last = arr.length ? arr[arr.length - 1] : null;
    // nunca registra a MESMA mensagem duas vezes (antes o pipeline chamava
    // addToHistory em dois lugares e o purge apagava o mesmo item 2x)
    if (last && last.key && last.key.id === messageKey.id) return false;
    arr.push({ key: messageKey, ts: now });
    if (arr.length > MAX_HISTORY_PER_USER) arr.shift();
    return true;
  } catch (_) {
    return false;
  }
}

function getUserHistory(groupJid, userJid) {
  const gh = messageHistory.get(groupJid);
  if (!gh) return [];
  const list = gh.get(userJid) || [];
  const cutoff = Date.now() - HISTORY_TTL_MS;
  return list.filter((it) => it.ts >= cutoff);
}

function clearUserHistory(groupJid, userJid) {
  const gh = messageHistory.get(groupJid);
  if (gh) gh.delete(userJid);
}

/** Limpeza periódica (registrada no janitor — um timer só para o bot todo). */
function sweepHistory() {
  const cutoff = Date.now() - HISTORY_TTL_MS;
  for (const [gid, users] of messageHistory) {
    for (const [uid, list] of users) {
      const kept = list.filter((it) => it.ts >= cutoff);
      if (kept.length) users.set(uid, kept);
      else users.delete(uid);
    }
    if (!users.size) messageHistory.delete(gid);
  }
}

janitor.register('anti-history', sweepHistory, 5 * 60 * 1000);

/* ---------------------------- configuração ------------------------------ */

function normalizeAction(raw) {
  const a = String(raw || '').toLowerCase().trim();
  if (['ban', 'banir', 'remover', 'banimento'].includes(a)) return 'ban';
  if (['kick', 'expulsar', 'chutar', 'remover2'].includes(a)) return 'kick';
  if (['mute', 'mutar', 'silenciar'].includes(a)) return 'mute';
  if (['warn', 'adv', 'advertencia', 'advertência', 'aviso'].includes(a)) return 'warn';
  if (['delete', 'del', 'apagar', 'apenas'].includes(a)) return 'delete';
  return null;
}

const ACTION_LABELS = {
  delete: '🗑️ só apagar',
  warn: '⚠️ advertência',
  mute: '🔇 mutar',
  ban: '🚫 banir',
  kick: '👢 expulsar',
};

/** Config completa de um anti (sempre com defaults preenchidos). */
function getAntiConfig(groupJid, type) {
  const def = autobot.resolve(type);
  if (!def || !def.anti) return null;
  const s = groups.getSettings(groupJid);
  const key = def.legacy || def.id;
  const raw = (s.anti && (s.anti[def.id] || s.anti[key])) || {};
  const cfg = { ...DEFAULT_ANTI, ...raw };
  cfg.action = normalizeAction(cfg.action) || 'delete';
  cfg.purge = !!cfg.purge;
  cfg.purgeLimit = Math.min(50, Math.max(1, parseInt(cfg.purgeLimit, 10) || 10));
  cfg.warnReason = String(cfg.warnReason || '').slice(0, 200);
  cfg.enabled = autobot.isEnabled(groupJid, def.id);
  cfg.id = def.id;
  cfg.label = def.label;
  return cfg;
}

function getAllAntiConfig(groupJid) {
  const result = {};
  for (const def of autobot.antiFeatures()) result[def.id] = getAntiConfig(groupJid, def.id);
  return result;
}

/**
 * Atualiza a configuração de ação/purge de um anti (e opcionalmente o
 * liga/desliga). UMA escrita no banco, cache atualizado na hora.
 */
function setAntiConfig(groupJid, type, patch = {}) {
  const def = autobot.resolve(type);
  if (!def || !def.anti) return false;

  const s = groups.getSettings(groupJid);
  const key = def.legacy || def.id;
  const current = (s.anti && (s.anti[def.id] || s.anti[key])) || {};
  const next = { ...DEFAULT_ANTI, ...current, ...patch };

  // sanitiza
  next.action = normalizeAction(next.action) || 'delete';
  next.purge = !!next.purge;
  next.purgeLimit = Math.min(50, Math.max(1, parseInt(next.purgeLimit, 10) || 10));
  next.warnReason = String(next.warnReason || '').slice(0, 200);

  const enabledProvided = Object.prototype.hasOwnProperty.call(patch, 'enabled');
  const enabled = enabledProvided ? !!patch.enabled : autobot.isEnabled(groupJid, def.id);
  next.enabled = enabled;

  groups.patchSettings(groupJid, (cfg) => {
    if (!cfg.anti) cfg.anti = {};
    cfg.anti[def.id] = { ...next };
    if (def.legacy && def.legacy !== def.id) cfg.anti[def.legacy] = { ...next };

    if (!cfg.autobot) cfg.autobot = {};
    cfg.autobot[def.id] = {
      ...(cfg.autobot[def.id] || {}),
      enabled,
      action: next.action,
      purge: next.purge,
      purgeLimit: next.purgeLimit,
    };

    if (!cfg.filters) cfg.filters = {};
    cfg.filters[def.legacy || def.id] = enabled;
  });

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
  return autobot.isEnabled(groupJid, type);
}

/**
 * Mapa de antis ativos do grupo — UMA leitura de cache por mensagem.
 * @returns {(id: string) => boolean}
 */
function enabledChecker(groupJid) {
  const s = groups.getSettings(groupJid);
  const auto = s.autobot || {};
  const anti = s.anti || {};
  const filters = s.filters || {};
  const cache = new Map();
  return function isOn(idOrAlias) {
    const def = autobot.resolve(idOrAlias);
    if (!def) return false;
    if (def.scope !== 'group') return autobot.isEnabled(groupJid, def.id);
    if (cache.has(def.id)) return cache.get(def.id);
    // "ligado" em qualquer sistema = ligado (compatibilidade com filtros antigos)
    const key = def.legacy || def.id;
    const a = auto[def.id];
    const an = anti[key];
    let value;
    if (a && a.enabled === true) value = true;
    else if (an && an.enabled === true) value = true;
    else if (filters[key] === true) value = true;
    else if (a && typeof a.enabled === 'boolean') value = a.enabled;
    else if (an && typeof an.enabled === 'boolean') value = an.enabled;
    else if (typeof filters[key] === 'boolean') value = filters[key];
    else value = false;
    cache.set(def.id, value);
    return value;
  };
}

/** Existe algum anti ligado no grupo? (caminho rápido do pipeline) */
function anyEnabled(groupJid) {
  const isOn = enabledChecker(groupJid);
  for (const def of autobot.antiFeatures()) {
    if (isOn(def.id)) return true;
  }
  return false;
}

/* ------------------------------- execução ------------------------------- */

/**
 * Executa a ação configurada do anti.
 * @param {object} sock socket Baileys
 * @param {object} ctx  contexto (remoteJid/sender/message/isBotAdmin)
 * @param {string} antiType id do anti
 * @param {string} [reason] motivo legível
 * @param {object} [opts] { key, skipDelete, notify }
 * @returns {Promise<{deleted:boolean, action:string|null, reason:string}>}
 */
async function executeAntiAction(sock, ctx, antiType, reason, opts = {}) {
  const cfg = getAntiConfig(ctx.remoteJid, antiType);
  const label = reason || reasonFor(antiType);
  if (!cfg || (!cfg.enabled && !opts.force)) return { deleted: false, action: null, reason: label };

  const action = cfg.action || 'delete';
  const key = opts.key || (ctx.message && ctx.message.key);
  let deleted = false;
  const extra = {};

  // 1) apaga a mensagem que acionou (exige admin)
  if (!opts.skipDelete && key) {
    try {
      if (ctx.isBotAdmin) {
        await sock.sendMessage(ctx.remoteJid, { delete: key });
        deleted = true;
      }
    } catch (err) {
      logger.warn({ err: err.message, anti: antiType }, 'falha ao apagar mensagem do anti');
    }
  }

  // 2) purge do histórico recente
  if (cfg.purge && ctx.isBotAdmin) {
    try {
      const history = getUserHistory(ctx.remoteJid, ctx.sender);
      const limit = Math.min(cfg.purgeLimit, history.length);
      for (let i = history.length - 1; i >= Math.max(0, history.length - limit); i--) {
        const item = history[i];
        if (!item || !item.key) continue;
        if (key && item.key.id === key.id) continue;
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
      groups.addWarning(
        ctx.remoteJid,
        ctx.sender,
        cfg.warnReason || label,
        'anti-system'
      );
      extra.warned = true;
    } else if (action === 'mute') {
      const { muteUser } = require('../handlers/groupHandler');
      muteUser(ctx.remoteJid, ctx.sender);
      extra.muted = true;
      if (!cfg.purge && ctx.isBotAdmin) {
        const history = getUserHistory(ctx.remoteJid, ctx.sender);
        for (let i = history.length - 2; i >= Math.max(0, history.length - 6); i--) {
          const item = history[i];
          if (!item || !item.key) continue;
          try {
            await sock.sendMessage(ctx.remoteJid, { delete: item.key });
            await new Promise((r) => setTimeout(r, 200));
          } catch (_) {}
        }
        extra.purged = Math.min(5, Math.max(0, history.length - 1));
      }
    } else if (action === 'ban' || action === 'kick') {
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

  return { deleted, action, reason: label, ...extra };
}

/** Purge manual: apaga N mensagens recentes de um usuário. */
async function purgeUserHistory(sock, groupJid, userJid, limit = 10, isBotAdmin = true) {
  if (!isBotAdmin) return { ok: false, reason: 'bot_not_admin' };
  const history = getUserHistory(groupJid, userJid);
  if (!history.length) return { ok: false, reason: 'no_history', count: 0 };
  const toDelete = Math.min(limit, history.length);
  let deleted = 0;
  for (let i = history.length - 1; i >= Math.max(0, history.length - toDelete); i--) {
    const item = history[i];
    if (!item || !item.key) continue;
    try {
      await sock.sendMessage(groupJid, { delete: item.key });
      deleted++;
      await new Promise((r) => setTimeout(r, 300));
    } catch (_) {}
  }
  return { ok: true, count: deleted };
}

module.exports = {
  ANTI_TYPES,
  DEFAULT_ANTI,
  REASONS,
  ACTION_LABELS,
  reasonFor,
  messageHistory,
  addToHistory,
  getUserHistory,
  clearUserHistory,
  sweepHistory,
  getAntiConfig,
  getAllAntiConfig,
  setAntiConfig,
  enableAnti,
  disableAnti,
  isAntiEnabled,
  enabledChecker,
  anyEnabled,
  normalizeAction,
  executeAntiAction,
  purgeUserHistory,
};
