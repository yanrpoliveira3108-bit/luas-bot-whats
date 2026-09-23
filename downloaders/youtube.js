/**
 * downloaders/youtube.js — busca e download de áudio/vídeo do YouTube (OTIMIZADO).
 *
 * Melhorias de velocidade e qualidade:
 * - Qualidade configurável via .env: YT_VIDEO_QUALITY (best/1080/720/480), YT_AUDIO_QUALITY
 * - Fragmentos concorrentes: YT_CONCURRENT_FRAGMENTS (1-16) — download DASH paralelo
 * - yt-dlp com --buffer-size, --http-chunk-size, --retries, --fragment-retries
 * - aria2c opcional (USE_ARIA2C) para download ainda mais rápido
 * - ytdl-core fallback com highWaterMark 32MB e escolha de maior qualidade
 * - Limite de tamanho e timeout respeitados
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, spawnSync } = require('child_process');
// O ytdl-core checa atualização na primeira extração: em rede de celular
// isso custa tempo e, com proxy/certificado estranho, imprime erro no console.
process.env.YTDL_NO_UPDATE = process.env.YTDL_NO_UPDATE || '1';
const ytdl = require('@distube/ytdl-core');
const yts = require('yt-search');
const CONFIG = require('../config');
const logger = require('../utils/logger').child('youtube');
const { safeFileName, deleteFile, ensureTmp } = require('../utils/download');
const mediaCache = require('../utils/mediaCache');

const MAX_BYTES = CONFIG.limits.maxDownloadMB * 1024 * 1024;
const DL = CONFIG.downloader || {};

const PLAYER_CLIENTS = ['WEB', 'WEB_EMBEDDED', 'TV', 'ANDROID', 'IOS'];

/* ------------------------- detecção de binários ---------------------- */

let _ytdlp;
function ytdlpAvailable() {
  if (_ytdlp === undefined) {
    _ytdlp = false;
    try {
      const r = spawnSync('yt-dlp', ['--version'], { stdio: 'ignore', timeout: 8000 });
      _ytdlp = !r.error && r.status === 0;
    } catch (_) {
      _ytdlp = false;
    }
  }
  return _ytdlp;
}

let _ffmpeg;
function ffmpegAvailable() {
  if (_ffmpeg === undefined) {
    _ffmpeg = false;
    try {
      const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 8000 });
      _ffmpeg = !r.error && r.status === 0;
    } catch (_) {
      _ffmpeg = false;
    }
  }
  return _ffmpeg;
}

let _aria2c;
function aria2cAvailable() {
  if (_aria2c === undefined) {
    _aria2c = false;
    try {
      const r = spawnSync('aria2c', ['--version'], { stdio: 'ignore', timeout: 5000 });
      _aria2c = !r.error && r.status === 0;
    } catch (_) {
      _aria2c = false;
    }
  }
  return _aria2c;
}

function execYtdlp(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = ((stderr || err.message || '').split('\n')[0] || '').trim();
        const e = new Error(msg || 'yt-dlp falhou');
        e.code = mapYtdlpError(msg);
        reject(e);
      } else {
        resolve(stdout);
      }
    });
  });
}

function mapYtdlpError(msg) {
  const m = (msg || '').toLowerCase();
  if (m.includes('video unavailable') || m.includes('private video') || m.includes('members-only') || m.includes('sign in') || m.includes('this video is not available') || m.includes('premiere')) return 'NO_RESULT';
  if (m.includes('unsupported url') || m.includes('not a valid url') || m.includes('unable to extract')) return 'INVALID_URL';
  if (m.includes('requested format is not available') || m.includes('requested format not available')) return 'NO_FORMAT';
  if (m.includes('max-filesize') || m.includes('file is larger than')) return 'FILE_TOO_BIG';
  if (m.includes('timed out')) return 'TIMEOUT';
  return 'DOWNLOAD_FAILED';
}

