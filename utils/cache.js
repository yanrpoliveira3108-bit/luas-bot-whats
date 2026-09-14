/**
 * utils/cache.js — cache em memória com TTL.
 *
 * Usado para metadados de grupo, foto de perfil, configurações e
 * resultados de download recentes. Nunca guarda dados para sempre.
 */

'use strict';

class TtlCache {
  constructor(defaultTtlMs = 30000, maxEntries = 500) {
    this.defaultTtl = defaultTtlMs;
    this.maxEntries = maxEntries;
    this.store = new Map(); // key -> { value, expiresAt }
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.countMiss();
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.countMiss();
      return undefined;
    }
    // refresh (LRU leve)
    this.store.delete(key);
    this.store.set(key, entry);
    this.countHit();
    return entry.value;
  }

  // contadores de hit/miss (utils/perf) — custo desprezível
  countHit() {
    try {
      require('./perf').add('cache:hits');
    } catch (_) { /* sem perf, sem problema */ }
  }

  countMiss() {
    try {
      require('./perf').add('cache:misses');
    } catch (_) { /* sem perf, sem problema */ }
  }

  set(key, value, ttlMs = this.defaultTtl) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

// cache global (metadados de grupo, fotos, etc.)
const cache = new TtlCache(30000, 500);

module.exports = { TtlCache, cache };
