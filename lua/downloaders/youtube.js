/**
 * downloaders/youtube.js — busca e download de áudio/vídeo do YouTube.
 *
 * Usa @distube/ytdl-core (mantido) + yt-search.
 * - playerClients fixos: o YouTube bloqueia os clients padrão (MWEB/ANDROID);
 *   o client WEB é o que continua devolvendo formatos reproduzíveis.
 * - limite de tamanho e timeout
 * - nomes seguros
 * - nunca trava o processo principal (streams com AbortController/timer)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, spawnSync } = require('child_process');
const ytdl = require('@distube/ytdl-core');
const yts = require('yt-search');
const CONFIG = require('../config');
const logger = require('../utils/logger').child('youtube');
const { safeFileName, deleteFile } = require('../utils/download');

const MAX_BYTES = CONFIG.limits.maxDownloadMB * 1024 * 1024;

/**
 * Clients na ordem de preferência. 'WEB' é o único que devolve formatos
 * reproduzíveis hoje; os demais servem de fallback para o futuro.
 */
const PLAYER_CLIENTS = ['WEB', 'WEB_EMBEDDED', 'TV', 'ANDROID', 'IOS'];

/* ------------------------- yt-dlp (preferencial) ---------------------- */
// O yt-dlp acompanha as mudanças do YouTube muito mais rápido que o
// ytdl-core (decifrador etc.). No Termux: `pkg install yt-dlp`. Quando
// disponível, é o motor usado; senão, cai no ytdl-core.

let _ytdlp;
function ytdlpAvailable() {
  if (_ytdlp === undefined) {
    _ytdlp = false;
    try {
      const r = spawnSync('yt-dlp', ['--version'], { stdio: 'ignore', timeout: 15000 });
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
      const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 15000 });
      _ffmpeg = !r.error && r.status === 0;
    } catch (_) {
      _ffmpeg = false;
    }
  }
  return _ffmpeg;
}

function execYtdlp(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
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

/** Acha o arquivo gerado pelo yt-dlp (o template tem .%(ext)s). */
function findDownloaded(dir, prefix) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(prefix) && !f.endsWith('.part') && !f.endsWith('.ytdl') && !f.endsWith('.tmp')) {
        return path.join(dir, f);
      }
    }
  } catch (_) {
    /* ignora */
  }
  return null;
}

/**
 * Baixa áudio/vídeo do YouTube usando o yt-dlp.
 *
 * Tenta primeiro o client padrão (melhor qualidade: DASH mesclado via ffmpeg).
 * Se o YouTube bloquear ("Sign in to confirm you're not a bot", comum em IP de
 * datacenter) ou negar o formato, tenta de novo com o client `android`, que
 * costuma devolver o formato combinado (itag 18, 360p A+V) mesmo bloqueado.
 */
async function ytdlpDownload(url, suggestedName, kind) {
  const base = safeFileName(suggestedName || 'youtube', '');
  const outTemplate = path.join(CONFIG.paths.tmpDir, base + '.%(ext)s');

  const fmtDefault = kind === 'audio'
    ? 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio'
    : ffmpegAvailable()
      // vídeo + áudio separados (DASH) mesclados pelo ffmpeg → mp4 final
      ? 'bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[ext=mp4][height<=480]/b[ext=mp4]/b'
      // sem ffmpeg: só formatos já combinados
      : 'b[ext=mp4][height<=480]/b[ext=mp4]/b';

  // client android só devolve formatos combinados → sem mesclagem necessária
  const fmtAndroid = kind === 'audio'
    ? 'b[height<=480]/b'
    : 'b[height<=480][ext=mp4]/b[ext=mp4]/b';

  const attempts = [
    { fmt: fmtDefault, android: false },
    { fmt: fmtAndroid, android: true },
  ];

  let firstErr;
  for (const att of attempts) {
    try {
      return await runYtdlpAttempt(url, suggestedName, base, outTemplate, kind, att);
    } catch (err) {
      if (!firstErr) firstErr = err;
      if (!att.android) {
        logger.warn({ err: err.message, code: err.code }, 'yt-dlp (client padrão) falhou — tentando client android');
      }
    }
  }
  throw firstErr;
}