function findDownloaded(dir, prefix) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(prefix) && !f.endsWith('.part') && !f.endsWith('.ytdl') && !f.endsWith('.tmp')) {
        return path.join(dir, f);
      }
    }
  } catch (_) {}
  return null;
}

function execFfmpeg(args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || err.message || '').split('\n')[0] || 'ffmpeg falhou'));
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Garante que o vídeo seja compatível com WhatsApp (mp4 h264 + aac)
 * Se o arquivo já for mp4 h264, retorna ele mesmo
 * Se for webm/vp9/av1 ou outro, converte para mp4 h264/aac
 */
async function ensureWhatsAppCompatible(filePath) {
  if (!ffmpegAvailable()) return filePath;

  const ext = path.extname(filePath).toLowerCase();
  // se já é mp4, tenta verificar rapidamente se precisa converter
  // por simplicidade, se for mp4, assume que está ok (yt-dlp já forçou avc)
  // mas se for webm, mkv, etc, converte
  if (ext === '.mp4') {
    return filePath;
  }

  const outPath = filePath.replace(/\.[^.]+$/, '_whatsapp.mp4');
  try {
    // converte para h264 + aac, preset ultrafast para velocidade, qualidade alta
    await execFfmpeg([
      '-y',
      '-i', filePath,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outPath,
    ], 120000);

    // verifica tamanho
    const bytes = fs.statSync(outPath).size;
    if (bytes > MAX_BYTES) {
      deleteFile(outPath);
      return filePath; // mantém original se conversão estourar limite
    }

    deleteFile(filePath);
    return outPath;
  } catch (err) {
    logger.warn({ err: err.message }, 'falha ao converter para WhatsApp mp4, mantendo original');
    deleteFile(outPath);
    return filePath;
  }
}

/* ------------------------- formatos de qualidade ---------------------- */

function getVideoQuality() {
  return DL.ytVideoQuality || 720;
}

function buildVideoFormat(quality, hasFfmpeg) {
  // quality = 'best' ou número (360,480,720,1080,1440,2160)
  // Usa h264 (avc) explicitamente para compatibilidade com WhatsApp
  // WhatsApp NÃO aceita vp9/av01 em muitos aparelhos — força avc1
  if (quality === 'best') {
    return hasFfmpeg
      ? 'bv*[ext=mp4][vcodec^=avc]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc]/b[ext=mp4]/b'
      : 'b[ext=mp4][vcodec^=avc]/b[ext=mp4]/b';
  }
  const h = Number(quality) || 720;
  return hasFfmpeg
    ? `bv*[height<=${h}][ext=mp4][vcodec^=avc]+ba[ext=m4a]/b[ext=mp4][height<=${h}][vcodec^=avc]/b[ext=mp4]/b`
    : `b[ext=mp4][height<=${h}][vcodec^=avc]/b[ext=mp4][height<=${h}]/b[ext=mp4]/b`;
}

function buildAudioFormat() {
  const q = (DL.ytAudioQuality || 'best').toLowerCase();
  // best = melhor disponível (m4a 256k ou opus)
  if (q === 'best') return 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best';
  // 320k, 256k etc — tenta bitrate específico
  if (q.includes('320')) return 'bestaudio[ext=m4a][abr>=320]/bestaudio[abr>=320]/bestaudio';
  if (q.includes('256')) return 'bestaudio[ext=m4a][abr>=192]/bestaudio[abr>=192]/bestaudio';
  if (q.includes('192')) return 'bestaudio[ext=m4a][abr>=128]/bestaudio/bestaudio';
  return 'bestaudio[ext=m4a]/bestaudio/bestaudio';
}

/* ------------------------- download yt-dlp (alta velocidade) ---------------------- */

