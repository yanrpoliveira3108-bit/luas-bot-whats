/**
 * utils/session.js — estado de conversa em memória (para jogos e confirmações).
 *
 * Sessões por (chat, usuário) com TTL. Usado por jogos (adivinhação, jokenpô,
 * batalha, etc.) e por confirmações de comandos perigosos (!eval).
 */

'use strict';

const TTL = 5 * 60 * 1000; // 5 minutos

const sessions = new Map();

function key(chatJid, userJid) {
  return `${chatJid}|${userJid}`;
}

/** Define uma sessão ativa. */
function set(chatJid, userJid, data, ttl = TTL) {
  const k = key(chatJid, userJid);
  const timer = setTimeout(() => sessions.delete(k), ttl);
  const prev = sessions.get(k);
  if (prev && prev.timer) clearTimeout(prev.timer);
  sessions.set(k, { data, timer, expiresAt: Date.now() + ttl });
}

/** Recupera a sessão ativa (sem remover). */
function get(chatJid, userJid) {
  const s = sessions.get(key(chatJid, userJid));
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    clearTimeout(s.timer);
    sessions.delete(key(chatJid, userJid));
    return null;
  }
  return s.data;
}

/** Remove a sessão ativa. */
function clear(chatJid, userJid) {
  const k = key(chatJid, userJid);
  const s = sessions.get(k);
  if (s && s.timer) clearTimeout(s.timer);
  sessions.delete(k);
}

function size() {
  return sessions.size;
}

module.exports = { set, get, clear, size };