/** Executa uma tentativa do yt-dlp e devolve o objeto de download. */
async function runYtdlpAttempt(url, suggestedName, base, outTemplate, kind, att) {
  const args = [
    '-f', att.fmt,
    '--no-playlist',
    '--max-filesize', `${CONFIG.limits.maxDownloadMB}M`,
    '--no-warnings',
  ];
  if (att.android) args.push('--extractor-args', 'youtube:player_client=android');
  // after_move: só imprime após o download (o --print simples implicaria
  // --simulate e não baixaria nada)
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
  const stdout = await execYtdlp(args, CONFIG.limits.downloadTimeoutMs);
  const lines = String(stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const title = lines[0] || suggestedName || 'YouTube';
  const author = lines[1] || '';

  const file = findDownloaded(CONFIG.paths.tmpDir, base);
  if (!file) {
    const e = new Error('Arquivo baixado não encontrado.');
    e.code = 'DOWNLOAD_FAILED';
    throw e;
  }
  const ext = path.extname(file).replace('.', '');
  const isVideo = kind === 'video';
  const bytes = fs.statSync(file).size;
  if (bytes > MAX_BYTES) {
    deleteFile(file);
    const e = new Error('FILE_TOO_BIG');
    e.code = 'FILE_TOO_BIG';
    throw e;
  }
  return {
    path: file,
    title,
    author,
    duration: 0,
    thumbnail: '',
    mimetype: isVideo ? 'video/mp4' : ext === 'm4a' || ext === 'mp4' ? 'audio/mp4' : 'audio/webm',
    engine: att.android ? 'yt-dlp (android)' : 'yt-dlp',
  };
}

/** Busca vídeos no YouTube. */
async function search(query, limit = 5) {
  const r = await yts({ query: String(query || '').trim() });
  const videos = (r && r.videos) || [];
  return videos.slice(0, limit).map((v) => ({
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

/** Converte erros do YouTube em erros amigáveis com código. */
function friendlyError(err) {
  const m = String((err && err.message) || '');
  const code = (err && err.code) || '';
  if (m.includes('decipher') || m.includes('n transform') || m.includes('player-script') || m.includes('Could not parse')) {
    const e = new Error('O YouTube mudou e o motor reserva (ytdl-core) não consegue extrair o vídeo.\n▸ No Termux, instale o yt-dlp: pkg install yt-dlp — e reinicie o bot.');
    e.code = 'DOWNLOAD_FAILED';
    return e;
  }
  if (m.includes('403') || m.includes('Forbidden')) {
    const e = new Error('O YouTube recusou o download (bloqueio de rede/região ou vídeo restrito).');
    e.code = 'YOUTUBE_BLOCKED';
    return e;
  }
  if (code === 'NO_FORMAT' || m.includes('playable formats') || m.includes('NO_FORMAT')) {
    const e = new Error('Nenhum formato disponível para este vídeo (pode ser restrito ou muito recente).');
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
      logger.warn({ err: err.message, clients }, 'ytdl getInfo falhou com clients, tentando próximo');
    }
  }
  throw friendlyError(lastErr);
}

/**
 * Escolhe um formato de áudio. Prefere áudio puro (m4a/opus); quando o
 * cliente WEB só devolve o formato combinado (A+V), usa ele como fallback —
 * o arquivo mp4 é enviado como áudio (o WhatsApp lê a faixa de áudio).
 */
function pickAudioFormat(info) {
  const audioOnly = info.formats.filter((f) => f.hasAudio && !f.hasVideo);
  const m4a = audioOnly.find((f) => f.container === 'm4a' || (f.mimeType && f.mimeType.includes('mp4')));
  const chosen = m4a || audioOnly[0];
  if (chosen) return { format: chosen, combined: false };
  const combined = info.formats
    .filter((f) => f.hasAudio && f.hasVideo)
    .sort((a, b) => (a.height || 9999) - (b.height || 9999))[0];
  if (!combined) {
    const e = new Error('NO_FORMAT');
    e.code = 'NO_FORMAT';
    throw e;
  }
  return { format: combined, combined: true };
}

/** Escolhe um formato de vídeo mp4 com vídeo+áudio (menor resolução). */
function pickVideoFormat(info) {
  const formats = info.formats
    .filter((f) => f.hasVideo && f.hasAudio && f.container === 'mp4')
    .sort((a, b) => (a.height || 9999) - (b.height || 9999));
  if (!formats.length) {
    const e = new Error('NO_FORMAT');
    e.code = 'NO_FORMAT';
    throw e;
  }
  return formats[0];
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
        try {
          fs.rmSync(dest, { force: true });
        } catch (_) {}
        reject(err);
      } else {
        resolve(size);
      }
    };
    const timer = setTimeout(() => {
      tooBig = true;
      stream.destroy(new Error('TIMEOUT'));
    }, timeoutMs);

    const file = fs.createWriteStream(dest, { flags: 'wx' });
    stream.on('data', (c) => {
      received += c.length;
      if (received > maxBytes) {
        tooBig = true;
        stream.destroy(new Error('FILE_TOO_BIG'));
      }
    });
    stream.on('error', (err) => {
      file.destroy();
      finish(err);
    });
    file.on('error', (err) => {
      stream.destroy();
      finish(err);
    });
    file.on('finish', () => {
      if (tooBig) finish(new Error('FILE_TOO_BIG'));
      else finish(null, received);
    });
    stream.pipe(file);
  });
}

