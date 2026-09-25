#!/usr/bin/env node
/**
 * scripts/diagnose.js — diagnóstico do ambiente (feito para Termux/Android).
 *
 * Uso:  node scripts/diagnose.js
 *
 * Verifica, com saída clara ✅/❌/⚠️, tudo o que o Lua precisa para:
 *   - stickers (sharp/ffmpeg/node-webpmux)
 *   - downloads (Node, fetch, rede, YouTube/TikTok/…)
 *   - IA (Node, fetch, provider local)
 * No final imprime um resumo com os comandos exatos a instalar.
 */

'use strict';

const { spawnSync } = require('child_process');

let pass = 0;
let warn = 0;
let fail = 0;

function ok(msg) { pass++; console.log('✅ ' + msg); }
function warn_(msg) { warn++; console.log('⚠️ ' + msg); }
function bad(msg) { fail++; console.log('❌ ' + msg); }

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), ms)),
  ]);
}

async function netTest(name, fn, ms = 10000) {
  try {
    const r = await withTimeout(fn(), ms);
    ok(name + (r ? ' → ' + r : ''));
  } catch (e) {
    bad(name + ' → ' + e.message);
  }
}

(async () => {
  console.log('════════════════════════════════════════════');
  console.log('  🔍 LUA BOT — DIAGNÓSTICO DO AMBIENTE');
  console.log('════════════════════════════════════════════\n');

  /* ------------------------------ Node ------------------------------- */
  const [maj, min] = process.versions.node.split('.').map(Number);
  const nodeOk = maj > 22 || (maj === 22) || (maj === 21) || (maj === 20 && min >= 18);
  console.log('【1/8】 NODE.JS');
  console.log('  Versão: ' + process.version);
  if (maj >= 22) ok('Node ≥ 22 (ideal p/ better-sqlite3 13 e ytdl-core)');
  else if (nodeOk) warn_('Node 20.18+ funciona, mas o ideal é Node 22 LTS (pkg install nodejs-lts)');
  else bad('Node muito antigo. Instale: pkg install nodejs-lts && hash -r');

  console.log('  Termux/Android: ' + (process.env.TERMUX_VERSION ? 'sim (' + process.env.TERMUX_VERSION + ')' : 'não'));

  /* ------------------------- módulos nativos ------------------------- */
  console.log('\n【2/8】 MÓDULOS NATIVOS');
  try {
    const b = require('../node_modules/better-sqlite3');
    ok('better-sqlite3 carregou');
  } catch (e) {
    bad('better-sqlite3 falhou → ' + e.message.split('\n')[0] +
      '\n     Corrija: pkg install python make clang nodejs-lts && npm rebuild better-sqlite3');
  }

  try {
    require('sharp');
    ok('sharp carregou (opcional)');
  } catch (e) {
    warn_('sharp indisponível (esperado no Termux — o bot usa ffmpeg/node-webpmux no lugar)');
  }

  /* ------------------------------ ffmpeg ----------------------------- */
  console.log('\n【3/8】 FFMPEG (vídeo do YouTube + sticker de vídeo/GIF)');
  try {
    const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    if (!r.error) ok('ffmpeg instalado ✓ (mescla vídeo+áudio do YouTube e faz stickers animados)');
    else bad('ffmpeg NÃO encontrado → pkg install ffmpeg\n     (sem ele: só áudio do YouTube e stickers de imagem)');
  } catch (_) {
    bad('ffmpeg NÃO encontrado → pkg install ffmpeg');
  }

  /* ------------------------------ yt-dlp ----------------------------- */
  console.log('\n【3b/8】 YT-DLP (motor de download do YouTube)');
  try {
    const r = spawnSync('yt-dlp', ['--version'], { stdio: 'ignore', timeout: 15000 });
    if (!r.error && r.status === 0) ok('yt-dlp instalado ✓ (download do YouTube confiável)');
    else bad('yt-dlp NÃO encontrado → pkg install python ffmpeg && pip install -U yt-dlp\n     (sem ele, o YouTube depende do ytdl-core, que vive quebrando)');
  } catch (_) {
    bad('yt-dlp NÃO encontrado → pkg install python && pip install -U yt-dlp');
  }

  /* ------------------------- conversores WASM ------------------------ */
  console.log('\n【4/8】 CONVERSORES PUROS (sem binário nativo)');
  try {
    const Jimp = require('jimp');
    ok('jimp carregou');
  } catch (e) {
    bad('jimp falhou → npm install jimp');
  }
  try {
    const libWebP = require('node-webpmux/libwebp');
    const Jimp = require('jimp');
    const img = new Jimp(64, 64, 0x2ecc71ff);
    const png = await img.getBufferAsync(Jimp.MIME_PNG);
    const { width, height, data } = (await Jimp.read(png)).bitmap;
    const enc = new libWebP();
    await enc.init();
    const ret = enc.encodeImage(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width, height, { lossless: 1 });
    if (ret.res === 0 && ret.buf) ok('node-webpmux (imagem → webp) funciona ✓');
    else bad('node-webpmux falhou ao codificar');
  } catch (e) {
    bad('node-webpmux falhou → ' + e.message.split('\n')[0] + '\n     npm install node-webpmux');
  }

  // teste REAL do pipeline completo de sticker (imagem → webp 512x512 → metadados)
  try {
    const engine = require('../utils/stickerEngine');
    const Jimp = require('jimp');
    const img = new Jimp(700, 900);
    for (let y = 0; y < 900; y += 5) for (let x = 0; x < 700; x += 5) {
      img.setPixelColor(Jimp.rgbaToInt((x * 3) % 255, (y * 5) % 255, (x + y) % 255, 255), x, y);
    }
    const jpeg = await img.getBufferAsync(Jimp.MIME_JPEG);
    const webp = await engine.imageToWebp(jpeg);
    const final = await engine.setStickerMetadata(webp, { packname: 'Lua', author: 'diagnóstico' });
    const { Image } = require('node-webpmux');
    await Image.initLib();
    const im = new Image(); await im.load(final);
    const okDims = im.width <= 512 && im.height <= 512;
    const okRiff = final.toString('ascii', 0, 4) === 'RIFF';
    if (okDims && okRiff) ok(`sticker completo OK ✓ (${im.width}x${im.height}, ${final.length} bytes)`);
    else bad(`pipeline de sticker falhou: ${im.width}x${im.height} RIFF=${okRiff}`);
  } catch (e) {
    bad('pipeline de sticker falhou → ' + e.message.split('\n')[0]);
  }

  /* ------------------------------- fetch ----------------------------- */
  console.log('\n【5/8】 FETCH / REDE');
  console.log('  global.fetch: ' + (typeof fetch === 'function' ? 'disponível' : 'AUSENTE (Node < 18)'));
  if (typeof fetch !== 'function') {
    bad('Sem fetch → os downloads e a IA externa não funcionam. Instale: pkg install nodejs-lts');
  } else {
    await netTest('HTTPS básico (exemplo.com)', async () => {
      const r = await fetch('https://example.com', { method: 'HEAD' });
      return 'HTTP ' + r.status;
    });
  }

  /* ------------------------- envio de mídia -------------------------- */
  console.log('\n【5b/8】 ENVIO DE MÍDIA (Baileys)');
  try {
    const { asMedia } = require('../utils/media');
    const { getStream } = require('@lucasmod/boruto-vk7-baileys/lib/Utils/messages-media');
    const fsx = require('fs');
    const pathx = require('path');
    // No Termux, /tmp NÃO é gravável (EACCES). Usa o tmp do próprio bot.
    const tmpDir = require('../config').paths.tmpDir;
    const p = pathx.join(tmpDir, 'lua-diagnose-media.bin');
    fsx.writeFileSync(p, 'x');
    const s = await getStream(asMedia(p), {});
    const okType = s.type === 'file';
    // lê o stream até o fim (evita corrida com unlink)
    await new Promise((resolve) => {
      s.stream.on('data', () => {});
      s.stream.on('end', resolve);
      s.stream.on('error', resolve);
      s.stream.resume();
    });
    try { fsx.unlinkSync(p); } catch (_) {}
    if (okType) ok('arquivo local → { url } aceito pelo Baileys (downloads enviam corretamente)');
    else bad('Baileys não leu o arquivo local → atualize o código (novo zip)');
  } catch (e) {
    bad('envio de mídia falhou → ' + e.message.split('\n')[0] + '\n     Atualize o código (novo zip).');
  }

  /* ------------------------------ YouTube ---------------------------- */
  console.log('\n【6/8】 YOUTUBE (downloads)');
  try {
    const yts = require('yt-search');
    await netTest('yt-search (busca)', async () => {
      const r = await yts({ query: 'never gonna give you up' });
      const n = (r && r.videos) ? r.videos.length : 0;
      return n + ' resultado(s)';
    }, 15000);
  } catch (e) {
    bad('yt-search não carregou → ' + e.message.split('\n')[0]);
  }

  // teste REAL de download via yt-dlp (motor preferencial)
  try {
    const r = spawnSync('yt-dlp', ['--version'], { stdio: 'ignore', timeout: 15000 });
    if (!r.error && r.status === 0) {
      const fsx = require('fs');
      const pathx = require('path');
      const tmp = require('../config').paths.tmpDir;
      const probe = pathx.join(tmp, 'diag_dl_probe');
      for (const f of fsx.readdirSync(tmp)) {
        if (f.startsWith('diag_dl_probe')) fsx.rmSync(pathx.join(tmp, f), { force: true });
      }
      const dl = spawnSync('yt-dlp', [
        '-f', 'bestaudio[ext=m4a]/bestaudio', '--no-playlist', '--max-filesize', '10M',
        '--no-warnings', '-o', probe + '.%(ext)s',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      ], { stdio: 'ignore', timeout: 60000 });
      let found = null;
      try {
        found = fsx.readdirSync(tmp).find((f) => f.startsWith('diag_dl_probe') && !f.endsWith('.part'));
      } catch (_) {}
      if (!dl.error && found) {
        ok('download de áudio do YouTube via yt-dlp ✓');
        try { fsx.rmSync(pathx.join(tmp, found), { force: true }); } catch (_) {}
      } else {
        warn_('yt-dlp instalado, mas o download de teste falhou (rede/IP bloqueada pelo YouTube? tente com dados móveis).');
      }
    } else {
      warn_('yt-dlp ausente — pulando teste de download (instale com: pip install -U yt-dlp).');
    }
  } catch (e) {
    warn_('teste yt-dlp falhou: ' + e.message.split('\n')[0]);
  }

  try {
    const ytdl = require('@distube/ytdl-core');
    ok('@distube/ytdl-core carregou (fallback)');
  } catch (e) {
    warn_('@distube/ytdl-core não carregou (fallback de YouTube indisponível) → ' + e.message.split('\n')[0]);
  }

  /* ------------------------- providers públicos ---------------------- */
  console.log('\n【7/8】 PROVIDERS (serviços de terceiros)');
  await netTest('TikTok (tikwm)', async () => {
    const r = await fetch('https://www.tikwm.com/api/?url=https://www.tiktok.com/@tiktok/video/7231338487075638570');
    return r.ok ? 'HTTP ' + r.status : 'HTTP ' + r.status;
  });
  await netTest('X/Twitter (fxtwitter)', async () => {
    const r = await fetch('https://api.fxtwitter.com/elonmusk/status/1', { headers: { 'user-agent': 'lua-diagnose' } });
    return 'HTTP ' + r.status;
  });
  await netTest('Reddit (JSON público)', async () => {
    const r = await fetch('https://www.reddit.com/r/aww/hot.json?limit=1', { headers: { 'user-agent': 'lua-diagnose' } });
    return 'HTTP ' + r.status;
  });
  await netTest('Emoji (Twemoji SVG)', async () => {
    const r = await fetch('https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/1f602.svg');
    return 'HTTP ' + r.status;
  });

  /* --------------------------- comandos + IA ------------------------- */
  console.log('\n【8/8】 COMANDOS CARREGADOS + IA');
  try {
    // No Termux, /tmp NÃO é gravável — usa o tmp do próprio bot.
    const pathx = require('path');
    const dbFile = pathx.join(require('../config').paths.tmpDir, 'lua-diagnose.db');
    process.env.DATABASE_FILE = dbFile;
    const fs = require('fs');
    try { fs.rmSync(dbFile, { force: true }); } catch (_) {}
    const database = require('../database/database');
    database.open();
    const { loadCommands } = require('../commands/loader');
    loadCommands(true);
    const { registry } = require('../engine/plugins');
    const byCat = registry.byCategory();
    const stickers = (byCat.get('stickers') || []).length;
    const downloads = (byCat.get('downloads') || []).length;
    const ai = (byCat.get('ai') || []).length;
    console.log(`  Stickers: ${stickers} comandos | Downloads: ${downloads} | IA: ${ai}`);
    if (stickers > 0) ok('categoria stickers carregada');
    else bad('categoria stickers VAZIA (verifique a pasta commands/stickers)');
    if (downloads > 0) ok('categoria downloads carregada');
    else bad('categoria downloads VAZIA');
    if (ai > 0) ok('categoria ia carregada');
    else bad('categoria ia VAZIA (atualize o código: git pull ou novo zip)');
    database.close();

    delete process.env.AI_API_URL;
    delete process.env.AI_API_KEY;
    const aiMod = require('../ai');
    const r = await aiMod.ask({ chatId: 'diag', userId: 'u', text: '2+2*3', mode: 'chat' });
    if (r.ok) ok('IA local respondeu: "' + r.text.slice(0, 50) + '"');
    else bad('IA local falhou: ' + (r.code || r.message));
  } catch (e) {
    bad('falha ao carregar comandos/IA → ' + e.message.split('\n')[0]);
  }

  /* ------------------------------ resumo ----------------------------- */
  console.log('\n════════════════════════════════════════════');
  console.log(`  RESULTADO: ${pass} ok · ${warn} aviso(s) · ${fail} falha(s)`);
  console.log('════════════════════════════════════════════\n');

  const hints = [];
  if (maj < 22) hints.push('pkg install nodejs-lts && hash -r     # Node 22 (obrigatório p/ melhor compatibilidade)');
  const ff = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (ff.error) hints.push('pkg install ffmpeg                    # vídeo do YouTube (mescla) + stickers de vídeo/GIF');
  const yt = spawnSync('yt-dlp', ['--version'], { stdio: 'ignore', timeout: 15000 });
  if (yt.error || yt.status !== 0) hints.push('pip install -U yt-dlp                 # download de YouTube confiável (pkg install python antes)');
  if (typeof fetch !== 'function') hints.push('pkg install nodejs-lts                # fetch (downloads + IA)');

  if (hints.length) {
    console.log('📌 PARA CORRIGIR NO TERMUX, RODE:');
    console.log('  pkg update && pkg upgrade');
    hints.forEach((h) => console.log('  ' + h));
    console.log('\nDepois, dentro da pasta do bot:');
    console.log('  npm install');
    console.log('  npm rebuild better-sqlite3   # se o banco de dados não abrir');
    console.log('  node index.js');
  } else {
    console.log('🎉 Ambiente OK. Se um comando específico ainda falhar, rode:');
    console.log('  node index.js   e veja a linha de erro exata no terminal.');
  }
  console.log('');
  process.exit(fail === 0 ? 0 : 1);
})();
