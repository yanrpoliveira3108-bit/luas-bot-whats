/**
 * test/autobot.test.js — suíte completa do sistema AutoBot.
 *
 * Garante, ponta a ponta (socket falso, banco temporário):
 *   1. registro único: todo recurso tem id/comando/label válidos e sem colisões
 *   2. !statusgrupo no formato oficial (todas as seções e itens)
 *   3. TODO recurso liga e desliga com a resposta padronizada
 *      "✅ Recurso ativado." / "❌ Recurso desativado."
 *   4. o efeito é imediato (sem reiniciar) e persiste no banco
 *   5. compatibilidade: chaves antigas (filters/anti), menus e nomes públicos
 *   6. antis novos: detecção real das mensagens do WhatsApp
 *   7. antis de evento: editar, apagar, reação, chamada
 *   8. automações: autofigu, autoresposta, simih, simih2, iaaleatory,
 *      autobaixar, visu única, modo brincadeira
 *   9. outros: cargo x9, modo gold, limitar comandos, modo registro,
 *      anti PV (1/2/3) e aniversário
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DB = require('./dbtmp').tmpFile('lua-autobot-test.db');

let failures = 0;
function ok(l) {
  console.log('✅ ' + l);
}
function fail(l, e) {
  failures++;
  console.log('❌ ' + l + ' — ' + ((e && e.message) || e));
}

/* ------------------------------ ambiente ------------------------------- */

try {
  fs.rmSync(DB, { force: true });
} catch (_) {}
process.env.OWNER_NUMBER = '5511999999999';
process.env.ANTI_FLOOD = 'false'; // anti-flood global tem teste próprio (utils/flood)
process.env.DATABASE_FILE = DB;
process.env.BUTTONS_ENABLED = 'false';

const database = require('../database/database');
database.open();
require('../commands/loader').loadCommands(true);

const { registry } = require('../engine/plugins');
const commandHandler = require('../handlers/commandHandler');
const groupHandler = require('../handlers/groupHandler');
const eventHandler = require('../handlers/eventHandler');
const autoHandler = require('../handlers/autoHandler');
const autobot = require('../utils/autobot');
const antiManager = require('../utils/antiManager');
const antiDetect = require('../utils/antiDetect');
const groups = require('../database/groups');
const users = require('../database/users');
const media = require('../utils/media');
const Jimp = require('jimp');

const GID = '551100000000@g.us';
const BOT = '551188888888@s.whatsapp.net';
const BOT_LID = '99887766554433@lid';
const OWNER = '5511999999999@s.whatsapp.net';
const ADMIN = '5511977777777@s.whatsapp.net';
const MEMBER = '552277777777@s.whatsapp.net';
const OUTSIDER = '5522666666666@s.whatsapp.net';

const sent = [];
const rejected = [];
const blockedUsers = [];

const meta = {
  id: GID,
  subject: 'Grupo Teste',
  isCommunity: false,
  participants: [
    { id: BOT, lid: BOT_LID, admin: 'admin' },
    { id: OWNER, admin: 'superadmin' },
    { id: ADMIN, admin: 'admin' },
    { id: MEMBER, admin: null },
    { id: OUTSIDER, admin: null },
  ],
};

const sock = {
  user: { id: BOT, lid: BOT_LID },
  sendMessage: async (jid, content, opts) => {
    sent.push({ jid, content, opts });
    return { key: { id: '3EB0' + 'A'.repeat(18), remoteJid: jid } };
  },
  sendPresenceUpdate: async () => {},
  groupMetadata: async () => meta,
  groupParticipantsUpdate: async () => {},
  rejectCall: async (id, from) => {
    rejected.push({ id, from });
  },
  updateBlockStatus: async (jid, action) => {
    blockedUsers.push({ jid, action });
  },
};

function reset() {
  sent.length = 0;
  rejected.length = 0;
  blockedUsers.length = 0;
}

let msgSeq = 0;
const mkMsg = (from, message, opts = {}) => ({
  key: {
    remoteJid: opts.jid || GID,
    fromMe: !!opts.fromMe,
    participant: opts.jid && !String(opts.jid).endsWith('@g.us') ? undefined : from,
    id: 'M' + ++msgSeq,
  },
  message,
  pushName: String(from).split('@')[0],
});
const textMsg = (t, opts = {}) => ({ conversation: t });

