/**
 * utils/groupMeta.js — metadados de grupo com cache único.
 *
 * Antes, cada módulo (commandHandler, groupHandler, plugins) chamava
 * `sock.groupMetadata()` por conta própria — várias chamadas de rede para o
 * MESMO grupo na mesma janela de segundos. Aqui existe um só cache (com TTL)
 * e uma só porta de entrada; falhas também são memorizadas por alguns
 * segundos para não martelar a API do WhatsApp.
 */

'use strict';

const cache = require('./cache').cache;
const logger = require('./logger').child('meta');

const DEFAULT_TTL_MS = 30000;
const ERROR_TTL_MS = 10000;

function keyOf(jid) {
  return 'meta:' + jid;
}

/**
 * Metadados do grupo (participantes, admins, nome...).
 * Nunca lança: em caso de erro devolve um objeto vazio seguro.
 */
async function get(sock, jid, ttlMs = DEFAULT_TTL_MS) {
  const key = keyOf(jid);
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const meta = await sock.groupMetadata(jid);
    cache.set(key, meta, ttlMs);
    return meta;
  } catch (err) {
    logger.warn({ err: err.message, grupo: jid }, 'falha ao buscar metadados do grupo');
    const empty = { id: jid, participants: [] };
    cache.set(key, empty, ERROR_TTL_MS);
    return empty;
  }
}

/** Metadados do cache (sem rede) — null se não estiverem memorizados. */
function peek(jid) {
  return cache.get(keyOf(jid)) || null;
}

/** Invalida o cache (mudou participante/admin/nome). */
function invalidate(jid) {
  cache.delete(keyOf(jid));
}

module.exports = { get, peek, invalidate, DEFAULT_TTL_MS, ERROR_TTL_MS };
