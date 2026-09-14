/**
 * downloaders/instagram.js — download de mídia pública do Instagram (OTIMIZADO).
 *
 * Melhorias:
 * - Qualidade alta: tenta s1080x1080, s2048x2048, original
 * - Retry com backoff
 * - User-agent iPhone atualizado
 * - Timeout maior para qualidade alta
 */

'use strict';

const CONFIG = require('../config');
const social = require('./social');
const { downloadToFile } = require('../utils/download');

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function extractShortcode(url) {
  const m = String(url || '').match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
  return m ? m[1] : null;
}

function embedUrl(url, shortcode) {
  const kind = String(url).match(/instagram\.com\/(p|reel|reels|tv)\//);
  let k = kind ? kind[1] : 'p';
  if (k === 'reels') k = 'reel';
  return `https://www.instagram.com/${k}/${shortcode}/embed/captioned/`;
}

function cleanUrl(s) {
  return String(s || '').replace(/\\/g, '').replace(/&amp;/g, '&').trim();
}

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
 * Upgrade de qualidade de imagem Instagram
 * Transforma s640x640, s750x750 etc em alta qualidade
 */
function upgradeImageQuality(url) {
  let u = String(url || '');
  if (!u) return u;

  const quality = (CONFIG.downloader && CONFIG.downloader.imageQuality) || 'high';

  if (quality === 'original') {
    // remove parâmetros de tamanho para pegar original
    u = u.replace(/\/s\d+x\d+\//, '/');
    u = u.replace(/\/p\d+x\d+\//, '/');
    // remove c0.etc crop params
    u = u.replace(/\/c\d+\.\d+\.\d+\.\d+\//, '/');
    return u;
  }

  if (quality === 'high') {
    // tenta 1080 ou 1350
    if (/\/s\d+x\d+\//.test(u)) {
      u = u.replace(/\/s\d+x\d+\//, '/s1080x1080/');
    } else if (!/\/s1080x1080\//.test(u) && !/\/s2048x2048\//.test(u)) {
      // se não tem tamanho, tenta forçar 1080
      // não faz nada se já for original
    }
  }

  return u;
}

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

async function fetchEmbedMedia(url) {
  const shortcode = extractShortcode(url);
  if (!shortcode) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
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
    return null;
  } finally {
    clearTimeout(timer);
  }

  let videoUrl = extractField(html, 'video_url');
  let imageUrl = extractField(html, 'display_url') || extractField(html, 'thumbnail_src');
  const caption = extractCaption(html);

  // upgrade qualidade
  if (imageUrl) imageUrl = upgradeImageQuality(imageUrl);
  if (videoUrl) {
    // vídeo já é mp4 direto do CDN, qualidade original
    videoUrl = cleanUrl(videoUrl);
  }

  if (!videoUrl && !imageUrl) return null;

  const title = caption || 'Instagram';
  return { videoUrl, imageUrl, title, author: '' };
}

async function download(url, suggestedName) {
  const maxBytes = CONFIG.limits.maxDownloadMB * 1024 * 1024;
  const retries = (CONFIG.downloader && CONFIG.downloader.downloadRetries) || 3;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const meta = await fetchEmbedMedia(url);
      if (!meta || (!meta.videoUrl && !meta.imageUrl)) {
        return social.downloadMedia(url, suggestedName || 'instagram');
      }

      const isVideo = Boolean(meta.videoUrl);
      const mediaUrl = meta.videoUrl || meta.imageUrl;
      const ext = isVideo ? 'mp4' : 'jpg';
      const file = await downloadToFile(mediaUrl, {
        name: suggestedName || meta.title,
        ext,
        maxBytes,
        timeoutMs: 45000,
      });
      return {
        ...file,
        title: meta.title,
        author: meta.author,
        mimetype: isVideo ? 'video/mp4' : 'image/jpeg',
        isVideo,
      };
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

module.exports = { download, extractShortcode, embedUrl, extractField, extractCaption, upgradeImageQuality };
