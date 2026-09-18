/**
 * test/pipeline.test.js — regressão da cadeia de mensagens (Fase 3).
 *
 * A cadeia saiu de dentro de handlers/commandHandler.js e virou etapas nomeadas
 * em engine/pipeline.js. Estes testes dirigem o handleMessage REAL (que agora só
 * delega para a pipeline), então qualquer diferença de ordem, gate, cooldown,
 * confirmação, rate limit, plugin ou hot reload aparece aqui.
 *
 * Cada cenário usa um usuário distinto para não contaminar cooldown/flood/AFK.
 */

'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));
process.env.DATABASE_FILE = path.resolve(__dirname, '../database/lua-test-pipeline.db');
const fs = require('fs');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
}

const database = require('../database/database');
database.open();
const { loadCommands } = require('../commands/loader');
const { registry } = require('../engine/plugins');
const { createPipeline } = require('../engine/pipeline');
const handler = require('../handlers/commandHandler');
const pendingCall = require('../utils/pendingCall');
const cooldown = require('../utils/cooldown');
const session = require('../utils/session');

/**
 * O cooldown tem chave GLOBAL por comando (utils/cooldown.js: `global:*:<name>`),
 * então um uso anterior do mesmo comando no processo barra os seguintes. Os
 * cenários que dependem do texto da resposta limpam essa chave antes.
 */
function liberar(nome) {
  cooldown.reset('global', '*', nome);
}

/** Grupo único por cenário: getGroupMetadata tem cache de 30 s (meta:<jid>). */
function grupo(tag) {
  seq += 1;
  return `1203630${String(seq).padStart(9, '0')}${tag || 0}@g.us`;
}

loadCommands(true);

const BOT = '5511888887777@s.whatsapp.net';
const OWNER = '5511999999999@s.whatsapp.net'; // OWNER_NUMBER do .env
const TARGET = '5511999999999@s.whatsapp.net';
const GROUP = '120363000000000000@g.us';
let seq = 0;

/* ------------------------------ fixtures ------------------------------ */

function fakeSock(adminJid) {
  const sent = [];
  const sock = {
    sent,
    user: { id: BOT },
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      return { key: { id: 'K' + sent.length, remoteJid: jid, fromMe: true } };
    },
    profilePictureUrl: async () => '',
    groupMetadata: async (jid) => ({
      id: jid,
      subject: 'Grupo de Teste',
      participants: [
        { id: BOT, admin: 'admin' },
        ...(adminJid ? [{ id: adminJid, admin: 'admin' }] : []),
      ],
    }),
    groupInviteCode: async () => 'CODIGO123',
    groupSettingUpdate: async () => ({}),
    sendPresenceUpdate: async () => ({}),
    presenceSubscribe: async () => ({}),
    fetchBlocklist: async () => [],
    updateBlockStatus: async () => ({}),
  };
  return sock;
}

function msg(from, text, chat) {
  seq += 1;
  return {
    // em grupo o remetente é key.participant (utils/messages.resolveSender)
    key: { remoteJid: chat || from, participant: chat ? from : undefined, fromMe: false, id: 'ID' + seq },
    pushName: 'Teste',
    message: { conversation: text },
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
}

/** JID único por cenário (evita colisão de cooldown/flood entre testes). */
function user(tag) {
  seq += 1;
  return `55119${String(seq).padStart(7, '0')}${tag || 0}@s.whatsapp.net`;
}

/** Texto da última mensagem enviada pelo bot. */
function lastText(sock) {
  const last = sock.sent[sock.sent.length - 1];
  if (!last) return '';
  const c = last.content || {};
  if (c.call) return '[CALL]';
  return String(c.text || c.caption || JSON.stringify(c.buttons || c.templateButtons || c));
}

/** Roda uma mensagem pela cadeia real e devolve o state. */
function run(sock, from, text, chat) {
  return handler.handleMessage(sock, msg(from, text, chat));
}

/* ------------------------------ harness ------------------------------- */

const results = [];
function check(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { results.push([label, true, '']); console.log('  ✔ ' + label); })
    .catch((err) => {
      results.push([label, false, err.message]);
      console.log('  ✘ ' + label + ' → ' + err.message);
    });
}

