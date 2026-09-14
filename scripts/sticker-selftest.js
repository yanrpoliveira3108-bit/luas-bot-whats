/**
 * scripts/sticker-selftest.js — Auto-teste LOCAL do pipeline de stickers.
 *
 * Roda TODA a cadeia de conversão SEM depender do WhatsApp, para descobrir em
 * qual etapa o sticker quebra no aparelho. Ideal para rodar no Termux do
 * celular quando o "!sticker não funciona":
 *
 *     node scripts/sticker-selftest.js
 *
 * Etapas verificadas (na ordem do pipeline real):
 *   1. ambiente (node, ffmpeg, sharp, node-webpmux/wasm)
 *   2. imagem  → webp (512x512, fundo branco) + validação estrutural
 *   3. vídeo   → webp animado (ffmpeg) + validação + limite de 500 KB
 *   4. metadados EXIF (pack/autor) + revalidação
 *
 * Saída: caixa no terminal com ✓/✗ por etapa + diagnóstico do que falta.
 * Não conecta no WhatsApp e não grava nada fora do diretório temporário.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const engine = require('../utils/stickerEngine');
const { drawBox, separator } = require('../utils/terminal');

const TMP = require('../config').paths.tmpDir;
try { fs.mkdirSync(TMP, { recursive: true }); } catch (_) {}

const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? '  → ' + detail : ''}`);
}

function ffmpegAvailable() {
  try {
    const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return !r.error;
  } catch (_) {
    return false;
  }
}

async function testWasm() {
  try {
    const { Image } = require('node-webpmux');
    await Image.initLib();
    return { ok: true };
  } catch (err) {
    return { ok: false, err: err.message };
  }
}

async function makePng(w, h) {
  const Jimp = require('jimp');
  const img = new Jimp(w, h);
  // gradiente simples para ter conteúdo real (não-sólido)
  for (let x = 0; x < w; x += 4) {
    for (let y = 0; y < h; y += 4) {
      img.setPixelColor(
        Jimp.rgbaToInt((x * 255 / w) | 0, (y * 255 / h) | 0, 128, 255),
        x,
        y
      );
    }
  }
  return img.getBufferAsync(Jimp.MIME_PNG);
}

async function makeTestVideo() {
  const out = path.join(TMP, 'selftest_src.mp4');
  const r = spawnSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=256x256:rate=10:duration=2',
    '-pix_fmt', 'yuv420p', out,
  ], { stdio: 'ignore' });
  if (r.error || r.status !== 0) throw new Error('ffmpeg não gerou vídeo de teste');
  const buf = fs.readFileSync(out);
  fs.unlinkSync(out);
  return buf;
}

(async () => {
  separator('═', 52);
  console.log('🖼️  AUTO-TESTE DE STICKERS (local, sem WhatsApp)');
  separator('═', 52);

  // ---- 1) ambiente ----
  console.log('\n[1/4] Ambiente');
  check('Node', true, `${process.version} · plataforma ${process.platform}${process.env.TERMUX_VERSION ? ' (Termux)' : ''}`);
  const hasFf = ffmpegAvailable();
  check('ffmpeg', hasFf, hasFf ? 'disponível no PATH' : 'AUSENTE → `pkg install ffmpeg`');
  let hasSharp = false;
  try { require('sharp'); hasSharp = true; } catch (_) {}
  if (hasSharp) {
    check('sharp', true, 'carregou (opcional, acelera a conversão)');
  } else {
    console.log('• sharp  → ausente (OPCIONAL — ignorar; usa ffmpeg/wasm)');
  }
  const wasm = await testWasm();
  check('node-webpmux (wasm)', wasm.ok, wasm.ok ? 'decode ok' : `FALHOU → ${wasm.err}`);

  // ---- 2) imagem → webp ----
  console.log('\n[2/4] Imagem → WebP estático');
  try {
    const pngBig = await makePng(1500, 1000);
    const webp = await engine.imageToWebp(pngBig);
    const v = await engine.validateSticker(webp);
    check('conversão imagem grande (1500×1000)', v.ok, `${v.width}×${v.height} · ${(v.bytes / 1024).toFixed(1)} KB · ${v.reason || 'válido'}`);
    if (!v.ok) console.log('   ⚠️  reason:', v.reason);

    const pngSmall = await makePng(200, 200);
    const webp2 = await engine.imageToWebp(pngSmall);
    const v2 = await engine.validateSticker(webp2);
    check('conversão imagem pequena (200×200)', v2.ok, `${v2.width}×${v2.height} · ${v2.reason || 'válido'}`);
  } catch (err) {
    check('conversão imagem', false, err.message);
  }

  // ---- 3) vídeo → webp animado (requer ffmpeg) ----
  console.log('\n[3/4] Vídeo → WebP animado');
  if (!hasFf) {
    console.log('✗ pulado: ffmpeg ausente (vídeos/GIFs animados NÃO vão funcionar)');
    results.push({ label: 'vídeo → webp animado', ok: false, detail: 'ffmpeg ausente' });
  } else {
    try {
      const video = await makeTestVideo();
      const webp = await engine.videoToWebp(video, 10);
      const v = await engine.validateSticker(webp);
      check('conversão vídeo (2s) → webp', v.ok, `${v.width}×${v.height} · animado=${v.animated} · ${(v.bytes / 1024).toFixed(1)} KB · ${v.reason || 'válido'}`);
      if (v.ok && v.bytes > 500 * 1024) {
        check('tamanho ≤ 500 KB', false, `${(v.bytes / 1024).toFixed(1)} KB estourou o limite`);
      }
    } catch (err) {
      check('conversão vídeo → webp', false, err.message);
    }
  }

  // ---- 4) metadados EXIF ----
  console.log('\n[4/4] Metadados (EXIF pack/autor)');
  try {
    const png = await makePng(300, 300);
    const webp = await engine.imageToWebp(png);
    const meta = await engine.setStickerMetadata(webp, { packname: 'Lua Bot', author: 'MRX style' });
    const v = await engine.validateSticker(meta);
    const hasExifChunk = meta.toString('ascii').includes('EXIF');
    check('EXIF gravado + revalidação', v.ok && hasExifChunk, `${v.width}×${v.height} · EXIF=${hasExifChunk ? 'sim' : 'não'} · ${v.reason || 'válido'}`);
  } catch (err) {
    check('metadados EXIF', false, err.message);
  }

  // ---- resumo ----
  separator('═', 52);
  const fails = results.filter((r) => !r.ok);
  const lines = [
    `Etapas: ${results.length} · OK: ${results.length - fails.length} · Falhas: ${fails.length}`,
  ];
  if (fails.length === 0) {
    lines.push('✅ Pipeline de sticker OK neste aparelho.');
    lines.push('Se o !sticker falhar mesmo assim, o problema');
    lines.push('é no ENVIO (rede/Baileys) — cole o log');
    lines.push('[STICKER] do terminal ao rodar !sticker.');
  } else {
    lines.push('❌ Corrija o(s) item(ns) acima.');
    for (const f of fails) lines.push(`   ✗ ${f.label}`);
    if (!hasFf) lines.push('💡 pkg install ffmpeg → vídeo/GIF animado.');
    if (!wasm.ok) lines.push('💡 npm install node-webpmux (wasm falhou)');
  }
  drawBox(lines, { title: 'RESULTADO DO AUTO-TESTE', width: 54 });
})();
