/**
 * downloaders/social.js — extração de mídia via Open Graph (OTIMIZADO).
 *
 * Melhorias:
 * - Qualidade alta: tenta og:image com maior resolução
 * - Retry e timeout maior
 * - User-agent moderno
 */

'use strict';

const CONFIG = require('../config');
const { downloadToFile } = require('../utils/download');

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function fetchPage(url) {
  const retries = (CONFIG.downloader && CONFIG.downloader.downloadRetries) || 2;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function pick(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1].replace(/&amp;/g, '&');
  }
  return '';
}

function metaPatterns(prop) {
  const p = prop.replace(/[:]/g, '[:]');
  return [
    new RegExp(`<meta[^>]+property=["']${p}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${p}["']`, 'i'),
  ];
}

function extractMeta(html) {
  const title = pick(html, [
    ...metaPatterns('og:title'),
    /<title[^>]*>([^<]+)<\/title>/i,
  ]);

  // tenta vídeo em alta qualidade primeiro
  const videoUrl = pick(html, [
    ...metaPatterns('og:video:secure_url'),
    ...metaPatterns('og:video:url'),
    ...metaPatterns('og:video'),
    ...metaPatterns('twitter:player:stream'),
    /<meta[^>]+property=["']twitter:player:stream["'][^>]+value=["']([^"']+)["']/i,
  ]);

  // imagem — tenta alta qualidade
  let imageUrl = pick(html, [
    ...metaPatterns('og:image:secure_url'),
    ...metaPatterns('og:image'),
    ...metaPatterns('twitter:image'),
  ]);

  // upgrade qualidade imagem se configurado
  if (imageUrl) {
    const quality = (CONFIG.downloader && CONFIG.downloader.imageQuality) || 'high';
    if (quality === 'original') {
      imageUrl = imageUrl.replace(/\/s\d+x\d+\//, '/').replace(/w=\d+/, '').replace(/h=\d+/, '');
    } else if (quality === 'high') {
      // tenta forçar maior resolução em alguns CDNs
      if (imageUrl.includes('pbs.twimg.com')) {
        imageUrl = imageUrl.replace(/&name=\w+/, '&name=4096x4096').replace(/\?format=\w+&name=\w+/, '?format=jpg&name=4096x4096');
        if (!imageUrl.includes('name=')) imageUrl += (imageUrl.includes('?') ? '&' : '?') + 'name=4096x4096';
      }
    }
  }

  return { title, videoUrl, imageUrl };
}

async function fetchOgMedia(url) {
  const html = await fetchPage(url);
  const meta = extractMeta(html);
  if (!meta.videoUrl && !meta.imageUrl) {
    const e = new Error('Mídia não encontrada (o post pode ser privado ou o site bloqueou o acesso).');
    e.code = 'NO_RESULT';
    throw e;
  }
  return meta;
}

async function downloadMedia(url, suggestedName) {
  const meta = await fetchOgMedia(url);
  const mediaUrl = meta.videoUrl || meta.imageUrl;
  const ext = meta.videoUrl ? 'mp4' : 'jpg';
  const file = await downloadToFile(mediaUrl, {
    name: suggestedName || meta.title,
    ext,
    maxBytes: CONFIG.limits.maxDownloadMB * 1024 * 1024,
    timeoutMs: 60000,
  });
  return { ...file, title: meta.title, mimetype: meta.videoUrl ? 'video/mp4' : 'image/jpeg', isVideo: !!meta.videoUrl };
}

module.exports = { fetchOgMedia, downloadMedia };
