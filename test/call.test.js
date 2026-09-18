/**
 * test/call.test.js — !call (Call Message) com confirmação obrigatória.
 *
 * Regra principal testada aqui: sem confirmação explícita, NADA é enviado.
 * O último bloco exercita o caminho real (commandHandler.handleMessage), que é
 * onde a interceptação da resposta acontece.
 */

'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));
process.env.DATABASE_FILE = path.resolve(__dirname, '../database/lua-test-call.db');
const fs = require('fs');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
}

const database = require('../database/database');
database.open();
const { loadCommands } = require('../commands/loader');
const { registry } = require('../engine/plugins');
loadCommands(true);

const pendingCall = require('../utils/pendingCall');
const CONFIG = require('../config');

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`  ✔ ${label}`);
};

const BOT = '5511888887777@s.whatsapp.net';
const USER_A = '5511911110001@s.whatsapp.net';
const USER_B = '5511911110002@s.whatsapp.net';
const TARGET = '5511999999999@s.whatsapp.net';
const CHAT = '120363000000000000@g.us';

function fakeSocket(opts = {}) {
  const sent = [];
  return {
    sent,
    user: { id: BOT },
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      if (opts.failCall && content && content.call) throw new Error('463: destino indisponível');
      return { key: { id: 'K' + sent.length } };
    },
    profilePictureUrl: async () => '',
    groupMetadata: async () => ({ id: CHAT, subject: 'Grupo', participants: [] }),
  };
}

function fakeCtx(overrides = {}) {
  const socket = overrides.socket || fakeSocket();
  const replies = [];
  return Object.assign(
    {
      args: [],
      text: '',
      prefix: '!',
      remoteJid: CHAT,
      sender: USER_A,
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
      message: { key: { remoteJid: CHAT, id: 'M', participant: USER_A }, message: {} },
    },
    overrides,
    { socket, replies }
  );
}

const cmd = registry.resolveTrigger('call');
const callsSent = (ctx) => ctx.socket.sent.filter((m) => m.content && m.content.call);

function resetState() {
  for (const k of [...pendingCall.pendingCallConfirmations.keys()]) pendingCall.clear(k);
}

