/**
 * utils/download.js — download seguro de URLs para arquivos temporários.
 *
 * - limite de tamanho
 * - timeout (AbortController)
 * - nomes seguros (anti path traversal)
 * - limpeza de temporários
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const CONFIG = require('../config');
const logger = require('./logger').child('download');
const { sanitize } = require('./formatter');

const HTTP = CONFIG.http = CONFIG.http || {};

function ensureTmp() {
  fs.mkdirSync(CONFIG.paths.tmpDir, { recursive: true });
}

/** Gera um nome de arquivo seguro a partir de uma sugestão. */
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
 * Baixa uma URL para um arquivo temporário.
 * @param {string} url
 * @param {object} opts { ext, maxBytes, timeoutMs, headers, userAgent }
 * @returns {Promise<{path:string, size:number, contentType:string}>}
 */
async function downloadToFile(url, opts = {}) {
  ensureTmp();
  const maxBytes = (opts.maxBytes || CONFIG.limits.maxDownloadMB * 1024 * 1024);
  const timeoutMs = opts.timeoutMs || 60000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = Object.assign(
    {
      'user-agent':
        'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
      accept: '*/*',
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
    const file = fs.createWriteStream(dest, { flags: 'wx' });
    let received = 0;
    let tooBig = false;

    const webStream = res.body;
    const nodeStream = Readable.fromWeb(webStream);
    nodeStream.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        tooBig = true;
        controller.abort();
      }
    });

    try {
      await pipeline(nodeStream, file);
    } catch (err) {
      if (tooBig) {
        throw new Error('FILE_TOO_BIG');
      }
      throw err;
    }

    if (tooBig) {
      fs.unlinkSync(dest);
      throw new Error('FILE_TOO_BIG');
    }
    if (received === 0) {
      fs.unlinkSync(dest);
      throw new Error('EMPTY_FILE');
    }

    return {
      path: dest,
      size: received,
      contentType: res.headers.get('content-type') || '',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Baixa um Buffer (para mídias pequenas, ex.: thumbnails).
 * @param {string} url
 * @param {object} opts { maxBytes, timeoutMs, headers }
 */
async function downloadToBuffer(url, opts = {}) {
  const maxBytes = opts.maxBytes || 10 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs || 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: Object.assign(
        {
          'user-agent':
            'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
        },
        opts.headers || {}
      ),
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('FILE_TOO_BIG');
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

/** Remove arquivos temporários mais antigos que `maxAgeMs`. */
function cleanupTmp(maxAgeMs = 30 * 60 * 1000) {
  try {
    ensureTmp();
    const now = Date.now();
    const files = fs.readdirSync(CONFIG.paths.tmpDir);
    let removed = 0;
    for (const f of files) {
      if (f === '.gitkeep') continue;
      const p = path.join(CONFIG.paths.tmpDir, f);
      try {
        const st = fs.statSync(p);
        if (now - st.mtimeMs > maxAgeMs) {
          fs.unlinkSync(p);
          removed++;
        }
      } catch (_) {
        /* ignora */
      }
    }
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
  } catch (_) {
    /* ignora */
  }
}

module.exports = { downloadToFile, downloadToBuffer, cleanupTmp, deleteFile, safeFileName };