(async () => {
  console.log('══════════ PIPELINE TEST (Fase 3) ══════════');

  /* ---------------------------------------------------- 1. ordem da cadeia */
  await check('ordem da cadeia preservada (10 etapas, na ordem efetiva)', () => {
    assert.deepStrictEqual(handler.pipeline.steps, [
      'accept', 'normalize', 'gateUser', 'register', 'interactive',
      'moderation', 'dispatch', 'shortcuts', 'confirmation', 'sessionFlow',
    ]);
    assert.deepStrictEqual(handler.pipeline.steps, createPipeline({}).steps,
      'a ordem exposta deveria vir da própria pipeline');
  });

  /* --------------------------------------- 2. mensagem comum (não-comando) */
  await check('mensagem comum ("oi") não vira comando nem resposta', async () => {
    const sock = fakeSock();
    const state = await run(sock, user(), 'oi');
    assert.strictEqual(state.result, 'noop', 'resultado: ' + state.result);
    assert.strictEqual(sock.sent.length, 0, 'não deveria ter respondido');
  });

  /* ---------------------------------------------------- 3. comando válido */
  await check('comando válido (!ping) executa e responde', async () => {
    const sock = fakeSock();
    const state = await run(sock, user(), '!ping');
    assert.strictEqual(state.result, 'command:ping');
    assert.match(lastText(sock), /pong/i);
  });

  /* ------------------------------------------------ 4. comando inexistente */
  await check('comando inexistente sugere (fuzzy + botões)', async () => {
    const sock = fakeSock();
    const state = await run(sock, user(), '!comandoquenaoexiste');
    assert.strictEqual(state.result, 'unknown-command');
    assert.ok(sock.sent.length > 0, 'deveria ter respondido com sugestão');
  });

  /* -------------------------------------------------------- 5. owner-only */
  await check('ownerOnly: usuário comum recebe "apenas o dono"', async () => {
    const sock = fakeSock();
    const state = await run(sock, user(), '!uptime');
    assert.strictEqual(state.result, 'command:uptime');
    assert.match(lastText(sock), /apenas o dono do bot/i);
  });

  await check('ownerOnly: dono executa o comando', async () => {
    const sock = fakeSock();
    const state = await run(sock, OWNER, '!uptime');
    assert.strictEqual(state.result, 'command:uptime');
    assert.ok(!/apenas o dono do bot/i.test(lastText(sock)), 'não deveria ser negado: ' + lastText(sock));
    assert.ok(sock.sent.length > 0, 'deveria ter respondido');
  });

  /* -------------------------------------------------------- 6. admin-only */
  await check('adminOnly: membro comum é bloqueado no grupo', async () => {
    const sock = fakeSock();
    const state = await run(sock, user(), '!linkgrupo', grupo());
    assert.strictEqual(state.result, 'command:linkgrupo');
    assert.match(lastText(sock), /apenas administradores do grupo/i);
  });

  await check('adminOnly: admin executa no grupo', async () => {
    const admin = user(1);
    const sock = fakeSock(admin);
    const state = await run(sock, admin, '!linkgrupo', grupo(1));
    assert.strictEqual(state.result, 'command:linkgrupo');
    assert.ok(!/apenas administradores|apenas o dono/i.test(lastText(sock)),
      'não deveria ser negado: ' + lastText(sock));
  });

  /* ------------------------------------------------------ 7. group-only PV */
  await check('groupOnly em conversa privada é bloqueado', async () => {
    const sock = fakeSock();
    const state = await run(sock, user(), '!linkgrupo'); // privado: sem chat de grupo
    assert.strictEqual(state.result, 'command:linkgrupo');
    assert.match(lastText(sock), /só funciona em grupos/i);
  });

  /* ------------------------------------------------------------ 8. cooldown */
  await check('cooldown: 1ª execução passa, 2ª imediata é barrada', async () => {
    const sock = fakeSock();
    const who = user();
    liberar('ping');
    const first = await run(sock, who, '!ping');
    assert.strictEqual(first.result, 'command:ping');
    assert.match(lastText(sock), /pong/i);
    await run(sock, who, '!ping');
    assert.match(lastText(sock), /aguarde .* antes de usar este comando novamente/i,
      'esperava aviso de cooldown, veio: ' + lastText(sock));
  });

  /* --------------------------------------------------------- 9. confirmação */
  await check('confirmação: !call pede, "1" confirma e envia a call', async () => {
    const sock = fakeSock();
    const who = user();
    liberar('call');
    const ask = await run(sock, who, `!call ${TARGET}`);
    assert.strictEqual(ask.result, 'command:call');
    assert.ok(pendingCall.has(who), 'deveria haver confirmação pendente');
    assert.match(lastText(sock), /confirmação/i);
    const callsBefore = sock.sent.filter((m) => m.content && m.content.call).length;
    assert.strictEqual(callsBefore, 0, 'nenhuma call deveria sair sem confirmação');

    // com uma sessão de jogo ativa, a resposta "1" tem que ir SÓ para a
    // confirmação: a cadeia precisa parar ali (era o `return` do código antigo)
    let sessaoTocada = false;
    try {
      session.set(who, who, { type: 'jogo-teste', onMessage: () => { sessaoTocada = true; } }, 2000);
      const yes = await run(sock, who, '1');
      assert.strictEqual(yes.result, 'confirmation:call');
      assert.strictEqual(sessaoTocada, false,
        'a sessão de jogo recebeu a resposta da confirmação — a cadeia não parou');
    } finally {
      session.clear(who, who); // sem isso o timer da sessão segura o processo vivo
    }
    assert.ok(!pendingCall.has(who), 'a confirmação deveria ter sido consumida');
    const callsAfter = sock.sent.filter((m) => m.content && m.content.call).length;
    assert.strictEqual(callsAfter, 1, 'deveria ter enviado exatamente 1 call');
  });

  await check('confirmação: "2" cancela sem enviar nada', async () => {
    const sock = fakeSock();
    const who = user();
    liberar('call');
    await run(sock, who, `!call ${TARGET}`);
    assert.ok(pendingCall.has(who), 'deveria haver confirmação pendente');
    let sessaoTocada = false;
    try {
      session.set(who, who, { type: 'jogo-teste', onMessage: () => { sessaoTocada = true; } }, 2000);
      const no = await run(sock, who, '2');
      assert.strictEqual(no.result, 'confirmation:call');
      assert.strictEqual(sessaoTocada, false, 'a sessão não deveria receber o cancelamento');
    } finally {
      session.clear(who, who);
    }
    assert.ok(!pendingCall.has(who), 'a confirmação deveria ter sido descartada');
    assert.strictEqual(sock.sent.filter((m) => m.content && m.content.call).length, 0,
      'nenhuma call deveria ter saído');
    assert.match(lastText(sock), /cancelad/i);
  });

  /* ------------------------------------------------------- 10. rate limit */
  await check('rate limit (flood): rajada é bloqueada após o limite', async () => {
    const sock = fakeSock();
    const who = user();
    const vistos = [];
    for (let i = 0; i < 18; i++) vistos.push((await run(sock, who, 'oi')).result);
    assert.strictEqual(vistos[0], 'noop', 'a 1ª mensagem não pode ser bloqueada');
    assert.ok(vistos.includes('flood'), 'esperava bloqueio por flood, veio: ' + vistos.join(','));
  });

  /* --------------------------------------------------------- 11. plugins */
  await check('comando vindo de plugin continua resolvendo e executando', async () => {
    const ping = registry.resolveTrigger('ping');
    assert.ok(ping, '!ping deveria existir');
    assert.strictEqual(ping.category, 'general', 'categoria/plugin do ping: ' + ping.category);
    const arcade = registry.resolveTrigger('tigrearcade');
    assert.ok(arcade, 'comando do plugin games deveria existir');
    assert.strictEqual(arcade.category, 'games');

    const sock = fakeSock();
    liberar('ping');
    const state = await run(sock, user(), '!ping');
    assert.strictEqual(state.result, 'command:ping');
    assert.match(lastText(sock), /pong/i);
  });

  /* ----------------------------------------------------- 12. hot reload */
  await check('hot reload: sem comandos/gatilhos duplicados e pipeline única', async () => {
    const contarTriggers = () => {
      const set = new Set();
      for (const c of registry.all()) for (const t of c.commands || []) set.add(t);
      return set.size;
    };
    const antes = { cmds: registry.count(), triggers: contarTriggers(), skipped: registry.skippedCommands().length };
    // 334 = 333 + !d/!delete (apagar a mensagem respondida)
    assert.strictEqual(antes.cmds, 334, 'comandos antes do reload: ' + antes.cmds);
    assert.strictEqual(antes.skipped, 0, 'registros descartados: ' + antes.skipped);

    const sockAntes = fakeSock();
    liberar('ping');
    await run(sockAntes, user(), '!ping');
    assert.match(lastText(sockAntes), /pong/i, 'ping deveria responder antes do reload');

    loadCommands(true); // hot reload

    const depois = { cmds: registry.count(), triggers: contarTriggers(), skipped: registry.skippedCommands().length };
    assert.strictEqual(depois.cmds, antes.cmds, `comandos duplicados/perdidos: ${antes.cmds} → ${depois.cmds}`);
    assert.strictEqual(depois.triggers, antes.triggers, `gatilhos duplicados/perdidos: ${antes.triggers} → ${depois.triggers}`);
    assert.strictEqual(depois.skipped, 0, 'registros descartados após reload: ' + depois.skipped);

    const nomes = registry.all().map((c) => c.name);
    assert.strictEqual(nomes.length, new Set(nomes).size, 'há nome de comando repetido no registry');

    // a pipeline é criada UMA vez no carregamento do módulo, nunca por mensagem
    assert.strictEqual(handler.pipeline, require('../handlers/commandHandler').pipeline,
      'a pipeline deveria ser a mesma instância (sem recriar por mensagem)');
    assert.strictEqual(handler.pipeline.steps.length, 10);
    const carregamentos = Object.keys(require.cache)
      .filter((k) => k.endsWith(path.join('engine', 'pipeline.js'))).length;
    assert.strictEqual(carregamentos, 1, 'engine/pipeline.js carregado ' + carregamentos + 'x');

    const sockDepois = fakeSock();
    liberar('ping');
    const depoisState = await run(sockDepois, user(), '!ping');
    assert.strictEqual(depoisState.result, 'command:ping', 'comando sumiu depois do reload');
    assert.match(lastText(sockDepois), /pong/i, 'ping parou de responder depois do reload');
  });

  /* ---------------------------------- 13. erro dentro de um comando real */
  await check('comando que lança não derruba a cadeia e o usuário é avisado', async () => {
    registry.registerCommand({
      name: '__pipelinethrows',
      commands: ['__pipelinethrows'],
      cooldown: 0,
      execute() { throw new Error('boom-controlado-do-teste'); },
    }, 'general');
    try {
      const sock = fakeSock();
      const state = await run(sock, user(), '!__pipelinethrows');
      assert.strictEqual(state.result, 'command:__pipelinethrows');
      assert.ok(sock.sent.length > 0, 'o handler de erros deveria ter respondido ao usuário');
      assert.ok(!/boom-controlado-do-teste/.test(lastText(sock)),
        'o stack não deveria vazar para o usuário comum');
    } finally {
      registry.unregisterCommand('__pipelinethrows');
    }
  });

  /* --------------------------------- 14. etapas isoladas com deps falsas */
  /** Deps falsas mínimas para uma mensagem privada que não é comando. */
  function fakeDeps(spy, opts = {}) {
    return {
      CONFIG: { ui: { antiFlood: false }, messages: { blocked: 'bloqueado' } },
      logger: { warn() {}, debug() {}, error() {}, info() {} },
      perf: { add() {}, timing() {} },
      settings: { effectivePrefix: () => '!' },
      users: { upsert() {}, incMessages() {}, get: () => ({ afk: false }), clearAfk() {} },
      groups: { ensure() {}, incMemberMessages() {} },
      session: { get: () => null },
      numberFallback: { getNumberMenu: () => null, match: () => { spy.push('numberFallback.match'); return null; } },
      interactive: {},
      registry: { resolveTrigger: () => null },
      buttonHandler: { process: async () => !!opts.botao },
      groupHandler: { applyFilters: async () => ({ deleted: false }) },
      errorHandler: { handle: async () => {} },
      isStatusJid: () => false,
      splitCommand: () => null,
      shouldProcessMessage: () => { spy.push('accept'); return true; },
      buildContext: async () => {
        spy.push('normalize');
        return {
          chat: 'c', sender: 's@s.whatsapp.net', senderJid: 's@s.whatsapp.net',
          remoteJid: 'c', text: 'oi', msg: msg('s@s.whatsapp.net', 'oi'),
          reply: async () => {}, sock: {},
        };
      },
      executeCommand: async () => { spy.push('dispatch'); return { ok: true }; },
      runByName: async () => { spy.push('runByName'); },
      grantXp: () => { spy.push('grantXp'); },
      notifyAfk: async () => {},
    };
  }

  await check('etapas isoladas: cadeia completa termina em "noop"', async () => {
    const spy = [];
    const p = createPipeline(fakeDeps(spy));
    const state = await p.run({}, msg('s@s.whatsapp.net', 'oi'));
    assert.strictEqual(state.result, 'noop', 'resultado: ' + state.result);
    assert.ok(spy.includes('normalize'), 'a etapa normalize deveria ter rodado');
    assert.ok(spy.includes('grantXp'), 'o registro de XP deveria ter rodado');
    assert.ok(spy.includes('numberFallback.match'), 'a última etapa deveria ter sido alcançada');
    assert.ok(!spy.includes('dispatch'), 'dispatch não deveria rodar sem comando');
    assert.strictEqual(p.steps.length, 10);
  });

  await check('etapas isoladas: state.stop interrompe as etapas seguintes', async () => {
    const spy = [];
    const p = createPipeline(fakeDeps(spy, { botao: true })); // botão intercepta
    const state = await p.run({}, msg('s@s.whatsapp.net', 'oi'));
    assert.strictEqual(state.result, 'interactive', 'resultado: ' + state.result);
    assert.ok(!spy.includes('numberFallback.match'),
      'nenhuma etapa depois de interactive deveria ter rodado');
  });

  await check('etapa que lança é capturada pelo handler central (não rejeita)', async () => {
    let registrado = null;
    const p = createPipeline({
      CONFIG: { ui: {} },
      logger: {
        warn() {}, debug() {}, info() {},
        error: (fields, texto) => { registrado = { texto, step: fields.step }; },
      },
      perf: { add() {}, timing() {} },
      settings: {}, users: {}, groups: {}, session: {}, numberFallback: {},
      interactive: {}, registry: {}, buttonHandler: {}, groupHandler: {},
      errorHandler: { handle: async () => {} },
      isStatusJid: () => false, splitCommand: () => null,
      shouldProcessMessage: () => true,
      buildContext: async () => { throw new Error('falha-na-etapa'); },
    });
    const state = await p.run({}, msg('s@s.whatsapp.net', 'oi')); // não pode rejeitar
    assert.strictEqual(state.result, 'error:normalize');
    assert.strictEqual(registrado && registrado.step, 'normalize', 'a etapa culpada deveria ser logada');
    assert.match(registrado.texto, /erro no processamento de mensagem/);
  });

  /* ----------------------------------------------------------- resumo */
  const falhas = results.filter(([, ok]) => !ok);
  console.log(`\n=== PIPELINE TEST: ${results.length - falhas.length} passou, ${falhas.length} falhou `
    + `(registry: ${registry.count()} comandos / ${registry.all().reduce((a, c) => a + (c.commands || []).length, 0)} gatilhos) ===`);
  if (falhas.length) {
    for (const [label, , err] of falhas) console.log('  FALHA: ' + label + ' — ' + err);
    process.exitCode = 1;
  } else {
    console.log('=== PIPELINE TEST: TUDO OK ===');
  }
})().catch((err) => { console.error('PIPELINE TEST quebrou:', err); process.exitCode = 1; });