/** Executa um comando pelo caminho real (buildContext + executeCommand). */
async function run(cmd, args = [], from = ADMIN, ctxOverrides = {}) {
  const prefix = require('../database/settings').effectivePrefix();
  const raw = prefix + cmd + (args.length ? ' ' + args.join(' ') : '');
  const msg = mkMsg(from, textMsg(raw));
  const ctx = await commandHandler.buildContext(sock, msg);
  Object.assign(ctx, ctxOverrides);
  const target = registry.resolveTrigger(cmd);
  assert.ok(target, `comando ${cmd} existe`);
  // cada chamada do teste precisa começar "limpa" (cooldown é por usuário/comando)
  const cooldown = require('../utils/cooldown');
  cooldown.reset('user', from, target.name);
  cooldown.reset('group', GID, target.name);
  cooldown.reset('global', '*', target.name);
  reset();
  await commandHandler.executeCommand(ctx, target, args);
  return { ctx, sent: sent.map((s) => s.content) };
}

/** Executa uma mensagem comum pelo pipeline completo. */
async function message(from, message, opts = {}) {
  reset();
  await commandHandler.handleMessage(sock, mkMsg(from, message, opts));
  await autoHandler.flush();
  return sent.map((s) => s.content);
}

function texts(list) {
  return list.filter((c) => c && typeof c.text === 'string').map((c) => c.text);
}
function hasText(list, re) {
  return texts(list).some((t) => re.test(t));
}

