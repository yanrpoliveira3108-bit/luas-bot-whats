/**
 * utils/media.js — helpers de mídia do Baileys.
 *
 * - baixa mídia recebida (cifrada) para Buffer
 * - envia imagem/vídeo/áudio/sticker/documento com checagem de tamanho
 * - limites e tratamento de erro
 */

'use strict';

const fs = require('fs');
const CONFIG = require('../config');
const logger = require('./logger').child('media');
const { deleteFile } = require('./download');

/** Baixa a mídia de uma mensagem (ou mensagem citada) para um Buffer. */
async function downloadMediaBuffer(sock, msgOrMessage, type) {
  let m = msgOrMessage && msgOrMessage.message ? msgOrMessage.message : msgOrMessage;
  // visualização única: a mídia fica em viewOnceMessage(V2).message
  const { unwrapViewOnce } = require('./messages');
  m = unwrapViewOnce(m) || m;
  const media = m && (m.imageMessage || m.videoMessage || m.audioMessage || m.stickerMessage || m.documentMessage);
  if (!media) return null;
  if (type && !m[`${type}Message`]) return null;

  const maxBytes = CONFIG.limits.maxUploadMB * 1024 * 1024;
  try {
    const stream = await downloadContentFromMessage(media, type || detectContentType(m));
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > maxBytes) {
        throw new Error('FILE_TOO_BIG');
      }
    }
    if (buffer.length === 0) return null;
    return buffer;
  } catch (err) {
    logger.warn({ err: err.message }, 'falha ao baixar mídia');
    return null;
  }
}

function detectContentType(m) {
  if (m.imageMessage) return 'image';
  if (m.videoMessage) return 'video';
  if (m.audioMessage) return 'audio';
  if (m.stickerMessage) return 'sticker';
  if (m.documentMessage) return 'document';
  return null;
}
/** Wrapper do downloadContentFromMessage do Baileys (evita import em todo lugar). */
function downloadContentFromMessage(media, type) {
  const { downloadContentFromMessage } = require('@lucasmod/boruto-vk7-baileys');
  return downloadContentFromMessage(media, type);
}

/**
 * Normaliza a entrada de mídia para o formato que o Baileys 7.4.7 aceita.
 *
 * IMPORTANTE: o Baileys NÃO aceita caminho de arquivo como string pura
 * (lança "Cannot use 'in' operator..." em getStream). Um caminho local deve
 * vir como { url: '/caminho' } — o Baileys então lê o arquivo do disco.
 * Buffer passa direto.
 */
function asMedia(bufferOrPath) {
  if (typeof bufferOrPath === 'string') return { url: bufferOrPath };
  return bufferOrPath;
}

/** Envia imagem a partir de Buffer/caminho. */
async function sendImage(sock, jid, bufferOrPath, caption = '', opts = {}) {
  return sock.sendMessage(
    jid,
    {
      image: asMedia(bufferOrPath),
      caption: caption || undefined,
      mimetype: opts.mimetype || 'image/jpeg',
      ...(opts.mentions && opts.mentions.length ? { mentions: opts.mentions } : {}),
    },
    { quoted: opts.quoted }
  );
}

/** Envia vídeo a partir de Buffer/caminho. */
async function sendVideo(sock, jid, bufferOrPath, caption = '', opts = {}) {
  return sock.sendMessage(
    jid,
    {
      video: asMedia(bufferOrPath),
      caption: caption || undefined,
      mimetype: opts.mimetype || 'video/mp4',
      gifPlayback: !!opts.gifPlayback,
    },
    { quoted: opts.quoted }
  );
}

/** Envia áudio a partir de Buffer/caminho. */
async function sendAudio(sock, jid, bufferOrPath, opts = {}) {
  return sock.sendMessage(
    jid,
    {
      audio: asMedia(bufferOrPath),
      mimetype: opts.mimetype || 'audio/mpeg',
      ptt: !!opts.ptt,
    },
    { quoted: opts.quoted }
  );
}

/** Envia sticker (webp) a partir de Buffer/caminho. */
async function sendSticker(sock, jid, bufferOrPath, opts = {}) {
  const media = asMedia(bufferOrPath);
  // backstop: nunca enviar sticker vazio ou com assinatura errada
  if (Buffer.isBuffer(media)) {
    if (media.length === 0) {
      const e = new Error('EMPTY_STICKER_BUFFER');
      e.code = 'EMPTY_STICKER_BUFFER';
      throw e;
    }
    const isWebp = media.length > 12 && media.toString('ascii', 0, 4) === 'RIFF' && media.toString('ascii', 8, 12) === 'WEBP';
    if (!isWebp) {
      const e = new Error('INVALID_STICKER_BUFFER (não é WebP)');
      e.code = 'INVALID_STICKER_BUFFER';
      throw e;
    }
  }
  return sock.sendMessage(
    jid,
    {
      sticker: media,
      mimetype: 'image/webp',
    },
    { quoted: opts.quoted }
  );
}

/** Envia documento a partir de Buffer/caminho. */
async function sendDocument(sock, jid, bufferOrPath, opts = {}) {
  const isPath = typeof bufferOrPath === 'string';
  return sock.sendMessage(
    jid,
    {
      document: isPath ? { url: bufferOrPath } : bufferOrPath,
      mimetype: opts.mimetype || 'application/octet-stream',
      fileName: opts.fileName || 'arquivo',
      caption: opts.caption || undefined,
    },
    { quoted: opts.quoted }
  );
}

/** Envia arquivo do disco (caminho) e depois o remove, se pedido. */
async function sendFileAndClean(sock, jid, filePath, senderFn, clean = true) {
  try {
    const res = await senderFn(filePath);
    return res;
  } finally {
    if (clean) deleteFile(filePath);
  }
}

function fileSizeMB(p) {
  try {
    return fs.statSync(p).size / (1024 * 1024);
  } catch (_) {
    return 0;
  }
}

module.exports = {
  downloadMediaBuffer,
  downloadContentFromMessage,
  detectContentType,
  asMedia,
  sendImage,
  sendVideo,
  sendAudio,
  sendSticker,
  sendDocument,
  sendFileAndClean,
  fileSizeMB,
};
