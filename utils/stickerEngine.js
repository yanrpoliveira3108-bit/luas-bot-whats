/**
 * utils/stickerEngine.js — conversão de mídia para stickers (webp) — V2 melhorada.
 *
 * Problemas antigos que causavam stickers "estranhos":
 * - fundo branco em fotos retangulares → faixas brancas feias
 * - imagem pequena não era centralizada em 512x512 → sticker minúsculo
 * - scale sem lanczos → serrilhado
 * - qualidade baixa (75) → borrado
 * - transparência removida → PNGs com fundo recortado viravam quadrado branco
 *
 * Correções V2:
 * - SEMPRE 512x512, fundo TRANSPARENTE (não branco), preservando recorte
 * - fitSticker: sempre cria canvas 512x512 transparente e centraliza, seja imagem grande ou pequena
 * - sharp: fit contain com background transparente, qualidade 85, sem serrilhado
 * - ffmpeg: scale com flags lanczos + pad transparente 0x00000000 + rgba
 * - jimp fallback: canvas transparente, qualidade 85
 * - validação anti-fantasma mantida (detecta 100% transparente e bloqueia)
 * - textToSticker com quebra de linha inteligente e centralização real
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const CONFIG = require('../config');
const logger = require('./logger').child('sticker');
const { safeFileName, deleteFile } = require('./download');

let _sharp;
function sharpLib() {
  if (_sharp === undefined) {
    if ((process.env.TERMUX_VERSION || process.platform === 'android') && process.env.LUA_ALLOW_SHARP !== '1') {
      _sharp = null;
      return _sharp;
    }
    try {
      _sharp = require('sharp');
    } catch (_) {
      _sharp = null;
    }
  }
  return _sharp;
}

let _ffmpeg;
function hasFfmpeg() {
  if (_ffmpeg !== undefined) return _ffmpeg;
  _ffmpeg = false;
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    _ffmpeg = !r.error;
  } catch (_) {
    _ffmpeg = false;
  }
  return _ffmpeg;
}

function exec(cmd, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).split('\n')[0]));
      else resolve(stdout);
    });
  });
}

function tmpName(ext) {
  const base = safeFileName('stk', '');
  const e = String(ext || '')
    .split('.')
    .pop()
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8);
  return path.join(CONFIG.paths.tmpDir, `${base}.${e || 'bin'}`);
}

/* ------------------------------ conversão ---------------------------- */

const STICKER_SIZE = 512;

/**
 * Redimensiona e centraliza em 512x512 com fundo TRANSPARENTE.
 * - Se imagem >512, reduz mantendo proporção
 * - Se imagem <=512, mantém tamanho original mas centraliza no canvas 512
 * - Fundo transparente preserva PNGs recortados
 */
async function fitSticker(img) {
  const Jimp = require('jimp');
  const { width, height } = img.bitmap;

  // clone para não mutar original
  let working = img.clone();

  // se maior que 512 em qualquer lado, reduz com alta qualidade
  if (width > STICKER_SIZE || height > STICKER_SIZE) {
    working = working.scaleToFit(STICKER_SIZE, STICKER_SIZE, Jimp.RESIZE_BEZIER);
  }

  // se ainda muito pequeno (ex: 50x50), upscale suave até pelo menos 256 para não ficar minúsculo
  // mas sem exagerar — WhatsApp aceita até 512, mas 256 mínimo fica legível
  const MIN_VISIBLE = 256;
  if (working.bitmap.width < MIN_VISIBLE && working.bitmap.height < MIN_VISIBLE) {
    // escala proporcional até MIN_VISIBLE no maior lado
    working = working.scaleToFit(MIN_VISIBLE, MIN_VISIBLE, Jimp.RESIZE_BEZIER);
  }

  // canvas 512x512 transparente
  const canvas = new Jimp(STICKER_SIZE, STICKER_SIZE, 0x00000000);
  const x = Math.floor((STICKER_SIZE - working.bitmap.width) / 2);
  const y = Math.floor((STICKER_SIZE - working.bitmap.height) / 2);
  canvas.composite(working, x, y);
  return canvas;
}

