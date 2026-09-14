/**
 * downloaders/social.js — extração de mídia via meta tags Open Graph.
 *
 * Abordagem sem chave de API: carrega a página pública e extrai
 * og:video / og:image / og:title. Funciona para muitos posts públicos do
 * Instagram/Facebook e falha graciosamente quando o site bloqueia o servidor.
 */

'use strict';

const CONFIG = require('../config');
const { downloadToFile } = require('../utils/download');

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function pick(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1].replace(/&amp;/g, '&');
  }
  return '';
}

/**
 * Muitos sites emitem `<meta content="..." property="og:...">` (ordem
 * invertida). Estes padrões casam as duas ordens e ainda as variantes
 * og:video:url / twitter:player:stream.
 */
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
  const videoUrl = pick(html, [
    ...metaPatterns('og:video:secure_url'),
    ...metaPatterns('og:video:url'),
    ...metaPatterns('og:video'),
    ...metaPatterns('twitter:player:stream'),
    /<meta[^>]+property=["']twitter:player:stream["'][^>]+value=["']([^"']+)["']/i,
  ]);
  const imageUrl = pick(html, [
    ...metaPatterns('og:image'),
    ...metaPatterns('og:image:secure_url'),
    ...metaPatterns('twitter:image'),
  ]);
  return { title, videoUrl, imageUrl };
}

/** Extrai metadados de mídia (e o link direto, quando disponível). */
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

/** Baixa a mídia (vídeo se houver, senão imagem). */
async function downloadMedia(url, suggestedName) {
  const meta = await fetchOgMedia(url);
  const mediaUrl = meta.videoUrl || meta.imageUrl;
  const ext = meta.videoUrl ? 'mp4' : 'jpg';
  const file = await downloadToFile(mediaUrl, {
    name: suggestedName || meta.title,
    ext,
    maxBytes: CONFIG.limits.maxDownloadMB * 1024 * 1024,
  });
  return { ...file, title: meta.title, mimetype: meta.videoUrl ? 'video/mp4' : 'image/jpeg', isVideo: !!meta.videoUrl };
}

module.exports = { fetchOgMedia, downloadMedia };
