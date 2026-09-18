/**
 * test/requests.test.js — pedidos de entrada no grupo (!pedidos, !aprovarall,
 * !rejeitarall).
 *
 * REGRESSÃO: o Baileys devolve um ARRAY de attrs em groupRequestParticipantsList
 * (vendor/boruto-vk7-baileys/lib/Socket/groups.js: `participants.map(v => v.attrs)`),
 * e o comando lia `res.participants` → sempre undefined → "Nenhum pedido
 * pendente" com a fila cheia. Estes testes usam exatamente o formato real do
 * Baileys para o bug não voltar.
 */

'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));
process.env.DATABASE_FILE = path.resolve(__dirname, '../database/lua-test-requests.db');
const fs = require('fs');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
}

const database = require('../database/database');
database.open();
const { loadCommands } = require('../commands/loader');
const { registry } = require('../engine/plugins');
loadCommands(true);

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`  ✔ ${label}`);
};

const GROUP = '120363000000000000@g.us';
const P1 = '5511911110001@s.whatsapp.net';
const P2 = '5511911110002@s.whatsapp.net';
const P3 = '5511911110003@s.whatsapp.net';

/** socket fake no formato REAL do Baileys (array de attrs). */
function fakeSocket(opts = {}) {
  const calls = [];
  const sock = {
    user: { id: '5511888887777@s.whatsapp.net' },
    calls,
    groupRequestParticipantsList: async (jid) => {
      calls.push(`list:${jid}`);
      if (opts.listThrows) throw new Error('500: server error');
      // exatamente o que o vendor devolve: array de attrs
      return opts.pending.map((jid) => ({ jid, request_time: '1757900000' }));
    },
    groupRequestParticipantsUpdate: async (jid, participants, action) => {
      calls.push(`update:${action}:${participants.length}`);
      return participants.map((jid, i) => ({
        jid,
        status: opts.failSome && i >= opts.failSome ? '403' : '200',
      }));
    },
    sendMessage: async () => ({ key: { id: 'K' } }),
  };
  if (opts.noApi) delete sock.groupRequestParticipantsList;
  return sock;
}

function fakeCtx(socket, overrides = {}) {
  const replies = [];
  const lists = [];
  return Object.assign(
    {
      args: [],
      prefix: '!',
      remoteJid: GROUP,
      sender: '5511999999999@s.whatsapp.net',
      isGroup: true,
      isOwner: true,
      isAdmin: true,
      isBotAdmin: true,
      mentions: [],
      replies,
      lists,
      reply: async (t) => {
        replies.push(String(t));
        return true;
      },
      sendList: async (opts) => {
        lists.push(opts);
        return true;
      },
      socket,
      message: { key: { remoteJid: GROUP, id: 'M' }, message: {} },
    },
    overrides
  );
}

(async () => {
  const pedidos = registry.resolveTrigger('pedidos');
  const aprovarall = registry.resolveTrigger('aprovarall');
  const rejeitarall = registry.resolveTrigger('rejeitarall');
  assert.ok(pedidos && aprovarall && rejeitarall, 'comandos registrados');

  // ---- 1) REGRESSÃO: array do Baileys precisa ser lido
  const c1 = fakeCtx(fakeSocket({ pending: [P1, P2, P3] }));
  await pedidos.execute(c1);
  assert.match(c1.replies[0], /Pedidos pendentes \(3\)/, `achou os 3 pedidos (veio: ${c1.replies[0]})`);
  assert.ok(!/Nenhum pedido pendente/.test(c1.replies.join('\n')), 'não pode dizer que não há pedidos');
  assert.strictEqual(c1.lists.length, 3, 'uma lista de ação por pedido');
  ok('!pedidos: lê o ARRAY do Baileys e lista os 3 pedidos (regressão do "nenhum pedido")');

  // ---- 2) aprovarall aprova todos e diz o número real
  const c2 = fakeCtx(fakeSocket({ pending: [P1, P2, P3] }));
  await aprovarall.execute(c2);
  assert.match(c2.replies.join('\n'), /3 de 3 pedidos aprovados/, 'conta os aprovados de verdade');
  assert.ok(
    c2.socket.calls.includes(`update:approve:3`),
    `chamou o update com os 3 (${c2.socket.calls.join(' | ')})`
  );
  ok('!aprovarall: aprova os 3 e reporta "3 de 3" com base no retorno da API');

  // ---- 3) falha parcial é reportada (antes dizia "aprovados" sempre)
  const c3 = fakeCtx(fakeSocket({ pending: [P1, P2, P3], failSome: 1 }));
  await aprovarall.execute(c3);
  const t3 = c3.replies.join('\n');
  assert.match(t3, /1 de 3 pedidos aprovados/, 'conta só os que passaram');
  assert.match(t3, /2 falharam/, 'avisa as falhas');
  assert.match(t3, /403/, 'mostra o código devolvido');
  ok('!aprovarall: falha parcial aparece (1 de 3 + 2 falharam com código 403)');

  // ---- 4) rejeitarall
  const c4 = fakeCtx(fakeSocket({ pending: [P1, P2] }));
  await rejeitarall.execute(c4);
  assert.match(c4.replies.join('\n'), /2 de 2 pedidos rejeitados/, 'rejeita todos');
  assert.ok(c4.socket.calls.includes('update:reject:2'), 'ação reject enviada');
  ok('!rejeitarall: rejeita todos com a ação correta');

  // ---- 5) fila realmente vazia continua dizendo que está vazia
  const c5 = fakeCtx(fakeSocket({ pending: [] }));
  await aprovarall.execute(c5);
  assert.match(c5.replies.join('\n'), /Nenhum pedido pendente/, 'fila vazia = aviso de vazio');
  ok('!aprovarall: fila vazia continua respondendo "nenhum pedido pendente"');

  // ---- 6) API ausente
  const c6 = fakeCtx(fakeSocket({ pending: [], noApi: true }));
  await pedidos.execute(c6);
  assert.match(c6.replies.join('\n'), /não está disponível|indisponível/i, 'avisa quando não há API');
  ok('!pedidos: sem a API no socket, avisa em vez de quebrar');

  // ---- 7) erro na consulta → mensagem clara, sem stack
  const c7 = fakeCtx(fakeSocket({ pending: [], listThrows: true }));
  let thrown = null;
  try {
    await aprovarall.execute(c7);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, 'erro propagado para o errorHandler');
  assert.match(thrown.message, /exige aprovação|admin/i, 'mensagem acionável');
  assert.ok(!/at\s+\w+\.js:\d+/.test(thrown.message), 'sem stack trace na mensagem');
  ok('consulta com falha: mensagem acionável (aprovação/admin), sem stack');

  database.close();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
  }
  console.log(`\n✅ pedidos de entrada (aprovar/rejeitar): ${n} verificações, 0 falhas`);
  process.exit(0);
})().catch((err) => {
  console.error(`\n❌ requests: ${err.stack || err.message}`);
  process.exit(1);
});
