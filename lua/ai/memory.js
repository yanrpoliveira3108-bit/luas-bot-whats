/**
 * ai/memory.js — memória opcional por conversa (IA).
 *
 * - habilitada via .env (AI_MEMORY, padrão true)
 * - mantém apenas as últimas mensagens (rolagem) por chat
 * - expira por inatividade; nunca grava em disco (não armazena dados
 *   desnecessários nem segredos)
 */

'use strict';

const CONFIG = require('../config');

const MAX = CONFIG.ai.maxHistory || 8;
const TTL_MS = 30 * 60 * 1000; // 30 min

let override = null; // null = segue o .env

// chatId -> { updatedAt, lines: [{ role, content }] }
const store = new Map();

function enabled() {
  return override === null ? CONFIG.ai.memory !== false : override;
}

/** Liga/desliga a memória em runtime (não persiste; .env define o padrão). */
function setEnabled(on) {
  override = Boolean(on);
}

function entry(chatId) {
  let e = store.get(chatId);
  if (!e) {
    e = { updatedAt: Date.now(), lines: [] };
    store.set(chatId, e);
  }
  if (Date.now() - e.updatedAt > TTL_MS) {
    e.lines = [];
    e.updatedAt = Date.now();
  }
  return e;
}

/** Adiciona uma fala à memória da conversa (se habilitada). */
function remember(chatId, role, content) {
  if (!enabled()) return;
  const c = String(content || '').trim();
  if (!c) return;
  const e = entry(chatId);
  e.lines.push({ role, content: c.slice(0, 1000) });
  if (e.lines.length > MAX) e.lines = e.lines.slice(-MAX);
  e.updatedAt = Date.now();
}

/** Histórico da conversa (para contexto no provider). */
function history(chatId) {
  if (!enabled()) return [];
  return entry(chatId).lines.slice();
}

function clear(chatId) {
  store.delete(chatId);
}

function size() {
  return store.size;
}

module.exports = { enabled, setEnabled, remember, history, clear, size };