async function ytdlpDownload(url, suggestedName, kind) {
  ensureTmp();
  const base = safeFileName(suggestedName || 'youtube', '');
  const outTemplate = path.join(CONFIG.paths.tmpDir, base + '.%(ext)s');

  const hasFfmpeg = ffmpegAvailable();
  const quality = getVideoQuality();
  const concurrent = DL.ytConcurrentFragments || 8;

  const fmtDefault = kind === 'audio'
    ? buildAudioFormat()
    : buildVideoFormat(quality, hasFfmpeg);

  // fallback android — formatos combinados, útil quando YouTube bloqueia IP de datacenter
  const fmtAndroid = kind === 'audio'
    ? 'b[height<=720]/b'
    : quality === 'best'
      ? 'b[ext=mp4][vcodec^=avc]/b[ext=mp4]/b'
      : `b[ext=mp4][height<=${quality}][vcodec^=avc]/b[ext=mp4][height<=${quality}]/b[ext=mp4]/b`;

  const attempts = [
    { fmt: fmtDefault, android: false },
    { fmt: fmtAndroid, android: true },
  ];

  let firstErr;
  for (const att of attempts) {
    try {
      return await runYtdlpAttempt(url, suggestedName, base, outTemplate, kind, att, concurrent);
    } catch (err) {
      if (!firstErr) firstErr = err;
      if (!att.android) {
        logger.warn({ err: err.message, code: err.code }, 'yt-dlp padrão falhou — tentando android');
      }
    }
  }
  throw firstErr;
}

