/**
 * plugins/welcome/profile.js — foto de perfil com cache + avatar padrão.
 *
 * Tenta sock.profilePictureUrl(jid, "image") (API do Baileys instalado) e
 * baixa o buffer. Em qualquer falha, usa o avatar padrão do LUA BOT — a card
 * NUNCA quebra por falta de foto.
 */

'use strict';

const { downloadToBuffer } = require('../../utils/download');
const templates = require('./templates');
const CONFIG = require('./config');

const cache = new Map(); // jid -> { buf, ts }

function prune() {
  const now = Date.now();
  const ttl = CONFIG.cache.photoTtlMs;
  for (const [k, v] of cache) {
    if (now - v.ts > ttl) cache.delete(k);
  }
}

/** Buffer da foto (ou avatar padrão). Cache TTL. */
async function getPhoto(sock, jid) {
  const hit = cache.get(jid);
  if (hit && Date.now() - hit.ts < CONFIG.cache.photoTtlMs) return hit.buf;

  let buf = null;
  try {
    const url = await sock.profilePictureUrl(jid, 'image');
    if (url) buf = await downloadToBuffer(url, { maxBytes: 4 * 1024 * 1024 });
  } catch (_) {
    buf = null;
  }

  if (!buf) buf = await templates.ensureAvatar();

  cache.set(jid, { buf, ts: Date.now() });
  if (cache.size > 300) prune();
  return buf;
}

module.exports = { getPhoto };
