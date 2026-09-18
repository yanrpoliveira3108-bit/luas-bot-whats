/**
 * test/criador.test.js — !criador com richResponse (GenAI) via relayMessage.
 *
 * O ponto mais importante aqui é o round-trip pelo proto REAL da biblioteca:
 * se algum campo não existisse no proto, o encode silenciaria e o cartão nunca
 * chegaria. Este teste prova que o payload sobrevive a encode + decode.
 */

'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));
process.env.DATABASE_FILE = path.resolve(__dirname, '../database/lua-test-criador.db');
const fs = require('fs');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
}

const database = require('../database/database');
database.open();
const { loadCommands } = require('../commands/loader');
const { registry } = require('../engine/plugins');
loadCommands(true);

const { proto } = require('@lucasmod/boruto-vk7-baileys/WAProto');
const consts = require('../utils/consts');
const CONFIG = require('../config');

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`  ✔ ${label}`);
};

const BOT = '5511888887777@s.whatsapp.net';
const USER = '5511911110001@s.whatsapp.net';
const CHAT = '120363000000000000@g.us';
const MSG_ID = 'BAE5ABC123';

const FORBIDDEN = ['CHOOSO', 'COLUMBINA', 'columbina', 'Draculaura', 'draculaura', 'Arthur Modz', 'arthur', 'Nerdzinho', 'nerdzinho', 'dylanModz'];

function fakeSocket(opts = {}) {
  const relayed = [];
  const sock = {
    relayed,
    user: { id: BOT },
    relayMessage: async (jid, message) => {
      if (opts.relayThrows) throw new Error('500: relay recusado');
      relayed.push({ jid, message });
      return 'OK';
    },
    sendMessage: async () => ({ key: { id: 'K' } }),
    profilePictureUrl: async () => '',
  };
  if (opts.noRelay) delete sock.relayMessage;
  return sock;
}

function fakeCtx(overrides = {}) {
  const socket = overrides.socket || fakeSocket();
  const replies = [];
  return Object.assign(
    {
      args: [],
      text: '!criador',
      prefix: '!',
      remoteJid: CHAT,
      sender: USER,
      isGroup: true,
      isOwner: false,
      isAdmin: true,
      isBotAdmin: true,
      mentionedJid: [],
      replies,
      socket,
      reply: async (t) => {
        replies.push(String(t));
        return true;
      },
      message: {
        key: { remoteJid: CHAT, fromMe: false, id: MSG_ID, participant: USER },
        pushName: 'Tester',
        message: {},
      },
    },
    overrides,
    { socket, replies }
  );
}

const cmd = registry.resolveTrigger('criador');

/** decodifica o unifiedResponse.data */
function sectionsOf(message) {
  const r = message.botForwardedMessage.message.richResponseMessage;
  return JSON.parse(Buffer.from(r.unifiedResponse.data, 'base64').toString('utf8'));
}

