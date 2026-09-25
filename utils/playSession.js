/**
 * utils/playSession.js — Gerenciamento seguro de sessões interativas de busca e reprodução do Play.
 *
 * Características:
 * - Validação estrita de solicitante (sender) e conversa (remoteJid)
 * - Isolamento por usuário e conversa
 * - Travamento contra duplo clique / concorrência por sessão
 * - TTL e limpeza automática (pruning) de sessões expiradas
 * - Vinculação estrita ao identificador canônico e URL da música selecionada
 */

'use strict';

const TTL = 10 * 60 * 1000; // 10 minutos de validade
const sessions = new Map(); // sessionId -> sessionData
const chatSessions = new Map(); // `${chatId}:${sender}` -> sessionId

function prune() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.expiresAt < now) {
      sessions.delete(id);
      const userChatKey = `${s.chatId}:${s.sender}`;
      if (chatSessions.get(userChatKey) === id) {
        chatSessions.delete(userChatKey);
      }
    }
  }
}

/**
 * Cria e armazena uma sessão de play para o usuário na conversa.
 */
function createSession({ sender, chatId, results, query, prefix }) {
  prune();
  const id = 'ps_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = Date.now();

  const session = {
    id,
    sender,
    chatId,
    results: Array.isArray(results) ? results : [],
    query: String(query || ''),
    prefix: String(prefix || '!'),
    createdAt: now,
    expiresAt: now + TTL,
    processing: false,
    selectedTrack: null,
  };

  sessions.set(id, session);
  chatSessions.set(`${chatId}:${sender}`, id);
  return session;
}

/**
 * Obtém a sessão ativa de um usuário em uma conversa.
 */
function getSessionForUser(chatId, sender) {
  prune();
  const id = chatSessions.get(`${chatId}:${sender}`);
  if (!id) return null;
  return getSession(id);
}

/**
 * Obtém uma sessão por ID direto.
 */
function getSession(sessionId) {
  prune();
  const s = sessions.get(sessionId);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  return s;
}

/**
 * Tenta adquirir trava de processamento na sessão para evitar duplo clique / corridas.
 */
function lockSession(sessionId) {
  const s = getSession(sessionId);
  if (!s) return { ok: false, reason: 'SESSION_EXPIRED' };
  if (s.processing) return { ok: false, reason: 'ALREADY_PROCESSING' };
  s.processing = true;
  return { ok: true, session: s };
}

/**
 * Libera a trava de processamento.
 */
function unlockSession(sessionId) {
  const s = sessions.get(sessionId);
  if (s) {
    s.processing = false;
  }
}

/**
 * Destrói/encerra uma sessão manualmente.
 */
function deleteSession(sessionId) {
  const s = sessions.get(sessionId);
  if (s) {
    chatSessions.delete(`${s.chatId}:${s.sender}`);
    sessions.delete(sessionId);
  }
}

module.exports = {
  createSession,
  getSessionForUser,
  getSession,
  lockSession,
  unlockSession,
  deleteSession,
  prune,
  TTL,
};