async function main() {
  groups.ensure(GID, 'Grupo Teste');
  autobot.ensureGroupDefaults(GID);
  users.upsert(MEMBER, 'Membro');
  users.upsert(ADMIN, 'Admin');
  users.upsert(OWNER, 'Dono');

  /* ══════════════════ 1. registro do AutoBot ══════════════════ */
  try {
    const ids = new Set();
    const cmds = new Set();
    for (const def of autobot.all()) {
      assert.ok(def.id && !ids.has(def.id), `id único: ${def.id}`);
      ids.add(def.id);
      if (!def.generated) continue;
      for (const t of [def.cmd, ...def.aliases]) {
        assert.ok(t && !cmds.has(t), `trigger único: ${t}`);
        cmds.add(t);
        assert.ok(registry.resolveTrigger(t), `trigger registrado: ${t}`);
      }
    }
    assert.ok(autobot.all().length >= 60, 'pelo menos 60 recursos no registro');
    assert.ok(autobot.antiIds().length >= 30, 'pelo menos 30 antis');
    ok(`1: registro íntegro (${autobot.all().length} recursos, ${autobot.antiIds().length} antis, ${cmds.size} comandos gerados)`);
  } catch (e) {
    fail('1: registro', e);
  }

  /* ══════════════════ 2. chaves padrão automáticas ══════════════════ */
  try {
    const s = groups.getSettings(GID);
    for (const def of autobot.all()) {
      if (def.scope !== 'group') continue;
      assert.ok(s.autobot && s.autobot[def.id], `chave criada automaticamente: ${def.id}`);
      assert.strictEqual(s.autobot[def.id].enabled, false, `valor padrão false: ${def.id}`);
    }
    for (const def of autobot.all()) {
      if (def.scope !== 'global') continue;
      assert.strictEqual(
        require('../database/settings').getBool(`autobot:${def.id}`, false),
        false,
        `global padrão false: ${def.id}`
      );
    }
    ok('2: chaves criadas automaticamente com valores padrão');
  } catch (e) {
    fail('2: chaves padrão', e);
  }

  /* ══════════════════ 3. status oficial ══════════════════ */
  try {
    autobot.setEnabled(GID, 'antilink', true);
    autobot.setEnabled(GID, 'antilinkgp', true);
    autobot.setEnabled(GID, 'antistatus', true);

    const { sent: out } = await run('statusgrupo', [], MEMBER);
    const text = texts(out)[0];
    assert.ok(text, 'status respondido');

    // cabeçalho e seções exatamente como especificado
    assert.ok(text.includes('⚙️ STATUS DO GRUPO ⚙️'), 'cabeçalho');
    for (const title of ['🔒 PROTEÇÕES', '🚫 ANTI MÍDIA', '👋 BEM-VINDO', '🤖 AUTOMAÇÃO', '📋 OUTROS', '🌐 GLOBAL']) {
      assert.ok(text.includes(title), `seção ${title}`);
    }
    const labels = [
      'Anti Link', 'Anti Link 2', 'Anti Link GP', 'Anti Palavrão', 'Anti Fake', 'Anti Catálogo',
      'Anti Localização', 'Limite Caracteres', 'Anti Spam', 'Anti Status',
      'Anti Vídeo', 'Anti Imagem', 'Anti Áudio', 'Anti Documento', 'Anti Contato', 'Anti Sticker',
      'Bemvindo1', 'Bemvindo2', 'Saiu1', 'Saiu2',
      'Autofigu', 'AutoResposta', 'Simih', 'Simih2', 'IA Aleatory', 'Auto Baixar',
      'Cargo X9', 'Visu Única', 'Modo Brincadeira', 'Limitar Comandos', 'Modo Gold',
      'Anti PV', 'Anti PV2', 'Anti PV3', 'Aniversário', 'Modo Registro',
    ];
    for (const label of labels) {
      assert.ok(
        text.includes(`${label} ✅`) || text.includes(`${label} ❌`),
        `item ${label} com ícone`
      );
    }
    assert.ok(/Anti Link ✅ !antilink/.test(text), 'Anti Link ligado com comando');
    assert.ok(/Anti Link 2 ❌ !antilink2/.test(text), 'Anti Link 2 desligado com comando');
    assert.ok(/Anti Link GP ✅ !antilinkgp/.test(text), 'Anti Link GP ligado');
    assert.ok(!/undefined/.test(text), 'sem "undefined" no status');
    ok('3: !statusgrupo no formato oficial');
  } catch (e) {
    fail('3: status', e);
  }

  /* ══════════════════ 4. liga/desliga padronizado ══════════════════ */
  try {
    let checked = 0;
    for (const def of autobot.all()) {
      if (!def.generated) continue;
      const from = def.scope === 'global' ? OWNER : ADMIN;
      const on = await run(def.cmd, ['on'], from);
      assert.strictEqual(
        texts(on.sent)[0],
        '✅ Recurso ativado.',
        `${def.cmd} on responde exatamente "✅ Recurso ativado." (recebi: ${JSON.stringify(texts(on.sent)[0] || '')})`
      );
      assert.strictEqual(autobot.isEnabled(def.scope === 'global' ? null : GID, def.id), true, `${def.id} ligado`);

      const off = await run(def.cmd, ['off'], from);
      assert.strictEqual(texts(off.sent)[0], '❌ Recurso desativado.', `${def.cmd} off responde exatamente o padrão`);
      assert.strictEqual(autobot.isEnabled(def.scope === 'global' ? null : GID, def.id), false, `${def.id} desligado`);
      checked++;
    }
    ok(`4: ${checked} comandos ligam/desligam com resposta padronizada`);
  } catch (e) {
    fail('4: on/off padronizado', e);
  }

  /* ══════════════════ 5. persistência (sem reiniciar) ══════════════════ */
  try {
    autobot.setEnabled(GID, 'antilink2', true);
    groups.invalidateSettings(GID); // simula leitura fria (outro processo)
    assert.strictEqual(autobot.isEnabled(GID, 'antilink2'), true, 'sobrevive à invalidação do cache');
    // grava direto no banco e confere que a chave existe
    const row = require('../database/database').prepare('x', 'SELECT settings FROM groups WHERE id = ?').get(GID);
    const parsed = JSON.parse(row.settings);
    assert.strictEqual(parsed.autobot.antilink2.enabled, true, 'valor gravado no JSON do grupo');
    // e o espelho legado também
    assert.strictEqual(parsed.filters.antilink2, true, 'espelho em filters');
    assert.strictEqual(parsed.anti.antilink2.enabled, true, 'espelho em anti');
    autobot.setEnabled(GID, 'antilink2', false); // limpa para os próximos testes
    ok('5: persistência + espelhos de compatibilidade');
  } catch (e) {
    fail('5: persistência', e);
  }

  /* ══════════════════ 6. compatibilidade com o legado ══════════════════ */
  try {
    // !antilink on (comando antigo) → mesmo estado do AutoBot
    autobot.setEnabled(GID, 'antilink', false);
    await run('antilink', ['on'], ADMIN);
    assert.strictEqual(autobot.isEnabled(GID, 'antilink'), true, '!antilink on liga o recurso');
    assert.strictEqual((groups.getSettings(GID).filters || {}).antilink, true, 'filters.antilink espelhado');

    // !anti antilink off (sistema avançado) → desliga o MESMO recurso
    await run('anti', ['antilink', 'off'], ADMIN);
    assert.strictEqual(autobot.isEnabled(GID, 'antilink'), false, '!anti antilink off desliga o mesmo recurso');

    // !antiinvite (nome público antigo) controla o "Anti Link GP"
    await run('antiinvite', ['on'], ADMIN);
    assert.strictEqual(autobot.isEnabled(GID, 'antilinkgp'), true, '!antiinvite = Anti Link GP');
    await run('antiinvite', ['off'], ADMIN);

    // whitelist do antilink continua funcionando
    const wl = await run('antilink', ['whitelist', 'add', 'exemplo.com'], ADMIN);
    assert.ok(hasText(wl.sent, /adicionado à whitelist/), 'whitelist add');
    assert.ok((groups.getSettings(GID).antilink_whitelist || []).includes('exemplo.com'), 'whitelist gravada');
    await run('antilink', ['whitelist', 'remove', 'exemplo.com'], ADMIN);
    assert.ok(!(groups.getSettings(GID).antilink_whitelist || []).includes('exemplo.com'), 'whitelist removida');

    // filtros antigos ligados direto no banco continuam valendo (migração)
    groups.updateFilter(GID, 'antipix', true);
    assert.strictEqual(autobot.isEnabled(GID, 'antipix'), true, 'filtro legado é respeitado');
    groups.updateFilter(GID, 'antipix', false);
    ok('6: compatibilidade total (filters, anti, nomes públicos, whitelist)');
  } catch (e) {
    fail('6: compatibilidade', e);
  }

  /* ══════════════════ 7. antis novos: detecção real ══════════════════ */
  try {
    const cases = [
      ['antilink', { conversation: 'olha http://site.com/x' }],
      ['antilink2', { conversation: 'acessa siteinvalido.com.br agora' }],
      ['antilinkgp', { conversation: 'entra no grupo chat.whatsapp.com/AbCdEf123' }],
      ['antipalavrao', { conversation: 'seu otario do caralho' }],
      ['anticatalogo', { productMessage: { product: { title: 'Camisa' } } }],
      ['antistatus', { groupStatusMentionMessage: { message: {} } }],
      ['antienquete', { pollCreationMessage: { name: 'Voto?' } }],
      ['anticanal', { newsletterAdminInviteMessage: { newsletterName: 'Canal X' } }],
      ['anticomunidade', { commentMessage: { message: { conversation: 'oi' } } }],
      ['antibot', { botInvokeMessage: { message: {} } }],
      ['antigif', { videoMessage: { gifPlayback: true, caption: 'gif' } }],
      ['antilocalizacaotemp', { liveLocationMessage: { degreesLatitude: -22 } }],
      ['antilocalizacao', { locationMessage: { degreesLatitude: -22, degreesLongitude: -47 } }],
      ['antiapk', { documentMessage: { fileName: 'app.apk', mimetype: 'application/vnd.android.package-archive' } }],
      ['antizip', { documentMessage: { fileName: 'arquivo.zip', mimetype: 'application/zip' } }],
      ['antiexe', { documentMessage: { fileName: 'setup.exe', mimetype: 'application/x-msdownload' } }],
      ['antipdf', { documentMessage: { fileName: 'contrato.pdf', mimetype: 'application/pdf' } }],
      ['anticontato', { contactMessage: { displayName: 'Fulano', vcard: 'BEGIN:VCARD' } }],
      ['antisticker', { stickerMessage: { mimetype: 'image/webp' } }],
      ['antiimagem', { imageMessage: { caption: 'foto' } }],
      ['antivideo', { videoMessage: { caption: 'video' } }],
      ['antiaudio', { audioMessage: { ptt: true } }],
      ['antidocumento', { documentMessage: { fileName: 'nota.txt' } }],
      ['antiviewonce', { viewOnceMessage: { message: { imageMessage: {} } } }],
      ['antiencaminhamento', { extendedTextMessage: { text: 'repasse', contextInfo: { isForwarded: true, forwardingScore: 5 } } }],
      [
        'antimencaomassa',
        { extendedTextMessage: { text: 'oi', contextInfo: { mentionedJid: [ADMIN, MEMBER, OWNER, BOT, OUTSIDER, '552211111111@s.whatsapp.net'] } } },
      ],
      ['limitecaracteres', { conversation: 'a'.repeat(1500) }],
      ['antiemojispam', { conversation: '😀'.repeat(12) }],
      ['antipix', { requestPaymentMessage: { amount: 1000 } }],
      ['antipix', { conversation: 'pague no pix chave 123.456.789-00' }],
    ];

    for (const [antiId, msg] of cases) {
      autobot.setEnabled(GID, antiId, true);
      const out = await message(MEMBER, msg);
      const deleted = out.some((c) => c && c.delete);
      assert.ok(deleted, `${antiId}: mensagem apagada (recebi ${JSON.stringify(out)})`);
      autobot.setEnabled(GID, antiId, false);
      const clean = await message(MEMBER, msg);
      assert.ok(!clean.some((c) => c && c.delete), `${antiId}: desligado não apaga mais`);
    }
    ok(`7: ${cases.length} detecções de anti (liga apaga / desliga não apaga)`);
  } catch (e) {
    fail('7: detecção de antis', e);
  }

  /* ══════════════════ 8. antis de evento ══════════════════ */
  try {
    // anti editar mensagem
    autobot.setEnabled(GID, 'antieditarmensagem', true);
    reset();
    await eventHandler.handleMessageUpdate(sock, [
      {
        key: { remoteJid: GID, participant: MEMBER, id: 'ORIG1' },
        update: { message: { editedMessage: { message: { conversation: 'novo texto' } } } },
      },
    ]);
    assert.ok(sent.some((c) => c.content && c.content.delete), '8a: mensagem editada é apagada');

    // anti apagar mensagem (revoke) com ação warn
    antiManager.setAntiConfig(GID, 'antiapagarmensagem', { enabled: true, action: 'warn' });
    reset();
    await eventHandler.handleMessageUpdate(sock, [
      {
        key: { remoteJid: GID, participant: MEMBER, id: 'ORIG2' },
        update: { message: null, messageStubType: eventHandler.REVOKE, key: { id: 'ORIG2' } },
      },
    ]);
    assert.strictEqual(groups.countWarnings(GID, MEMBER), 1, '8b: revoke aplicou advertência');
    antiManager.setAntiConfig(GID, 'antiapagarmensagem', { enabled: false, action: 'delete' });

    // anti reação
    autobot.setEnabled(GID, 'antireacao', true);
    reset();
    await eventHandler.handleReactions(sock, [
      { key: { remoteJid: GID, participant: MEMBER, id: 'MSGREAGIDA' }, reaction: { text: '😂', key: { remoteJid: GID, participant: MEMBER, id: 'REACT1' } } },
    ]);
    assert.ok(
      sent.some((c) => c.content && c.content.delete && c.content.delete.id === 'REACT1'),
      '8c: reação removida (delete da mensagem de reação)'
    );

    // anti chamada
    autobot.setEnabled(GID, 'antichamada', true);
    reset();
    await eventHandler.handleCalls(sock, [{ id: 'CALL1', from: MEMBER, status: 'offer', isVideo: false, chatId: GID }]);
    assert.strictEqual(rejected.length, 1, '8d: chamada rejeitada');
    ok('8: antis de evento (editar, apagar, reação, chamada)');
  } catch (e) {
    fail('8: antis de evento', e);
  }

  /* ══════════════════ 9. automações ══════════════════ */
  try {
    /* 9a: autofigu */
    autobot.setEnabled(GID, 'autofigu', true);
    const img = new Jimp(48, 48, 0xff0000ff);
    const png = await img.getBufferAsync(Jimp.MIME_PNG);
    const realDownload = media.downloadMediaBuffer;
    media.downloadMediaBuffer = async () => png;
    const stickerOut = await message(MEMBER, { imageMessage: { mimetype: 'image/png' } });
    media.downloadMediaBuffer = realDownload;
    assert.ok(stickerOut.some((c) => Buffer.isBuffer(c.sticker)), '9a: autofigu enviou figurinha');
    autobot.setEnabled(GID, 'autofigu', false);

    /* 9b: autoresposta */
    await run('autoresposta', ['add', 'bom dia', '=', 'Bom dia, {user}!'], ADMIN);
    assert.ok(autoHandler.autorespostas(GID).length === 1, '9b: gatilho cadastrado');
    autobot.setEnabled(GID, 'autoresposta', true);
    const arOut = await message(MEMBER, textMsg('bom dia pessoal'));
    assert.ok(hasText(arOut, /Bom dia/), '9b: autoresposta respondeu');
    const arList = await run('autoresposta', ['list'], ADMIN);
    assert.ok(hasText(arList.sent, /RESPOSTAS AUTOMÁTICAS/), '9b: list funciona');
    autobot.setEnabled(GID, 'autoresposta', false);
    const arOff = await message(MEMBER, textMsg('bom dia pessoal'));
    assert.ok(!hasText(arOff, /Bom dia/), '9b: desligado não responde');

    /* 9c: simih (IA local) */
    autobot.setEnabled(GID, 'simih', true);
    const simihOut = await message(MEMBER, textMsg('quanto é 2+2?'));
    assert.ok(simihOut.length >= 1, '9c: simih respondeu');
    autobot.setEnabled(GID, 'simih', false);

    /* 9d: simih2 — só quando citado */
    autobot.setEnabled(GID, 'simih2', true);
    const notAddressed = await message(MEMBER, textMsg('quanto é 3+3?'));
    assert.strictEqual(notAddressed.length, 0, '9d: simih2 ignorou mensagem comum');
    const addressed = await message(MEMBER, {
      extendedTextMessage: { text: 'quanto é 3+3?', contextInfo: { mentionedJid: [BOT] } },
    });
    assert.ok(addressed.length >= 1, '9d: simih2 respondeu quando citado');
    autobot.setEnabled(GID, 'simih2', false);

    /* 9e: iaaleatory (força a chance) */
    autobot.setEnabled(GID, 'iaaleatory', true);
    autobot.setOptions(GID, 'iaaleatory', { chance: 50 });
    const realRandom = Math.random;
    Math.random = () => 0.001;
    autoHandler.sweepRates();
    const iaOut = await message(MEMBER, textMsg('qual a capital do brasil?'));
    Math.random = realRandom;
    assert.ok(iaOut.length >= 1, '9e: iaaleatory participou');
    autobot.setEnabled(GID, 'iaaleatory', false);

    /* 9f: autobaixar (download mockado) */
    const router = require('../downloaders/router');
    const realRouterDownload = router.download;
    const tmpFile = path.join(os.tmpdir(), 'autobot-test.bin');
    fs.writeFileSync(tmpFile, Buffer.alloc(1024));
    router.download = async () => ({ path: tmpFile, title: 'Vídeo Teste', mimetype: 'video/mp4', isVideo: true, platform: 'youtube' });
    autobot.setEnabled(GID, 'autobaixar', true);
    autoHandler.sweepRates();
    const dlOut = await message(MEMBER, textMsg('olha https://youtu.be/abc123'));
    router.download = realRouterDownload;
    assert.ok(dlOut.some((c) => Buffer.isBuffer(c.video)), '9f: autobaixar enviou o vídeo');
    autobot.setEnabled(GID, 'autobaixar', false);

    /* 9g: visu única */
    autobot.setEnabled(GID, 'x9visaounica', true);
    const fakeMedia = Buffer.from('fake-image');
    media.downloadMediaBuffer = async () => fakeMedia;
    autoHandler.sweepRates();
    const vuOut = await message(MEMBER, { viewOnceMessage: { message: { imageMessage: { mimetype: 'image/png' } } } });
    media.downloadMediaBuffer = realDownload;
    assert.ok(vuOut.some((c) => Buffer.isBuffer(c.image)), '9g: visu única revelada');
    autobot.setEnabled(GID, 'x9visaounica', false);

    /* 9h: modo brincadeira */
    autobot.setEnabled(GID, 'modobrincadeira', true);
    Math.random = () => 0.001;
    autoHandler.sweepRates();
    const brOut = await message(MEMBER, textMsg('hahaha que isso'));
    Math.random = realRandom;
    assert.ok(brOut.length >= 1, '9h: modo brincadeira participou');
    autobot.setEnabled(GID, 'modobrincadeira', false);
    ok('9: automações (autofigu, autoresposta, simih, simih2, iaaleatory, autobaixar, visu única, brincadeira)');
  } catch (e) {
    fail('9: automações', e);
  }

  /* ══════════════════ 10. cargo x9, gold, limites ══════════════════ */
  try {
    /* 10a: cargo x9 — membro comum ganha poderes de moderação */
    autobot.setEnabled(GID, 'cargox9', true);
    const before = await run('advertir', ['@' + MEMBER.split('@')[0], 'teste'], MEMBER);
    assert.ok(hasText(before.sent, /Apenas administradores/), '10a: sem cargo x9 é bloqueado');
    await run('cargox9', ['add', '@' + MEMBER.split('@')[0]], ADMIN);
    assert.ok(groups.getList(GID, 'x9').includes(MEMBER), '10a: membro adicionado ao cargo x9');
    const after = await run('advertir', ['@' + MEMBER.split('@')[0], 'teste'], MEMBER);
    assert.ok(!hasText(after.sent, /Apenas administradores/), '10a: com cargo x9 tem permissão');
    const list = await run('cargox9', ['list'], ADMIN);
    assert.ok(hasText(list.sent, /CARGO X9/), '10a: list do cargo');
    await run('cargox9', ['remove', '@' + MEMBER.split('@')[0]], ADMIN);
    assert.strictEqual(groups.getList(GID, 'x9').length, 0, '10a: removido do cargo');
    autobot.setEnabled(GID, 'cargox9', false);

    /* 10b: modo gold — ignora cooldown */
    autobot.setEnabled(GID, 'modogold', true);
    await run('modogold', ['add', '@' + MEMBER.split('@')[0]], ADMIN);
    const c1 = await run('ping', [], MEMBER);
    const c2 = await run('ping', [], MEMBER);
    assert.ok(texts(c2.sent).length > 0 && !/Aguarde/.test(texts(c2.sent).join(' ')), '10b: gold ignorou o cooldown');
    assert.ok(texts(c1.sent).length > 0, '10b: comando normal funcionou');
    const goldList = await run('modogold', ['list'], ADMIN);
    assert.ok(hasText(goldList.sent, /MODO GOLD/), '10b: list do gold');
    autobot.setEnabled(GID, 'modogold', false);

    /* 10c: limitar comandos (o limite é aplicado no pipeline real) */
    await run('limitarcomandos', ['2'], ADMIN);
    assert.strictEqual(autobot.options(GID, 'limitarcomandos').limite, 2, '10c: limite configurado');
    autobot.setEnabled(GID, 'limitarcomandos', true);
    const r1 = texts(await message(OUTSIDER, textMsg('!ping'))).join(' ');
    const r2 = texts(await message(OUTSIDER, textMsg('!help'))).join(' ');
    const r3 = texts(await message(OUTSIDER, textMsg('!menu'))).join(' ');
    assert.ok(/Pong/.test(r1), `10c: 1º comando passa (${r1.slice(0, 40)})`);
    assert.ok(r2.length > 0, `10c: 2º comando passa (${r2.slice(0, 40)})`);
    assert.ok(/limite de/i.test(r3), `10c: 3º comando é limitado (${r3.slice(0, 80)})`);
    // desligado volta a funcionar na hora
    autobot.setEnabled(GID, 'limitarcomandos', false);
    const cd = require('../utils/cooldown');
    cd.reset('user', OUTSIDER, 'ping');
    cd.reset('group', GID, 'ping');
    cd.reset('global', '*', 'ping');
    const r4 = texts(await message(OUTSIDER, textMsg('!ping'))).join(' ');
    assert.ok(/Pong/.test(r4), '10c: desligado libera na hora');
    ok('10: cargo x9, modo gold e limitar comandos');
  } catch (e) {
    fail('10: x9/gold/limites', e);
  }

  /* ══════════════════ 11. modo registro + anti PV ══════════════════ */
  try {
    users.setRegistered(OUTSIDER, 0);
    autobot.setEnabled(null, 'modoregistro', true);
    const blocked = await run('ping', [], OUTSIDER);
    assert.ok(hasText(blocked.sent, /Modo Registro ativo/), '11a: não registrado é bloqueado');
    const ownerOk = await run('ping', [], OWNER);
    assert.ok(!hasText(ownerOk.sent, /Modo Registro ativo/), '11a: dono não é bloqueado');
    users.register(OUTSIDER);
    const registered = await run('ping', [], OUTSIDER);
    assert.ok(!hasText(registered.sent, /Modo Registro ativo/), '11a: registrado passa');
    autobot.setEnabled(null, 'modoregistro', false);

    // anti pv 1
    autobot.setEnabled(null, 'antipv', true);
    reset();
    await commandHandler.handleMessage(sock, mkMsg(OUTSIDER, textMsg('oi bot'), { jid: OUTSIDER }));
    assert.ok(hasText(sent.map((s) => s.content), /Anti PV ativo/), '11b: anti pv avisa');
    reset();
    await commandHandler.handleMessage(sock, mkMsg(OUTSIDER, textMsg('oi bot'), { jid: OUTSIDER }));
    const warns = sent.filter((s) => s.content && /Anti PV ativo/.test(s.content.text || ''));
    assert.strictEqual(warns.length, 0, '11b: avisa só uma vez por dia');
    autobot.setEnabled(null, 'antipv', false);

    // anti pv2 — silêncio
    autobot.setEnabled(null, 'antipv2', true);
    reset();
    await commandHandler.handleMessage(sock, mkMsg(OUTSIDER, textMsg('!ping'), { jid: OUTSIDER }));
    assert.strictEqual(sent.length, 0, '11c: anti pv2 ignora em silêncio');
    autobot.setEnabled(null, 'antipv2', false);

    // anti pv3 — bloqueia
    autobot.setEnabled(null, 'antipv3', true);
    reset();
    await commandHandler.handleMessage(sock, mkMsg(OUTSIDER, textMsg('oi'), { jid: OUTSIDER }));
    assert.strictEqual(blockedUsers.length, 1, '11d: anti pv3 bloqueou o número');
    assert.ok(blockedUsers[0].jid === OUTSIDER && blockedUsers[0].action === 'block', '11d: ação de bloqueio correta');
    autobot.setEnabled(null, 'antipv3', false);

    // dono nunca é bloqueado
    autobot.setEnabled(null, 'antipv3', true);
    reset();
    await commandHandler.handleMessage(sock, mkMsg(OWNER, textMsg('status'), { jid: OWNER }));
    assert.strictEqual(blockedUsers.length, 0, '11e: dono imune ao anti pv');
    autobot.setEnabled(null, 'antipv3', false);
    ok('11: modo registro + anti PV (1/2/3)');
  } catch (e) {
    fail('11: registro/anti-PV', e);
  }

  /* ══════════════════ 12. aniversário ══════════════════ */
  try {
    const birthday = require('../utils/birthday');
    assert.ok(birthday.parseDate('31/02') === null, '12: data impossível é rejeitada');
    assert.ok(birthday.parseDate('25/12/1990'), '12: aceita dd/mm/aaaa');

    const hoje = new Date();
    const dd = String(hoje.getDate()).padStart(2, '0');
    const mm = String(hoje.getMonth() + 1).padStart(2, '0');
    const reg = await run('aniversario', [`${dd}/${mm}`], MEMBER);
    assert.ok(hasText(reg.sent, /Aniversário salvo/), '12: aniversário cadastrado pelo comando');

    autobot.setEnabled(null, 'aniversario', true);
    reset();
    const enviados = await autoHandler.tickBirthdays(sock);
    assert.ok(enviados >= 1, '12: felicitação enviada');
    assert.ok(hasText(sent.map((s) => s.content), /FELIZ ANIVERSÁRIO/), '12: mensagem de parabéns');
    reset();
    const repetido = await autoHandler.tickBirthdays(sock);
    assert.strictEqual(repetido, 0, '12: não repete no mesmo dia');
    autobot.setEnabled(null, 'aniversario', false);
    ok('12: aniversário (cadastro + aviso único por dia)');
  } catch (e) {
    fail('12: aniversário', e);
  }

  /* ══════════════════ 13. boas-vindas / saída (texto e card) ══════════════════ */
  try {
    // texto de boas-vindas
    await run('setwelcome', ['Bem-vindo', '{user}!'], ADMIN);
    autobot.setEnabled(GID, 'bemvindo1', true);
    reset();
    await groupHandler.handleGroupParticipants(sock, { id: GID, author: ADMIN, participants: [OUTSIDER], action: 'add' });
    assert.ok(hasText(sent.map((s) => s.content), /Bem-vindo/), '13a: boas-vindas textual');
    autobot.setEnabled(GID, 'bemvindo1', false);
    reset();
    await groupHandler.handleGroupParticipants(sock, { id: GID, author: ADMIN, participants: ['5522555555555@s.whatsapp.net'], action: 'add' });
    assert.ok(!hasText(sent.map((s) => s.content), /Bem-vindo/), '13a: desligado não envia');

    // despedida em SAÍDA VOLUNTÁRIA (ação 'leave' — antes era ignorada)
    await run('setgoodbye', ['Ate', 'mais', '{user}!'], ADMIN);
    autobot.setEnabled(GID, 'saiu1', true);
    reset();
    await groupHandler.handleGroupParticipants(sock, { id: GID, author: MEMBER, participants: [MEMBER], action: 'leave' });
    assert.ok(hasText(sent.map((s) => s.content), /Ate mais/), '13b: despedida em saída voluntária (leave)');
    reset();
    await groupHandler.handleGroupParticipants(sock, { id: GID, author: ADMIN, participants: [MEMBER], action: 'remove' });
    assert.ok(hasText(sent.map((s) => s.content), /Ate mais/), '13b: despedida em remoção (remove)');
    autobot.setEnabled(GID, 'saiu1', false);
    ok('13: bem-vindo/saída (texto, add/leave/remove)');
  } catch (e) {
    fail('13: bem-vindo/saída', e);
  }

  /* ══════════════════ 14. desempenho: leituras de settings ══════════════════ */
  try {
    autobot.setEnabled(GID, 'antilink', true);
    autobot.setEnabled(GID, 'antispam', true);
    const before = groups.settingsCacheStats().size;
    let reads = 0;
    const original = groups.get;
    // conta quantas vezes o JSON é lido do banco durante o processamento
    const db = require('../database/database');
    const realPrepare = db.prepare;
    db.prepare = (name, sql) => {
      if (/SELECT \* FROM groups WHERE id/.test(sql)) reads++;
      return realPrepare(name, sql);
    };
    for (let i = 0; i < 20; i++) {
      await commandHandler.handleMessage(sock, mkMsg(MEMBER, textMsg('mensagem comum ' + i)));
    }
    db.prepare = realPrepare;
    groups.get = original;
    assert.ok(reads <= 25, `leituras do grupo limitadas pelo cache (${reads} em 20 mensagens)`);
    assert.ok(groups.settingsCacheStats().size >= before, 'cache em uso');
    ok(`14: cache de configurações (${reads} leituras de grupo em 20 mensagens)`);
  } catch (e) {
    fail('14: cache/desempenho', e);
  }

  /* ══════════════════ 15. janitor (memória) ══════════════════ */
  try {
    const janitor = require('../utils/janitor');
    const stats = janitor.stats();
    assert.ok(stats.tasks.length >= 4, 'tarefas de limpeza registradas');
    janitor.sweep();
    ok(`15: janitor ativo com ${stats.tasks.length} tarefas de limpeza`);
  } catch (e) {
    fail('15: janitor', e);
  }

  /* ------------------------------- fim ------------------------------- */
  database.close();
  if (failures) {
    console.error(`\n❌ AUTOBOT TEST: ${failures} falha(s)`);
    process.exit(1);
  }
  console.log('\n=== AUTOBOT TEST: TUDO OK ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err && err.stack ? err.stack : err);
  process.exit(1);
});
