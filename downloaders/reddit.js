/**
 * downloaders/reddit.js — download de mídia pública do Reddit.
 *
 * Usa a API JSON pública do Reddit (append .json), sem chave. Funciona para
 * posts públicos de imagem/vídeo. Vídeos do Reddit (v.redd.it) vêm sem áudio
 * (limitação conhecida e informada ao usuário).
 */

'use strict';

const CONFIG = require('../config');
const { downloadToFile } = require('../utils/download');
const { erroDeRede, erroHttp, erroSemMidia } = require('../utils/errors');

const UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

function canHandle(url) {
  const u = String(url || '').toLowerCase();
  return u.includes('reddit.com') || u.includes('redd.it');
}

function jsonUrl(url) {
  const u = String(url).replace(/\/$/, '');
  if (u.endsWith('.json')) return u;
  return u + '.json';
}

async function fetchData(url) {
  const api = jsonUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let bruto = '';
  try {
    let res;
    try {
      res = await fetch(api, {
        headers: {
          'user-agent': UA,
          accept: 'application/json',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
        signal: controller.signal,
      });
    } catch (errFetch) {
      throw erroDeRede(errFetch, 'Reddit');
    }
    bruto = await res.text();
    if (!res.ok) throw erroHttp(res.status, 'Reddit', bruto);
    let json;
    try {
      json = JSON.parse(bruto);
    } catch (_) {
      throw erroSemMidia('Reddit', bruto);
    }
    const listing = Array.isArray(json) ? json[0] : json;
    const post = listing && listing.data && listing.data.children && listing.data.children[0] && listing.data.children[0].data;
    if (!post) {
      const e = new Error('🔎 Reddit: post não encontrado ou indisponível (pode ter sido apagado).');
      e.code = 'NO_RESULT';
      throw e;
    }
    let mediaUrl = '';
    let isVideo = false;
    if (post.is_video && post.media && post.media.reddit_video && post.media.reddit_video.fallback_url) {
      mediaUrl = post.media.reddit_video.fallback_url;
      isVideo = true;
    } else if (post.url_overridden_by_dest) {
      mediaUrl = post.url_overridden_by_dest;
    } else if (post.url && /\.(jpg|jpeg|png|gif|mp4)/i.test(post.url)) {
      mediaUrl = post.url;
    } else if (post.preview && post.preview.images && post.preview.images[0]) {
      mediaUrl = post.preview.images[0].source && post.preview.images[0].source.url;
    }
    if (!mediaUrl) {
      const e = new Error('🔎 Reddit: este post não tem mídia compatível (é texto, galeria ou vídeo externo).');
      e.code = 'NO_RESULT';
      throw e;
    }
    return { title: (post.title || 'Reddit').slice(0, 80), author: (post.author || ''), mediaUrl, isVideo };
  } finally {
    clearTimeout(timer);
  }
}

async function download(url, suggestedName) {
  const data = await fetchData(url);
  const ext = data.isVideo ? 'mp4' : 'jpg';
  const file = await downloadToFile(data.mediaUrl, {
    name: suggestedName || data.title,
    ext,
    maxBytes: CONFIG.limits.maxDownloadMB * 1024 * 1024,
  });
  return {
    ...file,
    title: data.title,
    author: data.author,
    mimetype: data.isVideo ? 'video/mp4' : 'image/jpeg',
    isVideo: data.isVideo,
    note: data.isVideo ? 'vídeo sem áudio (limitação do Reddit)' : '',
  };
}

module.exports = { canHandle, jsonUrl, fetchData, download };
