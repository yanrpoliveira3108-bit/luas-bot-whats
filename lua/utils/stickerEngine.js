/**
 * utils/stickerEngine.js — conversão de mídia para stickers (webp).
 *
 * Backends (em ordem de preferência):
 *  - sharp (webp a partir de imagem) — opcional
 *  - ffmpeg (imagens/vídeos/GIFs, incluindo animados) — binário de sistema
 *  - jimp (operações de imagem: circle/crop/resize)
 *  - node-webpmux (metadados EXIF do sticker: pack/autor/emoji)
 *
 * Se nenhum backend estiver disponível, o comando responde com erro amigável.
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
    // No Termux/Android (libc bionic), os binários nativos do sharp são
    // compilados para glibc e NÃO carregam — podem até derrubar o processo.
    // O bot tem fallbacks (ffmpeg + node-webpmux WASM), então skip seguro.
    // (Se você compilou o sharp do zero no Termux, defina LUA_ALLOW_SHARP=1.)
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
  return path.join(CONFIG.paths.tmpDir, safeFileName('stk', ext));
}

/* ------------------------------ conversão ---------------------------- */

/**
 * Imagem (PNG/JPEG/...) → webp via jimp + libwebp (wasm, do node-webpmux).
 * Funciona SEM ffmpeg e SEM sharp — é o que garante stickers no Termux/Android.
 * (Usa o encodeImage do libwebp diretamente: o setImageData do node-webpmux
 *  assume um Image já carregado e falha em imagem nova.)
 */
/**
 * WhatsApp só aceita stickers de até 512x512 px. Fotos grandes (3000x4000…)
 * precisam ser redimensionadas ANTES de codificar, senão o sticker sai em
 * branco ou é rejeitado.
 */
const STICKER_MAX = 512;

/** Redimensiona para caber em STICKER_MAX (proporção + padding transparente). */
async function fitSticker(img) {
  const { width, height } = img.bitmap;
  if (width <= STICKER_MAX && height <= STICKER_MAX) return img;
  const Jimp = require('jimp');
  const scaled = img.clone().scaleToFit(STICKER_MAX, STICKER_MAX);
  const canvas = new Jimp(STICKER_MAX, STICKER_MAX, 0x00000000);
  canvas.composite(
    scaled,
    Math.floor((STICKER_MAX - scaled.bitmap.width) / 2),
    Math.floor((STICKER_MAX - scaled.bitmap.height) / 2)
  );
  return canvas;
}

async function webpmuxImageToWebp(buffer) {
  const Jimp = require('jimp');
  const libWebP = require('node-webpmux/libwebp');
  let img = await Jimp.read(buffer);
  img = await fitSticker(img);
  const { width, height, data } = img.bitmap;
  const enc = new libWebP();
  await enc.init();
  const ret = enc.encodeImage(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width,
    height,
    { lossless: 1 }
  );
  if (ret.res !== 0 || !ret.buf) {
    throw new Error(`node-webpmux encodeImage retornou ${ret.res}`);
  }
  return Buffer.from(ret.buf);
}

/**
 * webp → PNG via node-webpmux (decode RGBA) + jimp — sem ffmpeg/sharp.
 */
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

/** Imagem -> webp estático. */
async function imageToWebp(buffer) {
  const sharp = sharpLib();
  if (sharp) {
    try {
      return await sharp(buffer).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 80 }).toBuffer();
    } catch (err) {
      logger.warn({ err: err.message }, 'sharp falhou, tentando próximo conversor');
      _sharp = null; // desativa sharp após falha em runtime (evita repetir o erro)
    }
  }
  if (hasFfmpeg()) {
    const input = tmpName('in.png');
    const output = tmpName('out.webp');
    fs.writeFileSync(input, buffer);
    try {
      await exec('ffmpeg', [
        '-y', '-i', input,
        '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=0x00000000',
        '-frames:v', '1', '-c:v', 'libwebp', '-quality', '80', '-lossless', '0',
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
  // fallback puro (jimp + libwebp wasm) — cobre Termux/Android sem ffmpeg/sharp
  try {
    return await webpmuxImageToWebp(buffer);
  } catch (err) {
    logger.warn({ err: err.message }, 'node-webpmux falhou');
  }
  const e = new Error('Nenhum conversor disponível. Instale o ffmpeg (pkg install ffmpeg) para criar stickers.');
  e.code = 'CONVERTER_UNAVAILABLE';
  throw e;
}

/** Vídeo/GIF -> webp animado (requer ffmpeg). */
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
      '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15',
      '-c:v', 'libwebp', '-lossless', '0', '-q:v', '55', '-loop', '0', '-an',
      '-preset', 'default',
      output,
    ]);
    return fs.readFileSync(output);
  } finally {
    deleteFile(input);
    deleteFile(output);
  }
}