/** Baixa o áudio de um vídeo do YouTube. */
async function downloadAudio(url, suggestedName) {
  if (!validateUrl(url)) {
    const e = new Error('URL inválida');
    e.code = 'INVALID_URL';
    throw e;
  }
  // motor preferencial: yt-dlp (robusto contra mudanças do YouTube)
  if (ytdlpAvailable()) {
    try {
      return await ytdlpDownload(url, suggestedName, 'audio');
    } catch (err) {
      if (err.code && err.code !== 'DOWNLOAD_FAILED') throw friendlyError(err);
      logger.warn({ err: err.message }, 'yt-dlp falhou — tentando ytdl-core');
    }
  }
  try {
    const info = await getInfo(url);
    const { format, combined } = pickAudioFormat(info);
    const ext = combined ? 'mp4' : format.container === 'm4a' ? 'm4a' : 'webm';
    const dest = path.join(CONFIG.paths.tmpDir, safeFileName(suggestedName || info.videoDetails.title, ext));

    const stream = ytdl(url, { filter: (f) => f.itag === format.itag, playerClients: PLAYER_CLIENTS });
    await streamToFile(stream, dest, MAX_BYTES);
    return {
      path: dest,
      title: info.videoDetails.title,
      author: info.videoDetails.author && info.videoDetails.author.name,
      duration: Number(info.videoDetails.lengthSeconds) || 0,
      thumbnail: info.videoDetails.thumbnails && info.videoDetails.thumbnails.length ? info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url : '',
      mimetype: combined ? 'audio/mp4' : ext === 'm4a' ? 'audio/mp4' : 'audio/ogg',
      combined,
    };
  } catch (err) {
    throw friendlyError(err);
  }
}

/** Baixa o vídeo (mp4) de um vídeo do YouTube. */
async function downloadVideo(url, suggestedName) {
  if (!validateUrl(url)) {
    const e = new Error('URL inválida');
    e.code = 'INVALID_URL';
    throw e;
  }
  if (ytdlpAvailable()) {
    try {
      return await ytdlpDownload(url, suggestedName, 'video');
    } catch (err) {
      if (err.code && err.code !== 'DOWNLOAD_FAILED') throw friendlyError(err);
      logger.warn({ err: err.message }, 'yt-dlp falhou — tentando ytdl-core');
    }
  }
  try {
    const info = await getInfo(url);
    const format = pickVideoFormat(info);
    const dest = path.join(CONFIG.paths.tmpDir, safeFileName(suggestedName || info.videoDetails.title, 'mp4'));

    const stream = ytdl(url, { filter: (f) => f.itag === format.itag, playerClients: PLAYER_CLIENTS });
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

module.exports = { search, validateUrl, getInfo, downloadAudio, downloadVideo, friendlyError, ytdlpAvailable, ffmpegAvailable, mapYtdlpError, deleteFile };
