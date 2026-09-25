#!/usr/bin/env node
/**
 * test/apagar.test.js — APAGAR MENSAGEM + IDENTIDADE DO DONO.
 *
 * Pedido do dono (25/09/2026):
 *   "arrume todos os comandos de dono, pq tem alguns que não funcionam mesmo eu
 *    sendo o dono; arrume o apagar: se quem mandar apagar for adm, apaga
 *    qualquer mensagem; se não for, apaga somente a dele (enviada
 *    anteriormente); crie o comando {prefix}d para apagar somente a mensagem
 *    marcada."
 *
 * O que este teste trava:
 *   1. DONO  → apaga a mensagem de outra pessoa (com o bot admin);
 *   2. ADMIN → apaga a mensagem de outra pessoa;
 *   3. MEMBRO → NÃO apaga a dos outros (mensagem explicando);
 *   4. MEMBRO → apaga a PRÓPRIA mensagem marcada;
 *   5. mensagem DO BOT: a chave sai com `fromMe: true` (antes ia `false` e a
 *      revogação falhava no servidor);
 *   6. sem citação: membro apaga a última mensagem dele (histórico do anti);
 *   7. bot não-admin: explica o que falta, em vez de erro genérico;
 *   8. `!d` (e o alias `!del`) existe e só mexe na mensagem marcada;
 *   9. IDENTIDADE: remetente que chega como LID + telefone é reconhecido como
 *      DONO (era o que fazia "comando de dono não funcionar");
 *  10. `!identidade` mostra o que o bot viu (e explica quando não é o dono);
 *  11. sessão de confirmação casa mesmo quando a resposta vem com outra forma do
 *      mesmo número (com/sem código de dispositivo) — antes o "sim" se perdia.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const RAIZ = path.resolve(__dirname, '..');
const DB = require('./dbtmp').tmpFile('lua-apagar-test.db');

let falhas = 0;
let feitos = 0;
function ok(l) {
  feitos++;
  console.log('✅ ' + l);
}
function fail(l, e) {
  falhas++;
  console.log('❌ ' + l + ' — ' + ((e && e.message) || e));
}

process.env.OWNER_NUMBER = '5511999999999';
process.env.DATABASE_FILE = DB;
process.env.SEND_STATE_DIR = './tmp/apagar-state';
process.env.SEND_MIN_INTERVAL_MS = '5';
process.env.SEND_CHAT_INTERVAL_MS = '5';
process.env.SEND_JITTER_MS = '0';
process.env.SEND_WARMUP_HOURS = '0';
process.env.SEND_CONNECT_GRACE_MS = '0';
process.env.GROUP_META_WARM='0';

const OWNER = '5511999999999@s.whatsapp.net';
const MEMBRO = '5511911111111@s.whatsapp.net';
const ADM = '5511933333333@s.whatsapp.net';
const OUTRO = '5511922222222@s.whatsapp.net';
const BOT = '5511888888888@s.whatsapp.net';
const GRUPO = '120363046296961148@g.us';

const database = require('../database/database');
database.open();
require('../commands/loader').loadCommands(true);
const { registry } = require('../engine/plugins');
const commandHandler = require('../handlers/commandHandler');
const antiManager = require('../utils/antiManager');
const session = require('../utils/session');
const cool = require('../utils/cooldown');

// o teste exercita o MESMO comando várias vezes seguidas: sem zerar o cooldown
// o 2º caso receberia "⏳ aguarde" em vez de executar (foi o que quebrou a 1ª
// rodada deste teste)
for (const nome of ['d', 'apagar', 'identidade']) {
  const c = registry.getCommand(nome);
  if (c) c.cooldown = 0;
}
function limparCooldowns() {
  cool.cooldowns.clear();
}

/** Socket falso: registra envios e permite configurar quem é admin do grupo. */
function novoSocket(opcoes = {}) {
  const envios = [];
  const socket = {
    user: { id: BOT },
    envios,
    sendPresenceUpdate: async () => {},
    groupMetadata: async (jid) => ({
      id: String(jid),
      participants: opcoes.participantes || [],
    }),
    sendMessage: async (jid, content, opts = {}) => {
      envios.push({ jid: String(jid), content, opts });
      return { key: { id: 'OK' + envios.length, remoteJid: String(jid) } };
    },
  };
  return socket;
}