/** Sticker (webp) -> PNG. */
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
  // fallback puro (node-webpmux + jimp) — cobre Termux/Android sem ffmpeg/sharp
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

/** Aplica metadados (pack/autor/emoji) a um webp. */
async function setStickerMetadata(webpBuffer, { packname, author, emoji }) {
  const mux = webpmux();
  if (!mux) return webpBuffer;

  const exif = {
    'sticker-pack-id': 'com.lua.bot',
    'sticker-pack-name': packname || CONFIG.bot.name,
    'sticker-pack-publisher': author || CONFIG.bot.author,
    'android-app-store-link': '',
    'android-app-link': '',
  };
  if (emoji) exif['android-emojis'] = emoji;

  try {
    const { Image } = mux;
    const img = new Image();
    await img.load(webpBuffer);
    img.exif = Buffer.from(JSON.stringify(exif));
    const out = await img.save(null);
    return Buffer.isBuffer(out) ? out : webpBuffer;
  } catch (err) {
    logger.warn({ err: err.message }, 'falha ao gravar metadados do sticker');
    return webpBuffer;
  }
}

/* --------------------------- operações de imagem --------------------- */

/** Aplica circle/crop/resize/contain a uma imagem (jimp). */
async function processImage(buffer, op, params = {}) {
  const Jimp = require('jimp');
  const img = await Jimp.read(buffer);
  const w = params.width || 512;
  const h = params.height || 512;
  switch (op) {
    case 'circle':
      img.circle();
      break;
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

/** Nome de cor (pt/en/hex) -> cor RGBA. */
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
  };
  const key = String(name || '').toLowerCase().trim();
  if (map[key] !== undefined) return map[key];
  if (/^[0-9a-f]{6}$/i.test(key)) return parseInt(key + 'ff', 16);
  return fallback;
}

/** Cria sticker de texto (jimp, fonte bitmap embutida) com cor de fundo. */
async function textToSticker(text, opts = {}) {
  const Jimp = require('jimp');
  const bg = resolveColor(opts.bg, 0x1f1f2eff);
  const fg = resolveColor(opts.fg, 0xffffffff);
  const lines = String(text || 'Lua').slice(0, 200).split(/\n+/).filter((l) => l.trim()).slice(0, 6);
  // fonte branca padrão; para fundos claros usa preto
  const font = fg === 0xffffffff
    ? await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE)
    : await Jimp.loadFont(Jimp.FONT_SANS_64_BLACK);
  const width = 512;
  const height = 512; // WhatsApp: sticker deve ser <= 512x512
  const top = 32;
  const lineH = lines.length ? Math.min(80, Math.floor((height - top - 16) / lines.length)) : 80;
  const img = new Jimp(width, height, bg);
  lines.forEach((line, i) => {
    const tw = Jimp.measureText(font, line);
    img.print(font, Math.max(4, Math.floor((width - tw) / 2)), top + i * lineH, line);
  });
  const png = await img.getBufferAsync(Jimp.MIME_PNG);
  return imageToWebp(png);
}

module.exports = {
  imageToWebp,
  videoToWebp,
  webpToPng,
  setStickerMetadata,
  processImage,
  textToSticker,
  hasFfmpeg,
};