async function runYtdlpAttempt(url, suggestedName, base, outTemplate, kind, att, concurrent) {
  const args = [
    '-f', att.fmt,
    '--no-playlist',
    '--max-filesize', `${CONFIG.limits.maxDownloadMB}M`,
    '--no-warnings',
    '--no-mtime',
    '--no-overwrites',
    '--retries', '3',
    '--fragment-retries', '5',
    '--extractor-retries', '2',
    '--concurrent-fragments', String(concurrent),
    '--buffer-size', '32K',
    '--http-chunk-size', '10M',
  ];

  // cookies do YouTube: é o conserto definitivo do "Sign in to confirm you are
  // not a bot" (o YouTube exige sessão validada para muitos vídeos).
  const cookies = String(DL.ytCookies || '').trim();
  if (cookies) {
    args.push('--cookies', cookies);
  }

  // aria2c para download ainda mais rápido (se habilitado e disponível)
  if (DL.useAria2c && aria2cAvailable()) {
    args.push('--downloader', 'aria2c', '--downloader-args', 'aria2c:-x 8 -k 1M');
  }

  if (att.android) {
    args.push('--extractor-args', 'youtube:player_client=android');
  }

  args.push(
    '--print', 'after_move:%(title)s',
    '--print', 'after_move:%(uploader)s',
    '--no-simulate',
    '-o', outTemplate,
    url,
  );

  if (kind === 'video' && ffmpegAvailable() && !att.android) {
    args.splice(args.indexOf('--no-simulate'), 0, '--merge-output-format', 'mp4');
  }

  // áudio: extrai m4a de alta qualidade quando possível
  if (kind === 'audio' && ffmpegAvailable()) {
    // mantém m4a original se já for m4a, senão converte com bitrate alto
    const aq = DL.ytAudioQuality || 'best';
    if (aq !== 'best' && aq.includes('mp3')) {
      args.splice(args.indexOf('--no-simulate'), 0, '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
    }
  }

  const stdout = await execYtdlp(args, CONFIG.limits.downloadTimeoutMs);
  const lines = String(stdout || '').split('\n').map(l => l.trim()).filter(Boolean);
  const title = lines[0] || suggestedName || 'YouTube';
  const author = lines[1] || '';

  const file = findDownloaded(CONFIG.paths.tmpDir, base);
  if (!file) {
    const e = new Error('Arquivo baixado não encontrado.');
    e.code = 'DOWNLOAD_FAILED';
    throw e;
  }
  let finalFile = file;
  // garante compatibilidade com WhatsApp (mp4 h264)
  if (kind === 'video') {
    finalFile = await ensureWhatsAppCompatible(file);
  }
  const ext = path.extname(finalFile).replace('.', '');
  const isVideo = kind === 'video';
  const bytes = fs.statSync(finalFile).size;
  if (bytes > MAX_BYTES) {
    deleteFile(finalFile);
    const e = new Error('FILE_TOO_BIG');
    e.code = 'FILE_TOO_BIG';
    throw e;
  }
  return {
    path: finalFile,
    title,
    author,
    duration: 0,
    thumbnail: '',
    mimetype: isVideo ? 'video/mp4' : ext === 'm4a' || ext === 'mp4' ? 'audio/mp4' : ext === 'mp3' ? 'audio/mpeg' : 'audio/webm',
    engine: att.android ? 'yt-dlp (android)' : 'yt-dlp',
  };
}

/* ------------------------- busca ---------------------- */

async function search(query, limit = 5) {
  const r = await yts({ query: String(query || '').trim() });
  const videos = (r && r.videos) || [];
  return videos.slice(0, limit).map(v => ({
    title: v.title,
    url: v.url,
    duration: v.duration && v.duration.timestamp,
    views: v.views,
    author: v.author && v.author.name,
    thumbnail: v.thumbnail,
  }));
}

function validateUrl(url) {
  return ytdl.validateURL(String(url || ''));
}

function friendlyError(err) {
  const m = String((err && err.message) || '');
  const code = (err && err.code) || '';
  if (m.includes('sign in to confirm') || m.includes('not a bot') || m.includes('login_required') || m.includes('bot')) {
    const e = new Error(
      'O YouTube exigiu sessão validada ("confirme que você não é um robô").\n' +
        '▸ Instale/atualize o yt-dlp: pkg install python && pip install -U yt-dlp\n' +
        '▸ Se continuar: exporte os cookies do navegador para um arquivo e defina YT_COOKIES=/caminho/cookies.txt no .env\n' +
        '▸ Veja DOWNLOAD-TROUBLESHOOTING.md'
    );
    e.code = 'YOUTUBE_BLOCKED';
    return e;
  }
  if (m.includes('decipher') || m.includes('n transform') || m.includes('player-script') || m.includes('Could not parse')) {
    const e = new Error(
      'O YouTube mudou e o motor reserva (ytdl-core) não consegue extrair.\n' +
        '▸ Instale o motor principal: pkg install python && pip install -U yt-dlp — e reinicie o bot.'
    );
    e.code = 'DOWNLOAD_FAILED';
    return e;
  }
  if (m.includes('403') || m.includes('Forbidden')) {
    const e = new Error('YouTube recusou o download (bloqueio de rede/região ou vídeo restrito).');
    e.code = 'YOUTUBE_BLOCKED';
    return e;
  }
  if (code === 'NO_FORMAT' || m.includes('playable formats') || m.includes('NO_FORMAT')) {
    const e = new Error('Nenhum formato disponível (vídeo restrito ou muito recente).');
    e.code = 'NO_FORMAT';
    return e;
  }
  if (m.includes('unavailable') || m.includes('This video is unavailable')) {
    const e = new Error('Vídeo indisponível (privado, removido ou bloqueado).');
    e.code = 'NO_RESULT';
    return e;
  }
  return err;
}

async function getInfo(url) {
  let lastErr;
  for (const clients of [PLAYER_CLIENTS, ['ANDROID', 'IOS']]) {
    try {
      return await ytdl.getInfo(url, { playerClients: clients });
    } catch (err) {
      lastErr = err;
      logger.warn({ err: err.message, clients }, 'ytdl getInfo falhou, tentando próximo');
    }
  }
  throw friendlyError(lastErr);
}

/* ------------------------- escolha de formato (alta qualidade) ---------------------- */

function pickAudioFormat(info) {
  const audioOnly = info.formats
    .filter(f => f.hasAudio && !f.hasVideo)
    .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0) || (b.bitrate || 0) - (a.bitrate || 0));

  // prefere m4a (compatível com WhatsApp) com maior bitrate
  const m4a = audioOnly.find(f => f.container === 'm4a' || (f.mimeType && f.mimeType.includes('mp4')));
  const chosen = m4a || audioOnly[0];

  if (chosen) return { format: chosen, combined: false };

  // fallback: combinado com áudio
  const combined = info.formats
    .filter(f => f.hasAudio && f.hasVideo)
    .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];

  if (!combined) {
    const e = new Error('NO_FORMAT');
    e.code = 'NO_FORMAT';
    throw e;
  }
  return { format: combined, combined: true };
}