async function webpmuxImageToWebp(buffer) {
  const Jimp = require('jimp');
  let img = await Jimp.read(buffer);
  return jimpToWebp(img);
}

/** Codifica Jimp já tratado para webp com qualidade alta */
async function jimpToWebp(img) {
  const libWebP = require('node-webpmux/libwebp');
  img = await fitSticker(img);
  const { width, height, data } = img.bitmap;
  const enc = new libWebP();
  await enc.init();
  // qualidade 85 + método 4 (melhor compressão) + alpha preservado
  const ret = enc.encodeImage(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width,
    height,
    { lossless: 0, quality: 85, method: 4, alpha_quality: 90 }
  );
  if (ret.res !== 0 || !ret.buf) {
    throw new Error(`node-webpmux encodeImage retornou ${ret.res}`);
  }
  return Buffer.from(ret.buf);
}

async function webpmuxWebpToPng(buffer) {
  const Jimp = require('jimp');
  const { Image } = require('node-webpmux');
  await Image.initLib();
  const img = new Image();
  await img.load(buffer);
  if (img.hasAnim) throw new Error('webp animado requer sharp/ffmpeg');
  const rgba = await img.getImageData();
  const out = new Jimp(img.width, img.height);
  out.bitmap.data = Buffer.from(rgba);
  return out.getBufferAsync(Jimp.MIME_PNG);
}

/** Imagem -> webp estático com fundo transparente */
async function imageToWebp(buffer) {
  const sharp = sharpLib();
  if (sharp) {
    try {
      // contain preserva proporção, fundo transparente, 512x512 garantido
      return await sharp(buffer, { failOn: 'none' })
        .rotate() // respeita EXIF orientation
        .resize(512, 512, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
          kernel: 'lanczos3',
        })
        .webp({ quality: 85, effort: 4, alphaQuality: 90 })
        .toBuffer();
    } catch (err) {
      logger.warn({ err: err.message }, 'sharp falhou, tentando próximo conversor');
      _sharp = null;
    }
  }
  if (hasFfmpeg()) {
    const input = tmpName('in.png');
    const output = tmpName('out.webp');
    fs.writeFileSync(input, buffer);
    try {
      await exec('ffmpeg', [
        '-y', '-i', input,
        // scale com lanczos, pad transparente, garante 512x512
        '-vf', 'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba',
        '-frames:v', '1',
        '-vcodec', 'libwebp',
        '-lossless', '0',
        '-q:v', '85',
        '-compression_level', '4',
        output,
      ]);
      return fs.readFileSync(output);
    } catch (err) {
      logger.warn({ err: err.message }, 'ffmpeg falhou, tentando node-webpmux');
    } finally {
      deleteFile(input);
      deleteFile(output);
    }
  }
  try {
    return await webpmuxImageToWebp(buffer);
  } catch (err) {
    logger.warn({ err: err.message }, 'node-webpmux falhou');
  }
  const e = new Error('Nenhum conversor disponível. Instale o ffmpeg (pkg install ffmpeg) para criar stickers.');
  e.code = 'CONVERTER_UNAVAILABLE';
  throw e;
}

/** Vídeo/GIF -> webp animado 512x512 transparente */
async function videoToWebp(buffer, maxSeconds) {
  if (!hasFfmpeg()) {
    const e = new Error('Para stickers de vídeo/GIF é necessário o ffmpeg (pkg install ffmpeg).');
    e.code = 'CONVERTER_UNAVAILABLE';
    throw e;
  }
  const input = tmpName('in');
  const output = tmpName('out.webp');
  fs.writeFileSync(input, buffer);
  try {
    await exec('ffmpeg', [
      '-y', '-i', input,
      '-t', String(maxSeconds || CONFIG.limits.stickerMaxSeconds),
      // 10 fps, scale lanczos, pad transparente 512x512 quadrado
      '-vf', 'fps=10,scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba',
      '-vcodec', 'libwebp',
      '-lossless', '0',
      '-q:v', '70',
      '-compression_level', '4',
      '-loop', '0',
      '-an',
      output,
    ]);
    return fs.readFileSync(output);
  } finally {
    deleteFile(input);
    deleteFile(output);
  }
}

