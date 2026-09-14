/**
 * downloaders/router.js — roteador genérico de downloads (!download <link>).
 *
 * Detecta a plataforma pela URL e encaminha ao provedor certo. Nenhum
 * provedor derruba o processo: erros viram exceções amigáveis (code).
 */

'use strict';

function platformOf(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('facebook.com') || u.includes('fb.watch')) return 'facebook';
  if (u.includes('pinterest.com') || u.includes('pin.it')) return 'pinterest';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  if (u.includes('reddit.com') || u.includes('redd.it')) return 'reddit';
  return null;
}

/**
 * Baixa a mídia de uma URL qualquer.
 * @returns {{ path, title, mimetype, isVideo, platform }}
 */
async function download(url, suggestedName) {
  const platform = platformOf(url);
  if (!platform) {
    const e = new Error('Plataforma não suportada.');
    e.code = 'INVALID_URL';
    throw e;
  }
  const provider = require('./' + platform);
  const result = await provider.download(url, suggestedName);
  return { ...result, platform };
}

module.exports = { download, platformOf };
