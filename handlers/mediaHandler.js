/**
 * handlers/mediaHandler.js — helpers de mídia para comandos.
 *
 * Facilita obter mídia da mensagem atual ou da mensagem citada,
 * com validação de tipo e tamanho.
 */

'use strict';

const CONFIG = require('../config');
const mediaUtil = require('../utils/media');
const { detectMediaType } = require('../utils/messages');

/** Tipos de mídia suportados por helper. */
function classify(ctx) {
  const current = detectMediaType(ctx.message);
  if (current) return { type: current, from: 'message' };
  if (ctx.quoted) {
    const qt = detectMediaType({ message: ctx.quoted });
    if (qt) return { type: qt, from: 'quoted' };
  }
  return null;
}

/**
 * Obtém a mídia (imagem/vídeo/áudio/sticker) da mensagem ou da citada.
 * @returns {Promise<{buffer:Buffer, type:string} | null>}
 */
async function getMedia(ctx) {
  const info = classify(ctx);
  if (!info) return null;

  const source = info.from === 'quoted' ? { message: ctx.quoted } : ctx.message;
  const buffer = await mediaUtil.downloadMediaBuffer(ctx.socket, source);
  if (!buffer) return null;

  const maxBytes = CONFIG.limits.maxUploadMB * 1024 * 1024;
  if (buffer.length > maxBytes) {
    const err = new Error('Arquivo muito grande.');
    err.code = 'FILE_TOO_BIG';
    throw err;
  }
  return { buffer, type: info.type };
}

module.exports = { getMedia, classify };
