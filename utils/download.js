/**
 * utils/download.js — download seguro e OTIMIZADO para arquivos temporários.
 *
 * Melhorias de velocidade e qualidade:
 * - Retry com backoff exponencial
 * - Streaming com highWaterMark 1MB (mais rápido)
 * - Headers otimizados (keep-alive, accept-encoding)
 * - User-agent moderno
 * - Detecção de tamanho antes de baixar
 * - Limpeza automática
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const CONFIG = require('../config');
const logger = require('./logger').child('download');
const { sanitize } = require('./formatter');

function ensureTmp() {
  fs.mkdirSync(CONFIG.paths.tmpDir, { recursive: true });
  fs.mkdirSync(path.join(CONFIG.paths.tmpDir, 'cache'), { recursive: true });
}

function cacheKey(url) {
  const crypto = require('crypto');
  return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 16);
}

function getCachedBuffer(url, maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    const key = cacheKey(url);
    const fp = path.join(CONFIG.paths.tmpDir, 'cache', key);
    if (!fs.existsSync(fp)) return null;
    const stat = fs.statSync(fp);
    if (Date.now() - stat.mtimeMs > maxAgeMs) {
      try { fs.unlinkSync(fp); } catch (_) {}
      return null;
    }
    return fs.readFileSync(fp);
  } catch (_) {
    return null;
  }
}

function setCachedBuffer(url, buf) {
  try {
    const key = cacheKey(url);
    const fp = path.join(CONFIG.paths.tmpDir, 'cache', key);
    fs.writeFileSync(fp, buf);
  } catch (_) {}
}

function safeFileName(suggested, ext) {
  let base = sanitize(String(suggested || 'arquivo'))
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60);
  if (!base) base = 'arquivo';
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const e = (ext || '').replace(/[^a-z0-9]/gi, '').slice(0, 5);
  return `${base}_${stamp}${e ? '.' + e : ''}`;
}

/**
 * Baixa uma URL para um arquivo temporário com retry e alta velocidade.
 */
async function downloadToFile(url, opts = {}) {
  ensureTmp();
  const maxBytes = opts.maxBytes || CONFIG.limits.maxDownloadMB * 1024 * 1024;
  const timeoutMs = opts.timeoutMs || 60000;
  const retries = opts.retries !== undefined ? opts.retries : (CONFIG.downloader && CONFIG.downloader.downloadRetries) || 3;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers = Object.assign(
      {
        'user-agent':
          'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36',
        accept: '*/*',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
      opts.headers || {}
    );

    try {
      const res = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const declared = Number(res.headers.get('content-length')) || 0;
      if (declared > maxBytes) {
        throw new Error('FILE_TOO_BIG');
      }

      const dest = path.join(CONFIG.paths.tmpDir, safeFileName(opts.name, opts.ext));
      const file = fs.createWriteStream(dest, { flags: 'wx', highWaterMark: 1024 * 1024 });
      let received = 0;
      let tooBig = false;

      const webStream = res.body;
      const nodeStream = Readable.fromWeb(webStream);
      nodeStream.on('data', chunk => {
        received += chunk.length;
        if (received > maxBytes) {
          tooBig = true;
          controller.abort();
        }
      });

      try {
        await pipeline(nodeStream, file);
      } catch (err) {
        if (tooBig) throw new Error('FILE_TOO_BIG');
        throw err;
      }

      if (tooBig) {
        try { fs.unlinkSync(dest); } catch (_) {}
        throw new Error('FILE_TOO_BIG');
      }
      if (received === 0) {
        try { fs.unlinkSync(dest); } catch (_) {}
        throw new Error('EMPTY_FILE');
      }

      return {
        path: dest,
        size: received,
        contentType: res.headers.get('content-type') || '',
      };
    } catch (err) {
      lastErr = err;
      // não retry para erros definitivos
      if (err.message === 'FILE_TOO_BIG' || err.message === 'EMPTY_FILE') throw err;
      if (attempt < retries) {
        const delay = 1000 * Math.pow(1.5, attempt);
        logger.warn({ attempt, delay, err: err.message }, 'download falhou, tentando novamente');
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function downloadToBuffer(url, opts = {}) {
  const maxBytes = opts.maxBytes || 10 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs || 30000;
  const retries = opts.retries !== undefined ? opts.retries : 2;
  const useCache = opts.cache !== false; // cache por padrão

  if (useCache) {
    const cached = getCachedBuffer(url, opts.cacheTtlMs || 24 * 60 * 60 * 1000);
    if (cached) {
      logger.info({ url: String(url).slice(0, 80), bytes: cached.length }, 'cache hit downloadToBuffer');
      return cached;
    }
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: Object.assign(
          {
            'user-agent':
              'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
            accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            'accept-encoding': 'gzip, deflate, br',
          },
          opts.headers || {}
        ),
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new Error('FILE_TOO_BIG');
      if (buf.length === 0) throw new Error('EMPTY_FILE');
      if (useCache) setCachedBuffer(url, buf);
      return buf;
    } catch (err) {
      lastErr = err;
      if (err.message === 'FILE_TOO_BIG') throw err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function cleanupTmp(maxAgeMs = 30 * 60 * 1000) {
  try {
    ensureTmp();
    const now = Date.now();
    let removed = 0;
    const cleanDir = (dir, age) => {
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (f === '.gitkeep') continue;
          const p = path.join(dir, f);
          try {
            const st = fs.statSync(p);
            if (st.isDirectory()) {
              cleanDir(p, age);
              // remove diretório vazio
              if (fs.readdirSync(p).length === 0) {
                try { fs.rmdirSync(p); } catch (_) {}
              }
            } else if (now - st.mtimeMs > age) {
              fs.unlinkSync(p);
              removed++;
            }
          } catch (_) {}
        }
      } catch (_) {}
    };
    cleanDir(CONFIG.paths.tmpDir, maxAgeMs);
    // cache tem TTL maior (24h)
    cleanDir(path.join(CONFIG.paths.tmpDir, 'cache'), 24 * 60 * 60 * 1000);
    if (removed > 0) logger.info({ removed }, 'tmp limpo');
    return removed;
  } catch (err) {
    logger.warn({ err: err.message }, 'falha ao limpar tmp');
    return 0;
  }
}

function deleteFile(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {}
}

module.exports = { downloadToFile, downloadToBuffer, cleanupTmp, deleteFile, safeFileName };
