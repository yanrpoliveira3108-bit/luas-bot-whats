/**
 * downloaders/tiktok.js — download de vídeos do TikTok (OTIMIZADO).
 *
 * Melhorias:
 * - HD sempre (hd=1)
 * - Retry com backoff
 * - Timeout maior para HD
 * - User-agent atualizado
 */

'use strict';

const CONFIG = require('../config');
const { downloadToFile } = require('../utils/download');

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function normalize(u) {
  return u.startsWith('//') ? 'https:' + u : u;
}

async function fetchData(url) {
  const api = `${CONFIG.external.tikwm}?url=${encodeURIComponent(url)}&hd=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
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
    // tenta HD primeiro, fallback para play normal
    const hdUrl = normalize(d.hdplay || d.play || '');
    const playUrl = normalize(d.play || '');
    return {
      title: d.title || 'Vídeo TikTok',
      videoUrl: hdUrl || playUrl,
      cover: normalize(d.cover || ''),
      author: (d.author && d.author.nickname) || '',
      music: d.music || '',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function download(url, suggestedName) {
  const maxBytes = CONFIG.limits.maxDownloadMB * 1024 * 1024;
  const retries = (CONFIG.downloader && CONFIG.downloader.downloadRetries) || 3;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const data = await fetchData(url);
      if (!data.videoUrl) {
        const e = new Error('Sem vídeo');
        e.code = 'NO_RESULT';
        throw e;
      }
      const file = await downloadToFile(data.videoUrl, {
        name: suggestedName || data.title,
        ext: 'mp4',
        maxBytes,
        timeoutMs: 60000,
      });
      return { ...file, title: data.title, cover: data.cover, author: data.author, mimetype: 'video/mp4' };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

module.exports = { fetchData, download };
