/**
 * utils/perf.js — métricas internas do Lua (leves, sem timers).
 *
 * Contadores incrementais para diagnóstico e o comando !debug. Não expõe
 * nada a usuários comuns; só quem usa é o próprio bot. Custo por chamada é
 * O(1) e desprezível.
 *
 * Métricas: mensagens processadas, comandos executados, erros, downloads,
 * cache hits/misses, tempo médio de resposta e média de latência.
 */

'use strict';

const counters = new Map(); // key -> number
const latency = { sum: 0, n: 0 };
let enabled = true;

function setEnabled(v) {
  enabled = !!v;
}

function add(key, n = 1) {
  if (!enabled) return;
  counters.set(key, (counters.get(key) || 0) + n);
}

function count(key, n = 1) {
  return add(key, n);
}

/** Registra um tempo de resposta (ms). */
function timing(key, ms) {
  if (!enabled) return;
  const k = `time:${key}`;
  const entry = counters.get(k) || { sum: 0, n: 0 };
  entry.sum += Number(ms) || 0;
  entry.n += 1;
  counters.set(k, entry);
}

/** Latência média de resposta a comandos (ms). */
function avg(key) {
  const entry = counters.get(`time:${key}`);
  if (!entry || !entry.n) return 0;
  return Math.round(entry.sum / entry.n);
}

function get(key) {
  return counters.get(key) || 0;
}

/** Snapshot das métricas (para !debug / painel). */
function snapshot() {
  return {
    enabled,
    messages: get('messages'),
    commands: get('commands'),
    errors: get('errors'),
    downloads: get('downloads'),
    cacheHits: get('cache:hits'),
    cacheMisses: get('cache:misses'),
    avgResponseMs: avg('command'),
    pingMs: avg('ping'),
    groups: get('groups'),
  };
}

/** Zera todos os contadores. */
function reset() {
  counters.clear();
}

module.exports = {
  setEnabled,
  add,
  count,
  timing,
  avg,
  get,
  snapshot,
  reset,
};