(async () => {
  assert.ok(cmd, 'comando !call registrado');
  assert.strictEqual(cmd.name, 'call');

  // ---- 1) sem destino: só ajuda
  resetState();
  const c1 = fakeCtx({ args: [] });
  await cmd.execute(c1);
  assert.strictEqual(callsSent(c1).length, 0, 'nada enviado');
  assert.match(c1.replies.join('\n'), /Call Message/, 'mostra o uso');
  assert.strictEqual(pendingCall.size(), 0, 'nenhuma pendência criada sem destino');
  ok('!call sem destino → mensagem de uso, nada enviado, sem estado');

  // ---- 2) tipo inválido
  resetState();
  const c2 = fakeCtx({ args: ['5511999999999', 'holograma'] });
  await cmd.execute(c2);
  assert.strictEqual(callsSent(c2).length, 0);
  assert.match(c2.replies.join('\n'), /Tipo inválido/, 'aponta o tipo inválido');
  assert.strictEqual(pendingCall.size(), 0);
  ok('tipo inválido → recusa com o uso correto, nada enviado');

  // ---- 3) destino inválido (status e lixo)
  resetState();
  const c3 = fakeCtx({ args: ['status@broadcast'] });
  await cmd.execute(c3);
  assert.match(c3.replies.join('\n'), /Destino inválido/, 'recusa broadcast');
  const c3b = fakeCtx({ args: ['abc'] });
  await cmd.execute(c3b);
  assert.match(c3b.replies.join('\n'), /Destino inválido/, 'recusa texto sem número');
  assert.strictEqual(callsSent(c3).length + callsSent(c3b).length, 0);
  ok('destino inválido (broadcast / sem número) → recusado');

  // ---- 4) REGRA PRINCIPAL: executar o comando NÃO envia nada
  resetState();
  const c4 = fakeCtx({ args: ['5511999999999'] });
  await cmd.execute(c4);
  assert.strictEqual(callsSent(c4).length, 0, 'o comando sozinho não pode enviar a chamada');
  const card = c4.replies.join('\n');
  assert.match(card, /CONFIRMAÇÃO/, 'cartão de confirmação');
  assert.match(card, /chamada de \*voz\*/, 'diz que é de voz');
  assert.match(card, /5511999999999/, 'mostra o destinatário');
  assert.match(card, /expira em 30 segundos/, 'prazo de 30s');
  const pend = pendingCall.get(USER_A);
  assert.ok(pend, 'pendência criada');
  assert.strictEqual(pend.jid, TARGET, 'jid guardado');
  assert.strictEqual(pend.callType, 1, 'callType 1 = voz');
  assert.strictEqual(pend.name, 'Hay', 'nome padrão Hay');
  assert.ok(pend.expiresAt > Date.now() + 25000, 'expiresAt ~30s no futuro');
  ok('!call <numero> → nenhuma chamada enviada + cartão com voz/30s + estado {jid,callType,name,expiresAt}');

  // ---- 5) confirmação com "1"
  const c5 = fakeCtx({ text: '1' });
  const consumed = await pendingCall.handleMessage(c5);
  assert.strictEqual(consumed, true, 'mensagem consumida');
  assert.strictEqual(callsSent(c5).length, 1, 'enviou 1 chamada');
  assert.strictEqual(callsSent(c5)[0].jid, TARGET, 'para o jid certo');
  assert.deepStrictEqual(callsSent(c5)[0].content, { call: { name: 'Hay', type: 1 } }, 'payload do Baileys');
  assert.strictEqual(pendingCall.get(USER_A), null, 'estado limpo após confirmar');
  assert.match(c5.replies.join('\n'), /Chamada de \*voz\* enviada/, 'confirma o envio');
  ok('responder "1" → envia {call:{name:"Hay",type:1}} e limpa o estado');

  // ---- 6) todos os sinônimos
  for (const [word, shouldSend, label] of [
    ['sim', true, 'sim'],
    ['s', true, 's'],
    ['confirmar', true, 'confirmar'],
    ['SIM', true, 'SIM (maiúsculo)'],
    ['2', false, '2'],
    ['não', false, 'não'],
    ['n', false, 'n'],
    ['cancelar', false, 'cancelar'],
    ['cancel', false, 'cancel'],
  ]) {
    resetState();
    const cc = fakeCtx({ args: ['5511999999999'] });
    await cmd.execute(cc);
    const cr = fakeCtx({ text: word });
    await pendingCall.handleMessage(cr);
    assert.strictEqual(
      callsSent(cr).length,
      shouldSend ? 1 : 0,
      `"${label}" deveria ${shouldSend ? 'enviar' : 'cancelar'}`
    );
    assert.strictEqual(pendingCall.get(USER_A), null, `estado limpo após "${label}"`);
    if (!shouldSend) assert.match(cr.replies.join('\n'), /Cancelado/, `aviso de cancelamento (${label})`);
  }
  ok('1/sim/s/confirmar enviam; 2/não/n/cancelar/cancel cancelam (estado sempre limpo)');

  // ---- 7) resposta inválida pede de novo e mantém a pendência
  resetState();
  await cmd.execute(fakeCtx({ args: ['5511999999999'] }));
  const c7 = fakeCtx({ text: 'talvez' });
  await pendingCall.handleMessage(c7);
  assert.strictEqual(callsSent(c7).length, 0, 'não envia com resposta inválida');
  assert.match(c7.replies.join('\n'), /Resposta inválida/, 'pede de novo');
  assert.ok(pendingCall.get(USER_A), 'pendência continua ativa');
  ok('resposta inválida → re-pergunta e mantém a pendência');

  // ---- 8) expiração
  resetState();
  pendingCall.set(USER_A, { jid: TARGET, callType: 1, name: 'Hay', remoteJid: CHAT, socket: fakeSocket() }, 20);
  assert.ok(pendingCall.get(USER_A), 'existe antes de expirar');
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(pendingCall.get(USER_A), null, 'expirado → removido');
  assert.strictEqual(pendingCall.pendingCallConfirmations.has(USER_A), false, 'chave removida da tabela');
  const c8 = fakeCtx({ text: '1' });
  assert.strictEqual(await pendingCall.handleMessage(c8), false, 'resposta tardia não é consumida');
  assert.strictEqual(callsSent(c8).length, 0, 'confirmação fora do prazo não envia nada');
  ok('expiração: estado removido e confirmação tardia não envia nada');

  // ---- 9) isolamento por senderJid
  resetState();
  await cmd.execute(fakeCtx({ sender: USER_A, args: ['5511999999999'] }));
  const c9b = fakeCtx({ sender: USER_B, text: '1' });
  assert.strictEqual(await pendingCall.handleMessage(c9b), false, 'outro usuário não tem pendência');
  assert.strictEqual(callsSent(c9b).length, 0, 'confirmação de B não envia a chamada de A');
  assert.ok(pendingCall.get(USER_A), 'pendência de A intacta');
  const c9a = fakeCtx({ sender: USER_A, text: '1' });
  await pendingCall.handleMessage(c9a);
  assert.strictEqual(callsSent(c9a).length, 1, 'A confirma a própria chamada');
  ok('isolamento: o "1" de outro usuário não autoriza a chamada (chave = senderJid)');

  // ---- 10) !call de novo com pendência ativa
  resetState();
  await cmd.execute(fakeCtx({ args: ['5511999999999'] }));
  const c10 = fakeCtx({ args: ['5511222223333', 'video'] });
  await cmd.execute(c10);
  assert.match(c10.replies.join('\n'), /já tem uma chamada aguardando confirmação/, 'avisa');
  assert.strictEqual(pendingCall.get(USER_A).jid, TARGET, 'não sobrescreveu a pendência anterior');
  assert.strictEqual(pendingCall.get(USER_A).callType, 1, 'tipo anterior mantido');
  ok('!call com pendência ativa → avisa e não sobrescreve');

  // ---- 11) vídeo
  resetState();
  const c11 = fakeCtx({ args: ['5511999999999', 'video'] });
  await cmd.execute(c11);
  assert.match(c11.replies.join('\n'), /chamada de \*vídeo\*/, 'cartão diz vídeo');
  assert.strictEqual(pendingCall.get(USER_A).callType, 2, 'callType 2');
  await pendingCall.handleMessage(fakeCtx({ text: '1', socket: c11.socket, replies: c11.replies }));
  assert.deepStrictEqual(callsSent(c11)[0].content, { call: { name: 'Hay', type: 2 } }, 'type 2 no payload');
  ok('!call <numero> video → type 2 (vídeo)');

  // ---- 12) nome configurável + ordem invertida
  resetState();
  const c12 = fakeCtx({ args: ['5511999999999', 'video', 'Reunião', 'de', 'time'] });
  await cmd.execute(c12);
  assert.strictEqual(pendingCall.get(USER_A).name, 'Reunião de time', 'nome montado dos argumentos');
  resetState();
  const c12b = fakeCtx({ args: ['video', '5511999999999'] });
  await cmd.execute(c12b);
  assert.strictEqual(pendingCall.get(USER_A).callType, 2, 'ordem invertida aceita');
  assert.strictEqual(pendingCall.get(USER_A).jid, TARGET, 'destino certo na ordem invertida');
  ok('nome configurável (padrão Hay) e ordem invertida "!call video <numero>"');

  // ---- 13) menção como destino
  resetState();
  const c13 = fakeCtx({ args: ['video'], mentionedJid: [TARGET] });
  await cmd.execute(c13);
  assert.strictEqual(pendingCall.get(USER_A).jid, TARGET, 'destino veio da menção');
  assert.strictEqual(pendingCall.get(USER_A).callType, 2, 'tipo lido dos argumentos');
  ok('!call @menção video → destino da menção');

  // ---- 14) falha no envio não quebra o bot
  resetState();
  const failSocket = fakeSocket({ failCall: true });
  await cmd.execute(fakeCtx({ args: ['5511999999999'], socket: failSocket }));
  const c14 = fakeCtx({ text: '1', socket: failSocket });
  await pendingCall.handleMessage(c14);
  assert.strictEqual(pendingCall.get(USER_A), null, 'estado limpo mesmo com falha');
  assert.match(c14.replies.join('\n'), /Não consegui enviar a chamada/, 'erro amigável');
  assert.ok(!/at\s+\w+\.js:\d+/.test(c14.replies.join('\n')), 'sem stack trace');
  ok('falha no envio → erro tratado, estado limpo, sem stack');

  // ---- 15) caminho real: commandHandler.handleMessage
  resetState();
  const handler = require('../handlers/commandHandler');
  const realSocket = fakeSocket();
  const PRIVATE = USER_A;
  const msg = (id, text) => ({
    key: { remoteJid: PRIVATE, fromMe: false, id },
    message: { extendedTextMessage: { text } },
    messageTimestamp: Math.floor(Date.now() / 1000),
  });
  await handler.handleMessage(realSocket, msg('A1', `${CONFIG.bot.prefix || '!'}call 5511999999999`));
  assert.strictEqual(
    realSocket.sent.filter((m) => m.content && m.content.call).length,
    0,
    'pelo pipeline real, o comando não envia a chamada'
  );
  assert.ok(pendingCall.get(USER_A), 'pendência criada pelo pipeline real');
  await handler.handleMessage(realSocket, msg('A2', '1'));
  const realCalls = realSocket.sent.filter((m) => m.content && m.content.call);
  assert.strictEqual(realCalls.length, 1, 'o "1" pelo pipeline real dispara a chamada');
  assert.deepStrictEqual(realCalls[0].content, { call: { name: 'Hay', type: 1 } });
  assert.strictEqual(pendingCall.size(), 0, 'estado limpo no fim');
  ok('caminho real (handleMessage): !call não envia, "1" envia — interceptação integrada');

  // ---- 16) o payload é convertido pela lib REAL (proto do Baileys vendored)
  const { generateWAMessage } = require('@lucasmod/boruto-vk7-baileys/lib/Utils/messages');
  const opts = { userJid: BOT, upload: async () => ({}) };
  const voz = await generateWAMessage(TARGET, { call: { name: 'Hay', type: 1 } }, opts);
  const vid = await generateWAMessage(TARGET, { call: { name: 'Reunião', type: 2 } }, opts);
  assert.ok(voz.message.scheduledCallCreationMessage, 'voz vira scheduledCallCreationMessage');
  // no objeto o enum é numérico; na serialização (toJSON) vira o nome do enum
  assert.strictEqual(voz.message.scheduledCallCreationMessage.callType, 1, 'type 1 no objeto');
  assert.strictEqual(JSON.parse(JSON.stringify(voz.message)).scheduledCallCreationMessage.callType, 'VOICE', 'serializa como VOICE');
  assert.strictEqual(voz.message.scheduledCallCreationMessage.title, 'Hay', 'title = name');
  assert.strictEqual(vid.message.scheduledCallCreationMessage.callType, 2, 'type 2 no objeto');
  assert.strictEqual(JSON.parse(JSON.stringify(vid.message)).scheduledCallCreationMessage.callType, 'VIDEO', 'serializa como VIDEO');
  assert.strictEqual(vid.message.scheduledCallCreationMessage.title, 'Reunião', 'nome personalizado no proto');
  ok('lib vendored converte {call:{name,type}} em scheduledCallCreationMessage (VOICE/VIDEO)');

  resetState();
  database.close();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
  }
  console.log(`\n✅ call (Call Message + confirmação): ${n} verificações, 0 falhas`);
  process.exit(0);
})().catch((err) => {
  console.error(`\n❌ call: ${err.stack || err.message}`);
  process.exit(1);
});
