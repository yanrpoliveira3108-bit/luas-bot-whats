/**
 * commands/_shared/admin.js — helpers compartilhados dos comandos de admin.
 */

'use strict';

const groups = require('../../database/groups');
const commandHandler = require('../../handlers/commandHandler');
const { toJid } = require('../../utils/messages');

/** Participantes do grupo (com cache). */
async function getParticipants(ctx) {
  const meta = await commandHandler.getGroupMetadata(ctx.socket, ctx.remoteJid);
  return meta.participants || [];
}

/** Resolve o usuário-alvo (menção > argumento numérico). */
function resolveTarget(ctx) {
  if (ctx.mentionedJid && ctx.mentionedJid.length) return ctx.mentionedJid[0];
  // aceita "@5522...", "<@5522...>" e "5522..." (sem contextInfo de menção)
  const raw = (ctx.args[0] || '').trim().replace(/^[<]?@+/, '').replace(/>$/, '');
  if (raw) return toJid(raw);
  return null;
}

/** Valida: grupo + admin + bot admin. Retorna mensagem de erro ou null. */
async function requireGroupAdmin(ctx) {
  if (!ctx.isGroup) return '👥 Este comando só funciona em grupos.';
  if (!ctx.isAdmin && !ctx.isOwner) return '🛡️ Apenas administradores podem usar este comando.';
  if (!ctx.isBotAdmin) return '⚠️ Eu preciso ser administrador do grupo.';
  return null;
}

/** Lista de banidos do grupo. */
function bannedList(jid) {
  const s = groups.getSettings(jid);
  return Array.isArray(s.banned) ? s.banned : [];
}

function addBan(jid, userJid) {
  const list = bannedList(jid);
  if (!list.includes(userJid)) list.push(userJid);
  return groups.setSetting(jid, 'banned', list);
}

function removeBan(jid, userJid) {
  return groups.setSetting(jid, 'banned', bannedList(jid).filter((x) => x !== userJid));
}

function isBanned(jid, userJid) {
  return bannedList(jid).includes(userJid);
}

module.exports = {
  getParticipants,
  resolveTarget,
  requireGroupAdmin,
  bannedList,
  addBan,
  removeBan,
  isBanned,
};
