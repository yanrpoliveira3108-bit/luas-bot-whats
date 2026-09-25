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
const { erroDeRede, erroHttp, erroSemMidia } = require('../utils/errors');

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function normalize(u) {
  return u.startsWith('//') ? 'https:' + u : u;
}

async function fetchData(url) {
  const api = `${CONFIG.external.tikwm}?url=${encodeURIComponent(url)}&hd=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  let bruto = '';
  try {
    let res;
    try {
      res = await fetch(api, {
        headers: {
          'user-agent': UA,
          accept: 'application/json, text/plain, */*',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
          referer: 'https://www.tikwm.com/',
        },
        signal: controller.signal,
      });
    } catch (errFetch) {
      throw erroDeRede(errFetch, 'TikTok');
    }
    bruto = await res.text();
    if (!res.ok) throw erroHttp(res.status, 'TikTok', bruto);

    let json;
    try {
      json = JSON.parse(bruto);
    } catch (_) {
      // resposta não é JSON → quase sempre é página de challenge do Cloudflare
      throw erroSemMidia('TikTok', bruto);
    }
    if (!json || json.code !== 0 || !json.data) {
      const msg = (json && json.msg) || 'a API não devolveu o vídeo';
      const e = new Error(
        `🔎 TikTok: não consegui obter o vídeo (${msg}).\n` +
          '▸ Se o link abre normalmente no navegador, tente de novo em alguns minutos.'
      );
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