/** Mensagem citando outra (é assim que chega uma resposta no WhatsApp). */
function msgRespondendo({ de, autorCitado, idCitado = 'MSG1', texto = ',d', grupo = GRUPO, alt }) {
  const key = {
    remoteJid: grupo,
    fromMe: false,
    id: 'N' + Math.random().toString(36).slice(2, 8),
    participant: de,
  };
  if (alt) key.participantAlt = alt;
  return {
    key,
    message: {
      extendedTextMessage: {
        text: texto,
        contextInfo: {
          stanzaId: idCitado,
          participant: autorCitado,
          quotedMessage: { conversation: 'mensagem marcada' },
        },
      },
    },
    pushName: 'Teste',
  };
}

/** Respostas enviadas por ctx.reply (o que o usuário vê). */
async function rodar(socket, msg, nomeComando = null) {
  // cada caso do teste é independente: sem isso o 2º uso do MESMO comando
  // receberia "⏳ aguarde" em vez de executar o que o teste quer medir
  limparCooldowns();
  const ctx = await commandHandler.buildContext(socket, msg);
  const ditas = [];
  ctx.reply = async (t) => {
    ditas.push(String(t));
    return { key: { id: 'R' + ditas.length } };
  };
  ctx.replyWithMentions = async (t) => {
    ditas.push(String(t));
    return { key: { id: 'R' + ditas.length } };
  };
  if (nomeComando) await commandHandler.runByName(ctx, nomeComando, ctx.args || []);
  return { ctx, ditas };
}

/** Apagou? = algum envio com { delete: chave }. */
function apagados(socket) {
  return socket.envios.filter((e) => e.content && e.content.delete).map((e) => e.content.delete);
}

