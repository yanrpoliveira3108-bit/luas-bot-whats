/**
 * utils/tmpCleaner.js — ciclo de vida de arquivos temporários (item 50).
 *
 * Regra: create → use → cleanup, sempre em try/finally. Arquivos órfãos
 * (download interrompido, conversão abortada, processo morto) são varridos no
 * boot e periodicamente — nada de tmp/ acumulando.
 */

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const CONFIG = require('../config');
const logger = require('./logger').child('tmp');

const TMP_DIR = (CONFIG.paths && (CONFIG.paths.tmpDir || CONFIG.paths.tmp)) || path.join(process.cwd(), 'tmp');
const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h

/** Arquivos temporários ativos (path -> { since, label }). */
const active = new Map();

/** Padrões de lixo gerado por ytdl/ffmpeg/cards na raiz do projeto. */
const ROOT_JUNK = [
  /^card-.*\.(jpg|jpeg|png)$/i,
  /^preview-.*\.(jpg|jpeg|png)$/i,
  /^welcome-preview\.(jpg|png)$/i,
  /^tigrinho-preview\.html$/i,
  /.*-player-script\.js$/i,
  /^1788.*\.js$/,
  /\.tmp$/,
  /\.temp$/,
];

/** Garante que o diretório temporário existe. */
function ensureDir(dir = TMP_DIR) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    /* melhor esforço */
  }
  return dir;
}

/** Cria um caminho temporário único e o marca como ativo. */
function allocate(prefix = 'lua', ext = '', dir = TMP_DIR) {
  ensureDir(dir);
  const name = `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${ext ? (ext.startsWith('.') ? ext : `.${ext}`) : ''}`;
  const full = path.join(dir, name);
  active.set(full, { since: Date.now(), label: prefix });
  return full;
}

/** Libera/remove um temporário (idempotente). */
async function release(file) {
  if (!file) return false;
  active.delete(file);
  try {
    await fsp.rm(file, { force: true });
    return true;
  } catch (err) {
    logger.warn({ err: err.message, file }, 'falha ao remover temporário');
    return false;
  }
}

/**
 * Executa `fn(filePath)` com cleanup garantido (try/finally).
 * @param {object} opts { prefix, ext, dir, keep }
 * @param {Function} fn recebe o caminho
 */
async function withTempFile(opts, fn) {
  const options = typeof opts === 'function' ? {} : opts || {};
  const task = typeof opts === 'function' ? opts : fn;
  const file = allocate(options.prefix || 'lua', options.ext || '', options.dir || TMP_DIR);
  try {
    return await task(file);
  } finally {
    if (!options.keep) await release(file);
    else active.delete(file);
  }
}

/**
 * Varre órfãos: tmp/ antigo + lixo na raiz (cards, player scripts, previews).
 * @param {object} [opts] { maxAgeMs, root }
 * @returns {Promise<{removed: number, freedBytes: number, errors: number}>}
 */
async function sweepOrphans(opts = {}) {
  const maxAge = opts.maxAgeMs || DEFAULT_MAX_AGE_MS;
  const root = opts.root || process.cwd();
  const cutoff = Date.now() - maxAge;
  const result = { removed: 0, freedBytes: 0, errors: 0 };

  const consider = async (file) => {
    try {
      const st = await fsp.stat(file);
      if (!st.isFile()) return;
      if (active.has(file)) return; // em uso agora
      if (st.mtimeMs > cutoff) return; // recente demais
      result.freedBytes += st.size;
      await fsp.rm(file, { force: true });
      result.removed++;
    } catch (_) {
      result.errors++;
    }
  };

  // 1) tmp/ (exceto .gitkeep)
  try {
    const entries = await fsp.readdir(TMP_DIR);
    for (const e of entries) {
      if (e === '.gitkeep') continue;
      await consider(path.join(TMP_DIR, e));
    }
  } catch (_) {
    /* tmp/ pode não existir ainda */
  }

  // 2) lixo na raiz
  try {
    const entries = await fsp.readdir(root);
    for (const e of entries) {
      if (!ROOT_JUNK.some((re) => re.test(e))) continue;
      await consider(path.join(root, e));
    }
  } catch (_) {
    /* ignora */
  }

  if (result.removed) {
    logger.info({ removed: result.removed, freedKB: Math.round(result.freedBytes / 1024) }, 'temporários órfãos removidos');
  }
  return result;
}

/** Lista os temporários ativos (debug/!status). */
function list() {
  return [...active.entries()].map(([file, meta]) => ({ file, label: meta.label, ageMs: Date.now() - meta.since }));
}

/** Remove temporários órfãos que passaram muito tempo ativos (vazamento). */
async function sweepActive(maxAgeMs = 30 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [file, meta] of [...active]) {
    if (meta.since < cutoff) {
      await release(file);
      removed++;
    }
  }
  return removed;
}

module.exports = { allocate, release, withTempFile, sweepOrphans, sweepActive, list, ensureDir, TMP_DIR, ROOT_JUNK };
