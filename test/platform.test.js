/**
 * test/platform.test.js — regressão dos módulos da plataforma.
 *
 * Cobre: IA Groq-only/status/memória, router de downloads, providers
 * Twitter/Reddit, stickers (texto com cor), e os novos comandos
 * (utilidades, diversão, membros) via pipeline real de comando.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

const DB = require('./dbtmp').tmpFile('lua-platform-test.db');

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

  const database = require('../database/database');
  database.open();
  const { loadCommands } = require('../commands/loader');
  loadCommands(true);

  const ai = require('../ai');
  const router = require('../downloaders/router');
  const twitter = require('../downloaders/twitter');
  const reddit = require('../downloaders/reddit');
  const stickerEngine = require('../utils/stickerEngine');

  /* ------------------------- IA Groq-only ---------------------------- */
  try {
    const r = await ai.ask({ chatId: 'g', userId: 'u', text: 'teste', mode: 'chat' });
    assert.strictEqual(r.ok, false, 'sem Groq deve falhar controladamente');
    assert.strictEqual(r.provider, 'groq');
    assert.ok(/^GROQ_/.test(r.code));
    ok('IA: sem Groq falha sem gerar resposta');
  } catch (e) { fail('IA Groq-only', e); }

  try {
    const r = await ai.ask({ chatId: 'g', userId: 'u', text: '', mode: 'chat' });
    assert.strictEqual(r.ok, false, 'entrada vazia rejeitada');
    assert.strictEqual(r.code, 'EMPTY_INPUT');
    ok('IA: entrada vazia rejeitada');
  } catch (e) { fail('IA entrada vazia', e); }

  try {
    const r = await ai.ask({ chatId: 'g', userId: 'u', text: 'x'.repeat(600), mode: 'chat' });
    assert.strictEqual(r.ok, false, 'prompt gigante rejeitado');
    assert.strictEqual(r.code, 'GROQ_NOT_CONFIGURED');
    ok('IA: prompt grande preservado até a política da Groq');
  } catch (e) { fail('IA prompt gigante', e); }

  try {
    const s = ai.status();
    assert.strictEqual(s.provider, 'groq');
    assert.deepStrictEqual(s.order, ['groq']);
    assert.ok(!/key|token|secret/i.test(JSON.stringify(s)), 'sem segredos no status');
    ok('IA: status Groq-only sem segredos');
  } catch (e) { fail('IA status', e); }

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

  /* ------------- sticker via ffmpeg (bug da extensão do tmp) ---------- */
  try {
    // ambiente Termux + ffmpeg (sem sharp): o caminho ffmpeg DEVE rodar.
    process.env.TERMUX_VERSION = '0.118.0';
    delete require.cache[require.resolve('../utils/stickerEngine')];
    const eng3 = require('../utils/stickerEngine');
    if (eng3.hasFfmpeg()) {
      const Jimp = require('jimp');
      // foto com ruído (não cor sólida) — lossless ficaria grande
      const noisy = new Jimp(1080, 1920);
      for (let y = 0; y < 1920; y += 3) for (let x = 0; x < 1080; x += 3) {
        noisy.setPixelColor(Jimp.rgbaToInt((x * 7) % 255, (y * 3) % 255, (x + y) % 255, 255), x, y);
      }
      const jpeg = await noisy.getBufferAsync(Jimp.MIME_JPEG);
      const webp = await eng3.imageToWebp(jpeg);
      assert.strictEqual(webp.toString('ascii', 0, 4), 'RIFF', 'assinatura RIFF');
      assert.ok(webp.length < 60000, 'webp lossy (ffmpeg) pequeno — ' + webp.length + ' bytes');
      ok('stickers: imagem via ffmpeg (webp lossy, sem cair no fallback)');
    } else {
      ok('stickers: ffmpeg ausente — pulando teste do caminho ffmpeg');
    }
    delete process.env.TERMUX_VERSION;
  } catch (e) { fail('stickers ffmpeg', e); }

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

  /* ------------- config: dono múltiplo pelo .env (OWNER_NUMBERS) ------- */
  try {
    process.env.OWNER_NUMBERS = '5511988888888, 5531999999999@s.whatsapp.net';
    delete require.cache[require.resolve('../config')];
    const cfg = require('../config');
    assert.ok(cfg.owner.numbers.includes('5511999999999'), 'OWNER_NUMBER preservado');
    assert.ok(cfg.owner.numbers.includes('5511988888888'), 'OWNER_NUMBERS incluído');
    assert.ok(cfg.owner.numbers.includes('5531999999999'), 'OWNER_JID/número normalizado (digits)');
    assert.strictEqual(cfg.helpers.isOwnerNumber('5511988888888@s.whatsapp.net'), true, '2º dono reconhecido');
    assert.strictEqual(cfg.helpers.isOwnerNumber('5511777777777@s.whatsapp.net'), false, 'não-dono rejeitado');
    delete process.env.OWNER_NUMBERS;
    delete require.cache[require.resolve('../config')];
    ok('config: dono múltiplo via OWNER_NUMBERS/OWNER_JID');
  } catch (e) { fail('config multi-owner', e); }

  /* ------------- admin em grupos LID (participant @lid vs PN) --------- */
  try {
    const perms = require('../utils/permissions');
    const { resolveSender } = require('../utils/messages');
    const participantsLid = [
      { id: '5511999999999@s.whatsapp.net', lid: '111111111@lid', admin: 'admin' },
      { id: '5522999999999@s.whatsapp.net', lid: '222222222@lid', admin: null },
    ];
    // remetente chega como LID, participant traz PN (id) + LID (lid)
    assert.strictEqual(perms.isAdmin(participantsLid, '111111111@lid'), true, 'admin via LID');
    assert.strictEqual(perms.isAdmin(participantsLid, '5511999999999@s.whatsapp.net'), true, 'admin via PN');
    assert.strictEqual(perms.isAdmin(participantsLid, '222222222@lid'), false, 'não-admin via LID');
    assert.strictEqual(perms.isBotAdmin(participantsLid, '5511999999999@s.whatsapp.net'), true, 'bot admin (PN)');
    // resolveSender canoniza para PN
    assert.strictEqual(resolveSender({ key: { remoteJid: '123@g.us', participant: '111111111@lid', participantAlt: '5511999999999@s.whatsapp.net' } }), '5511999999999@s.whatsapp.net', 'grupo LID → PN');
    assert.strictEqual(resolveSender({ key: { remoteJid: '123@g.us', participant: '5511999999999@s.whatsapp.net', participantAlt: '111111111@lid' } }), '5511999999999@s.whatsapp.net', 'grupo PN mantém');
    assert.strictEqual(resolveSender({ key: { remoteJid: '5511999999999@s.whatsapp.net' } }), '5511999999999@s.whatsapp.net', 'privado');
    // preferPn
    assert.strictEqual(perms.preferPn('111111111@lid', '5511999999999@s.whatsapp.net'), '5511999999999@s.whatsapp.net', 'prefere PN');
    // toPn: resolve LID → PN pelo metadado do grupo (participantAlt ausente)
    assert.strictEqual(perms.toPn('111111111@lid', participantsLid), '5511999999999@s.whatsapp.net', 'LID → PN via metadado');
    assert.strictEqual(perms.toPn('5511999999999@s.whatsapp.net', participantsLid), '5511999999999@s.whatsapp.net', 'PN mantém');
    assert.strictEqual(perms.toPn('999999999@lid', participantsLid), '999999999@lid', 'LID desconhecido fica (sem match)');
    ok('permissions/messages: admin em grupo LID reconhecido');
  } catch (e) { fail('admin grupo LID', e); }

  /* ------------- view-once (revelar + sticker em ver-uma-vez) --------- */
  try {
    const { unwrapViewOnce, isViewOnce, detectMediaType } = require('../utils/messages');
    // estrutura real do Baileys: viewOnceMessage.message.imageMessage
    const vo = { viewOnceMessage: { message: { imageMessage: { url: 'x', viewOnce: true } } } };
    assert.strictEqual(isViewOnce({ message: vo }), true, 'detecta view-once');
    const inner = unwrapViewOnce(vo);
    assert.ok(inner && inner.imageMessage, 'desempacota para imageMessage');
    assert.strictEqual(detectMediaType({ message: vo }), 'image', 'tipo = image em view-once');
    assert.strictEqual(detectMediaType({ message: { viewOnceMessageV2: { message: { videoMessage: {} } } } }), 'video', 'tipo = video em view-once V2');

    const { registry } = require('../engine/plugins');
    assert.ok(registry.resolveTrigger('revelar'), 'comando !revelar registrado');
    assert.ok(registry.resolveTrigger('viewonce'), 'alias !viewonce registrado');
    ok('view-once: unwrap + comando !revelar');
  } catch (e) { fail('view-once', e); }

  /* ------------- captura de view-once (utils/viewonce) ---------------- */
  try {
    const viewonce = require('../utils/viewonce');
    const { isViewOnce } = require('../utils/messages');
    // flag direta (sem wrapper) também é view-once
    assert.strictEqual(isViewOnce({ message: { imageMessage: { viewOnce: true } } }), true, 'flag viewOnce direta');
    assert.strictEqual(isViewOnce({ message: { imageMessage: {} } }), false, 'mídia normal não é view-once');
    const voMsg = { key: { remoteJid: 'g@g.us' }, message: { viewOnceMessage: { message: { imageMessage: { viewOnce: true } } } } };
    assert.strictEqual(viewonce.capture(voMsg), true, 'captura view-once');
    const last = viewonce.last('g@g.us');
    assert.ok(last && last.message.viewOnceMessage, 'recupera última view-once');
    assert.strictEqual(viewonce.last('outro@g.us'), null, 'outro chat não tem view-once');
    ok('view-once: captura + última por chat');
  } catch (e) { fail('view-once captura', e); }

  /* ------------- imagens de ação (utils/actionImage) ------------------ */
  try {
    const actionImage = require('../utils/actionImage');
    assert.strictEqual(typeof actionImage.resolvePath('beijo'), 'string', 'resolve imagem existente (beijo)');
    assert.strictEqual(actionImage.resolvePath('nao_existe_xyz'), null, 'sem imagem → null');
    // send sem imagem cai para texto
    let replied = null;
    const fakeCtx = {
      reply: async (t) => { replied = t; },
      sendImage: async () => { throw new Error('não deve ser chamado'); },
    };
    await actionImage.send(fakeCtx, 'nao_existe_xyz', 'olá');
    assert.strictEqual(replied, 'olá', 'fallback para texto quando não há imagem');
    ok('actionImage: resolução + fallback de texto');
  } catch (e) { fail('actionImage', e); }

  /* ------------- GIF puro-JS → webp animado (sem ffmpeg) -------------- */
  try {
    const omggif = require('omggif');
    const eng = require('../utils/stickerEngine');
    const w = 32, h = 32;
    const buf = Buffer.alloc(w * h * 8 + 1024);
    const writer = new omggif.GifWriter(buf, w, h, { loop: 0, palette: [0x000000, 0xff0000] });
    const idx1 = new Uint8Array(w * h).fill(0);
    const idx2 = new Uint8Array(w * h).fill(1);
    writer.addFrame(0, 0, w, h, idx1, { delay: 10 });
    writer.addFrame(0, 0, w, h, idx2, { delay: 10 });
    const gifBuf = buf.slice(0, writer.end());
    const anim = await eng.gifToWebp(gifBuf);
    assert.ok(anim.length > 0, 'webp gerado');
    assert.strictEqual(anim.toString('ascii', 0, 4), 'RIFF', 'assinatura RIFF');
    assert.strictEqual(anim.toString('ascii', 8, 12), 'WEBP', 'assinatura WEBP');
    // webp animado tem o chunk ANIM
    assert.ok(anim.includes(Buffer.from('ANIM')), 'chunk ANIM presente (animado)');
    ok('stickers: GIF puro-JS → webp animado (sem ffmpeg)');
  } catch (e) { fail('sticker gif puro', e); }

  /* ------------- guarda de tamanho + quadrado 512x512 (ffmpeg) -------- */
  try {
    const eng = require('../utils/stickerEngine');
    const Jimp = require('jimp');
    const img = new Jimp(64, 64, 0x2ecc71ff);
    const png = await img.getBufferAsync(Jimp.MIME_PNG);
    const webp = await eng.imageToWebp(png);
    const kept = await eng.ensureStickerSize(webp, { animated: false });
    assert.ok(Buffer.isBuffer(kept), 'sticker pequeno passa pela guarda');
    if (eng.hasFfmpeg()) {
      // vídeo quadrado: gera um mp4 mínimo de 1s e verifica se o webp sai 512x512
      const { execFileSync } = require('child_process');
      const os = require('os');
      const path = require('path');
      const tmp = path.join(os.tmpdir(), 'lua-stk-test.mp4');
      execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=256x144:rate=15:duration=1', '-pix_fmt', 'yuv420p', tmp], { stdio: 'ignore' });
      const vidWebp = await eng.videoToWebp(fs.readFileSync(tmp), 2);
      const { Image } = require('node-webpmux');
      await Image.initLib();
      const im = new Image();
      await im.load(vidWebp);
      assert.strictEqual(im.width, 512, 'largura 512');
      assert.strictEqual(im.height, 512, 'altura 512 (quadrado — requisito do WhatsApp)');
      try { fs.rmSync(tmp, { force: true }); } catch (_) {}
      ok('stickers: vídeo → webp animado 512x512 quadrado');
    } else {
      ok('stickers: ffmpeg ausente — pulando teste de vídeo quadrado');
    }
  } catch (e) { fail('sticker guarda de tamanho', e); }

  /* ------------- validação do sticker (anti-fantasma) ----------------- */
  try {
    const eng = require('../utils/stickerEngine');
    const Jimp = require('jimp');
    // 1) webp válido passa
    const img = new Jimp(100, 100, 0x2ecc71ff);
    const webp = await eng.imageToWebp(await img.getBufferAsync(Jimp.MIME_PNG));
    const okCheck = await eng.validateSticker(webp);
    assert.strictEqual(okCheck.ok, true, 'webp válido → ok (' + okCheck.reason + ')');
    assert.ok(okCheck.width > 0 && okCheck.width <= 512, 'dimensões válidas');
    // 2) PNG renomeado (não é webp) → rejeitado
    const pngBuf = await img.getBufferAsync(Jimp.MIME_PNG);
    assert.strictEqual((await eng.validateSticker(pngBuf)).reason, 'NOT_WEBP', 'PNG disfarçado → NOT_WEBP');
    // 3) buffer vazio → rejeitado
    assert.strictEqual((await eng.validateSticker(Buffer.alloc(0))).reason, 'EMPTY_STICKER_BUFFER', 'vazio → EMPTY_STICKER_BUFFER');
    // 4) RIFF/WEBP falso sem chunk de imagem → rejeitado
    const fake = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('XXXX'), Buffer.alloc(4)]);
    assert.strictEqual((await eng.validateSticker(fake)).reason, 'NO_IMAGE_CHUNK', 'RIFF falso → NO_IMAGE_CHUNK');
    // 5) backstop do sendSticker: nunca envia vazio/inválido
    const media = require('../utils/media');
    let threw = null;
    try { await media.sendSticker({ sendMessage: async () => {} }, 'x@s.whatsapp.net', Buffer.alloc(0)); } catch (e) { threw = e.code; }
    assert.strictEqual(threw, 'EMPTY_STICKER_BUFFER', 'sendSticker rejeita vazio');
    ok('stickers: validação anti-fantasma (WebP real vs corrupto)');
  } catch (e) { fail('sticker validação', e); }

  /* ------------- atalhos de menu + rankings (Parte 2/3) --------------- */
  try {
    const { registry } = require('../engine/plugins');
    const needed = ['menudownload', 'menurpg', 'menulife', 'menuanime', 'menugames', 'menuzoeira', 'menuutil', 'menumembros', 'menuowner', 'menuadmin', 'topxp', 'topnivel', 'topricho', 'topfazenda', 'statusrpg', 'celeiro', 'criarempresa', 'upgradecasa'];
    const missing = needed.filter((t) => !registry.resolveTrigger(t));
    assert.strictEqual(missing.length, 0, 'atalhos registrados: ' + (missing.join(', ') || 'ok'));
    ok('menus/rankings: atalhos registrados no registry');
  } catch (e) { fail('atalhos menu/rankings', e); }

  /* ------------------ mídia: envio por caminho (bug sistêmico) -------- */
  try {
    const media = require('../utils/media');
    const dbtmp = require('./dbtmp');
    const fakeMp4 = dbtmp.tmpFile('lua-media-test.mp4');
    // string → { url } (o Baileys 7.4.7 NÃO aceita string pura)
    assert.deepStrictEqual(media.asMedia(fakeMp4), { url: fakeMp4 }, 'string vira { url }');
    assert.strictEqual(Buffer.isBuffer(media.asMedia(Buffer.from('x'))), true, 'Buffer passa direto');

    // o Baileys real consegue ler o { url } como arquivo local
    const { getStream } = require('@lucasmod/boruto-vk7-baileys/lib/Utils/messages-media');
    const fs = require('fs');
    fs.writeFileSync(fakeMp4, Buffer.from('fake'));
    const s = await getStream(media.asMedia(fakeMp4), {});
    assert.strictEqual(s.type, 'file', 'getStream lê arquivo local via { url }');
    // drena e fecha a stream ANTES de apagar (evita ENOENT assíncrono)
    await new Promise((resolve) => {
      s.stream.on('error', () => resolve());
      s.stream.on('close', () => resolve());
      s.stream.resume();
    });
    dbtmp.rm(fakeMp4);

    // sendVideo envia { url } (não string pura)
    let captured = null;
    const fakeSock = { sendMessage: async (jid, content) => { captured = content; return { key: { id: 'x' } }; } };
    await media.sendVideo(fakeSock, 'g', fakeMp4, 'cap');
    assert.deepStrictEqual(captured.video, { url: fakeMp4 }, 'sendVideo envia { url }');
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
  await expectReply('cmd: !ia (indisponível sem Groq)', 'ia', ['quanto é 15% de 80'], /IA indisponível/);

  /* -------------------- telas de menu registradas --------------------- */
  try {
    require('../menus/screens');
    const nav = require('../utils/nav');
    for (const id of ['lua_admin_menu', 'lua_automod', 'lua_sticker_menu', 'lua_media', 'lua_ia_menu', 'lua_owner']) {
      const ctx = await commandHandler.buildContext(sock, mkMsg('!menu'));
      sent.length = 0;
      const opened = await nav.openScreen(ctx, id);
      assert.strictEqual(opened, true, id + ' abriu');
      const nativeList = sent.find((s) => s.content && Array.isArray(s.content.interactiveButtons));
      const classicList = sent.find((s) => s.content && Array.isArray(s.content.sections));
      let rows = [];
      if (nativeList) {
        const params = JSON.parse(nativeList.content.interactiveButtons[0].buttonParamsJson);
        rows = (params.sections || []).flatMap((sec) => sec.rows || []);
      } else if (classicList) {
        rows = (classicList.content.sections || []).flatMap((sec) => sec.rows || []);
      } else {
        // MODO SEGURO (padrão do bot): lista/botões nativos são bloqueados por
        // serem payload de alto risco (restrição de conta) e a tela sai como
        // menu TEXTUAL numerado — mesmo conteúdo, comando numérico funcionando.
        const txt = sent.find(
          (s) => s.content && typeof s.content.text === 'string' && /(^|\n)\s*\d+\.\s/.test(s.content.text)
        );
        assert.ok(txt, id + ' enviou menu textual numerado (modo seguro)');
        assert.ok(/número/i.test(txt.content.text), id + ' instrução de navegação numérica');
        continue;
      }
      assert.ok(rows.length > 0, id + ' enviou lista');
    }
    ok('menus: telas admin/automod/sticker/mídia/IA/dono registradas');
  } catch (e) { fail('menus telas', e); }

  /* ------------- stickers: tovideo/togif + emojis de menu ------------ */
  try {
    const { registry } = require('../engine/plugins');
    assert.ok(registry.resolveTrigger('tovideo'), '!tovideo registrado');
    assert.ok(registry.resolveTrigger('togif'), '!togif registrado');
    assert.strictEqual(registry.resolveTrigger('sticker2video').name, 'tovideo', 'alias sticker2video');
    assert.strictEqual(registry.resolveTrigger('stickergif').name, 'togif', 'alias stickergif');
    assert.strictEqual(registry.resolveTrigger('stickerfoto').name, 'toimg', 'alias stickerfoto');

    const { commandEmoji } = require('../utils/commandEmoji');
    assert.ok(commandEmoji({ name: 'sticker', category: 'stickers' }).length > 0, 'emoji de comando');
    assert.ok(commandEmoji({ name: 'sem_mapa', category: 'fun' }).length > 0, 'emoji fallback de categoria');

    // helpers de conversão existem e, com ffmpeg, geram saída
    const eng = require('../utils/stickerEngine');
    assert.strictEqual(typeof eng.stickerToVideo, 'function', 'stickerToVideo exportado');
    assert.strictEqual(typeof eng.stickerToGif, 'function', 'stickerToGif exportado');
    if (eng.hasFfmpeg()) {
      const Jimp = require('jimp');
      const img = new Jimp(128, 128, 0x2ecc71ff);
      const webp = await eng.imageToWebp(await img.getBufferAsync(Jimp.MIME_PNG));
      const gif = await eng.stickerToGif(webp);
      assert.ok(Buffer.isBuffer(gif) && gif.length > 0, 'sticker → gif gerado');
      assert.strictEqual(gif.slice(0, 3).toString('ascii'), 'GIF', 'saída é GIF');
      const mp4 = await eng.stickerToVideo(webp);
      assert.ok(Buffer.isBuffer(mp4) && mp4.length > 0, 'sticker → vídeo gerado');
    } else {
      ok('stickers: ffmpeg ausente — pulando teste de tovideo/togif');
    }
    ok('stickers: tovideo/togif + emojis de menu');
  } catch (e) { fail('stickers tovideo/togif', e); }

  /* ------------- filtros anti (pix/localização/contato) --------------- */
  try {
    const groupHandler = require('../handlers/groupHandler');
    const groups = require('../database/groups');
    const { detectMediaType } = require('../utils/messages');

    // detectMediaType cobre localização e contato
    assert.strictEqual(detectMediaType({ message: { locationMessage: { degreesLatitude: -22 } } }), 'location', 'tipo location');
    assert.strictEqual(detectMediaType({ message: { contactMessage: { displayName: 'X' } } }), 'contact', 'tipo contact');

    const gid = '5511filtertest@g.us';
    groups.ensure(gid, '');
    let deleted = 0;
    const sock = { sendMessage: async (jid, c) => { if (c && c.delete) deleted++; return {}; } };
    const mkCtx = (text, message) => ({
      remoteJid: gid, sender: '5522999999999@s.whatsapp.net',
      isOwner: false, isAdmin: false, isBot: false, isBotAdmin: true,
      text, message: { key: { id: 'k' + Math.random() }, message },
      mentionedJid: [],
    });

    // antipix: link de pagamento é bloqueado
    groups.updateFilter(gid, 'antipix', true);
    const rPix = await groupHandler.applyFilters(sock, mkCtx('pague aqui https://pix.gg/lua', { conversation: 'pague aqui https://pix.gg/lua' }));
    assert.strictEqual(rPix.action, 'antipix', 'antipix detecta link de pix');
    assert.strictEqual(rPix.deleted, true, 'antipix apaga mensagem');

    // antipix: pix copia-e-cola (br.gov.bcb.pix) também é detectado
    const emv = '00020126580014br.gov.bcb.pix0136abc-def-1234';
    const rEmv = await groupHandler.applyFilters(sock, mkCtx(emv, { conversation: emv }));
    assert.strictEqual(rEmv.action, 'antipix', 'antipix detecta pix copia-e-cola');

    // antilocalizacao
    groups.updateFilter(gid, 'antipix', false);
    groups.updateFilter(gid, 'antilocalizacao', true);
    const rLoc = await groupHandler.applyFilters(sock, mkCtx('', { locationMessage: { degreesLatitude: -22.8, degreesLongitude: -47.2 } }));
    assert.strictEqual(rLoc.action, 'antilocalizacao', 'antilocalizacao apaga localização');

    // anticontato
    groups.updateFilter(gid, 'antilocalizacao', false);
    groups.updateFilter(gid, 'anticontato', true);
    const rCtc = await groupHandler.applyFilters(sock, mkCtx('', { contactMessage: { displayName: 'Fulano', vcard: 'BEGIN:VCARD' } }));
    assert.strictEqual(rCtc.action, 'anticontato', 'anticontato apaga contato');

    // filtros nunca atingem admins
    groups.updateFilter(gid, 'antipix', true);
    const rAdmin = await groupHandler.applyFilters(sock, Object.assign(mkCtx('https://pix.gg/x', { conversation: 'https://pix.gg/x' }), { isAdmin: true }));
    assert.strictEqual(rAdmin.deleted, false, 'admin não é filtrado');
    ok('filtros anti: pix/localização/contato + admin imune');
  } catch (e) { fail('filtros anti', e); }

  /* ------------- RPG: cassino + cripto + investimentos ---------------- */
  try {
    const economy = require('../database/economy');
    const crypto = require('../database/crypto');
    const invest = require('../database/investments');
    const { withLock } = require('../utils/keyedMutex');
    const U = '5511casino@s.whatsapp.net';
    economy.setWallet(U, 20000);

    // cassino: aposta nunca deixa saldo negativo
    const before = economy.get(U).wallet;
    const { registry } = require('../engine/plugins');
    assert.ok(registry.resolveTrigger('cassino'), '!cassino registrado');
    assert.ok(registry.resolveTrigger('slots'), '!slots registrado');
    assert.ok(registry.resolveTrigger('flip'), '!flip registrado');
    assert.ok(registry.resolveTrigger('dados'), '!dados registrado');
    assert.ok(registry.resolveTrigger('roleta'), '!roleta registrado');

    // cripto: preços flutuam (janelas de tempo diferentes)
    const p1 = crypto.price('BTC', Date.now());
    const p2 = crypto.price('BTC', Date.now() + 16 * 60 * 1000);
    assert.ok(p1 > 0 && p2 > 0, 'preços positivos');
    assert.notStrictEqual(p1, p2, 'preço muda entre janelas');

    await withLock(U, () => crypto.buy(U, 'ETH', 5000));
    const port = crypto.portfolio(U);
    assert.ok(port.some((r) => r.symbol === 'ETH' && r.amount > 0), 'comprou ETH');
    await withLock(U, () => crypto.sell(U, 'ETH', null));
    assert.strictEqual(crypto.portfolio(U).length, 0, 'vendeu tudo');

    // investimento: investe e resgata sem negativar
    const w1 = economy.get(U).wallet;
    await withLock(U, () => invest.invest(U, 3000));
    assert.strictEqual(economy.get(U).wallet, w1 - 3000, 'carteira descontada');
    assert.ok(invest.get(U).invested === 3000, 'investido salvo');
    const val = invest.valueOf(invest.get(U).invested, Date.parse(invest.get(U).invested_at));
    assert.ok(val > 0, 'valor do fundo positivo');
    await withLock(U, () => invest.redeem(U, null));
    assert.strictEqual(invest.get(U).invested, 0, 'resgatou tudo');
    assert.ok(economy.get(U).wallet >= 0, 'saldo nunca negativo');

    ok('rpg: cassino + cripto + investimentos (atômicos, sem saldo negativo)');
  } catch (e) { fail('rpg cassino/cripto/invest', e); }

  /* ------------- anti: aviso quando bot não é admin ------------------ */
  try {
    const groups = require('../database/groups');
    const groupHandler = require('../handlers/groupHandler');
    const GID = '5511antiaviso@g.us';
    groups.ensure(GID, '');
    groups.updateFilter(GID, 'antilink', true);
    let warned = false;
    const sock = { sendMessage: async (jid, c) => { if (c && c.text && /Links não são permitidos/.test(c.text)) warned = true; return {}; } };
    const ctx = {
      remoteJid: GID, sender: '5522888877777@s.whatsapp.net',
      isOwner: false, isAdmin: false, isBot: false, isBotAdmin: false,
      text: 'https://exemplo.com', message: { key: { id: 'k' }, message: { conversation: 'https://exemplo.com' } },
    };
    const r = await groupHandler.applyFilters(sock, ctx);
    assert.strictEqual(r.action, 'antilink', 'antilink aciona');
    assert.strictEqual(warned, true, 'avisa no grupo quando bot não é admin');
    ok('anti: aviso visível quando o bot não pode apagar');
  } catch (e) { fail('anti aviso', e); }

  /* ------------- LUA TIGRINHO: caça-níquel na carteira RPG ----------- */
  try {
    const { registry } = require('../engine/plugins');
    const game = require('../utils/tigrinhoGame');
    const tstore = require('../database/tigrinho');
    const economy = require('../database/economy');
    const richHtml = require('../utils/richHtml');
    const TG = '5511tigrinho@s.whatsapp.net';
    const TG2 = '5511tigrinho2@s.whatsapp.net';

    // registro + config centralizada (5 rolos)
    assert.ok(registry.resolveTrigger('tigrinho'), '!tigrinho registrado');
    assert.strictEqual(game.TIGRINHO_CONFIG.reelCount, 5, '5 rolos');
    assert.ok(game.TIGRINHO_CONFIG.symbols.length >= 7, '7 símbolos');
    assert.ok(game.TIGRINHO_CONFIG.symbols.some((s) => s.jackpot), 'tem símbolo jackpot');

    // resultado é gerado no backend (avaliação determinística)
    assert.strictEqual(game.evaluate(game.spinReels(() => 0.01)).mult, 48, '5×3 cereja = 3×16x');
    assert.strictEqual(game.evaluate(game.spinReels(() => 0.995)).jackpot, true, '5×3 tigre = jackpot');

    // RTP da tabela de pagamentos entre 50% e 100% (borda da casa saudável)
    const W = game.TIGRINHO_CONFIG.symbols.reduce((a, s) => a + s.weight, 0);
    const pair = game.TIGRINHO_CONFIG.pairMult;
    let E = 0;
    for (const s of game.TIGRINHO_CONFIG.symbols) {
      const p = s.weight / W;
      E += Math.pow(p, 5) * s.p5 + Math.pow(p, 4) * (1 - p) * s.p4 + Math.pow(p, 3) * (1 - p) * s.p3 + Math.pow(p, 2) * (1 - p) * pair;
    }
    const rtp = 3 * E;
    assert.ok(rtp > 0.5 && rtp < 1.0, `RTP razoável (${(rtp * 100).toFixed(1)}%)`);

    // fichas = carteira RPG (mesma moeda do cassino/cripto/invest)
    economy.setWallet(TG, 2000);
    assert.strictEqual(tstore.getBalance(TG), 2000, 'saldo vem da carteira RPG');
    const r1 = await tstore.applySpin(TG, { bet: 100, reward: 0, reels: [['🍒'], ['🍒'], ['🍒'], ['🍒'], ['🍒']], jackpot: false, won: false });
    assert.strictEqual(r1.balance, 1900, '2000 - 100 = 1900');
    assert.strictEqual(economy.get(TG).wallet, 1900, 'carteira RPG atualizada');
    const r2 = await tstore.applySpin(TG, { bet: 50, reward: 250, reels: [['🐯'], ['🐯'], ['🐯'], ['🐯'], ['🐯']], jackpot: true, won: true });
    assert.strictEqual(r2.balance, 2100, '1900 - 50 + 250 = 2100');
    await assert.rejects(() => tstore.applySpin(TG, { bet: 999999, reward: 0, reels: [['🍒'], ['🍒'], ['🍒'], ['🍒'], ['🍒']], jackpot: false, won: false }), /INSUFFICIENT_FUNDS/, 'nunca negativo');

    // histórico limitado a 20
    economy.setWallet(TG2, 2000);
    for (let i = 0; i < 30; i++) await tstore.applySpin(TG2, { bet: 1, reward: 0, reels: [['🍒'], ['🍒'], ['🍒'], ['🍒'], ['🍒']], jackpot: false, won: false });
    assert.strictEqual(tstore.getHistory(TG2).length, 20, 'histórico limitado');

    // ranking ordenado (por saldo da carteira RPG)
    const rank = tstore.getRanking();
    for (let i = 1; i < rank.length; i++) assert.ok(rank[i - 1].balance >= rank[i].balance, 'ranking desc');

    // cooldown individual por usuário
    assert.strictEqual(tstore.canSpin(TG).allowed, false, 'cooldown ativo após giro');
    assert.strictEqual(tstore.canSpin(TG, Date.now() + 5000).allowed, true, 'libera após o tempo');

    // payload visual (relayMessage) com a primitive correta
    const msg = richHtml.buildHtmlMessage('<style>.x{}</style><body>🐯</body>');
    const data = JSON.parse(msg.botForwardedMessage.message.richResponseMessage.unifiedResponse.data.toString('utf8'));
    assert.strictEqual(data.sections[0].view_model.primitive.__typename, 'GenAIaeacdsnwHtmlPrimitive', 'primitive HTML');

    ok('tigrinho: 5 rolos + carteira RPG + cooldown + payload HTML');
  } catch (e) { fail('tigrinho', e); }

  /* ------------- WELCOME/GOODBYE visual (cards) ---------------------- */
  try {
    const { registry } = require('../engine/plugins');
    const wstore = require('../database/welcome');
    const templates = require('../plugins/welcome/templates');
    const renderer = require('../plugins/welcome/renderer');
    const { generateFakeId } = require('../plugins/welcome/fakeId');
    const Jimp = require('jimp');
    const WG = '5511wlcm@g.us';
    const WU = '5511888899999@s.whatsapp.net';

    // comandos registrados sem duplicar (welcome/goodbye + legado intacto)
    assert.ok(registry.resolveTrigger('welcome'), '!welcome registrado');
    assert.ok(registry.resolveTrigger('bemvindo'), '!bemvindo alias');
    assert.ok(registry.resolveTrigger('goodbye'), '!goodbye registrado');
    assert.ok(registry.resolveTrigger('setwelcome'), 'legado setwelcome intacto');
    assert.ok(registry.resolveTrigger('setgoodbye'), 'legado setgoodbye intacto');

    // fake id nunca expõe jid/lid
    assert.match(generateFakeId(), /^LUA-[A-Z0-9]{6}$/, 'formato fake id');

    // templates: 4 welcome + 4 goodbye, sem repetir consecutivo
    await templates.pregenerateAll();
    wstore.setRandom(WG, 'welcome', true);
    let prev = null;
    for (let i = 0; i < 6; i++) {
      const t = wstore.nextTemplate(WG, 'welcome', ['welcome-01', 'welcome-02', 'welcome-03', 'welcome-04']);
      assert.ok(['welcome-01', 'welcome-02', 'welcome-03', 'welcome-04'].includes(t), 'template válido');
      if (prev) assert.notStrictEqual(t, prev, 'sem repetição consecutiva');
      prev = t;
    }

    // estado por grupo
    wstore.setWelcome(WG, true);
    wstore.setGoodbye(WG, true);
    assert.strictEqual(wstore.getState(WG).welcome_enabled, 1, 'welcome on');
    wstore.recordEvent(WG, WU, 'welcome', 'LUA-7F3A91', 'welcome-03');

    // render produz JPEG 1280x720 (sem quebrar por falta de foto: buffer fake)
    const fakePhoto = await new Jimp(200, 200, 0x552288ff).getBufferAsync(Jimp.MIME_PNG);
    const card = await renderer.renderCard({
      kind: 'welcome', templateId: 'welcome-01', photoBuffer: fakePhoto,
      name: 'Teste', number: '5511888899999', fakeId: 'LUA-7F3A91',
      group: 'Grupo Teste', members: 5, date: '09/09/2026', time: '10:00',
    });
    assert.ok(Buffer.isBuffer(card) && card.length > 1000, 'JPEG gerado');
    const img = await Jimp.read(card);
    assert.strictEqual(img.bitmap.width, 1280, '1280 de largura');
    assert.strictEqual(img.bitmap.height, 720, '720 de altura');

    ok('welcome/goodbye: cards 1280x720 + templates + fake id + estado por grupo');
  } catch (e) { fail('welcome/goodbye', e); }

  database.close();
  console.log(`\n=== PLATFORM TEST: ${failures === 0 ? 'TUDO OK' : failures + ' falha(s)'} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ erro fatal:', err);
  process.exit(1);
});