async function main() {
  fs.rmSync(path.join(RAIZ, 'tmp', 'apagar-state'), { recursive: true, force: true });

  const PARTICIPANTES = [
    { id: OWNER, admin: 'superadmin' },
    { id: BOT, admin: 'admin' },
    { id: ADM, admin: 'admin' },
    { id: MEMBRO, admin: null },
    { id: OUTRO, admin: null },
  ];

  /* 1) DONO apaga a mensagem de OUTRA pessoa ------------------------------- */
  try {
    const sock = novoSocket({ participantes: PARTICIPANTES });
    const msg = msgRespondendo({ de: OWNER, autorCitado: OUTRO, idCitado: 'ALHEIA' });
    const { ctx } = await rodar(sock, msg);
    assert.strictEqual(ctx.isOwner, true, 'o dono é reconhecido');
    await commandHandler.runByName(ctx, 'd', []);
    const apagou = apagados(sock);
    assert.strictEqual(apagou.length, 1, 'apagou 1 mensagem');
    assert.strictEqual(apagou[0].id, 'ALHEIA', 'e é a mensagem que foi marcada');
    assert.strictEqual(apagou[0].participant, OUTRO, 'com o autor certo');
    ok('1: DONO apaga a mensagem marcada de outra pessoa');
  } catch (e) {
    fail('1: dono apagando de outro', e);
  }

  /* 2) ADMIN do grupo apaga a mensagem de outra pessoa --------------------- */
  try {
    const sock = novoSocket({ participantes: PARTICIPANTES });
    const msg = msgRespondendo({ de: ADM, autorCitado: OUTRO, idCitado: 'ALHEIA2' });
    const { ctx } = await rodar(sock, msg);
    assert.strictEqual(ctx.isAdmin, true, 'o remetente é admin do grupo');
    await commandHandler.runByName(ctx, 'apagar', []);
    const apagou = apagados(sock);
    assert.strictEqual(apagou.length, 1, 'apagou com !apagar também');
    assert.strictEqual(apagou[0].id, 'ALHEIA2', 'a mensagem marcada');
    ok('2: ADMIN do grupo apaga mensagem de outra pessoa (via !apagar)');
  } catch (e) {
    fail('2: admin apagando de outro', e);
  }

  /* 3) MEMBRO comum NÃO apaga a mensagem de outra pessoa ------------------- */
  try {
    const sock = novoSocket({ participantes: PARTICIPANTES });
    const msg = msgRespondendo({ de: OUTRO, autorCitado: OWNER, idCitado: 'DODONO' });
    const { ctx, ditas } = await rodar(sock, msg);
    assert.strictEqual(ctx.isAdmin, false, 'não é admin');
    assert.strictEqual(ctx.isOwner, false, 'não é o dono');
    await commandHandler.runByName(ctx, 'd', []);
    assert.strictEqual(
      apagados(sock).length,
      0,
      `NÃO apagou nada (respostas: ${JSON.stringify(ditas)})`
    );
    assert.ok(/suas próprias|admin/i.test(ditas.join('\n')), 'explica o motivo (sem erro genérico)');
    ok('3: MEMBRO não apaga mensagem dos outros — recebe explicação');
  } catch (e) {
    fail('3: membro tentando apagar de outro', e);
  }

  /* 4) MEMBRO apaga a PRÓPRIA mensagem marcada ----------------------------- */
  try {
    const sock = novoSocket({ participantes: PARTICIPANTES });
    const msg = msgRespondendo({ de: OUTRO, autorCitado: OUTRO, idCitado: 'MINHA' });
    const { ctx, ditas } = await rodar(sock, msg);
    await commandHandler.runByName(ctx, 'd', []);
    const apagou = apagados(sock);
    assert.strictEqual(apagou.length, 1, `apagou a própria (respostas: ${JSON.stringify(ditas)})`);
    assert.strictEqual(apagou[0].id, 'MINHA', 'a mensagem dele');
    ok('4: MEMBRO apaga a própria mensagem marcada');
  } catch (e) {
    fail('4: membro apagando a própria', e);
  }

  /* 5) mensagem DO BOT sai com fromMe: true (regressão: ia false) ---------- */
  try {
    const sock = novoSocket({ participantes: PARTICIPANTES });
    const msg = msgRespondendo({ de: OWNER, autorCitado: BOT, idCitado: 'DOBOT' });
    const { ctx, ditas } = await rodar(sock, msg);
    await commandHandler.runByName(ctx, 'd', []);
    const apagou = apagados(sock);
    assert.strictEqual(apagou.length, 1, `apagou a mensagem do bot (respostas: ${JSON.stringify(ditas)})`);
    assert.strictEqual(apagou[0].fromMe, true, 'com fromMe=true (sem isso o servidor recusa)');
    ok('5: apagar mensagem DO BOT usa fromMe=true (era o campo que faltava)');
  } catch (e) {
    fail('5: apagar mensagem do bot', e);
  }

  /* 6) sem citação: membro apaga a última mensagem dele -------------------- */
  try {
    const sock = novoSocket({ participantes: PARTICIPANTES });
    // simula uma mensagem anterior dele (é o que os antis registram)
    antiManager.addToHistory(GRUPO, OUTRO, {
      remoteJid: GRUPO,
      fromMe: false,
      id: 'ANTERIOR',
      participant: OUTRO,
    });
    const msg = {
      key: { remoteJid: GRUPO, fromMe: false, id: 'N', participant: OUTRO },
      message: { conversation: ',d' },
      pushName: 'Teste',
    };
    const { ctx, ditas } = await rodar(sock, msg);
    await commandHandler.runByName(ctx, 'd', []);
    const apagou = apagados(sock);
    assert.strictEqual(apagou.length, 1, `apagou a última dele (respostas: ${JSON.stringify(ditas)})`);
    assert.strictEqual(apagou[0].id, 'ANTERIOR', 'a mensagem registrada no histórico');
    ok('6: sem citação, o membro apaga a última mensagem dele (histórico do anti)');
  } catch (e) {
    fail('6: apagar a última sem citação', e);
  }

  /* 7) bot NÃO é admin: explica o que falta -------------------------------- */
  try {
    const semBotAdmin = PARTICIPANTES.filter((p) => p.id !== BOT).map((p) =>
      p.id === OWNER ? { id: OWNER, admin: 'superadmin' } : p.id === MEMBRO ? { id: MEMBRO, admin: 'admin' } : p
    );
    const sock = novoSocket({ participantes: semBotAdmin });
    // grupo PRÓPRIO: o metadata dos grupos é cacheado (getGroupMetadata) e usar o
    // mesmo JID do caso anterior traria o cache com o bot admin
    const msg = msgRespondendo({
      de: MEMBRO,
      autorCitado: OUTRO,
      idCitado: 'ALHEIA3',
      grupo: '120363046296961149@g.us',
    });
    const { ctx, ditas } = await rodar(sock, msg);
    assert.strictEqual(ctx.isBotAdmin, false, 'o bot não é admin');
    await commandHandler.runByName(ctx, 'd', []).catch(() => {});
    assert.strictEqual(apagados(sock).length, 0, 'não tentou apagar de outro');
    assert.ok(/admin do grupo/i.test(ditas.join('\n')), `diz que o bot precisa ser admin (respostas: ${JSON.stringify(ditas)})`);
    ok('7: sem o bot admin, o comando explica o que falta (não dá erro seco)');
  } catch (e) {
    fail('7: bot sem admin', e);
  }

  /* 8) o comando `d` existe, o alias `del` resolve nele -------------------- */
  try {
    assert.ok(registry.getCommand('d'), '!d registrado');
    assert.strictEqual((registry.resolveTrigger('del') || {}).name, 'd', '!del é o mesmo comando');
    assert.strictEqual((registry.resolveTrigger('apagar') || {}).name, 'apagar', '!apagar continua existindo');
    const cmd = registry.getCommand('d');
    assert.ok(!cmd.adminOnly, '!d NÃO é adminOnly (membro apaga a própria)');
    ok('8: `!d` (e `!del`) registrados, sem exigir admin — a regra é por caso');
  } catch (e) {
    fail('8: registro dos comandos', e);
  }

  /* 9) identidade: LID + telefone → dono reconhecido ----------------------- */
  try {
    const sock = novoSocket({ participantes: PARTICIPANTES });
    const msg = msgRespondendo({
      de: '9988776655443@lid',
      alt: OWNER,
      autorCitado: OUTRO,
      idCitado: 'X',
      texto: ',freio',
    });
    const ctx = await commandHandler.buildContext(sock, msg);
    assert.strictEqual(ctx.sender, OWNER, 'a identidade escolhida é o telefone (PN)');
    assert.ok(ctx.identidades.includes('9988776655443@lid'), 'o LID continua entre as formas conhecidas');
    assert.strictEqual(ctx.isOwner, true, 'DONO reconhecido mesmo vindo como LID (o defeito do aparelho)');
    ok('9: remetente que chega como LID é reconhecido como dono pelo telefone');
  } catch (e) {
    fail('9: identidade LID → dono', e);
  }

  /* 10) `!identidade` mostra o que o bot viu ------------------------------- */
  try {
    const sock = novoSocket({ participantes: PARTICIPANTES });
    const doDono = await rodar(sock, msgRespondendo({ de: OWNER, autorCitado: OUTRO, idCitado: 'Y', texto: ',identidade' }));
    await registry.getCommand('identidade').execute(doDono.ctx);
    const texto = doDono.ditas.join('\n');
    assert.ok(/COMO O BOT IDENTIFICOU VOCÊ/.test(texto), 'mostra o cabeçalho');
    assert.ok(/Você é o DONO\?: ✅ sim/.test(texto), 'confirma que é o dono');
    assert.ok(/\*{4,}\d{4}/.test(texto), 'mostra os números mascarados (sem expor telefone)');

    const doOutro = await rodar(sock, msgRespondendo({ de: OUTRO, autorCitado: OWNER, idCitado: 'Z', texto: ',identidade' }));
    await registry.getCommand('identidade').execute(doOutro.ctx);
    const texto2 = doOutro.ditas.join('\n');
    assert.ok(/Você é o DONO\?: ❌ NÃO/.test(texto2), 'diz que NÃO é o dono');
    assert.ok(/OWNER_NUMBER|LID/.test(texto2), 'e explica as causas possíveis sem precisar de ajuda');
    ok('10: `!identidade` mostra o que o bot viu e explica quando não reconhece o dono');
  } catch (e) {
    fail('10: comando identidade', e);
  }

  /* 11) confirmação: a resposta casa mesmo com outra forma do número -------- */
  try {
    const { confirmAction } = require('../commands/_shared/confirm');
    const sock = novoSocket({ participantes: PARTICIPANTES });
    let executou = false;
    const ctxA = await commandHandler.buildContext(
      sock,
      Object.assign(msgRespondendo({ de: OWNER + ':12', autorCitado: OUTRO, idCitado: 'W', texto: ',reload' }), {})
    );
    ctxA.reply = async () => ({ key: { id: 'c1' } });
    await confirmAction(ctxA, 'teste de confirmação', async () => {
      executou = true;
    });

    // a resposta chega SEM o código de dispositivo (caso comum)
    const achada = session.getAny(GRUPO, [OWNER]);
    assert.ok(achada && achada.onMessage, 'a confirmação é encontrada por outra forma do mesmo número');
    await achada.onMessage({ ...ctxA, text: 'sim', remoteJid: GRUPO, sender: OWNER, identidades: [OWNER] });
    assert.strictEqual(executou, true, 'e o "sim" executou a ação do comando de dono');
    ok('11: confirmação de comando de dono casa por qualquer forma do número (o "sim" não se perde mais)');
  } catch (e) {
    fail('11: confirmação por identidade', e);
  }

  /* 12) ADMIN que toca o botão do menu sem marcar nada: nada é apagado ------ */
  try {
    const sock = novoSocket({ participantes: PARTICIPANTES });
    antiManager.addToHistory(GRUPO, ADM, {
      remoteJid: GRUPO,
      fromMe: false,
      id: 'DOADM',
      participant: ADM,
    });
    const msg = {
      key: { remoteJid: GRUPO, fromMe: false, id: 'N2', participant: ADM },
      message: { conversation: ',apagar' },
      pushName: 'Teste',
    };
    const { ctx, ditas } = await rodar(sock, msg);
    assert.strictEqual(ctx.isAdmin, true, 'é admin');
    await commandHandler.runByName(ctx, 'apagar', []);
    assert.strictEqual(
      apagados(sock).length,
      0,
      `nada apagado por engano (respostas: ${JSON.stringify(ditas)})`
    );
    assert.ok(/[Mm]arque a mensagem/.test(ditas.join('\n')), 'e ensina a marcar a mensagem');
    ok('12: admin sem marcar nada não perde mensagem — recebe a instrução de marcar');
  } catch (e) {
    fail('12: admin sem alvo', e);
  }

  fs.rmSync(path.join(RAIZ, 'tmp', 'apagar-state'), { recursive: true, force: true });

  console.log(`\n${feitos} ✅ · ${falhas} ❌`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ erro fatal:', e && e.stack ? e.stack : e);
  process.exit(1);
});