function pickVideoFormat(info) {
  const quality = getVideoQuality();
  let formats = info.formats.filter(f => f.hasVideo && f.hasAudio);

  // filtra por qualidade configurada
  if (quality !== 'best') {
    const h = Number(quality) || 720;
    formats = formats.filter(f => (f.height || 0) <= h);
  }

  // prefere mp4
  const mp4 = formats.filter(f => f.container === 'mp4');
  const pool = mp4.length ? mp4 : formats;

  // ordena por qualidade DESCENDENTE (maior primeiro) — alta qualidade
  pool.sort((a, b) => {
    const ha = a.height || 0, hb = b.height || 0;
    if (hb !== ha) return hb - ha;
    return (b.bitrate || 0) - (a.bitrate || 0);
  });

  if (!pool.length) {
    const e = new Error('NO_FORMAT');
    e.code = 'NO_FORMAT';
    throw e;
  }
  return pool[0];
}

function streamToFile(stream, dest, maxBytes, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    let received = 0;
    let tooBig = false;
    let settled = false;
    const finish = (err, size) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        try { fs.rmSync(dest, { force: true }); } catch (_) {}
        reject(err);
      } else {
        resolve(size);
      }
    };
    const timer = setTimeout(() => {
      tooBig = true;
      stream.destroy(new Error('TIMEOUT'));
    }, timeoutMs);

    const file = fs.createWriteStream(dest, { flags: 'wx', highWaterMark: 1024 * 1024 });
    stream.on('data', c => {
      received += c.length;
      if (received > maxBytes) {
        tooBig = true;
        stream.destroy(new Error('FILE_TOO_BIG'));
      }
    });
    stream.on('error', err => { file.destroy(); finish(err); });
    file.on('error', err => { stream.destroy(); finish(err); });
    file.on('finish', () => {
      if (tooBig) finish(new Error('FILE_TOO_BIG'));
      else finish(null, received);
    });
    stream.pipe(file);
  });
}

/* ------------------------- downloads principais ---------------------- */

async function downloadAudio(url, suggestedName) {
  ensureTmp();
  if (!validateUrl(url)) {
    const e = new Error('URL inválida');
    e.code = 'INVALID_URL';
    throw e;
  }

  // cache: tenta reutilizar áudio baixado recentemente (24h)
  try {
    const cached = mediaCache.getCached(url + '|audio|' + (DL.ytAudioQuality || 'best'));
    if (cached && fs.existsSync(cached.path)) {
      logger.info({ url, cached: cached.path }, 'cache hit áudio YouTube');
      return {
        path: cached.path,
        title: cached.meta.title || suggestedName || 'YouTube',
        author: '',
        duration: 0,
        thumbnail: '',
        mimetype: 'audio/mp4',
        engine: 'cache',
      };
    }
  } catch (_) {}

  if (DL.preferYtdlp !== false && ytdlpAvailable()) {
    try {
      const result = await ytdlpDownload(url, suggestedName, 'audio');
      try { mediaCache.setCached(url + '|audio|' + (DL.ytAudioQuality || 'best'), result.path, { ext: path.extname(result.path).replace('.', '') || 'm4a', ttl: 24 * 60 * 60 * 1000, title: result.title }); } catch (_) {}
      return result;
    } catch (err) {
      if (err.code && err.code !== 'DOWNLOAD_FAILED') throw friendlyError(err);
      logger.warn({ err: err.message }, 'yt-dlp falhou — tentando ytdl-core');
    }
  }
  try {
    const info = await getInfo(url);
    const { format, combined } = pickAudioFormat(info);
    const ext = combined ? 'mp4' : format.container === 'm4a' ? 'm4a' : format.container === 'mp3' ? 'mp3' : 'webm';
    const dest = path.join(CONFIG.paths.tmpDir, safeFileName(suggestedName || info.videoDetails.title, ext));

    const stream = ytdl(url, {
      filter: f => f.itag === format.itag,
      playerClients: PLAYER_CLIENTS,
      highWaterMark: 1 << 25, // 32MB — download mais rápido
    });
    await streamToFile(stream, dest, MAX_BYTES);
    return {
      path: dest,
      title: info.videoDetails.title,
      author: info.videoDetails.author && info.videoDetails.author.name,
      duration: Number(info.videoDetails.lengthSeconds) || 0,
      thumbnail: info.videoDetails.thumbnails && info.videoDetails.thumbnails.length ? info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url : '',
      mimetype: combined ? 'audio/mp4' : ext === 'm4a' ? 'audio/mp4' : ext === 'mp3' ? 'audio/mpeg' : 'audio/ogg',
      combined,
    };
  } catch (err) {
    throw friendlyError(err);
  }
}

