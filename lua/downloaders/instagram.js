/**
 * downloaders/instagram.js — download de mídia pública do Instagram.
 *
 * Estratégia (sem chave de API, sem login):
 *  1. Baixa a página de embed `https://www.instagram.com/{p|reel}/{shortcode}/embed/captioned/`
 *     (acessível sem sessão) e extrai o `video_url` (mp4 do CDN) e o
 *     `display_url` (capa) do JSON embutido na página.
 *  2. Se não achar nada no embed, cai no social.js (Open Graph).
 *
 * Posts privados ou bloqueios do servidor resultam em erro amigável.
 */

'use strict';

const CONFIG = require('../config');
const social = require('./social');
const { downloadToFile } = require('../utils/download');

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

/** Extrai o shortcode (ID público) de uma URL do Instagram. */
function extractShortcode(url) {
  const m = String(url || '').match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
  return m ? m[1] : null;
}

/** Monta a URL de embed a partir do link original. */
function embedUrl(url, shortcode) {
  const kind = String(url).match(/instagram\.com\/(p|reel|reels|tv)\//);
  let k = kind ? kind[1] : 'p';
  if (k === 'reels') k = 'reel';
  return `https://www.instagram.com/${k}/${shortcode}/embed/captioned/`;
}

/** Limpa uma URL extraída do JSON embutido (barras escapadas, &amp;). */
function cleanUrl(s) {
  return String(s || '').replace(/\\/g, '').replace(/&amp;/g, '&').trim();
}

/** Limpa um texto (caption) com escapes \n, \uXXXX e \". */
function cleanText(s) {
  return String(s || '')
    .replace(/\\n/g, '\n')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\/g, '')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Extrai um campo do JSON embutido do embed.
 * O JSON vem multi-escapado: `\"video_url\":\"https:\/\/cdn...\"`.
 */
function extractField(html, key) {
  const needle = '\\"' + key + '\\"';
  let i = html.indexOf(needle);
  if (i < 0) i = html.indexOf('"' + key + '"');
  if (i < 0) return '';
  const after = html.slice(i + needle.length);
  const colon = after.indexOf(':');
  if (colon < 0) return '';
  let k = colon + 1;
  while (k < after.length && (after[k] === ' ' || after[k] === '"' || after[k] === '\\')) k++;
  let stop = after.indexOf('\\"', k);
  const stop2 = after.indexOf('"', k);
  if (stop < 0 || (stop2 >= 0 && stop2 < stop)) stop = stop2;
  return cleanUrl(after.slice(k, stop < 0 ? undefined : stop));
}

/** Extrai a legenda (caption) a partir do bloco edge_media_to_caption. */
function extractCaption(html) {
  const i = html.indexOf('edge_media_to_caption');
  if (i < 0) return '';
  const region = html.slice(i, i + 6000);
  const t = region.indexOf('\\"text\\"');
  if (t < 0) return '';
  const after = region.slice(t + '\\"text\\"'.length);
  const colon = after.indexOf(':');
  if (colon < 0) return '';
  let k = colon + 1;
  while (k < after.length && (after[k] === ' ' || after[k] === '"' || after[k] === '\\')) k++;
  const stop = after.indexOf('\\"', k);
  return cleanText(after.slice(k, stop < 0 ? undefined : stop));
}

/** Busca a página de embed e extrai { videoUrl, imageUrl, title }. */
async function fetchEmbedMedia(url) {
  const shortcode = extractShortcode(url);
  if (!shortcode) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let html;
  try {
    const res = await fetch(embedUrl(url, shortcode), {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    html = await res.text();
  } catch (_) {
    return null; // embed indisponível → cai no fallback OG
  } finally {
    clearTimeout(timer);
  }

  const videoUrl = extractField(html, 'video_url');
  const imageUrl = extractField(html, 'display_url') || extractField(html, 'thumbnail_src');
  const caption = extractCaption(html);
  if (!videoUrl && !imageUrl) return null;

  const title = caption || 'Instagram';
  return { videoUrl, imageUrl, title, author: '' };
}

/**
 * Baixa a mídia de uma URL do Instagram.
 * @returns {{ path, title, author, mimetype, isVideo }}
 */
async function download(url, suggestedName) {
  const meta = await fetchEmbedMedia(url);
  if (!meta || (!meta.videoUrl && !meta.imageUrl)) {
    // fallback: extração Open Graph (imagem/capa ou vídeo og:video)
    return social.downloadMedia(url, suggestedName || 'instagram');
  }

  const isVideo = Boolean(meta.videoUrl);
  const mediaUrl = meta.videoUrl || meta.imageUrl;
  const ext = isVideo ? 'mp4' : 'jpg';
  const file = await downloadToFile(mediaUrl, {
    name: suggestedName || meta.title,
    ext,
    maxBytes: CONFIG.limits.maxDownloadMB * 1024 * 1024,
  });
  return {
    ...file,
    title: meta.title,
    author: meta.author,
    mimetype: isVideo ? 'video/mp4' : 'image/jpeg',
    isVideo,
  };
}

module.exports = { download, extractShortcode, embedUrl, extractField, extractCaption };
