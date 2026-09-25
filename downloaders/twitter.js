/**
 * downloaders/twitter.js — download de mídia pública do X/Twitter.
 *
 * Usa o serviço público fxtwitter (https://api.fxtwitter.com), sem chave de
 * API. É um serviço de terceiros: pode mudar ou ficar indisponível — erros
 * viram resposta amigável, nunca derrubam o processo.
 */

'use strict';

const CONFIG = require('../config');
const { downloadToFile } = require('../utils/download');
const { erroDeRede, erroHttp, erroSemMidia } = require('../utils/errors');

const UA =
  'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

function canHandle(url) {
  const u = String(url || '').toLowerCase();
  return u.includes('twitter.com') || u.includes('x.com');
}

function parseTweetUrl(url) {
  // ex.: https://x.com/nome/status/1234567890
  const m = String(url).match(/\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
  if (!m) return null;
  return { user: m[1], id: m[2] };
}

async function fetchData(url) {
  const parsed = parseTweetUrl(url);
  if (!parsed) {
    const e = new Error('Link do X/Twitter inválido.');
    e.code = 'INVALID_URL';
    throw e;
  }
  const api = `${CONFIG.external.fxtwitter}/${parsed.user}/status/${parsed.id}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let bruto = '';
  try {
    let res;
    try {
      res = await fetch(api, {
        headers: { 'user-agent': UA, accept: 'application/json', 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8' },
        signal: controller.signal,
      });
    } catch (errFetch) {
      throw erroDeRede(errFetch, 'X/Twitter');
    }
    bruto = await res.text();
    if (!res.ok) throw erroHttp(res.status, 'X/Twitter', bruto);

    let json;
    try {
      json = JSON.parse(bruto);
    } catch (_) {
      throw erroSemMidia('X/Twitter', bruto);
    }
    if (!json || json.code !== 200 || !json.tweet) {
      const e = new Error(
        `🔎 X/Twitter: tweet não encontrado ou indisponível${json && json.message ? ' (' + json.message + ')' : ''}.\n` +
          '▸ Confira se o link é de um post público.'
      );
      e.code = 'NO_RESULT';
      throw e;
    }
    const t = json.tweet;
    const media = (t.media && (t.media.all || t.media.videos || t.media.photos)) || [];
    if (!media.length) {
      const e = new Error('🔎 X/Twitter: este tweet não tem foto nem vídeo para baixar.');
      e.code = 'NO_RESULT';
      throw e;
    }
    return {
      title: (t.text || 'Tweet').slice(0, 80),
      author: (t.author && t.author.name) || '',
      media,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function download(url, suggestedName) {
  const data = await fetchData(url);
  // prefere vídeo (mp4); senão a primeira imagem
  const video = data.media.find((m) => m.type === 'video' || m.type === 'gif') || (data.media[0] && data.media[0].type !== 'photo' && data.media[0]);
  const photo = data.media.find((m) => m.type === 'photo');

  const mediaUrl = (video && (video.url || video.variants)) || (photo && photo.url);
  const isVideo = Boolean(video && mediaUrl);
  const ext = isVideo ? 'mp4' : 'jpg';
  const file = await downloadToFile(mediaUrl, {
    name: suggestedName || data.title,
    ext,
    maxBytes: CONFIG.limits.maxDownloadMB * 1024 * 1024,
  });
  return {
    ...file,
    title: data.title,
    author: data.author,
    mimetype: isVideo ? 'video/mp4' : 'image/jpeg',
    isVideo,
  };
}

module.exports = { canHandle, parseTweetUrl, fetchData, download };
