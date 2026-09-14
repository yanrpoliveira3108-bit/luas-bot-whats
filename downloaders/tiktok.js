/**
 * downloaders/tiktok.js — download de vídeos do TikTok.
 *
 * Usa o serviço público tikwm (sem chave de API). É um serviço de terceiros:
 * pode mudar ou ficar indisponível — erros são tratados com resposta amigável.
 */

'use strict';

const CONFIG = require('../config');
const { downloadToFile } = require('../utils/download');

const UA =
  'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

function normalize(u) {
  return u.startsWith('//') ? 'https:' + u : u;
}

/** Obtém metadados + URLs de mídia de um link do TikTok. */
async function fetchData(url) {
  const api = `${CONFIG.external.tikwm}?url=${encodeURIComponent(url)}&hd=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(api, { headers: { 'user-agent': UA }, signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (!json || json.code !== 0 || !json.data) {
      const e = new Error('Sem resultado');
      e.code = 'NO_RESULT';
      throw e;
    }
    const d = json.data;
    return {
      title: d.title || 'Vídeo TikTok',
      videoUrl: normalize(d.play || ''),
      cover: normalize(d.cover || ''),
      author: (d.author && d.author.nickname) || '',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Baixa o vídeo do TikTok para um arquivo temporário. */
async function download(url, suggestedName) {
  const data = await fetchData(url);
  if (!data.videoUrl) {
    const e = new Error('Sem vídeo');
    e.code = 'NO_RESULT';
    throw e;
  }
  const file = await downloadToFile(data.videoUrl, { name: suggestedName || data.title, ext: 'mp4', maxBytes: CONFIG.limits.maxDownloadMB * 1024 * 1024 });
  return { ...file, title: data.title, cover: data.cover, author: data.author, mimetype: 'video/mp4' };
}

module.exports = { fetchData, download };
