/**
 * test/platform.test.js — regressão dos módulos da plataforma.
 *
 * Cobre: IA (local/router/status/memória), router de downloads, providers
 * Twitter/Reddit, stickers (texto com cor), e os novos comandos
 * (utilidades, diversão, membros) via pipeline real de comando.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

const DB = '/tmp/lua-platform-test.db';

function clearCache() {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
}

let failures = 0;
function ok(l) { console.log('✅ ' + l); }
function fail(l, e) { failures++; console.log('❌ ' + l + ' — ' + (e && e.message)); }

async function main() {
  try { fs.rmSync(DB, { force: true }); } catch (_) {}
  process.env.OWNER_NUMBER = '5511999999999';
  process.env.DATABASE_FILE = DB;
  process.env.BUTTONS_ENABLED = 'true';
  delete process.env.AI_API_URL;
  delete process.env.AI_API_KEY;

  const database = require('../database/database');
  database.open();
  const { loadCommands } = require('../commands/loader');
  loadCommands(true);

  const ai = require('../ai');
  const router = require('../downloaders/router');
  const twitter = require('../downloaders/twitter');
  const reddit = require('../downloaders/reddit');
  const stickerEngine = require('../utils/stickerEngine');

  /* ------------------------- IA (local/router) ------------------------ */
  try {
    const r = await ai.ask({ chatId: 'g', userId: 'u', text: '2+2*3', mode: 'chat' });
    assert.strictEqual(r.ok, true, 'responde');
    assert.ok(/8/.test(r.text), 'matemática: 2+2*3=8 → ' + r.text);
    assert.strictEqual(r.provider, 'local', 'provider local (sem API)');
    ok('IA: matemática local');
  } catch (e) { fail('IA matemática', e); }

  try {
    const r = await ai.ask({ chatId: 'g', userId: 'u', text: 'função JS que soma', mode: 'code' });
    assert.ok(r.ok && /```/.test(r.text), 'código com bloco markdown');
    ok('IA: snippet de código');
  } catch (e) { fail('IA código', e); }

  try {
    const r = await ai.ask({ chatId: 'g', userId: 'u', text: 'inglês bom dia', mode: 'translate' });
    assert.ok(r.ok && /good morning/i.test(r.text), 'tradução local');
    ok('IA: tradução local');
  } catch (e) { fail('IA tradução', e); }

  try {
    const r = await ai.ask({ chatId: 'g', userId: 'u', text: 'Hoje foi um dia bom. Aprendi coisas. Fiz exercícios.', mode: 'summarize' });
    assert.ok(r.ok && /resumo/i.test(r.text), 'resumo');
    ok('IA: resumo local');
  } catch (e) { fail('IA resumo', e); }

  try {
    const r = await ai.ask({ chatId: 'g', userId: 'u', text: '', mode: 'chat' });
    assert.strictEqual(r.ok, false, 'entrada vazia rejeitada');
    assert.strictEqual(r.code, 'EMPTY_INPUT', 'código EMPTY_INPUT');
    ok('IA: entrada vazia rejeitada');
  } catch (e) { fail('IA entrada vazia', e); }

  try {
    const r = await ai.ask({ chatId: 'g', userId: 'u', text: 'x'.repeat(600), mode: 'chat' });
    assert.strictEqual(r.ok, false, 'prompt gigante rejeitado');
    assert.strictEqual(r.code, 'INPUT_TOO_BIG', 'código INPUT_TOO_BIG');
    ok('IA: prompt gigante rejeitado');
  } catch (e) { fail('IA prompt gigante', e); }

  try {
    const s = ai.status();
    assert.strictEqual(s.apiConfigured, false, 'sem API configurada');
    assert.ok(!/key|token|secret/i.test(JSON.stringify(s)), 'sem segredos no status');
    assert.ok(Array.isArray(s.order), 'cadeia de fallback');
    ok('IA: status sem segredos');
  } catch (e) { fail('IA status', e); }

  try {
    ai.memory.setEnabled(false);
    ai.memory.remember('mem', 'user', 'segredo');
    assert.strictEqual(ai.memory.history('mem').length, 0, 'memória desligada não grava');
    ai.memory.setEnabled(true);
    ai.memory.remember('mem', 'user', 'oi');
    assert.strictEqual(ai.memory.history('mem').length, 1, 'memória ligada grava');
    ai.memory.clear('mem');
    assert.strictEqual(ai.memory.history('mem').length, 0, 'clear limpa');
    ok('IA: memória on/off/clear');
  } catch (e) { fail('IA memória', e); }

  /* ------------------------- downloads router ------------------------- */
  try {
    assert.strictEqual(router.platformOf('https://youtu.be/abc'), 'youtube');
    assert.strictEqual(router.platformOf('https://www.tiktok.com/@a/video/1'), 'tiktok');
    assert.strictEqual(router.platformOf('https://www.instagram.com/p/abc'), 'instagram');
    assert.strictEqual(router.platformOf('https://fb.watch/abc'), 'facebook');
    assert.strictEqual(router.platformOf('https://pin.it/abc'), 'pinterest');
    assert.strictEqual(router.platformOf('https://x.com/user/status/123'), 'twitter');
    assert.strictEqual(router.platformOf('https://twitter.com/user/status/123'), 'twitter');
    assert.strictEqual(router.platformOf('https://www.reddit.com/r/x/comments/1/'), 'reddit');
    assert.strictEqual(router.platformOf('https://exemplo.com/arquivo.jpg'), null);
    ok('downloads: router.platformOf');
  } catch (e) { fail('downloads router', e); }

  try {
    assert.deepStrictEqual(twitter.parseTweetUrl('https://x.com/nome/status/123456'), { user: 'nome', id: '123456' });
    assert.strictEqual(twitter.parseTweetUrl('https://x.com/nome'), null);
    assert.strictEqual(twitter.canHandle('https://x.com/nome/status/1'), true);
    assert.strictEqual(twitter.canHandle('https://youtube.com'), false);
    ok('downloads: twitter parse/canHandle');
  } catch (e) { fail('downloads twitter', e); }

  try {
    assert.strictEqual(reddit.canHandle('https://www.reddit.com/r/a/comments/1/t/'), true);
    assert.strictEqual(reddit.jsonUrl('https://www.reddit.com/r/a/comments/1/t'), 'https://www.reddit.com/r/a/comments/1/t.json');
    assert.strictEqual(reddit.jsonUrl('https://redd.it/x.json'), 'https://redd.it/x.json');
    ok('downloads: reddit canHandle/jsonUrl');
  } catch (e) { fail('downloads reddit', e); }

  /* --------------------------- stickers ------------------------------- */
  try {
    const webp = await stickerEngine.textToSticker('Olá Lua', { bg: 'azul' });
    assert.ok(Buffer.isBuffer(webp) && webp.length > 0, 'webp gerado');
    assert.strictEqual(webp.toString('ascii', 0, 4), 'RIFF', 'assinatura RIFF');
    // sticker de texto deve ser <= 512x512 (limite do WhatsApp)
    const { Image } = require('node-webpmux');
    await Image.initLib();
    const ti = new Image(); await ti.load(webp);
    assert.ok(ti.width <= 512 && ti.height <= 512, 'texto → webp ≤ 512x512');
    ok('stickers: texto com cor → webp');
  } catch (e) { fail('stickers texto cor', e); }

  try {
    // foto grande (3000x4000) SEM sharp/ffmpeg → deve virar webp 512x512
    process.env.TERMUX_VERSION = '0.118.0';
    delete require.cache[require.resolve('../utils/stickerEngine')];
    const eng2 = require('../utils/stickerEngine');
    const Jimp = require('jimp');
    const big = new Jimp(3000, 4000, 0xcc3366ff);
    const jpeg = await big.getBufferAsync(Jimp.MIME_JPEG);
    const webp = await eng2.imageToWebp(jpeg);
    const { Image } = require('node-webpmux');
    await Image.initLib();
    const im = new Image(); await im.load(webp);
    assert.strictEqual(im.width, 512, 'largura 512');
    assert.strictEqual(im.height, 512, 'altura 512');
    const rgba = await im.getImageData();
    let opaque = 0; for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) opaque++;
    assert.ok(opaque > 100000, 'conteúdo visível (não em branco)');
    delete process.env.TERMUX_VERSION;
    ok('stickers: foto 3000x4000 → webp 512x512 (anti-branco)');
  } catch (e) { fail('stickers redimensionar', e); }

  /* ----------------------- youtube erros amigáveis ------------------- */
  try {
    const yt = require('../downloaders/youtube');
    const e403 = yt.friendlyError(new Error('Status code: 403'));
    assert.strictEqual(e403.code, 'YOUTUBE_BLOCKED', '403 → YOUTUBE_BLOCKED');
    const eNoFormat = yt.friendlyError(new Error('Failed to find any playable formats'));
    assert.strictEqual(eNoFormat.code, 'NO_FORMAT', 'sem formatos → NO_FORMAT');
    const eUnav = yt.friendlyError(new Error('This video is unavailable'));
    assert.strictEqual(eUnav.code, 'NO_RESULT', 'indisponível → NO_RESULT');
    // mapeamento de erros do yt-dlp
    assert.strictEqual(yt.mapYtdlpError('ERROR: [youtube] Private video'), 'NO_RESULT', 'yt-dlp privado → NO_RESULT');
    assert.strictEqual(yt.mapYtdlpError('ERROR: Unsupported URL: x'), 'INVALID_URL', 'yt-dlp URL → INVALID_URL');
    assert.strictEqual(yt.mapYtdlpError('ERROR: Requested format is not available'), 'NO_FORMAT', 'yt-dlp formato → NO_FORMAT');
    assert.strictEqual(yt.mapYtdlpError('ERROR: File is larger than max-filesize'), 'FILE_TOO_BIG', 'yt-dlp tamanho → FILE_TOO_BIG');
    ok('downloads: erros do YouTube/yt-dlp mapeados');
  } catch (e) { fail('downloads friendlyError', e); }

  /* ---------------- instagram: extração de vídeo (embed) -------------- */
  try {
    const ig = require('../downloaders/instagram');
    assert.strictEqual(ig.extractShortcode('https://www.instagram.com/reel/AbCdEf123/'), 'AbCdEf123', 'shortcode de reel');
    assert.strictEqual(ig.extractShortcode('https://instagram.com/p/XYZ12345/?utm_source=x'), 'XYZ12345', 'shortcode de post');
    assert.strictEqual(ig.extractShortcode('https://instagram.com/usuario/'), null, 'sem shortcode → null');
    assert.strictEqual(ig.embedUrl('https://www.instagram.com/reels/AbCdEf123/', 'AbCdEf123'), 'https://www.instagram.com/reel/AbCdEf123/embed/captioned/', 'reels → reel');

    // simula o JSON multi-escapado do embed (barras escapadas)
    const esc = '\\"video_url\\":\\"https:\\\\/\\\\/scontent-sea.cdninstagram.com\\\\/v\\\\/abc.mp4?_nc_cat=108\\",\\"display_url\\":\\"https:\\\\/\\\\/scontent-sea.cdninstagram.com\\\\/v\\\\/thumb.jpg\\"';
    assert.strictEqual(ig.extractField(esc, 'video_url'), 'https://scontent-sea.cdninstagram.com/v/abc.mp4?_nc_cat=108', 'video_url limpa');
    assert.strictEqual(ig.extractField(esc, 'display_url'), 'https://scontent-sea.cdninstagram.com/v/thumb.jpg', 'display_url limpa');

    // caption com escapes \n e \uXXXX
    const cap = 'edge_media_to_caption\\":{\\"edges\\":[{\\"node\\":{\\"text\\":\\"Ol\\u00e1\\\\n\\\\u0040fulano legal\\"}}]}';
    const txt = ig.extractCaption(cap);
    assert.ok(/@fulano/.test(txt), 'caption decodificada (@fulano)');
    ok('downloads: instagram embed → video_url/caption');
  } catch (e) { fail('downloads instagram embed', e); }

  /* ------------------ mídia: envio por caminho (bug sistêmico) -------- */
  try {
    const media = require('../utils/media');
    // string → { url } (o Baileys 7.4.7 NÃO aceita string pura)
    assert.deepStrictEqual(media.asMedia('/tmp/x.mp4'), { url: '/tmp/x.mp4' }, 'string vira { url }');
    assert.strictEqual(Buffer.isBuffer(media.asMedia(Buffer.from('x'))), true, 'Buffer passa direto');

    // o Baileys real consegue ler o { url } como arquivo local
    const { getStream } = require('@innovatorssoft/baileys/lib/Utils/messages-media');
    const fs = require('fs');
    const p = '/tmp/lua-media-test.mp4';
    fs.writeFileSync(p, Buffer.from('fake'));
    const s = await getStream(media.asMedia(p), {});
    assert.strictEqual(s.type, 'file', 'getStream lê arquivo local via { url }');
    s.stream.destroy();
    fs.unlinkSync(p);

    // sendVideo envia { url } (não string pura)
    let captured = null;
    const fakeSock = { sendMessage: async (jid, content) => { captured = content; return { key: { id: 'x' } }; } };
    await media.sendVideo(fakeSock, 'g', '/tmp/x.mp4', 'cap');
    assert.deepStrictEqual(captured.video, { url: '/tmp/x.mp4' }, 'sendVideo envia { url }');
    ok('mídia: caminho local → { url } (Baileys aceita)');
  } catch (e) { fail('mídia envio por caminho', e); }

  /* ------------------ comandos novos (pipeline real) ------------------ */
  const commandHandler = require('../handlers/commandHandler');
  const OWNER = '5511999999999@s.whatsapp.net';
  const sent = [];
  const sock = {
    user: { id: '5511999999998@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      return { key: { id: '3EB0' + 'A'.repeat(18), remoteJid: jid } };
    },
    groupMetadata: async () => ({ id: 'g', participants: [] }),
    sendPresenceUpdate: async () => {},
  };
  const mkMsg = (text) => ({ key: { remoteJid: OWNER, fromMe: false, id: 'AAA' }, message: { conversation: text }, pushName: 'Owner' });
  const cooldown = require('../utils/cooldown');
  const run = async (name, args = []) => {
    sent.length = 0;
    cooldown.reset('user', OWNER, name);
    cooldown.reset('global', '*', name);
    const ctx = await commandHandler.buildContext(sock, mkMsg('!' + name));
    await commandHandler.runByName(ctx, name, args);
    return sent;
  };

  const expectReply = async (label, name, args, re) => {
    try {
      const s = await run(name, args);
      const last = s[s.length - 1];
      assert.ok(last && re.test(last.content.text || ''), label + ' → ' + (last && last.content.text));
      ok(label);
    } catch (e) { fail(label, e); }
  };

  await expectReply('cmd: !uuid', 'uuid', [], /^🆔/);
  await expectReply('cmd: !senha', 'senha', [], /^🔑/);
  await expectReply('cmd: !base64', 'base64', ['olá'], /Base64/);
  await expectReply('cmd: !base64 -d', 'base64', ['-d', Buffer.from('olá').toString('base64')], /Decodificado/);
  await expectReply('cmd: !porcentagem', 'porcentagem', ['15', '80'], /12/);
  await expectReply('cmd: !8ball', '8ball', ['vai chover?'], /^🎱/);
  await expectReply('cmd: !piada', 'piada', [], /^😂/);
  await expectReply('cmd: !fato', 'fato', [], /^🤓/);
  await expectReply('cmd: !data', 'data', [], /^📅/);
  await expectReply('cmd: !hora', 'hora', [], /^🕐/);
  await expectReply('cmd: !botinfo', 'botinfo', [], /Comandos:/);
  await expectReply('cmd: !aistatus', 'aistatus', [], /STATUS DA IA/);
  await expectReply('cmd: !userinfo', 'userinfo', [], /^👤/);
  await expectReply('cmd: !ia (conta)', 'ia', ['quanto é 15% de 80'], /12/);

  /* -------------------- telas de menu registradas --------------------- */
  try {
    require('../menus/screens');
    const nav = require('../utils/nav');
    for (const id of ['lua_admin_menu', 'lua_automod', 'lua_sticker_menu', 'lua_media', 'lua_ia_menu', 'lua_owner']) {
      const ctx = await commandHandler.buildContext(sock, mkMsg('!menu'));
      sent.length = 0;
      const opened = await nav.openScreen(ctx, id);
      assert.strictEqual(opened, true, id + ' abriu');
      const btn = sent.find((s) => s.content && s.content.interactiveButtons);
      assert.ok(btn && btn.content.interactiveButtons.length > 0, id + ' enviou botões');
    }
    ok('menus: telas admin/automod/sticker/mídia/IA/dono registradas');
  } catch (e) { fail('menus telas', e); }

  database.close();
  console.log(`\n=== PLATFORM TEST: ${failures === 0 ? 'TUDO OK' : failures + ' falha(s)'} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ erro fatal:', err);
  process.exit(1);
});
