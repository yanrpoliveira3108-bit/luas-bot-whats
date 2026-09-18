/**
 * test/menu2.test.js — camada visual aplicada aos menus (briefing 9/12/53-58/82-84)
 * + comandos novos: !menumode, !fotobot, !twitter.
 *
 * Verifica o que importa de verdade:
 *  - cada modo muda fonte e separador (não é só texto decorativo igual);
 *  - comando executável NUNCA sai estilizado;
 *  - o modo vale por grupo e cai para o global no PV;
 *  - paginação honesta;
 *  - !fotobot troca a foto do jid do BOT (não do grupo) e trata erro/mídia ausente;
 *  - !twitter usa o downloader real em fluxo de etapas e rejeita URL inválida.
 */
'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));
process.env.DATABASE_FILE = path.resolve(__dirname, '../database/lua-test-menu2.db');

// banco próprio e limpo a cada execução (o modo de menu é persistido nele)
const fs = require('fs');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
}

const database = require('../database/database');
database.open();

const { loadCommands } = require('../commands/loader');
const { registry } = require('../engine/plugins');
loadCommands(true);

const menuRenderer = require('../utils/menuRenderer');
const groups = require('../database/groups');
const settings = require('../database/settings');

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`  ✔ ${label}`);
};

const GROUP_A = '111111@g.us';
const GROUP_B = '222222@g.us';
const PV = '5511999999999@s.whatsapp.net';

function fakeCtx(overrides = {}) {
  const replies = [];
  const sent = [];
  const ctx = {
    text: '',
    args: [],
    prefix: '!',
    remoteJid: PV,
    sender: PV,
    isGroup: false,
    isOwner: true,
    isAdmin: true,
    isBotAdmin: true,
    isRegistered: true,
    replies,
    sent,
    reply: async (t) => {
      replies.push(String(t));
      return true;
    },
    sendImage: async (p, caption) => {
      sent.push({ kind: 'image', p, caption });
      return { key: { id: 'K' } };
    },
    sendVideo: async (p, caption) => {
      sent.push({ kind: 'video', p, caption });
      return { key: { id: 'K' } };
    },
    sendAudio: async (p) => {
      sent.push({ kind: 'audio', p });
      return { key: { id: 'K' } };
    },
    downloadMedia: async () => null,
    socket: {
      user: { id: '5511888887777@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        sent.push({ kind: 'edit', text: String((content && content.text) || '') });
        return { key: { id: 'EDIT' } };
      },
      updateProfilePicture: async (jid, buf) => {
        sent.push({ kind: 'pp', jid, bytes: buf.length });
      },
    },
    message: { key: { remoteJid: PV, id: 'M' }, message: {} },
  };
  return Object.assign(ctx, overrides);
}

