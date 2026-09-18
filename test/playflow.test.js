/**
 * test/playflow.test.js — fluxo de mídia em etapas (itens 17, 19, 21, 79, 85).
 *
 * Simula search → resultado → download → envio com o downloader stubado e
 * verifica a interface: estados reais (BUSCANDO/BAIXANDO/ENVIANDO), card com
 * dados verdadeiros, nenhuma porcentagem inventada, cache por
 * youtube:<id>:<tipo>:<qualidade> e limpeza do temporário.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));

const TEST_DB = path.resolve(__dirname, '..', 'database', 'lua-play-test.db');
process.env.DATABASE_FILE = TEST_DB;
for (const suf of ['', '-wal', '-shm']) {
  try {
    fs.rmSync(TEST_DB + suf, { force: true });
  } catch (_) {}
}

const CONFIG = require('../config');
CONFIG.helpers.ensureDirs();

const database = require('../database/database');
database.open();

/* ---------------- stub do downloader (antes de carregar os comandos) ---------------- */

const TMP_AUDIO = path.join(CONFIG.paths.tmpDir, 'play-test-audio.mp3');
fs.mkdirSync(CONFIG.paths.tmpDir, { recursive: true });
fs.writeFileSync(TMP_AUDIO, 'ID3' + 'x'.repeat(4 * 1024 * 1024)); // ~4 MB

const fakeVideo = {
  path: TMP_AUDIO,
  title: 'Imagine Dragons - Believer',
  author: 'Imagine Dragons VEVO',
  duration: 214,
  thumbnail: '',
  mimetype: 'audio/mpeg',
};

const ytPath = require.resolve('../downloaders/youtube');
require.cache[ytPath] = {
  id: ytPath,
  filename: ytPath,
  loaded: true,
  exports: {
    search: async (q) => [
      { title: `${q} (oficial)`, url: 'https://youtu.be/aaa', duration: '3:34', views: 1200000, author: 'Canal Oficial', thumbnail: '' },
      { title: `${q} (ao vivo)`, url: 'https://youtu.be/bbb', duration: '4:12', views: 80000, author: 'Show', thumbnail: '' },
    ],
    validateUrl: () => true,
    downloadAudio: async () => Object.assign({}, fakeVideo),
    downloadVideo: async () => Object.assign({}, fakeVideo, { mimetype: 'video/mp4' }),
  },
};

const fonts = require('../utils/fonts');
const { loadCommands } = require('../commands/loader');
const { registry } = require('../engine/plugins');
loadCommands(true);

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`✅ ${n}: ${label}`);
};

function fakeCtx(prefix = '!') {
  const replies = [];
  const sent = [];
  const ctxRef = {
    replies,
    sent,
    message: { key: { remoteJid: 'j@s.whatsapp.net', id: 'M1' }, message: { conversation: '' } },
    socket: {
      sendMessage: async (jid, payload) => {
        sent.push(payload);
        return { key: { id: `K${sent.length}` } };
      },
    },
    remoteJid: 'j@s.whatsapp.net',
    sender: '5511999990000@s.whatsapp.net',
    isGroup: false,
    isOwner: true,
    isAdmin: true,
    isBotAdmin: true,
    isRegistered: true,
    prefix,
    args: [],
    text: '',
    reply: async (t) => {
      replies.push(String(t));
    },
    sendButtons: async (o) => {
      sent.push(o);
      return true;
    },
    media: [],
    sendAudio: async (file, opts) => {
      ctxRef.media.push({ type: 'audio', file, opts });
      return { key: { id: 'MEDIA1' } };
    },
    sendVideo: async (file, caption, opts) => {
      ctxRef.media.push({ type: 'video', file, caption, opts });
      return { key: { id: 'MEDIA2' } };
    },
    sendImage: async (file, caption) => {
      ctxRef.media.push({ type: 'image', file, caption });
      return { key: { id: 'MEDIA3' } };
    },
  };
  return ctxRef;
}

/** Junta tudo que o usuário viu (replies + payloads de lista/botões). */
function allText(ctx) {
  const parts = ctx.replies.slice();
  for (const p of ctx.sent) {
    if (p && typeof p.text === 'string') parts.push(p.text);
    if (p && p.sections) for (const s of p.sections) for (const r of s.rows) parts.push(`${r.title} ${r.description || ''}`);
  }
  return parts.join('\n');
}

