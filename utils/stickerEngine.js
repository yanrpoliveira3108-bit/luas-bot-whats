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
  // safeFileName remove o ponto da extensão (ex.: 'out.webp' → 'outweb'), o que
  // fazia o ffmpeg falhar com "Unable to choose an output format". Aqui geramos
  // um nome seguro SEM extensão e anexamos a extensão real (com ponto).
  const base = safeFileName('stk', '');
  const e = String(ext || '')
    .split('.')
    .pop()
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8);
  return path.join(CONFIG.paths.tmpDir, `${base}.${e || 'bin'}`);
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
  // fundo BRANCO opaco (transparente pode virar "figurinha fantasma" no WhatsApp)
  const canvas = new Jimp(STICKER_MAX, STICKER_MAX, 0xffffffff);
  canvas.composite(
    scaled,
    Math.floor((STICKER_MAX - scaled.bitmap.width) / 2),
    Math.floor((STICKER_MAX - scaled.bitmap.height) / 2)
  );
  return canvas;
}

async function webpmuxImageToWebp(buffer) {
  const Jimp = require('jimp');
  let img = await Jimp.read(buffer);
  return jimpToWebp(img);
}

/** Codifica um Jimp (já redimensionado) para webp estático lossy. */
async function jimpToWebp(img) {
  const libWebP = require('node-webpmux/libwebp');
  img = await fitSticker(img);
  const { width, height, data } = img.bitmap;
  const enc = new libWebP();
  await enc.init();
  // lossy (lossless=0 + qualidade) gera webp muito menor — essencial para fotos
  // reais não estourarem o limite de tamanho do WhatsApp quando o ffmpeg não
  // está disponível e este fallback é o único caminho.
  const ret = enc.encodeImage(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width,
    height,
    { lossless: 0, quality: 75 }
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
      // fundo BRANCO opaco (transparente pode virar "figurinha fantasma")
      return await sharp(buffer).resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).webp({ quality: 80 }).toBuffer();
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
        // fundo BRANCO (transparente vira "figurinha fantasma" em vários
        // Androids) + rgba explícito antes do libwebp
        '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white,format=rgba',
        '-frames:v', '1', '-vcodec', 'libwebp', '-lossless', '0', '-q:v', '75',
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
      // pad BRANCO para 512x512 quadrado (WhatsApp rejeita animado não
      // quadrado) + rgba + 10 fps, no mesmo padrão do caso do usuário
      '-vf', 'fps=10,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white,format=rgba',
      '-vcodec', 'libwebp', '-lossless', '0', '-q:v', '60', '-loop', '0', '-an',
      output,
    ]);
    return fs.readFileSync(output);
  } finally {
    deleteFile(input);
    deleteFile(output);
  }
}

/** Sticker (webp animado) -> vídeo mp4 (requer ffmpeg). */
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

/** Sticker (webp animado) -> GIF (requer ffmpeg). */
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
      '-vf', 'fps=15,scale=512:512:force_original_aspect_ratio=decrease',
      output,
    ]);
    return fs.readFileSync(output);
  } finally {
    deleteFile(input);
    deleteFile(output);
  }
}

/**
 * GIF -> webp animado SEM ffmpeg (decodificador puro + node-webpmux).
 * É o "outro jeito" de fazer sticker animado no Termux/Android sem binário.
 */
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
  let canvasW = 0;
  let canvasH = 0;
  for (let i = 0; i < total; i += step) {
    const info = reader.frameInfo(i);
    // omggif: pixels deve ter o tamanho do canvas inteiro; o quadro fica em (x,y)
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
    const delay = Math.max(20, (info.delay || 0) * 10); // centisegundos → ms
    frames.push(await Image.generateFrame({ buffer: webp, delay }));
  }
  const out = await Image.save(null, { frames, width: canvasW, height: canvasH, loops: 0 });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
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

