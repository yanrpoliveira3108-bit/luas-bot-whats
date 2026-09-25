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
const { assertSafeDestination } = require('../utils/urlSecurity');

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
        reject(erroDeYtdlp(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Converte a saída de erro do yt-dlp em resposta útil.
 *
 * Antes a linha crua virava um `code` e o usuário lia "Nenhum resultado
 * encontrado" mesmo quando o problema era ffmpeg ausente, cookies ou limite de
 * tamanho. Agora o texto diz o que aconteceu e o que fazer.
 */
function erroDeYtdlp(saidaCrua) {
  const bruto = String(saidaCrua || '').replace(/^\s*ERROR:\s*/i, '').split('\n')[0].trim().slice(0, 200);
  const code = mapYtdlpError(bruto || saídaCrua);
  const extra = [];
  if (/ffmpeg|merg|postprocess|post-process/i.test(bruto)) {
    extra.push('▸ Instale o ffmpeg para juntar vídeo+áudio: pkg install ffmpeg');
  }
  if (/sign in|not a bot|cookies|login_required/i.test(bruto)) {
    extra.push('▸ O YouTube pediu sessão validada: defina YT_COOKIES no .env (veja DOWNLOAD-TROUBLESHOOTING.md)');
  }
  if (code === 'FILE_TOO_BIG') {
    extra.push(`▸ Aumente DOWNLOAD_MAX_MB no .env (hoje: ${CONFIG.limits.maxDownloadMB} MB)`);
  }
  if (code === 'TIMEOUT') {
    extra.push('▸ Conexão lenta: tente de novo ou use YT_VIDEO_QUALITY=360');
  }
  if (code === 'NO_FORMAT') {
    extra.push('▸ Sem ffmpeg só dá para baixar formatos já prontos — pkg install ffmpeg');
  }
  if (code === 'NO_RESULT') {
    extra.push('▸ Confira se o vídeo abre no navegador (privado/removido/região não dá).');
  }
  const texto = {
    NO_RESULT: '🔎 O YouTube não devolveu este vídeo.',
    NO_FORMAT: '📥 Nenhum formato compatível para este vídeo.',
    FILE_TOO_BIG: '📦 O arquivo passou do limite configurado.',
    TIMEOUT: '⏰ O YouTube demorou demais para responder.',
    INVALID_URL: '🔗 Link do YouTube inválido.',
    DOWNLOAD_FAILED: '📥 O yt-dlp não conseguiu concluir o download.',
  }[code] || '📥 O yt-dlp falhou.';
  const e = new Error([texto, bruto ? `▸ Detalhe: ${bruto}` : '', ...extra].filter(Boolean).join('\n'));
  e.code = code;
  return e;
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
    console.log('[MEDIA 7] iniciando conversão', { inputExt: ext });
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
    console.log('[MEDIA 8] conversão concluída', { bytes });
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
  // Sem ffmpeg NÃO existe junção de vídeo+áudio: o seletor precisa exigir
  // trilha de vídeo (`vcodec!=none`), senão o yt-dlp pode entregar um arquivo
  // SÓ DE ÁUDIO (f140) dizendo que é o "melhor" — foi o que aconteceu no
  // celular do dono (arquivo .f140 renomeado para .mp4).
  if (quality === 'best') {
    return hasFfmpeg
      ? 'bv*[ext=mp4][vcodec^=avc]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc]/b[ext=mp4]/b'
      : 'b[ext=mp4][vcodec^=avc]/b[ext=mp4][vcodec!=none]/b[vcodec!=none]';
  }
  const h = Number(quality) || 720;
  return hasFfmpeg
    ? `bv*[height<=${h}][ext=mp4][vcodec^=avc]+ba[ext=m4a]/b[ext=mp4][height<=${h}][vcodec^=avc]/b[ext=mp4]/b`
    : `b[ext=mp4][height<=${h}][vcodec^=avc]/b[ext=mp4][height<=${h}][vcodec!=none]/b[height<=${h}][vcodec!=none]/b[vcodec!=none]`;
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
  // yt-dlp é processo externo e pode seguir redirecionamentos; só o texto da
  // URL não basta para prevenir SSRF. Resolva e rejeite destinos internos antes
  // de entregar o argumento ao processo.
  await assertSafeDestination(url);
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
    : !hasFfmpeg
      ? // sem ffmpeg: só formato único COM vídeo
        'b[ext=mp4][vcodec^=avc]/b[ext=mp4][vcodec!=none]/b[vcodec!=none]'
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

  // IMPORTANTE: prints no estágio padrão (`video`), não `after_move`.
  // Sem ffmpeg instalado não existe pós-processamento/movimentação, e o
  // `after_move:` não imprimia NADA — o bot ficava sem título e sem saber qual
  // formato baixou (foi assim que um áudio-only virou "vídeo" no celular).
  args.push(
    '--print', '%(title)s',
    '--print', '%(uploader)s',
    '--print', '%(format_id)s',
    '--print', '%(vcodec)s',
    '--print', '%(acodec)s',
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

  console.log('[MEDIA 5] iniciando download yt-dlp', { kind, android: att.android });
  let stdout;
  try {
    stdout = await execYtdlp(args, CONFIG.limits.downloadTimeoutMs);
    console.log('[MEDIA 6] download yt-dlp concluído', { kind, android: att.android });
  } catch (err) {
    console.error('[MEDIA ERROR] yt-dlp', { message: err && err.message, name: err && err.name, code: err && err.code, stack: err && err.stack, cause: err && err.cause });
    throw err;
  }
  // o `--print` emite uma linha por campo, mas downloads repetidos (ou o
  // `after_move` de uma tentativa anterior) podem deixar linhas extras: por
  // isso os cinco campos são lidos das ÚLTIMAS linhas.
  const lines = String(stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const fim = lines.slice(-5);
  const title = lines[0] || suggestedName || 'YouTube';
  const author = lines.length > 1 ? lines[1] : '';
  const formatId = fim.length >= 3 ? fim[fim.length - 3] : '';
  const vcodec = fim.length >= 2 ? fim[fim.length - 2] : '';
  const acodec = fim.length >= 1 ? fim[fim.length - 1] : '';

  const file = findDownloaded(CONFIG.paths.tmpDir, base);
  if (!file) {
    const e = new Error('Arquivo baixado não encontrado.');
    e.code = 'DOWNLOAD_FAILED';
    throw e;
  }
  // Guarda: sem ffmpeg o yt-dlp não junta vídeo+áudio e pode entregar um
  // arquivo SÓ DE ÁUDIO. Mandar isso como "vídeo" é pior que falhar — foi o que
  // aconteceu no celular do dono (arquivo .f140 renomeado para .mp4).
  if (kind === 'video' && (vcodec === 'none' || vcodec === '')) {
    deleteFile(file);
    const e = new Error(
      '🎬 Baixei apenas o áudio: sem o ffmpeg não é possível juntar vídeo + áudio.\n' +
        '▸ Instale e reinicie o bot: pkg install ffmpeg\n' +
        '▸ (Ou peça só o áudio: !ytmp3)'
    );
    e.code = 'CONVERTER_UNAVAILABLE';
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
    formatId,
    vcodec,
    acodec,
  };
}

/* ------------------------- busca ---------------------- */

/**
 * Busca pelo yt-dlp (plano B quando o yt-search volta vazio).
 *
 * Por que existe: o `yt-search` depende do HTML do YouTube. Quando o YouTube
 * serve uma página de consentimento/bloqueio para o bot, a busca volta VAZIA —
 * e o usuário lê "Nenhum resultado encontrado" mesmo com o nome certo.
 */
async function searchViaYtdlp(query, limit = 5) {
  const q = `ytsearch${Math.max(1, Math.min(10, limit))}:${String(query || '').trim()}`;
  const stdout = await execYtdlp(
    ['--flat-playlist', '--no-warnings', '--print', '%(id)s\t%(title)s\t%(duration_string)s\t%(uploader)s', q],
    45000
  );
  const linhas = String(stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const linha of linhas) {
    const [id, title, duration, author] = linha.split('\t');
    if (!id || !title) continue;
    out.push({
      title,
      url: `https://www.youtube.com/watch?v=${id}`,
      duration: duration || '',
      views: 0,
      author: author || '',
      thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      engine: 'yt-dlp',
    });
  }
  return out.slice(0, limit);
}

async function search(query, limit = 5) {
  const q = String(query || '').trim();
  let videos = [];
  try {
    const r = await yts({ query: q });
    videos = ((r && r.videos) || []).slice(0, limit).map((v) => ({
      title: v.title,
      url: v.url,
      duration: v.duration && v.duration.timestamp,
      views: v.views,
      author: v.author && v.author.name,
      thumbnail: v.thumbnail,
    }));
  } catch (err) {
    logger.warn({ err: err.message }, 'busca (yt-search) falhou — tentando yt-dlp');
  }

  if (!videos.length && ytdlpAvailable()) {
    try {
      const viaYtdlp = await searchViaYtdlp(q, limit);
      if (viaYtdlp.length) {
        logger.info({ q, n: viaYtdlp.length }, 'busca pelo yt-dlp (plano B)');
        return viaYtdlp;
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'busca pelo yt-dlp também falhou');
    }
  }
  return videos;
}

function validateUrl(url) {
  return ytdl.validateURL(String(url || ''));
}

/** Códigos que JÁ são mensagens nossas — não podem ser reescritos. */
const CODIGOS_NOSSOS = new Set([
  'CONVERTER_UNAVAILABLE',
  'NETWORK',
  'BLOCKED',
  'LOGIN',
  'FILE_TOO_BIG',
  'NO_FORMAT',
  'TIMEOUT',
  'INVALID_URL',
  'YOUTUBE_BLOCKED',
  'DOWNLOAD_FAILED',
  'NO_RESULT',
]);

function friendlyError(err) {
  const m = String((err && err.message) || '');
  const code = (err && err.code) || '';
  // Já é um erro nosso, com mensagem pensada para o usuário: passa direto.
  // (Era aqui que "reinicie o bot" virava "confirme que você não é um robô",
  // porque a checagem antiga usava `includes('bot')` — pegava a palavra "bot"
  // em QUALQUER frase, inclusive nas nossas.)
  if (code && CODIGOS_NOSSOS.has(code)) return err;
  if (/sign in to confirm|not a bot|login_required|please sign in|confirm you('| a)?re not a bot/i.test(m)) {
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
  console.log('[MEDIA 1] obtendo informações (ytdl.getInfo)');
  // A validação síncrona no comando não protege chamadas feitas por outros
  // comandos. Valide novamente no ponto que realmente abre a conexão.
  await assertSafeDestination(url);
  let lastErr;
  for (const clients of [PLAYER_CLIENTS, ['ANDROID', 'IOS']]) {
    try {
      const info = await ytdl.getInfo(url, { playerClients: clients });
      console.log('[MEDIA 2] informações obtidas', { formats: Array.isArray(info.formats) ? info.formats.length : 0 });
      return info;
    } catch (err) {
      console.error('[MEDIA ERROR] getInfo', { message: err && err.message, code: err && err.code, stack: err && err.stack });
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
  console.log('[MEDIA 5] iniciando download HTTP/stream');
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
      else { console.log('[MEDIA 6] download concluído', { bytes: received }); finish(null, received); }
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
    console.log('[MEDIA 3] selecionando formato de áudio');
    const { format, combined } = pickAudioFormat(info);
    console.log('[MEDIA 4] formato de áudio', { itag: format && format.itag, mimeType: format && format.mimeType, hasAudio: !!(format && format.hasAudio), hasVideo: !!(format && format.hasVideo), hasUrl: Boolean(format && format.url) });
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
    console.error('[MEDIA ERROR] áudio pipeline', { message: err && err.message, name: err && err.name, code: err && err.code, stack: err && err.stack, cause: err && err.cause });
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
    console.log('[MEDIA 3] selecionando formato de vídeo');
    const format = pickVideoFormat(info);
    console.log('[MEDIA 4] formato de vídeo', { itag: format && format.itag, mimeType: format && format.mimeType, hasAudio: !!(format && format.hasAudio), hasVideo: !!(format && format.hasVideo), hasUrl: Boolean(format && format.url) });
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
    console.error('[MEDIA ERROR] vídeo pipeline', { message: err && err.message, name: err && err.name, code: err && err.code, stack: err && err.stack, cause: err && err.cause });
    throw friendlyError(err);
  }
}

module.exports = {
  ensureTmp,
  search,
  searchViaYtdlp,
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