/** Só arquivos (o mediaCache cria o próprio diretório dentro de tmp/). */
function tmpFiles() {
  return fs
    .readdirSync(CONFIG.paths.tmpDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
}

async function main() {
  const beforeTmp = tmpFiles();

  /* ------------------------------- !play ------------------------------- */
  {
    const play = registry.resolveTrigger('play');
    const ctx = fakeCtx();
    ctx.args = ['imagine dragons', 'believer'];
    await play.execute(ctx);

    const text = allText(ctx);
    assert.ok(text.includes('BUSCANDO'), `deve mostrar o estado BUSCANDO: ${text.slice(0, 200)}`);
    assert.ok(text.includes(fonts.apply('PLAY', 'boldScript')), `cabeçalho PLAY estilizado: ${text.slice(0, 120)}`);
    assert.ok(text.includes('Believer') || text.includes('imagine dragons'), 'resultados aparecem');
    assert.ok(text.includes(fonts.safe('PLAY READY', 'bold')) || text.includes('Título'), 'card de resultado presente');
    assert.ok(!/▰+\s*\d+%/.test(text) || /▰/.test(text) === false, 'nenhuma barra de % sem progresso real na busca');
    assert.ok(!/\b(10|20|30|40|55|77)%\b/.test(text), `porcentagem inventada na busca: ${text}`);
    assert.ok(ctx.sent.length > 0, 'lista/botões enviados com os resultados');
    const hasFake = /▰▰▰▰▱/.test(text);
    assert.strictEqual(hasFake, false, 'busca não pode mostrar barra de progresso fake');
    ok('!play: estados reais (BUSCANDO→ENCONTRADO), card com dados, zero % inventado');
  }

  /* ------------------------------- !ytmp3 ------------------------------- */
  {
    const ytmp3 = registry.resolveTrigger('ytmp3');
    const ctx = fakeCtx();
    ctx.args = ['https://youtu.be/aaa'];
    await ytmp3.execute(ctx);

    const text = allText(ctx);
    for (const stage of ['BAIXANDO', 'ENVIANDO']) {
      assert.ok(text.includes(stage), `etapa ${stage} deveria aparecer`);
    }
    assert.ok(text.includes('Imagine Dragons - Believer'), 'título real no card');
    assert.ok(text.includes('Imagine Dragons VEVO'), 'canal real no card');
    assert.ok(/MP3/.test(text), 'formato real (MP3)');
    assert.ok(/\d[.,]\d MB|KB/.test(text), 'tamanho real do arquivo');
    assert.ok(text.includes(fonts.safe('COMPLETE', 'boldScript')), 'card de conclusão');
    assert.ok(!/stack|node_modules|\/home\//i.test(text), 'não vaza caminho/stack');
    ok('!ytmp3: BAIXANDO→ENVIANDO→CONCLUÍDO com título/canal/formato/tamanho reais');
  }

  /* ------------------------------ cache YT ------------------------------ */
  {
    const mediaCache = require('../utils/mediaCache');
    const src = path.join(CONFIG.paths.tmpDir, 'play-test-cache-src.mp3');
    fs.writeFileSync(src, 'ID3' + 'y'.repeat(2048));
    const key = 'youtube:aaa:audio:128';
    mediaCache.setCached(key, src, { ext: 'mp3', ttl: 60 * 1000, title: fakeVideo.title });
    const hit = mediaCache.getCached(key);
    assert.ok(hit && fs.existsSync(hit.path), 'cache deve devolver um arquivo existente');
    assert.notStrictEqual(hit.path, src, 'o cache guarda a própria cópia (não depende do original)');
    fs.rmSync(src, { force: true });
    assert.ok(fs.existsSync(mediaCache.getCached(key).path), 'cópia em cache sobrevive à remoção do original');
    assert.strictEqual(mediaCache.getCached('youtube:zzz:audio:128'), null, 'chave diferente → miss');

    const expiring = 'youtube:bbb:audio:128';
    mediaCache.setCached(expiring, TMP_AUDIO, { ext: 'mp3', ttl: 1, title: 'expira' });
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(mediaCache.getCached(expiring), null, 'entrada expirada não pode ser servida');
    mediaCache.clearCache();
    ok('cache YouTube: chave youtube:<id>:<tipo>:<qualidade>, hit/miss e TTL');
  }

  /* ---------------------------- sem temporário ---------------------------- */
  {
    // compara o antes/depois: nenhum ARQUIVO criado por este teste pode sobrar
    const created = tmpFiles().filter((f) => !beforeTmp.includes(f));
    assert.deepStrictEqual(created, [], `o fluxo deixou resíduos em tmp/: ${created}`);
    fs.rmSync(TMP_AUDIO, { force: true });
    ok('fluxo não deixa temporário órfão em tmp/');
  }

  for (const suf of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(TEST_DB + suf, { force: true });
    } catch (_) {}
  }
  database.close();

  console.log(`\n✅ play/ytmp3/cache: ${n} verificações, 0 falhas`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err && err.stack ? err.stack : err);
  process.exit(1);
});