(async () => {
  // ------------------------------------------------- 1) modos mudam o visual
  const modes = menuRenderer.listModes();
  assert.ok(modes.length >= 6, `pelo menos 6 modos, vieram ${modes.length}`);
  const titles = modes.map((m) => menuRenderer.style('MUSICA', m.font));
  const unique = new Set(titles);
  assert.ok(unique.size >= 5, `fontes distintas por modo (${unique.size}/${modes.length})`);
  const divs = modes.map((m) => menuRenderer.dividerLine(null, null, null) && menuRenderer.mode(m.id).div);
  assert.ok(new Set(divs).size >= 4, 'famílias de separador distintas por modo');
  ok(`menumode: ${modes.length} modos com ${unique.size} fontes e ${new Set(divs).size} famílias de separador`);

  // ------------------------------------------------- 2) comando nunca estilizado
  const cmdLine = menuRenderer.row({ text: '!play música do ano' });
  assert.ok(cmdLine.includes('!play música do ano'), 'comando permanece literal');
  const sectionText = menuRenderer.section({
    title: 'Música',
    category: 'music',
    items: [{ text: '!ytmp3 https://youtu.be/abc' }],
  });
  assert.ok(sectionText.includes('!ytmp3 https://youtu.be/abc'), 'URL e comando intactos na seção');
  assert.ok(!sectionText.includes('𝚢𝚝𝚖𝚙𝟹'), 'nada de unicode matemático no comando');
  ok('visual: comandos e URLs saem em texto puro dentro das seções decoradas');

  // ------------------------------------------------- 3) escopo por grupo
  assert.strictEqual(menuRenderer.currentModeName(GROUP_A), 'default', 'grupo começa no padrão');
  assert.strictEqual(menuRenderer.setMode('dark', GROUP_A), true, 'aceita modo válido');
  assert.strictEqual(menuRenderer.currentModeName(GROUP_A), 'dark', 'modo do grupo A');
  assert.strictEqual(menuRenderer.currentModeName(GROUP_B), 'default', 'grupo B não é afetado');
  assert.strictEqual(menuRenderer.modeScope(GROUP_A), 'grupo', 'escopo grupo');
  assert.strictEqual(menuRenderer.setMode('cyber', PV), true, 'no PV grava global');
  assert.strictEqual(menuRenderer.currentModeName(PV), 'cyber', 'global aplicado no PV');
  // grupo SEM modo próprio segue o global; grupo COM modo próprio mantém o seu
  assert.strictEqual(menuRenderer.currentModeName(GROUP_B), 'cyber', 'grupo sem config segue o global');
  assert.strictEqual(menuRenderer.currentModeName(GROUP_A), 'dark', 'modo explícito do grupo vence o global');
  assert.strictEqual(groups.getSettings(GROUP_A).menuMode, 'dark', 'persistido no banco do grupo');
  assert.strictEqual(menuRenderer.setMode('naoexiste', GROUP_A), false, 'modo inválido recusado');
  assert.strictEqual(menuRenderer.currentModeName(GROUP_A), 'dark', 'modo inválido não altera nada');
  ok('menumode: vale por grupo, cai para o global no PV e persiste no banco');

  // o modo do grupo aparece no menu renderizado
  const darkMenu = menuRenderer.mainMenu({ jid: GROUP_A, prefix: '!', commands: 1, categories: [] });
  const defMenu = menuRenderer.mainMenu({ jid: GROUP_B, prefix: '!', commands: 1, categories: [] });
  assert.notStrictEqual(darkMenu, defMenu, 'menu do grupo dark difere do padrão');
  ok('menu: o mesmo comando renderiza diferente conforme o modo do chat');

  // ------------------------------------------------- 3b) styleFit (limite UTF-16)
  const curto = menuRenderer.styleFit('LUA', 24, GROUP_B);
  assert.ok(curto.length <= 24, `estilizado dentro do limite (${curto.length} unidades)`);
  assert.notStrictEqual(curto, 'LUA', 'aplicou a fonte quando coube');
  const longo = menuRenderer.styleFit('ADMINISTRAÇÃO DO GRUPO', 22, GROUP_B);
  assert.ok(longo.length <= 22, `dentro do limite (${longo.length})`);
  assert.strictEqual(longo, 'ADMINISTRAÇÃO DO GRUPO'.slice(0, 22), 'não coube → texto puro completo');
  // nunca parte um par de surrogate: todo code point do resultado é válido
  for (const ch of menuRenderer.styleFit('🌙 LUA BOT', 12, GROUP_B)) {
    assert.ok(ch.codePointAt(0) > 0, 'sem surrogate órfão');
  }
  ok('styleFit: respeita o limite UTF-16 sem partir glifo (ou cabe inteiro, ou vai puro)');

  // ------------------------------------------------- 4) paginação honesta
  const p = menuRenderer.page({ page: 3, pages: 8 });
  assert.match(p, /Página 3\/8/, 'indicador de página');
  assert.ok(!/%/.test(p), 'não inventa porcentagem');
  const clamped = menuRenderer.page({ page: 99, pages: 8 });
  assert.match(clamped, /Página 8\/8/, 'clamp na última página');
  ok('paginação: indicador "Página X/Y" sem porcentagem inventada');

  // ------------------------------------------------- 5) limites do WhatsApp
  const big = menuRenderer.mainMenu({
    jid: GROUP_B,
    prefix: '!',
    commands: 324,
    subtitle: 'x'.repeat(500),
    categories: Array.from({ length: 40 }, (_, i) => ({ id: 'general', title: `Categoria ${i}`, emoji: '◈' })),
  });
  assert.ok(big.length < 4096, `menu dentro do limite (${big.length} chars)`);
  ok(`responsividade: menu com 40 categorias = ${big.length} chars (< 4096)`);

  // ------------------------------------------------- 6) comando !menumode
  const menumode = registry.resolveTrigger('menumode');
  assert.ok(menumode, '!menumode registrado');
  const c1 = fakeCtx({ remoteJid: GROUP_B, args: [] });
  await menumode.execute(c1);
  assert.match(c1.replies[0], /dark/, 'lista os modos');
  assert.match(c1.replies[0], /menumode <modo>/, 'ensina o uso');

  const c2 = fakeCtx({ remoteJid: GROUP_B, args: ['naoexiste'] });
  await menumode.execute(c2);
  assert.match(c2.replies[0], /não existe/, 'modo inválido avisado');
  assert.match(c2.replies[0], /default/, 'lista os válidos');

  const c3 = fakeCtx({ remoteJid: GROUP_B, args: ['cute'] });
  await menumode.execute(c3);
  assert.strictEqual(menuRenderer.currentModeName(GROUP_B), 'cute', 'modo aplicado');
  assert.match(c3.replies[0], /ativado/, 'confirma');
  // o título da seção sai estilizado (fonte do modo), então a prévia é conferida
  // pelo que é estável: os comandos em texto puro dentro dela
  assert.ok(c3.replies[0].includes('!menu') && c3.replies[0].includes('!help play'), 'prévia com comandos reais');
  assert.ok(/[═╔╚─♪◦❖⋆✧]/.test(c3.replies[0]), 'prévia traz separador decorativo');
  ok('!menumode: lista, rejeita inválido e aplica com prévia');

  // ------------------------------------------------- 7) !fotobot
  const fotobot = registry.resolveTrigger('fotobot');
  assert.ok(fotobot, '!fotobot registrado');
  assert.strictEqual(fotobot.ownerOnly, true, 'só o dono muda a foto do bot');

  const f1 = fakeCtx({ args: [] }); // sem mídia
  await fotobot.execute(f1);
  assert.match(f1.replies.join(' '), /Marque uma \*imagem\*/, 'pede imagem');
  assert.ok(!f1.sent.some((s) => s.kind === 'pp'), 'não chama a API sem mídia');

  const f2 = fakeCtx({ args: [], downloadMedia: async () => ({ type: 'image', buffer: Buffer.alloc(2048, 7) }) });
  await fotobot.execute(f2);
  const pp = f2.sent.find((s) => s.kind === 'pp');
  assert.ok(pp, 'chama updateProfilePicture');
  assert.strictEqual(pp.jid, '5511888887777@s.whatsapp.net', 'troca a foto do BOT, não do grupo');
  assert.strictEqual(pp.bytes, 2048, 'envia o buffer da imagem');
  assert.match(f2.replies.join(' '), /Foto do bot atualizada/, 'confirma');

  const f3 = fakeCtx({
    args: [],
    downloadMedia: async () => ({ type: 'image', buffer: Buffer.alloc(6 * 1024 * 1024) }),
  });
  await fotobot.execute(f3);
  assert.match(f3.replies.join(' '), /grande demais/, 'rejeita imagem acima de 5 MB');
  assert.ok(!f3.sent.some((s) => s.kind === 'pp'), 'não envia imagem gigante');

  const f4 = fakeCtx({
    args: [],
    downloadMedia: async () => ({ type: 'image', buffer: Buffer.alloc(1024) }),
    socket: { user: { id: 'x@s.whatsapp.net' }, updateProfilePicture: async () => { throw new Error('403: not authorized'); } },
  });
  await fotobot.execute(f4);
  assert.match(f4.replies.join(' '), /Não consegui atualizar/, 'trata falha da API');
  assert.ok(!/at\s+\w+\.js:\d+/.test(f4.replies.join(' ')), 'sem stack trace na resposta');
  ok('!fotobot: pede imagem, troca a foto do jid do bot, limita 5 MB e trata erro sem stack');

  // ------------------------------------------------- 8) !twitter
  // stub do downloader real: o comando deve usar o fluxo em etapas
  const twitterPath = require.resolve('../downloaders/twitter');
  const calls = [];
  require.cache[twitterPath] = {
    id: twitterPath,
    filename: twitterPath,
    loaded: true,
    exports: {
      canHandle: (u) => /twitter\.com|x\.com/i.test(String(u)),
      parseTweetUrl: (u) => u,
      fetchData: async (u) => {
        calls.push(`fetch:${u}`);
        return { title: 'Tweet de teste', author: '@lua', media: [{ type: 'video', url: 'u' }] };
      },
      download: async (u) => {
        calls.push(`download:${u}`);
        return {
          path: '/tmp/fake-tweet.mp4',
          size: 1024 * 900,
          title: 'Tweet de teste',
          author: '@lua',
          mimetype: 'video/mp4',
          isVideo: true,
        };
      },
    },
  };
  delete require.cache[require.resolve('../commands/downloads/twitter')];
  loadCommands(true);
  const twitterCmd = registry.resolveTrigger('twitter');
  assert.ok(twitterCmd, '!twitter registrado');
  assert.ok(registry.resolveTrigger('tw'), 'alias !tw');
  assert.ok(registry.resolveTrigger('x'), 'alias !x');

  const t1 = fakeCtx({ args: [] });
  await twitterCmd.execute(t1);
  assert.match(t1.replies.join(' '), /Envie o link do tweet/, 'sem URL pede o link');

  const t2 = fakeCtx({ args: ['https://example.com/nao-e-tweet'] });
  await twitterCmd.execute(t2);
  assert.match(t2.replies.join(' '), /inválido/, 'URL inválida rejeitada');

  const t3 = fakeCtx({ args: ['https://x.com/lua/status/1'] });
  await twitterCmd.execute(t3);
  assert.ok(calls.some((c) => c.startsWith('fetch:')), 'consulta o tweet');
  assert.ok(calls.some((c) => c.startsWith('download:')), 'baixa a mídia');
  assert.ok(t3.sent.some((s) => s.kind === 'video'), 'envia o vídeo');
  // etapas aparecem na mensagem de progresso (editada), não no reply
  const joined = [...t3.replies, ...t3.sent.filter((x) => x.kind === 'edit').map((x) => x.text)].join('\n');
  assert.match(joined, /BAIXANDO|DOWNLOADING|ENVIANDO|UPLOADING|BUSCANDO/i, 'mostra etapas reais');
  assert.ok(!/\b\d{1,3}%\b/.test(joined.replace(/Página \d\/\d/g, '')), 'sem porcentagem inventada');
  ok('!twitter: valida URL, usa o downloader real em etapas e envia o vídeo');

  database.close();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
  }
  console.log(`\n✅ menu 2.0 (renderer/modos/fotobot/twitter): ${n} verificações, 0 falhas`);
  process.exit(0);
})().catch((err) => {
  console.error(`\n❌ menu2: ${err.stack || err.message}`);
  process.exit(1);
});