(async () => {
  // ---- 1) registro dos quatro gatilhos
  for (const t of ['criador', 'criadordobot', 'creator', 'suporte-criador']) {
    const c = registry.resolveTrigger(t);
    assert.ok(c && c.name === 'criador', `gatilho ${t} → !criador`);
  }
  ok('registrado: !criador, !criadordobot, !creator e !suporte-criador');

  // ---- 2) envio real e formato do payload
  const c2 = fakeCtx();
  await cmd.execute(c2);
  assert.strictEqual(c2.socket.relayed.length, 1, 'relayMessage chamado uma vez');
  assert.strictEqual(c2.socket.relayed[0].jid, CHAT, 'enviado para o chat de origem');
  const sent = c2.socket.relayed[0].message;
  assert.strictEqual(c2.replies.length, 0, 'não caiu no fallback de texto');
  assert.ok(sent.messageContextInfo.botMetadata.messageDisclaimerText.includes('Lua'), 'disclaimer com a marca Lua');
  const rich = sent.botForwardedMessage.message.richResponseMessage;
  assert.strictEqual(rich.messageType, 1);
  assert.ok(Array.isArray(rich.submessages) && rich.submessages.length >= 3, 'submessages presentes');
  assert.ok(rich.submessages[0].messageText.includes('Lua Bot'), 'primeira submensagem é o nome do bot');
  assert.strictEqual(rich.submessages[2].messageType, 2);
  assert.strictEqual(rich.contextInfo.stanzaId, MSG_ID, 'stanzaId vem da mensagem real (via selo)');
  assert.strictEqual(rich.contextInfo.participant, USER, 'participant preenchido pelo selo');
  assert.ok(rich.contextInfo.quotedMessage.extendedTextMessage, 'quotedMessage preenchido pelo selo');
  ok('payload: botForwardedMessage → richResponseMessage com submessages, contextInfo do selo e disclaimer');

  // ---- 3) base64 → seções com todos os primitivos
  const json = sectionsOf(sent);
  assert.ok(json.response_id.startsWith('lua_'), 'response_id com prefixo lua_');
  assert.ok(Array.isArray(json.sections) && json.sections.length >= 8, `seções: ${json.sections.length}`);
  const flat = JSON.stringify(json.sections);
  for (const t of [
    'GenAIMetadataTextPrimitive',
    'GenAISingleLayoutViewModel',
    'GenAIImaginePrimitive',
    'GenAIProductItemCardPrimitive',
    'GenAIHScrollLayoutViewModel',
    'GenAIPostPrimitive',
    'GenAIMarkdownTextUXPrimitive',
    'GenAIInlineLinkItem',
  ]) {
    assert.ok(flat.includes(t), `seção usa ${t}`);
  }
  ok('unifiedResponse em base64 decodifica e contém os 8 primitivos GenAI');

  // ---- 4) identidade Lua (nada de nomes antigos)
  const all = JSON.stringify(sent);
  for (const bad of FORBIDDEN) {
    assert.ok(!all.includes(bad), `nenhuma referência a "${bad}"`);
  }
  assert.ok(all.includes('Lua'), 'identidade Lua presente');
  ok('identidade 100% Lua Bot (nenhum nome do código de referência)');

  // ---- 5) ROUND-TRIP pelo proto real
  const buf = proto.Message.encode(proto.Message.fromObject(sent)).finish();
  const back = proto.Message.decode(buf);
  const backRich = back.botForwardedMessage.message.richResponseMessage;
  assert.ok(Buffer.isBuffer(backRich.unifiedResponse.data), 'unifiedResponse.data sobrevive como bytes');
  assert.deepStrictEqual(
    JSON.parse(backRich.unifiedResponse.data.toString('utf8')).response_id,
    json.response_id,
    'conteúdo idêntico depois do decode'
  );
  assert.strictEqual(backRich.contextInfo.stanzaId, MSG_ID, 'stanzaId sobrevive');
  assert.strictEqual(backRich.contextInfo.participant, USER, 'participant sobrevive');
  assert.ok(backRich.contextInfo.quotedMessage.extendedTextMessage.text, 'quotedMessage sobrevive');
  assert.strictEqual(back.messageContextInfo.botMetadata.messageDisclaimerText, sent.messageContextInfo.botMetadata.messageDisclaimerText);
  const mt = backRich.submessages[0].messageType;
  assert.ok(mt === 2 || mt === 'AI_RICH_RESPONSE_TEXT', `messageType preservado (${mt})`);
  assert.strictEqual(
    JSON.parse(JSON.stringify(backRich.submessages[0])).messageType,
    'AI_RICH_RESPONSE_TEXT',
    'enum serializa como AI_RICH_RESPONSE_TEXT'
  );
  ok(`proto real: encode (${buf.length} bytes) + decode preservam tudo — o payload é transmitível`);

  // ---- 6) argumentos como contexto/pesquisa
  const c6 = fakeCtx({ args: ['quem', 'criou', 'a', 'Lua?'] });
  await cmd.execute(c6);
  const j6 = sectionsOf(c6.socket.relayed[0].message);
  assert.ok(c6.socket.relayed[0].message.botForwardedMessage.message.richResponseMessage.submessages.some((s) => s.messageText.includes('quem criou a Lua?')));
  assert.ok(JSON.stringify(j6.sections).includes('quem criou a Lua?'), 'pergunta aparece nas seções');
  const c6b = fakeCtx({ args: [] });
  await cmd.execute(c6b);
  assert.ok(
    c6b.socket.relayed[0].message.botForwardedMessage.message.richResponseMessage.submessages.some((s) =>
      s.messageText.includes('informações do criador')
    ),
    'sem argumentos usa o contexto padrão'
  );
  const c6c = fakeCtx({ args: undefined });
  await cmd.execute(c6c);
  assert.strictEqual(c6c.socket.relayed.length, 1, 'args undefined não quebra');
  ok('args: pergunta vira contexto; args vazio/undefined usa o padrão sem quebrar');

  // ---- 7) dados reais do bot
  const facts = JSON.stringify(j6.sections);
  assert.ok(facts.includes(CONFIG.bot.version), 'versão real do bot');
  assert.ok(facts.includes(String(registry.count())), 'contagem real de comandos');
  assert.ok(facts.includes(process.version), 'versão real do Node');
  assert.ok(!/undefined|null/.test(facts.replace(/nulla/g, '')), 'sem undefined/null vazando no texto');
  ok('informações da Lua são reais (versão, nº de comandos, uptime, Node)');

  // ---- 8) fallback quando o relay é recusado
  const c8 = fakeCtx({ socket: fakeSocket({ relayThrows: true }) });
  await cmd.execute(c8);
  assert.strictEqual(c8.socket.relayed.length, 0, 'relay falhou');
  const t8 = c8.replies.join('\n');
  assert.match(t8, /informações do criador/, 'fallback entrega a informação em texto');
  assert.match(t8, /Instagram:/, 'redes sociais no fallback');
  assert.match(t8, /Suporte:/, 'link de suporte no fallback');
  ok('relay recusado → mensagem de texto com as mesmas informações (comando continua funcional)');

  // ---- 9) socket sem relayMessage
  const c9 = fakeCtx({ socket: fakeSocket({ noRelay: true }) });
  await cmd.execute(c9);
  assert.ok(c9.replies.join('\n').includes('informações do criador'), 'não quebra sem relayMessage');
  ok('socket sem relayMessage → cai no texto em vez de estourar');

  // ---- 10) erro inesperado no meio do caminho
  const broken = fakeCtx();
  Object.defineProperty(broken, 'remoteJid', {
    get() {
      throw new Error('jid indisponível');
    },
  });
  await cmd.execute(broken);
  assert.match(broken.replies.join('\n'), /Não consegui montar o cartão do criador/, 'catch externo responde');
  assert.ok(!/at\s+\w+\.js:\d+/.test(broken.replies.join('\n')), 'sem stack trace');
  ok('erro inesperado → resposta amigável sem stack (nenhum ReferenceError escapa)');

  // ---- 11) seloNubank
  const selo = await consts.seloNubank(fakeSocket(), { key: { id: MSG_ID, participant: USER } }, USER, 'Tester', CHAT);
  assert.strictEqual(selo.key.id, MSG_ID, 'usa o id real da mensagem');
  assert.strictEqual(selo.key.participant, USER);
  assert.ok(selo.message.extendedTextMessage.text.includes('Lua'), 'selo com a marca Lua');
  const seloSemMsg = await consts.seloNubank(fakeSocket(), null, USER, '', CHAT);
  assert.ok(seloSemMsg.key.id && seloSemMsg.key.id.length > 0, 'sem msg ainda gera id válido');
  const seloPrivado = await consts.seloNubank(fakeSocket(), { key: { id: 'X1' } }, USER, '', USER);
  assert.strictEqual(seloPrivado.key.participant, undefined, 'no privado não força participant');
  ok('seloNubank: id/participant reais, funciona sem msg e no privado (nada de undefined no payload)');

  database.close();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
  }
  console.log(`\n✅ criador (richResponse/relayMessage): ${n} verificações, 0 falhas`);
  process.exit(0);
})().catch((err) => {
  console.error(`\n❌ criador: ${err.stack || err.message}`);
  process.exit(1);
});