async function stickerToVideo(buffer) {
  if (!hasFfmpeg()) {
    const e = new Error('Para converter sticker em vídeo é necessário o ffmpeg (pkg install ffmpeg).');
    e.code = 'CONVERTER_UNAVAILABLE';
    throw e;
  }
  const input = tmpName('in.webp');
  const output = tmpName('out.mp4');
  fs.writeFileSync(input, buffer);
  try {
    await exec('ffmpeg', [
      '-y', '-i', input,
      '-movflags', '+faststart',
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      output,
    ]);
    return fs.readFileSync(output);
  } finally {
    deleteFile(input);
    deleteFile(output);
  }
}

async function stickerToGif(buffer) {
  if (!hasFfmpeg()) {
    const e = new Error('Para converter sticker em GIF é necessário o ffmpeg (pkg install ffmpeg).');
    e.code = 'CONVERTER_UNAVAILABLE';
    throw e;
  }
  const input = tmpName('in.webp');
  const output = tmpName('out.gif');
  fs.writeFileSync(input, buffer);
  try {
    await exec('ffmpeg', [
      '-y', '-i', input,
      '-vf', 'fps=15,scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos',
      output,
    ]);
    return fs.readFileSync(output);
  } finally {
    deleteFile(input);
    deleteFile(output);
  }
}

