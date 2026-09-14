/**
 * utils/permissions.js — checagens de permissão padronizadas.
 *
 * isOwner() / isAdmin() / isBotAdmin() / isGroup() / isPrivate() / isRegistered()
 */

'use strict';

const CONFIG = require('../config');
const { isOwnerNumber } = CONFIG.helpers;

/** O remetente é o dono do bot? */
function isOwner(jid) {
  return isOwnerNumber(jid);
}

/** Qualquer remetente válido é, no mínimo, um USER. */
function isUser(jid) {
  return Boolean(jid);
}

/**
 * Nível de acesso do remetente dentro do contexto atual.
 * @returns {'owner'|'admin'|'user'}
 */
function getRole(ctx) {
  if (!ctx || !ctx.sender) return 'user';
  if (isOwner(ctx.sender)) return 'owner';
  if (ctx.isGroup && ctx.isAdmin) return 'admin';
  return 'user';
}

/** Verifica se um JID está na lista de admins (participants já resolvidos). */
function isAdmin(participants, jid) {
  if (!jid) return false;
  const p = (participants || []).find((x) => x.id === jid);
  return !!(p && (p.admin === 'admin' || p.admin === 'superadmin'));
}

/** O bot é admin no grupo? (participants resolvidos + id do bot) */
function isBotAdmin(participants, botJid) {
  if (!botJid) return false;
  return isAdmin(participants, botJid);
}

function isGroup(jid) {
  return String(jid || '').endsWith('@g.us');
}

function isPrivate(jid) {
  return !isGroup(jid);
}

/** O usuário está registrado no banco? (users.is_registered) */
function isRegistered(usersDb, jid) {
  if (!jid || !usersDb) return false;
  const u = usersDb.get(jid);
  return !!(u && u.is_registered);
}

/** O usuário está bloqueado? */
function isBlocked(blockedDb, jid) {
  if (!jid || !blockedDb) return false;
  return !!blockedDb.get(jid);
}

module.exports = {
  isOwner,
  isAdmin,
  isBotAdmin,
  isGroup,
  isPrivate,
  isRegistered,
  isBlocked,
  isUser,
  getRole,
};
