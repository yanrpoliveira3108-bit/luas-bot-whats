#!/usr/bin/env node
/**
 * test/alvo.test.js — "marcar @ OU responder a mensagem" em todos os comandos.
 *
 * utils/alvo.js + promover/rebaixar/kick/ban (_shared/admin.mudarParticipante)
 * + medidores/brincadeiras (engine/interactionEngine) + comandos com valor
 * depois do alvo (!pagar, !givecoin). Socket FALSO com os métodos reais
 * (groupMetadata → { participants:[{id,admin}] },
 * groupParticipantsUpdate → [{ status, jid }]).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

const DB = require('./dbtmp').tmpFile('lua-alvo-test.db');
fs.rmSync(DB, { force: true });
process.env.DATABASE_FILE = DB;
process.env.OWNER_NUMBER = process.env.OWNER_NUMBER || '5511999990000';
require('../database/database').open();
require('../commands/loader').loadCommands(true);

const CONFIG = require('../config');
const alvo = require('../utils/alvo');
const commandHandler = require('../handlers/commandHandler');

let falhas = 0;
let feitos = 0;
async function caso(nome, fn) {
  try {
    await fn();
    feitos++;
    console.log('✅ ' + nome);
  } catch (e) {
    falhas++;
    console.log('❌ ' + nome + ' — ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  }
}

const GRUPO = '120363000000000077@g.us';
const BOT = '5519988887777@s.whatsapp.net';
const ADMIN = '5511911110000@s.whatsapp.net';
const MARIA = '5511922220000@s.whatsapp.net';
const JOAO = '5511933330000@s.whatsapp.net';
const CRIADOR = '5511944440000@s.whatsapp.net';
const DONO = `${String(CONFIG.owner.numbers[0]).replace(/\D/g, '')}@s.whatsapp.net`;

function sockFalso(participants, opts = {}) {
  const chamadas = [];
  return {
    user: { id: '5519988887777:7@s.whatsapp.net', lid: '424242424242:7@lid', name: 'Lua' },
    chamadas,
    groupMetadata: async () => ({ id: GRUPO, subject: 'Teste', participants: participants.map((p) => ({ ...p })) }),
    groupParticipantsUpdate: async (jid, lista, acao) => {
      chamadas.push({ jid, lista, acao });
      if (opts.lancar) throw new Error(opts.lancar);
      return lista.map((j) => ({ status: opts.status || '200', jid: j }));
    },
  };
}
const PARTS = [
  { id: BOT, admin: 'admin' },
  { id: ADMIN, admin: 'admin' },
  { id: MARIA, admin: null },
  { id: JOAO, admin: 'admin' },
  { id: CRIADOR, admin: 'superadmin' },
  { id: DONO, admin: null },
];

function ctxBase(extra = {}) {
  const respostas = [];
  const ctx = {
    socket: extra.socket || sockFalso(PARTS),
    remoteJid: GRUPO,
    isGroup: true,
    sender: ADMIN,
    identidades: [ADMIN],
    isAdmin: true,
    isBotAdmin: true,
    isOwner: false,
    prefix: '!',
    args: [],
    mentionedJid: [],
    quotedKey: null,
    respostas,
    reply: async (t, o = {}) => {
      respostas.push({ t: String(t), mentions: o.mentions || [] });
    },
    sendImage: async (b, t, o = {}) => respostas.push({ t: String(t), mentions: o.mentions || [] }),
    ...extra,
  };
  ctx.respostas = respostas;
  return ctx;
}
const respondendo = (participant) => ({ remoteJid: GRUPO, id: 'Q' + Math.random(), participant, fromMe: false });
function acharCmd(nome) {
  const c = require('../engine/plugins').registry.resolveTrigger(nome);
  assert.ok(c, 'comando não encontrado: ' + nome);
  return c;
}

(async () => {
  await caso('1: menção vence resposta; resposta vale sem menção; número só quando pedido', () => {
    assert.strictEqual(alvo.alvo(ctxBase({ mentionedJid: [MARIA], quotedKey: respondendo(JOAO) })), MARIA);
    assert.strictEqual(alvo.alvo(ctxBase({ quotedKey: respondendo(JOAO) })), JOAO);
    assert.strictEqual(alvo.alvo(ctxBase({ args: ['5511955550000'] })), null);
    assert.strictEqual(alvo.alvo(ctxBase({ args: ['5511955550000'] }), { numero: true }), '5511955550000@s.whatsapp.net');
    assert.deepStrictEqual(alvo.alvos(ctxBase({ quotedKey: respondendo(JOAO) })).origem, 'resposta');
  });

  await caso('2: resposta a mensagem DO BOT não vira alvo (id com :device e LID)', () => {
    assert.strictEqual(alvo.alvo(ctxBase({ quotedKey: respondendo(BOT) })), null);
    assert.strictEqual(alvo.alvo(ctxBase({ quotedKey: respondendo('424242424242@lid') })), null);
    assert.strictEqual(alvo.alvo(ctxBase({ quotedKey: respondendo(BOT) }), { incluirBot: true }), BOT);
  });

  await caso('3: resto() tira o alvo e deixa o valor sempre na mesma posição', () => {
    assert.deepStrictEqual(alvo.resto(ctxBase({ args: ['@5511922220000', '100'], mentionedJid: [MARIA] })), ['100']);
    assert.deepStrictEqual(alvo.resto(ctxBase({ args: ['100'], quotedKey: respondendo(MARIA) })), ['100']);
    assert.deepStrictEqual(alvo.resto(ctxBase({ args: ['5511922220000', 'spam', 'demais'] }), { numero: true }), ['spam', 'demais']);
  });

  await caso('4: !promover respondendo → promove o autor citado (id exato do grupo)', async () => {
    const ctx = ctxBase({ quotedKey: respondendo(MARIA) });
    await acharCmd('promover').execute(ctx);
    assert.deepStrictEqual(ctx.socket.chamadas, [{ jid: GRUPO, lista: [MARIA], acao: 'promote' }]);
    assert.ok(/agora é \*admin\*/.test(ctx.respostas[0].t), ctx.respostas[0].t);
    assert.deepStrictEqual(ctx.respostas[0].mentions, [MARIA]);
  });

  await caso('5: !promover em quem JÁ é admin → avisa e não chama o WhatsApp', async () => {
    const ctx = ctxBase({ mentionedJid: [JOAO] });
    await acharCmd('promover').execute(ctx);
    assert.strictEqual(ctx.socket.chamadas.length, 0);
    assert.ok(/já é admin/.test(ctx.respostas[0].t));
  });

  await caso('6: !rebaixar: não-admin, criador do grupo e sucesso', async () => {
    let ctx = ctxBase({ quotedKey: respondendo(MARIA) });
    await acharCmd('rebaixar').execute(ctx);
    assert.ok(/não é admin/.test(ctx.respostas[0].t));
    ctx = ctxBase({ mentionedJid: [CRIADOR] });
    await acharCmd('rebaixar').execute(ctx);
    assert.ok(/criador do grupo/.test(ctx.respostas[0].t));
    assert.strictEqual(ctx.socket.chamadas.length, 0);
    ctx = ctxBase({ quotedKey: respondendo(JOAO) });
    await acharCmd('rebaixar').execute(ctx);
    assert.deepStrictEqual(ctx.socket.chamadas[0].acao, 'demote');
    assert.ok(/não é mais admin/.test(ctx.respostas[0].t));
  });

  await caso('7: resultado recusado pelo WhatsApp (403) NÃO vira "sucesso"', async () => {
    const ctx = ctxBase({ socket: sockFalso(PARTS, { status: '403' }), quotedKey: respondendo(MARIA) });
    await acharCmd('promover').execute(ctx);
    assert.ok(/Não consegui/.test(ctx.respostas[0].t) && !/agora é/.test(ctx.respostas[0].t), ctx.respostas[0].t);
  });

  await caso('8: erro lançado pelo socket vira mensagem clara (sem derrubar)', async () => {
    const ctx = ctxBase({ socket: sockFalso(PARTS, { lancar: 'not-authorized' }), quotedKey: respondendo(MARIA) });
    await acharCmd('promover').execute(ctx);
    assert.ok(/preciso ser admin/.test(ctx.respostas[0].t));
  });

  await caso('9: respondendo ao BOT / sem alvo → dica com "responda a mensagem"', async () => {
    let ctx = ctxBase({ quotedKey: respondendo(BOT) });
    await acharCmd('kick').execute(ctx);
    assert.ok(/sou eu/.test(ctx.respostas[0].t));
    ctx = ctxBase();
    await acharCmd('promover').execute(ctx);
    assert.ok(/responda a mensagem/.test(ctx.respostas[0].t));
    assert.strictEqual(ctx.socket.chamadas.length, 0);
  });

  await caso('10: kick protege o dono do bot, o autor e quem não está no grupo', async () => {
    let ctx = ctxBase({ quotedKey: respondendo(DONO) });
    await acharCmd('kick').execute(ctx);
    assert.ok(/dono do bot/.test(ctx.respostas[0].t));
    ctx = ctxBase({ quotedKey: respondendo(ADMIN) });
    await acharCmd('kick').execute(ctx);
    assert.ok(/não pode se remover/.test(ctx.respostas[0].t));
    ctx = ctxBase({ mentionedJid: ['5511900000001@s.whatsapp.net'] });
    await acharCmd('kick').execute(ctx);
    assert.ok(/não está neste grupo/.test(ctx.respostas[0].t));
    assert.strictEqual(ctx.socket.chamadas.length, 0);
  });

  await caso('11: grupo em LID — usa o id da lista do grupo', async () => {
    const parts = [{ id: '777000111@lid', phoneNumber: MARIA, admin: null }, { id: BOT, admin: 'admin' }];
    const ctx = ctxBase({ socket: sockFalso(parts), quotedKey: respondendo(MARIA) });
    await acharCmd('promover').execute(ctx);
    assert.deepStrictEqual(ctx.socket.chamadas[0].lista, ['777000111@lid']);
  });

  await caso('12: !gado mede quem foi MARCADO ou RESPONDIDO (antes: sempre o autor)', async () => {
    require('../database/users').upsert(MARIA);
    const ctx = ctxBase({ sender: JOAO, identidades: [JOAO], quotedKey: respondendo(MARIA) });
    await acharCmd('gado').execute(ctx);
    const r = ctx.respostas[0];
    assert.ok(r.t.includes('@5511922220000'), r.t);
    assert.deepStrictEqual(r.mentions, [MARIA]);
    // mesma pessoa, mesmo dia → mesmo resultado, não importa quem pediu
    const ctx2 = ctxBase({ sender: ADMIN, mentionedJid: [MARIA] });
    await acharCmd('gado').execute(ctx2);
    assert.strictEqual(ctx2.respostas[0].t, r.t);
    // sem alvo → mede o próprio autor
    const ctx3 = ctxBase({ sender: JOAO, identidades: [JOAO] });
    await acharCmd('gado').execute(ctx3);
    assert.ok(!ctx3.respostas[0].t.includes('@5511922220000'));
  });

  await caso('13: brincadeira respondendo → alvo é o citado, e o @ vira menção', async () => {
    const ctx = ctxBase({ sender: JOAO, identidades: [JOAO], quotedKey: respondendo(MARIA) });
    const texto = await require('../engine/interactionEngine').runInteraction(ctx, {
      action: 'teste-sem-imagem',
      responses: ['{actor} abraçou {target}'],
    });
    assert.ok(!/si mesmo/.test(texto), texto);
    const r = ctx.respostas[0];
    for (const j of r.mentions) assert.ok(r.t.includes(alvo.marca(j)));
  });

  await caso('14: !pagar @fulano 100 — o valor não é mais lido do "@" (bug antigo)', async () => {
    const eco = require('../database/economy');
    require('../database/users').upsert(JOAO);
    require('../database/users').upsert(MARIA);
    eco.ensure(JOAO);
    eco.ensure(MARIA);
    eco.addWallet(JOAO, 1000);
    const antes = eco.get(MARIA).wallet;
    const c = acharCmd('pagar');
    const ctx = ctxBase({ sender: JOAO, identidades: [JOAO], args: ['@5511922220000', '100'], mentionedJid: [MARIA] });
    await c.execute(ctx);
    assert.ok(!/Use:/.test(ctx.respostas[0].t), ctx.respostas[0].t);
    const ctx2 = ctxBase({ sender: JOAO, identidades: [JOAO], args: ['50'], quotedKey: respondendo(MARIA) });
    await c.execute(ctx2);
    assert.ok(!/Use:/.test(ctx2.respostas[0].t), ctx2.respostas[0].t);
    assert.strictEqual(eco.get(MARIA).wallet - antes, 150);
  });

  await caso('15: !ship respondendo → você + a pessoa, com menções', async () => {
    const ctx = ctxBase({ sender: JOAO, identidades: [JOAO], quotedKey: respondendo(MARIA) });
    await acharCmd('ship').execute(ctx);
    const r = ctx.respostas[0];
    assert.ok(!/Marque duas/.test(r.t), r.t);
    for (const j of r.mentions) assert.ok(r.t.includes(alvo.marca(j)));
  });

  console.log(`\n${feitos} ✅ · ${falhas} ❌`);
  try {
    require('../database/database').close();
  } catch (_) {}
  fs.rmSync(DB, { force: true });
  process.exit(falhas ? 1 : 0);
})();