/** GIF -> webp animado SEM ffmpeg (puro JS) — 512x512 transparente */
async function gifToWebp(buffer, maxFrames = 50) {
  let omggif;
  try {
    omggif = require('omggif');
  } catch (_) {
    const e = new Error('GIF animado precisa do ffmpeg (pkg install ffmpeg).');
    e.code = 'CONVERTER_UNAVAILABLE';
    throw e;
  }
  const Jimp = require('jimp');
  const { Image } = require('node-webpmux');
  const reader = new omggif.GifReader(new Uint8Array(buffer));
  const total = reader.numFrames();
  if (!total) throw new Error('GIF sem quadros.');
  const step = Math.max(1, Math.ceil(total / maxFrames));
  const frames = [];
  let canvasW = STICKER_SIZE;
  let canvasH = STICKER_SIZE;
  for (let i = 0; i < total; i += step) {
    const info = reader.frameInfo(i);
    const px = new Uint8Array(reader.width * reader.height * 4);
    reader.decodeAndBlitFrameRGBA(i, px);
    let img = new Jimp(reader.width, reader.height);
    img.bitmap.data = Buffer.from(px);
    if (info.x !== 0 || info.y !== 0 || info.width !== reader.width || info.height !== reader.height) {
      img = img.crop(info.x, info.y, info.width, info.height);
    }
    img = await fitSticker(img);
    canvasW = img.bitmap.width;
    canvasH = img.bitmap.height;
    const webp = await jimpToWebp(img);
    const delay = Math.max(20, (info.delay || 0) * 10);
    frames.push(await Image.generateFrame({ buffer: webp, delay }));
  }
  const out = await Image.save(null, { frames, width: canvasW, height: canvasH, loops: 0 });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

async function webpToPng(buffer) {
  const sharp = sharpLib();
  if (sharp) {
    try {
      return await sharp(buffer).png().toBuffer();
    } catch (err) {
      logger.warn({ err: err.message }, 'sharp falhou em webp→png');
      _sharp = null;
    }
  }
  if (hasFfmpeg()) {
    const input = tmpName('in.webp');
    const output = tmpName('out.png');
    fs.writeFileSync(input, buffer);
    try {
      await exec('ffmpeg', ['-y', '-i', input, output]);
      return fs.readFileSync(output);
    } catch (err) {
      logger.warn({ err: err.message }, 'ffmpeg falhou em webp→png, tentando node-webpmux');
    } finally {
      deleteFile(input);
      deleteFile(output);
    }
  }
  try {
    return await webpmuxWebpToPng(buffer);
  } catch (err) {
    logger.warn({ err: err.message }, 'node-webpmux falhou em webp→png');
  }
  const e = new Error('Nenhum conversor disponível (sharp/ffmpeg).');
  e.code = 'CONVERTER_UNAVAILABLE';
  throw e;
}

/* ------------------------------ metadados ---------------------------- */

let _webpmux;
function webpmux() {
  if (_webpmux === undefined) {
    try {
      _webpmux = require('node-webpmux');
    } catch (_) {
      _webpmux = null;
    }
  }
  return _webpmux;
}

async function validateSticker(buffer) {
  const res = { ok: false, reason: null, bytes: 0, width: 0, height: 0, animated: false, alpha: false };
  if (!buffer || !Buffer.isBuffer(buffer)) {
    res.reason = 'INVALID_STICKER_BUFFER';
    return res;
  }
  res.bytes = buffer.length;
  if (buffer.length === 0) {
    res.reason = 'EMPTY_STICKER_BUFFER';
    return res;
  }
  if (buffer.length > STICKER_MAX_BYTES) {
    res.reason = 'STICKER_TOO_BIG';
    return res;
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    res.reason = 'NOT_WEBP';
    return res;
  }
  const chunks = [];
  let off = 12;
  while (off + 8 <= buffer.length) {
    const fourcc = buffer.toString('ascii', off, off + 4);
    const size = buffer.readUInt32LE(off + 4);
    chunks.push(fourcc);
    off += 8 + size + (size & 1);
    if (off > buffer.length + 1) {
      res.reason = 'CHUNK_OVERFLOW';
      return res;
    }
  }
  if (!chunks.some((c) => c === 'VP8 ' || c === 'VP8L' || c === 'VP8X')) {
    res.reason = 'NO_IMAGE_CHUNK';
    return res;
  }

  try {
    const { Image } = require('node-webpmux');
    const img = new Image();
    await img.load(buffer);
    res.width = img.width;
    res.height = img.height;
    res.animated = !!img.hasAnim;
    res.alpha = !!img.hasAlpha;
    if (!img.width || !img.height) {
      res.reason = 'ZERO_DIMS';
      return res;
    }
    if (img.width > 512 || img.height > 512) {
      res.reason = 'TOO_BIG_DIMS';
      return res;
    }
  } catch (err) {
    res.reason = 'UNPARSEABLE';
    logger.warn({ err: err.message }, 'validateSticker: parser não conseguiu ler o webp');
    return res;
  }

  try {
    const { Image } = require('node-webpmux');
    await Image.initLib();
    const img = new Image();
    await img.load(buffer);
    const px = res.animated ? await img.getFrameData(0) : await img.getImageData();
    if (!res.animated && px && px.length) {
      let allTransparent = true;
      for (let i = 3; i < px.length; i += 4) {
        if (px[i] !== 0) {
          allTransparent = false;
          break;
        }
      }
      if (allTransparent) {
        res.reason = 'ALL_TRANSPARENT';
        return res;
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'validateSticker: decodificação profunda indisponível');
  }

  res.ok = true;
  return res;
}

function buildStickerExif(json) {
  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const jsonBuff = Buffer.from(JSON.stringify(json), 'utf-8');
  const exif = Buffer.concat([exifAttr, jsonBuff]);
  exif.writeUIntLE(jsonBuff.length, 14, 4);
  return exif;
}

async function setStickerMetadata(webpBuffer, { packname, author, emoji }) {
  const mux = webpmux();
  if (!mux) return webpBuffer;

  const safePack = String(packname || CONFIG.bot.name || 'Lua').slice(0, 60).trim() || CONFIG.bot.name;
  const safeAuthor = String(author || CONFIG.bot.author || 'Lua').slice(0, 120).trim() || CONFIG.bot.author;

  const json = {
    'sticker-pack-id': 'com.lua.bot',
    'sticker-pack-name': safePack,
    'sticker-pack-publisher': safeAuthor,
  };
  if (emoji) json.emojis = [String(emoji).slice(0, 8)];

  try {
    const { Image } = mux;
    const img = new Image();
    await img.load(webpBuffer);
    img.exif = buildStickerExif(json);
    const out = await img.save(null);
    if (!Buffer.isBuffer(out) || out.length === 0) return webpBuffer;
    const check = await validateSticker(out);
    if (!check.ok) {
      logger.warn({ reason: check.reason }, '[STICKER ERROR] stage=metadata reason=INVALID_WEBP — enviando sem metadados');
      return webpBuffer;
    }
    return out;
  } catch (err) {
    logger.warn({ err: err.message }, 'falha ao gravar metadados do sticker (enviando sem)');
    return webpBuffer;
  }
}

/* --------------------------- operações de imagem --------------------- */

async function processImage(buffer, op, params = {}) {
  const Jimp = require('jimp');
  const img = await Jimp.read(buffer);
  const w = params.width || 512;
  const h = params.height || 512;
  switch (op) {
    case 'circle': {
      // circle perfeito 512x512 com fundo transparente
      const sized = img.clone().cover(w, h);
      sized.circle();
      const canvas = new Jimp(STICKER_SIZE, STICKER_SIZE, 0x00000000);
      const x = Math.floor((STICKER_SIZE - sized.bitmap.width) / 2);
      const y = Math.floor((STICKER_SIZE - sized.bitmap.height) / 2);
      canvas.composite(sized, x, y);
      return canvas.getBufferAsync(Jimp.MIME_PNG);
    }
    case 'crop':
      img.cover(w, h);
      break;
    case 'resize':
      img.resize(w, h);
      break;
    case 'contain':
      img.contain(w, h);
      break;
    default:
      break;
  }
  return img.getBufferAsync(Jimp.MIME_PNG);
}

const STICKER_MAX_BYTES = 500 * 1024;

async function ensureStickerSize(webp, opts = {}) {
  if (!webp || webp.length <= STICKER_MAX_BYTES) return webp;

  if (opts.animated) {
    if (hasFfmpeg()) {
      const input = tmpName('big.webp');
      const output = tmpName('small.webp');
      fs.writeFileSync(input, webp);
      try {
        await exec('ffmpeg', [
          '-y', '-i', input,
          '-vf', 'fps=10,scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba',
          '-c:v', 'libwebp', '-lossless', '0', '-q:v', '60', '-compression_level', '4', '-loop', '0', '-an', output,
        ]);
        const out = fs.readFileSync(output);
        if (out.length <= STICKER_MAX_BYTES) return out;
      } catch (err) {
        logger.warn({ err: err.message }, 'recompressão de sticker animado falhou');
      } finally {
        deleteFile(input);
        deleteFile(output);
      }
    }
    const e = new Error('Sticker animado ficou grande demais (limite do WhatsApp: 500 KB). Envie um vídeo/GIF mais curto.');
    e.code = 'STICKER_TOO_BIG';
    throw e;
  }

  try {
    const { Image } = require('node-webpmux');
    await Image.initLib();
    const img = new Image();
    await img.load(webp);
    const rgba = await img.getImageData();
    const Jimp = require('jimp');
    const out = new Jimp(img.width, img.height);
    out.bitmap.data = Buffer.from(rgba);
    const libWebP = require('node-webpmux/libwebp');
    const enc = new libWebP();
    await enc.init();
    const ret = enc.encodeImage(
      new Uint8Array(out.bitmap.data.buffer, out.bitmap.data.byteOffset, out.bitmap.data.byteLength),
      img.width,
      img.height,
      { lossless: 0, quality: 55, method: 4 }
    );
    if (ret.res === 0 && ret.buf) {
      const b = Buffer.from(ret.buf);
      if (b.length <= STICKER_MAX_BYTES) return b;
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'recompressão de sticker falhou');
  }

  const e = new Error('Sticker ficou grande demais (limite do WhatsApp: 500 KB).');
  e.code = 'STICKER_TOO_BIG';
  throw e;
}

function isGif(buffer) {
  return !!(buffer && buffer.length > 4 && buffer.slice(0, 3).toString('ascii') === 'GIF');
}

function resolveColor(name, fallback) {
  const map = {
    vermelho: 0xe74c3cff, red: 0xe74c3cff,
    azul: 0x3498dbff, blue: 0x3498dbff,
    verde: 0x2ecc71ff, green: 0x2ecc71ff,
    amarelo: 0xf1c40fff, yellow: 0xf1c40fff, amarela: 0xf1c40fff,
    rosa: 0xff7ac2ff, pink: 0xff7ac2ff,
    roxo: 0x9b59b6ff, purple: 0x9b59b6ff,
    laranja: 0xe67e22ff, orange: 0xe67e22ff,
    preto: 0x111111ff, black: 0x111111ff, preta: 0x111111ff,
    branco: 0xffffffff, white: 0xffffffff, branca: 0xffffffff,
    cinza: 0x95a5a6ff, gray: 0x95a5a6ff, grey: 0x95a5a6ff,
    transparente: 0x00000000, transparent: 0x00000000,
  };
  const key = String(name || '').toLowerCase().trim();
  if (map[key] !== undefined) return map[key];
  if (/^[0-9a-f]{6,8}$/i.test(key)) {
    // hex com ou sem alpha
    const hex = key.length === 6 ? key + 'ff' : key;
    return parseInt(hex, 16);
  }
  return fallback;
}

/** Cria sticker de texto com quebra inteligente e centralização */
async function textToSticker(text, opts = {}) {
  const Jimp = require('jimp');
  const bg = resolveColor(opts.bg, 0x1f1f2eff); // escuro por padrão para legibilidade (use transparente se quiser)
  const fg = resolveColor(opts.fg, 0xffffffff);
  const raw = String(text || 'Lua').slice(0, 300);
  // quebra em linhas de até ~20 chars para caber em 512
  const words = raw.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 18) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
    if (lines.length >= 7) break;
  }
  if (cur && lines.length < 8) lines.push(cur);
  const finalLines = lines.length ? lines.slice(0, 8) : ['Lua'];

  const isLightBg = bg === 0xffffffff || bg === 0xffffff00 || (bg & 0xffffff00) === 0xf1c40f00;
  const font = fg === 0xffffffff && !isLightBg
    ? await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE)
    : await Jimp.loadFont(Jimp.FONT_SANS_64_BLACK);

  const width = STICKER_SIZE;
  const height = STICKER_SIZE;
  const img = new Jimp(width, height, bg);

  // calcula altura total do texto para centralizar verticalmente
  const lineHeight = 64;
  const totalTextH = finalLines.length * lineHeight;
  const startY = Math.max(10, Math.floor((height - totalTextH) / 2));

  finalLines.forEach((line, i) => {
    const tw = Jimp.measureText(font, line);
    const th = Jimp.measureTextHeight(font, line, width);
    const x = Math.max(4, Math.floor((width - tw) / 2));
    const y = startY + i * lineHeight;
    img.print(font, x, y, line);
  });

  const png = await img.getBufferAsync(Jimp.MIME_PNG);
  return imageToWebp(png);
}

module.exports = {
  imageToWebp,
  videoToWebp,
  gifToWebp,
  webpToPng,
  stickerToVideo,
  stickerToGif,
  setStickerMetadata,
  ensureStickerSize,
  validateSticker,
  isGif,
  processImage,
  textToSticker,
  hasFfmpeg,
  fitSticker,
};
