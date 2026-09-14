/**
 * test/sticker.test.js — engine de stickers (briefing 3 e 51).
 *
 * Verifica o que é independente do conversor instalado: 512x512, fundo
 * transparente (nunca branco), proporção preservada (sem distorção), JPEG sem
 * alpha, imagem já quadrada, buffer inválido e ausência de temporários órfãos.
 *
 * Conversores, em ordem: sharp (lanczos3) → ffmpeg (lanczos + pad) →
 * node-webpmux/jimp. Neste ambiente roda o fallback, então o teste valida o
 * contrato da saída, não o kernel de resize.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));

const Jimp = require('jimp');
const CONFIG = require('../config');
const engine = require('../utils/stickerEngine');

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`  ✔ ${label}`);
};

/** Cria uma imagem de teste com um retângulo opaco centralizado. */
async function makeImage(w, h, mime = Jimp.MIME_PNG) {
  const img = new Jimp(w, h, 0x00000000);
  const x0 = Math.floor(w * 0.1);
  const y0 = Math.floor(h * 0.1);
  const x1 = Math.floor(w * 0.9);
  const y1 = Math.floor(h * 0.9);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) img.setPixelColor(0xff0000ff, x, y);
  }
  return img.getBufferAsync(mime);
}

function tmpFiles() {
  const dir = CONFIG.paths.tmpDir;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .sort();
}

/** Caixa opaca (alpha > 10) do PNG decodificado. */
function opaqueBox(img) {
  let minX = img.bitmap.width;
  let minY = img.bitmap.height;
  let maxX = -1;
  let maxY = -1;
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function scanPx(x, y, idx) {
    if (this.bitmap.data[idx + 3] > 10) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  });
  return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

async function toStickerPng(buffer) {
  const webp = await engine.imageToWebp(buffer);
  assert.ok(webp.length > 100, 'webp não vazio');
  assert.strictEqual(webp.slice(0, 4).toString('ascii'), 'RIFF', 'assinatura RIFF');
  assert.strictEqual(webp.slice(8, 12).toString('ascii'), 'WEBP', 'assinatura WEBP');
  const png = await engine.webpToPng(webp);
  return Jimp.read(png);
}

function cornerAlpha(img) {
  const pts = [
    [0, 0],
    [img.bitmap.width - 1, 0],
    [0, img.bitmap.height - 1],
    [img.bitmap.width - 1, img.bitmap.height - 1],
  ];
  return pts.map(([x, y]) => Jimp.intToRGBA(img.getPixelColor(x, y)).a);
}

(async () => {
  const before = tmpFiles();

  // ---- 1) horizontal 800x400 → 512x512
  let out = await toStickerPng(await makeImage(800, 400));
  assert.strictEqual(out.bitmap.width, 512, 'largura 512');
  assert.strictEqual(out.bitmap.height, 512, 'altura 512');
  ok('sticker: imagem 800x400 → saída 512x512');

  // ---- 2) fundo transparente nos 4 cantos (nunca branco)
  const corners = cornerAlpha(out);
  assert.deepStrictEqual(corners, [0, 0, 0, 0], `cantos com alpha 0, veio ${corners}`);
  ok('sticker: 4 cantos com alpha 0 (sem fundo branco)');

  // ---- 3) proporção preservada no eixo horizontal
  let box = opaqueBox(out);
  let ratio = box.w / box.h;
  assert.ok(ratio > 1.7 && ratio < 2.3, `proporção ~2:1, veio ${ratio.toFixed(2)} (${box.w}x${box.h})`);
  ok(`sticker: proporção preservada na horizontal (${box.w}x${box.h}, ratio ${ratio.toFixed(2)})`);

  // ---- 4) vertical 400x800 → proporção invertida
  out = await toStickerPng(await makeImage(400, 800));
  assert.strictEqual(out.bitmap.width, 512, 'largura 512');
  assert.strictEqual(out.bitmap.height, 512, 'altura 512');
  box = opaqueBox(out);
  ratio = box.w / box.h;
  assert.ok(ratio > 0.4 && ratio < 0.6, `proporção ~1:2, veio ${ratio.toFixed(2)} (${box.w}x${box.h})`);
  assert.deepStrictEqual(cornerAlpha(out), [0, 0, 0, 0], 'cantos transparentes');
  ok(`sticker: imagem 400x800 → 512x512 sem distorcer (${box.w}x${box.h}, ratio ${ratio.toFixed(2)})`);

  // ---- 5) já quadrada 512x510 → continua 512x512 e ocupa quase tudo
  out = await toStickerPng(await makeImage(512, 512));
  assert.strictEqual(out.bitmap.width, 512, 'largura 512');
  assert.strictEqual(out.bitmap.height, 512, 'altura 512');
  box = opaqueBox(out);
  assert.ok(box.w >= 400 && box.h >= 400, `quadrada preenche o canvas, veio ${box.w}x${box.h}`);
  ok(`sticker: imagem já quadrada permanece 512x512 (conteúdo ${box.w}x${box.h})`);

  // ---- 6) JPEG (não tem alpha) → cantos continuam transparentes
  out = await toStickerPng(await makeImage(600, 300, Jimp.MIME_JPEG));
  assert.strictEqual(out.bitmap.width, 512, 'largura 512');
  const jpegCorners = cornerAlpha(out);
  assert.ok(
    jpegCorners.every((a) => a < 128),
    `JPEG não pode ganhar fundo opaco, veio ${jpegCorners}`
  );
  ok(`sticker: JPEG de entrada mantém cantos transparentes (alpha ${jpegCorners.join('/')})`);

  // ---- 7) buffer inválido → erro tratado, sem vazar stack/caminho
  let caught = null;
  try {
    await engine.imageToWebp(Buffer.from('isto definitivamente não é uma imagem'));
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'buffer inválido deve lançar erro');
  assert.ok(caught.code, `erro com código (${caught.code})`);
  assert.ok(!/at\s+.*\.js:\d+:\d+/.test(caught.message), 'mensagem sem stack trace');
  assert.ok(!caught.message.includes(path.resolve(__dirname)), 'mensagem sem caminho interno');
  ok(`sticker: imagem inválida → erro tratado (${caught.code}) sem stack/caminho`);

  // ---- 8) nenhum temporário órfão
  const after = tmpFiles();
  const orphans = after.filter((f) => !before.includes(f));
  assert.deepStrictEqual(orphans, [], `temporários abandonados: ${orphans.join(', ')}`);
  ok(`sticker: nenhum temporário órfão em tmp/ (${after.length} arquivos antes e depois)`);

  console.log(`\n✅ sticker (512x512/alpha/proporção): ${n} verificações, 0 falhas`);
  process.exit(0);
})().catch((err) => {
  console.error(`\n❌ sticker: ${err.message}`);
  process.exit(1);
});
