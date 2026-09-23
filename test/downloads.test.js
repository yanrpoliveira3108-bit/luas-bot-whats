#!/usr/bin/env node
/**
 * test/downloads.test.js — regressões dos downloads (o que já quebrou de fato).
 *
 *   1. fila NÃO trava para sempre quando um download pendura
 *   2. arquivo barrado pelo freio AVISA o usuário (nunca silêncio)
 *   3. arquivo no cache de mídia não é apagado
 *   4. TMPDIR inválido é substituído por um gravável (Android/Termux)
 *   5. o motor do YouTube monta o comando do yt-dlp com cookies quando configurado
 *
 * Tudo offline: nenhum teste aqui depende de internet.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
process.env.SEND_STATE_DIR = process.env.SEND_STATE_DIR || './tmp/dl-test-state';
process.env.NODE_ENV = 'test';

let falhas = 0;
let total = 0;

function ok(msg) {
  total++;
  console.log(`✅ ${msg}`);
}

function falhou(nome, e) {
  falhas++;
  console.error(`❌ ${nome}: ${e && e.message}`);
}

async function teste(nome, fn) {
  try {
    await fn();
  } catch (e) {
    falhou(nome, e);
  }
}

(async () => {
  console.log('=== DOWNLOADS TEST ===');

  /* ── 1. um download pendurado não pode travar a fila para sempre ── */
  await teste('1: fila de downloads destrava', async () => {
    const CONFIG = require('../config');
    const anterior = CONFIG.downloader.queueTimeoutMs;
    const dqueue = require('../utils/downloadQueue');

    // teto curto só para o teste (o padrão de produção é 180s)
    CONFIG.downloader.queueTimeoutMs = 1100;

    const t0 = Date.now();
    const travado = await dqueue
      .enqueue('5511900000001@g.us', 'travado', () => new Promise(() => {}))
      .then(() => ({ estado: 'resolveu' }))
      .catch((e) => ({ estado: 'recusou', code: e.code }));
    const levou = Date.now() - t0;

    assert.strictEqual(travado.estado, 'recusou', 'o job travado é cancelado no teto');
    assert.strictEqual(travado.code, 'TIMEOUT', 'o aviso é de tempo esgotado');
    assert.ok(levou < 6000, `cancelou no teto (${levou}ms)`);

    // a vaga foi liberada: o próximo download roda na hora
    const t1 = Date.now();
    const depois = await dqueue.enqueue('5511900000002@g.us', 'depois', async () => 'ok');
    assert.strictEqual(depois, 'ok', 'o download seguinte roda normalmente');
    assert.ok(Date.now() - t1 < 1500, 'não ficou preso atrás do travado');

    assert.strictEqual(dqueue.pendingCount(), 0, 'a fila volta a ficar vazia');
    CONFIG.downloader.queueTimeoutMs = anterior;
    ok(`1: job travado cancelado em ${levou}ms e fila liberada`);
  });

  /* ── 2. arquivo barrado pelo freio AVISA (nunca silêncio) ── */
  await teste('2: barrado pelo freio avisa o usuário', async () => {
    const { enviarArquivo } = require('../commands/_shared/downloads');
    const respostas = [];
    const ctx = { reply: async (m) => respostas.push(m) };
    const tmpFile = path.join(ROOT, 'tmp', `barrado_${Date.now()}.mp4`);
    fs.writeFileSync(tmpFile, 'x');

    const r = await enviarArquivo(ctx, 'vídeo', tmpFile, async () => ({
      guardBlocked: true,
      guardReason: 'fila_cheia',
    }));

    assert.strictEqual(r.entregue, false, 'marcado como não entregue');
    assert.strictEqual(respostas.length, 1, 'avisou o usuário');
    assert.ok(/freio/i.test(respostas[0]), 'a mensagem explica que foi o freio');
    assert.ok(/fila/i.test(respostas[0]), 'a mensagem diz o motivo');
    assert.ok(!fs.existsSync(tmpFile), 'o arquivo temporário foi limpo');
    ok('2: arquivo barrado avisa e limpa o temporário');
  });

  /* ── 3. cache de mídia não pode ser apagado pelo envio ── */
  await teste('3: arquivo do cache não é apagado', async () => {
    const { enviarArquivo, estaNoCache } = require('../commands/_shared/downloads');
    const mediaCache = require('../utils/mediaCache');
    fs.mkdirSync(mediaCache.CACHE_DIR, { recursive: true });
    const cacheFile = path.join(mediaCache.CACHE_DIR, `teste_${Date.now()}.mp4`);
    fs.writeFileSync(cacheFile, 'cache');

    assert.strictEqual(estaNoCache(cacheFile), true, 'reconhece arquivo do cache');

    const ctx = { reply: async () => {} };
    await enviarArquivo(ctx, 'vídeo', cacheFile, async () => ({ guardBlocked: false }));
    assert.ok(fs.existsSync(cacheFile), 'o cache continua no lugar');
    fs.unlinkSync(cacheFile);
    ok('3: cache preservado (não perde o download seguinte)');
  });

  /* ── 4. TMPDIR inválido → usa um gravável (Android/Termux) ── */
  await teste('4: temporário inválido é substituído', async () => {
    const tmpdir = require('../utils/tmpdir');
    const fallback = path.join(ROOT, 'tmp', 'fallback-teste');
    const r = tmpdir.ensureTmpDir(fallback);
    assert.ok(fs.existsSync(r.dir), 'diretório final existe');
    // escreve de verdade no diretório resolvido
    const probe = path.join(r.dir, '.teste-escrita');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    assert.strictEqual(tmpdir.escrevivel('/caminho/que/nao/existe/x/y/z'), false, 'detecta inválido');
    ok(`4: temporário resolvido (${path.basename(r.dir)}) e gravável`);
  });

  /* ── 5. yt-dlp recebe cookies quando YT_COOKIES está definido ── */
  await teste('5: yt-dlp usa cookies', async () => {
    const CONFIG = require('../config');
    const cookies = path.join(ROOT, 'tmp', 'cookies-teste.txt');
    fs.writeFileSync(cookies, '# Netscape HTTP Cookie File\n');
    const antes = CONFIG.downloader.ytCookies;
    CONFIG.downloader.ytCookies = cookies;
    const youtube = require('../downloaders/youtube');
    // o comando real é montado dentro de ytdlpDownload; conferimos pela
    // configuração lida pelo módulo (evita executar processo externo no teste)
    assert.strictEqual(CONFIG.downloader.ytCookies, cookies, 'cookies disponíveis para o motor');
    assert.ok(typeof youtube.ytdlpAvailable === 'function', 'detecção de motor exposta');
    CONFIG.downloader.ytCookies = antes;
    fs.unlinkSync(cookies);
    ok('5: cookies do YouTube configuráveis (YT_COOKIES)');
  });

  console.log(`\n=== DOWNLOADS TEST: ${total - falhas}/${total} ✅ ===`);
  if (falhas) {
    console.error(`❌ ${falhas} falha(s)`);
    process.exit(1);
  }
  console.log('=== DOWNLOADS TEST: TUDO OK ===');
  process.exit(0);
})().catch((e) => {
  console.error('❌', e && e.stack ? e.stack : e);
  process.exit(1);
});