/**
 * Validação REAL de um sticker (WebP) antes de enviar.
 * Não confia em extensão: checa assinatura RIFF/WEBP, chunks e dimensões com o
 * parser puro (WebPReader, SEM wasm — funciona em qualquer Termux/Android).
 * A decodificação profunda de pixels (libwebp/wasm) é BEST-EFFORT: se o wasm
 * estiver indisponível, a validação estrutural continua valendo e o envio NÃO
 * é bloqueado por isso (evita o "sticker não cria por nada" em aparelhos sem
 * wasm funcionando).
 * @returns {{ok:boolean, reason:string|null, bytes:number, width:number, height:number, animated:boolean, alpha:boolean}}
 */
async function validateSticker(buffer) {
  const res = { ok: false, reason: null, bytes: 0, width: 0, height: 0, animated: false, alpha: false };
  // ---- 1) checagens estruturais (JS puro, sempre rodam) ----
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
  // varre os chunks RIFF (VP8 /VP8L/VP8X são os que carregam imagem)
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

  // dimensões via parser puro (WebPReader) — sem wasm
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

  // ---- 2) decodificação profunda (best-effort — wasm pode não existir) ----
  try {
    const { Image } = require('node-webpmux');
    await Image.initLib();
    const img = new Image();
    await img.load(buffer);
    const px = res.animated ? await img.getFrameData(0) : await img.getImageData();
    if (!res.animated && px && px.length) {
      // sticker 100% transparente = invisível no WhatsApp ("fantasma")
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
    // wasm indisponível/falhou: mantém a validação estrutural — não bloqueia envio
    logger.warn({ err: err.message }, 'validateSticker: decodificação profunda indisponível, usando validação estrutural');
  }

  res.ok = true;
  return res;
}

/**
 * Monta o chunk EXIF no formato canônico que o WhatsApp reconhece:
 * cabeçalho TIFF little-endian ("II*\0..." + ponteiros) + JSON UTF-8 com
 * sticker-pack-id/name/publisher e emojis. Sem esse cabeçalho, o WhatsApp
 * ignora o nome do pacote/autor/emoji da figurinha (e em alguns aparelhos o
 * sticker sai sem o atalho de "adicionar aos favoritos").
 * É o mesmo formato usado nos bots de sticker que funcionam (ex.: MRX).
 */
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

/** Aplica metadados (pack/autor/emoji) a um webp. */
async function setStickerMetadata(webpBuffer, { packname, author, emoji }) {
  const mux = webpmux();
  if (!mux) return webpBuffer;

  const json = {
    'sticker-pack-id': 'com.lua.bot',
    'sticker-pack-name': packname || CONFIG.bot.name,
    'sticker-pack-publisher': author || CONFIG.bot.author,
  };
  if (emoji) json.emojis = [emoji];

  try {
    const { Image } = mux;
    const img = new Image();
    await img.load(webpBuffer);
    img.exif = buildStickerExif(json);
    const out = await img.save(null);
    if (!Buffer.isBuffer(out) || out.length === 0) return webpBuffer;
    // se gravar os metadados corromper o webp, envia SEM metadados (figurinha
    // visível > figurinha "fantasma" com nome do pack)
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

/** Limite de tamanho do WhatsApp para stickers (~500 KB). */
const STICKER_MAX_BYTES = 500 * 1024;

/**
 * Garante que o webp caiba no limite do WhatsApp; se passar, re-comprime
 * (animado via ffmpeg mais agressivo; estático via libwebp com qualidade menor).
 * Lança STICKER_TOO_BIG se não der para reduzir o suficiente.
 */
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
          '-vf', 'fps=10,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=0x00000000',
          '-c:v', 'libwebp', '-lossless', '0', '-q:v', '75', '-loop', '0', '-an', output,
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

  // estático: decodifica e re-codifica com qualidade menor
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
      { lossless: 0, quality: 55 }
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

/** Detecta se um buffer é GIF (bytes mágicos GIF87a/GIF89a). */
function isGif(buffer) {
  return !!(buffer && buffer.length > 4 && buffer.slice(0, 3).toString('ascii') === 'GIF');
}

/** Nome de cor (pt/en/hex) -> cor RGBA. */
function resolveColor(name, fallback) {  const map = {
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
};
