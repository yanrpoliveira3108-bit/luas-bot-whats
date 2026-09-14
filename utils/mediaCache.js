'use strict';

/**
 * utils/mediaCache.js — cache de mídias baixadas (YouTube, TikTok, etc)
 *
 * Evita baixar o mesmo link várias vezes em sequência.
 * - Chave: hash da URL
 * - TTL padrão: 1h para vídeo, 24h para áudio/imagem
 * - Limite de tamanho total: 500MB (configurável)
 * - LRU: remove arquivos mais antigos quando estoura limite
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CONFIG = require('../config');
const logger = require('./logger').child('mediaCache');

const CACHE_DIR = path.join(CONFIG.paths.tmpDir, 'media-cache');
const META_FILE = path.join(CACHE_DIR, 'meta.json');
const MAX_TOTAL_MB = 500;
const MAX_TOTAL_BYTES = MAX_TOTAL_MB * 1024 * 1024;

function ensureDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function hashUrl(url) {
  return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 20);
}

function loadMeta() {
  try {
    if (!fs.existsSync(META_FILE)) return {};
    return JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
  } catch (_) {
    return {};
  }
}

function saveMeta(meta) {
  try {
    ensureDir();
    fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
  } catch (_) {}
}

function getCachePath(url, ext = 'mp4') {
  const h = hashUrl(url);
  const safeExt = String(ext || 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'mp4';
  return path.join(CACHE_DIR, `${h}.${safeExt}`);
}

function getCached(url) {
  try {
    ensureDir();
    const meta = loadMeta();
    const h = hashUrl(url);
    const entry = meta[h];
    if (!entry) return null;
    const fp = entry.path || getCachePath(url, entry.ext);
    if (!fs.existsSync(fp)) {
      delete meta[h];
      saveMeta(meta);
      return null;
    }
    const age = Date.now() - (entry.ts || 0);
    const ttl = entry.ttl || 60 * 60 * 1000;
    if (age > ttl) {
      try { fs.unlinkSync(fp); } catch (_) {}
      delete meta[h];
      saveMeta(meta);
      return null;
    }
    // atualiza acesso para LRU
    entry.lastAccess = Date.now();
    saveMeta(meta);
    return { path: fp, meta: entry };
  } catch (_) {
    return null;
  }
}

function setCached(url, filePath, opts = {}) {
  try {
    ensureDir();
    const ext = opts.ext || path.extname(filePath).replace('.', '') || 'mp4';
    const dest = getCachePath(url, ext);
    // copia arquivo para cache
    fs.copyFileSync(filePath, dest);
    const meta = loadMeta();
    const h = hashUrl(url);
    meta[h] = {
      path: dest,
      url,
      ext,
      ts: Date.now(),
      lastAccess: Date.now(),
      ttl: opts.ttl || 60 * 60 * 1000,
      size: fs.statSync(dest).size,
      title: opts.title || '',
    };
    saveMeta(meta);
    // verifica limite total
    enforceLimit();
    return dest;
  } catch (err) {
    logger.warn({ err: err.message }, 'falha ao cachear mídia');
    return null;
  }
}

function enforceLimit() {
  try {
    const meta = loadMeta();
    let total = 0;
    const entries = Object.entries(meta).map(([k, v]) => ({ key: k, ...v }));
    for (const e of entries) total += e.size || 0;

    if (total <= MAX_TOTAL_BYTES) return;

    // ordena por último acesso (LRU) — mais antigo primeiro
    entries.sort((a, b) => (a.lastAccess || 0) - (b.lastAccess || 0));

    for (const e of entries) {
      if (total <= MAX_TOTAL_BYTES) break;
      try {
        if (fs.existsSync(e.path)) fs.unlinkSync(e.path);
      } catch (_) {}
      total -= e.size || 0;
      delete meta[e.key];
    }
    saveMeta(meta);
    logger.info({ totalMB: (total / 1024 / 1024).toFixed(1) }, 'cache media limpo (LRU)');
  } catch (_) {}
}

function clearCache() {
  try {
    const meta = loadMeta();
    for (const entry of Object.values(meta)) {
      try { if (fs.existsSync(entry.path)) fs.unlinkSync(entry.path); } catch (_) {}
    }
    saveMeta({});
    // remove arquivos órfãos
    if (fs.existsSync(CACHE_DIR)) {
      for (const f of fs.readdirSync(CACHE_DIR)) {
        if (f === 'meta.json') continue;
        try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch (_) {}
      }
    }
    return true;
  } catch (_) {
    return false;
  }
}

function stats() {
  try {
    const meta = loadMeta();
    let total = 0;
    let count = 0;
    for (const e of Object.values(meta)) {
      total += e.size || 0;
      count++;
    }
    return { count, totalBytes: total, totalMB: (total / 1024 / 1024).toFixed(1) };
  } catch (_) {
    return { count: 0, totalBytes: 0, totalMB: '0' };
  }
}

module.exports = {
  getCached,
  setCached,
  getCachePath,
  clearCache,
  stats,
  CACHE_DIR,
};
