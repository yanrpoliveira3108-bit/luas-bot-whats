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

/** Verifica se um JID está na lista de admins (participants já resolvidos).
 *
 * LID vs PN: em grupos no modo LID, o remetente chega como `...@lid` enquanto
 * o participant traz `id` (PN), `lid` (LID) e/ou `phoneNumber` (PN). Comparamos
 * TODAS as formas de identidade, normalizadas, para nunca dar "não é admin"
 * para quem é admin.
 */
function jidKeys(jid) {
  const keys = new Set();
  const s = String(jid || '').trim();
  if (!s) return keys;
  keys.add(s);
  const bare = s.split(':')[0]; // remove ':device'
  keys.add(bare);
  const digits = bare.split('@')[0].replace(/\D/g, '');
  if (digits) keys.add(digits);
  return keys;
}

function isLidJid(jid) {
  return /@lid$/.test(String(jid || ''));
}

/** Prefere o PN entre duas formas do mesmo remetente (participant vs alt). */
function preferPn(a, b) {
  const A = String(a || '');
  const B = String(b || '');
  if (!A) return B;
  if (!B) return A;
  if (isLidJid(A) && !isLidJid(B)) return B;
  return A;
}

function isAdmin(participants, jid) {
  const ids = Array.isArray(jid) ? jid : [jid];
  const keys = new Set();
  for (const id of ids) for (const k of jidKeys(id)) keys.add(k);
  if (!keys.size) return false;
  const p = (participants || []).find((x) =>
    [x.id, x.lid, x.phoneNumber].some((v) => v && [...jidKeys(v)].some((k) => keys.has(k)))
  );
  return !!(p && (p.admin === 'admin' || p.admin === 'superadmin'));
}

/** O bot é admin no grupo? (participants resolvidos + id do bot) */
function isBotAdmin(participants, botJid) {
  if (!botJid) return false;
  return isAdmin(participants, botJid);
}

/**
 * Converte um JID LID (ex.: 111111111@lid) para o PN correspondente,
 * usando a lista de participantes do grupo (id = PN, lid = LID).
 * Devolve o mesmo JID quando já é PN ou quando não encontra.
 */
function toPn(jid, participants) {
  const j = String(jid || '').trim();
  if (!j || !j.endsWith('@lid')) return j;
  const keys = jidKeys(j);
  for (const p of participants || []) {
    const lid = String(p.lid || '');
    if (lid && [...jidKeys(lid)].some((k) => keys.has(k))) {
      let pn = (p.id && !String(p.id).endsWith('@lid') && p.id) || p.phoneNumber;
      if (pn && !String(pn).endsWith('@lid')) {
        pn = String(pn);
        // garante formato completo de JID (alguns nós trazem só dígitos)
        if (!pn.includes('@') && /^\d+$/.test(pn)) pn = `${pn}@s.whatsapp.net`;
        return pn;
      }
    }
  }
  return j;
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
  jidKeys,
  isLidJid,
  preferPn,
  toPn,
};
