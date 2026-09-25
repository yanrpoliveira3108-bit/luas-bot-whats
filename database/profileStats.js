/**
 * database/profileStats.js — Registro e persistência de estatísticas de perfil,
 * atividade por escopo (grupo/privado), plataforma estimada e figurinhas.
 */

'use strict';

const db = require('./database');

function nowIso() {
  return new Date().toISOString();
}

/**
 * Estima a plataforma de origem com base no padrão do ID da mensagem do Baileys.
 * Tratado expressamente como estimativa técnica ("Origem estimada").
 */
function estimatePlatform(messageId) {
  if (!messageId || typeof messageId !== 'string') return 'Desconhecido';
  if (/^3A.{18}$/.test(messageId)) return 'iOS';
  if (/^3E.{20}$/.test(messageId)) return 'Web';
  if (/^(.{21}|.{32})$/.test(messageId)) return 'Android';
  if (/^(3F|.{18}$)/.test(messageId)) return 'Desktop';
  return 'Desconhecido';
}

/** Registra mensagem observada em um escopo específico ('global' ou remoteJid do grupo). */
function recordMessage(userId, scope, deviceEstimate = 'Desconhecido') {
  if (!userId || !scope) return;
  const now = nowIso();

  db.prepare(
    'record_user_msg_stat',
    `INSERT INTO user_activity_stats (user_id, scope, messages, commands, command_counts, last_device, last_interaction)
     VALUES (?, ?, 1, 0, '{}', ?, ?)
     ON CONFLICT(user_id, scope) DO UPDATE SET
       messages = messages + 1,
       last_device = CASE WHEN excluded.last_device != 'Desconhecido' THEN excluded.last_device ELSE user_activity_stats.last_device END,
       last_interaction = excluded.last_interaction`
  ).run(userId, scope, deviceEstimate, now);
}

/** Registra execução com sucesso de um comando no escopo. */
function recordCommand(userId, scope, cmdName, deviceEstimate = 'Desconhecido') {
  if (!userId || !scope || !cmdName) return;
  const now = nowIso();

  const current = getActivityStats(userId, scope);
  const counts = current.commandCounts;
  counts[cmdName] = (counts[cmdName] || 0) + 1;
  const json = JSON.stringify(counts);

  db.prepare(
    'record_user_cmd_stat',
    `INSERT INTO user_activity_stats (user_id, scope, messages, commands, command_counts, last_device, last_interaction)
     VALUES (?, ?, 0, 1, ?, ?, ?)
     ON CONFLICT(user_id, scope) DO UPDATE SET
       commands = commands + 1,
       command_counts = excluded.command_counts,
       last_device = CASE WHEN excluded.last_device != 'Desconhecido' THEN excluded.last_device ELSE user_activity_stats.last_device END,
       last_interaction = excluded.last_interaction`
  ).run(userId, scope, json, deviceEstimate, now);
}

/** Obtém as estatísticas de atividade em determinado escopo. */
function getActivityStats(userId, scope) {
  const row = db.prepare(
    'get_user_activity_stat',
    `SELECT * FROM user_activity_stats WHERE user_id = ? AND scope = ?`
  ).get(userId, scope);

  if (!row) {
    return {
      userId,
      scope,
      messages: 0,
      commands: 0,
      commandCounts: {},
      lastDevice: 'Desconhecido',
      lastInteraction: null,
    };
  }

  let commandCounts = {};
  try {
    commandCounts = JSON.parse(row.command_counts || '{}');
  } catch (_) {}

  return {
    userId: row.user_id,
    scope: row.scope,
    messages: row.messages,
    commands: row.commands,
    commandCounts,
    lastDevice: row.last_device || 'Desconhecido',
    lastInteraction: row.last_interaction || null,
  };
}

/** Obtém top comandos mais utilizados no escopo. */
function getTopCommands(userId, scope, limit = 5) {
  const stats = getActivityStats(userId, scope);
  return Object.entries(stats.commandCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([cmd, count]) => ({ cmd, count }));
}

/* --------------------------- FIGURINHAS --------------------------- */

function ensureStickerStats(userId) {
  db.prepare(
    'ensure_sticker_stats',
    `INSERT OR IGNORE INTO user_sticker_stats (user_id, created, stolen, from_image, from_video_gif, animated, text_stickers, conversions_to_media, last_operation)
     VALUES (?, 0, 0, 0, 0, 0, 0, 0, '')`
  ).run(userId);
}

/** Registra operação de figurinha com sucesso. */
function recordStickerOperation(userId, opType, extra = {}) {
  if (!userId || !opType) return;
  ensureStickerStats(userId);
  const now = nowIso();

  let sqlCol = null;
  if (opType === 'create') sqlCol = 'created = created + 1';
  else if (opType === 'steal') sqlCol = 'stolen = stolen + 1';
  else if (opType === 'from_image') sqlCol = 'created = created + 1, from_image = from_image + 1';
  else if (opType === 'from_video_gif') sqlCol = 'created = created + 1, from_video_gif = from_video_gif + 1, animated = animated + 1';
  else if (opType === 'text') sqlCol = 'created = created + 1, text_stickers = text_stickers + 1';
  else if (opType === 'to_media') sqlCol = 'conversions_to_media = conversions_to_media + 1';

  if (!sqlCol) return;

  const extraAnimated = extra.animated ? ', animated = animated + 1' : '';

  db.get().prepare(
    `UPDATE user_sticker_stats
     SET ${sqlCol}${extraAnimated}, last_operation = ?
     WHERE user_id = ?`
  ).run(now, userId);
}

/** Obtém estatísticas de figurinhas do usuário. */
function getStickerStats(userId) {
  const row = db.prepare(
    'get_sticker_stats',
    `SELECT * FROM user_sticker_stats WHERE user_id = ?`
  ).get(userId);

  if (!row) {
    return {
      userId,
      created: 0,
      stolen: 0,
      fromImage: 0,
      fromVideoGif: 0,
      animated: 0,
      textStickers: 0,
      conversionsToMedia: 0,
      lastOperation: null,
    };
  }

  return {
    userId: row.user_id,
    created: row.created,
    stolen: row.stolen,
    fromImage: row.from_image,
    fromVideoGif: row.from_video_gif,
    animated: row.animated,
    textStickers: row.text_stickers,
    conversionsToMedia: row.conversions_to_media,
    lastOperation: row.last_operation || null,
  };
}

module.exports = {
  estimatePlatform,
  recordMessage,
  recordCommand,
  getActivityStats,
  getTopCommands,
  recordStickerOperation,
  getStickerStats,
};