async function downloadVideo(url, suggestedName) {
  ensureTmp();
  if (!validateUrl(url)) {
    const e = new Error('URL inválida');
    e.code = 'INVALID_URL';
    throw e;
  }

  // cache: tenta reutilizar vídeo baixado recentemente (1h)
  try {
    const cacheKey = url + '|video|' + (DL.ytVideoQuality || 720);
    const cached = mediaCache.getCached(cacheKey);
    if (cached && fs.existsSync(cached.path)) {
      logger.info({ url, cached: cached.path }, 'cache hit vídeo YouTube');
      return {
        path: cached.path,
        title: cached.meta.title || suggestedName || 'YouTube',
        author: '',
        duration: 0,
        thumbnail: '',
        mimetype: 'video/mp4',
        engine: 'cache',
      };
    }
  } catch (_) {}

  if (DL.preferYtdlp !== false && ytdlpAvailable()) {
    try {
      const result = await ytdlpDownload(url, suggestedName, 'video');
      try {
        const cacheKey = url + '|video|' + (DL.ytVideoQuality || 720);
        mediaCache.setCached(cacheKey, result.path, { ext: 'mp4', ttl: 60 * 60 * 1000, title: result.title });
      } catch (_) {}
      return result;
    } catch (err) {
      if (err.code && err.code !== 'DOWNLOAD_FAILED') throw friendlyError(err);
      logger.warn({ err: err.message }, 'yt-dlp falhou — tentando ytdl-core');
    }
  }
  try {
    const info = await getInfo(url);
    const format = pickVideoFormat(info);
    const dest = path.join(CONFIG.paths.tmpDir, safeFileName(suggestedName || info.videoDetails.title, 'mp4'));

    const stream = ytdl(url, {
      filter: f => f.itag === format.itag,
      playerClients: PLAYER_CLIENTS,
      highWaterMark: 1 << 25,
    });
    await streamToFile(stream, dest, MAX_BYTES);
    return {
      path: dest,
      title: info.videoDetails.title,
      author: info.videoDetails.author && info.videoDetails.author.name,
      duration: Number(info.videoDetails.lengthSeconds) || 0,
      thumbnail: info.videoDetails.thumbnails && info.videoDetails.thumbnails.length ? info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url : '',
      mimetype: 'video/mp4',
    };
  } catch (err) {
    throw friendlyError(err);
  }
}

module.exports = {
  ensureTmp,
  search,
  validateUrl,
  getInfo,
  downloadAudio,
  downloadVideo,
  friendlyError,
  ytdlpAvailable,
  ffmpegAvailable,
  aria2cAvailable,
  mapYtdlpError,
  deleteFile,
  buildVideoFormat,
  buildAudioFormat,
};
