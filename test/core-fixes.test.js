/**
 * test/core-fixes.test.js — regressões das correções críticas da auditoria.
 *
 * C1  dois arquivos com o mesmo `name` se sobrescreviam em silêncio (!tigrinho
 *     existia em commands/games e commands/rpg);
 * C2  spamState crescia sem limite em handlers/groupHandler.js;
 * C3  !eval podia travar o event loop com um laço síncrono.
 */

'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));
process.env.DATABASE_FILE = path.resolve(__dirname, '../database/lua-test-corefixes.db');
const fs = require('fs');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
}

const database = require('../database/database');
database.open();
const { loadCommands } = require('../commands/loader');
loadCommands(true);
const { registry } = require('../engine/plugins');
const session = require('../utils/session');
const groupHandler = require('../handlers/groupHandler');
const CONFIG = require('../config');

let n = 0;
const ok = (label) => {
  n += 1;
  console.log(`  ✔ ${label}`);
};

function fakeCtx(overrides = {}) {
  const replies = [];
  return Object.assign(
    {
      args: [],
      text: '',
      prefix: '!',
      remoteJid: '120363000000000000@g.us',
      sender: '5511911110001@s.whatsapp.net',
      isGroup: true,
      isOwner: true,
      isAdmin: true,
      isBotAdmin: true,
      mentionedJid: [],
      replies,
      socket: { user: { id: '5511888887777@s.whatsapp.net' }, sendMessage: async () => ({ key: { id: 'K' } }) },
      reply: async (t) => {
        replies.push(String(t));
        return true;
      },
      message: { key: { remoteJid: '120363000000000000@g.us', id: 'M' }, message: {} },
    },
    overrides,
    { replies }
  );
}

(async () => {
  /* ------------------------------------------------- C1: colisão de name */

  const before = registry.count();
  const loadSkipped = registry.skippedCommands().length; // estado logo após o load
  const skippedBefore = loadSkipped;

  registry.registerCommand(
    { name: 'cmdtestea', commands: ['cmdtestea', 'alias_a'], category: 'general', execute: async () => 'A' },
    'general'
  );
  registry.registerCommand(
    { name: 'cmdtestea', commands: ['cmdtestea'], category: 'general', execute: async () => 'B' },
    'general'
  );

  const active = registry.getCommand('cmdtestea');
  assert.ok(active, 'comando registrado');
  assert.strictEqual(await active.execute({}), 'B', 'o segundo arquivo vence (comportamento mantido)');
  assert.strictEqual(
    registry.skippedCommands().length,
    skippedBefore + 1,
    'a substituição agora é registrada em skipped (antes era silenciosa)'
  );
  assert.match(
    JSON.stringify(registry.skippedCommands().at(-1)),
    /name duplicado/,
    'motivo explicado'
  );
  ok('registry: dois arquivos com o mesmo name não se sobrescrevem mais em silêncio');

  // gatilho do comando substituído não pode ficar órfão apontando para objeto morto
  assert.strictEqual(registry.resolveTrigger('alias_a'), null, 'gatilho do anterior foi removido');
  assert.strictEqual(registry.resolveTrigger('cmdtestea').name, 'cmdtestea');
  ok('registry: sem gatilhos órfãos apontando para o comando substituído');

  registry.unregisterCommand('cmdtestea');
  assert.strictEqual(registry.count(), before, 'limpeza do teste');

  /* ------------------------------- C1 (caso real): tigrinho x tigrearcade */

  const tigrinho = registry.resolveTrigger('tigrinho');
  const arcade = registry.resolveTrigger('tigrearcade');
  assert.ok(tigrinho, '!tigrinho continua registrado');
  assert.ok(arcade, '!tigrearcade registrado');
  assert.notStrictEqual(tigrinho, arcade, 'são comandos diferentes agora');
  assert.match(tigrinho.description, /5 rolos/, '!tigrinho é o caça-níquel de 5 rolos');
  assert.ok(arcade.execute, '!tigrearcade tem execute real');
  assert.strictEqual(registry.resolveTrigger('tigrinhoarcade'), arcade, 'alias do arcade');
  // o +1 vem do registro sintético acima; o load em si não descarta nada
  assert.strictEqual(
    registry.skippedCommands().length - loadSkipped,
    1,
    'só a colisão sintética do teste está em skipped; o load real não descartou comando'
  );
  ok('!tigrinho (5 rolos) e !tigrearcade coexistem — nenhum dos dois jogos foi perdido');

  /* -------------------------------------------------- C2: spamState */

  const state = groupHandler.__spamState;
  assert.ok(state instanceof Map, 'estado do flood é uma Map');
  state.clear();

  const now = Date.now();
  // 600 usuários que sumiram do grupo há 10 minutos + 3 ativos agora
  for (let i = 0; i < 600; i += 1) {
    state.set(`55119000${i}@s.whatsapp.net`, { count: 3, windowStart: now - 10 * 60 * 1000, lastText: 'x' });
  }
  for (let i = 0; i < 3; i += 1) {
    state.set(`551191111000${i}@s.whatsapp.net`, { count: 2, windowStart: now, lastText: 'y' });
  }
  assert.strictEqual(groupHandler.spamStateSize(), 603, 'estado semeado');

  // abaixo do teto a poda nem roda (custo zero no caminho da mensagem)
  assert.strictEqual(groupHandler.pruneSpamState(now, 1000), 0, 'não poda abaixo do teto');
  assert.strictEqual(groupHandler.spamStateSize(), 603, 'nada removido');

  const removed = groupHandler.pruneSpamState(now, 500);
  assert.strictEqual(removed, 600, 'removeu exatamente as 600 entradas vencidas');
  assert.strictEqual(groupHandler.spamStateSize(), 3, 'manteve as 3 recentes');
  ok('spamState: poda remove só as entradas vencidas e mantém as ativas (antes crescia sem limite)');

  state.clear();

  /* ------------------------------------------------------- C3: !eval */

  const evalCmd = registry.resolveTrigger('eval');
  assert.ok(evalCmd && evalCmd.ownerOnly, '!eval existe e é ownerOnly');
  const evalEnabledBefore = CONFIG.limits.evalEnabled;
  CONFIG.limits.evalEnabled = true;

  try {
    // código normal continua funcionando
    const cOk = fakeCtx({ args: ['1', '+', '1'] });
    await evalCmd.execute(cOk);
    const sOk = session.get(cOk.remoteJid, cOk.sender);
    assert.ok(sOk && sOk.onMessage, '!eval pede confirmação antes de executar');
    const cOk2 = fakeCtx({ text: 'sim' });
    await sOk.onMessage(cOk2);
    assert.match(cOk2.replies.join('\n'), /Resultado/, 'resultado devolvido');
    assert.match(cOk2.replies.join('\n'), /2/, '1+1 = 2');
    ok('!eval continua funcionando para código válido (com confirmação)');

    // laço infinito: precisa ser interrompido, não travar o processo
    // expressão válida que entra em laço: "(while(true){})" seria só erro de sintaxe
    const cLoop = fakeCtx({ args: ['(()', '=>', '{', 'while(true){}', '})()'] });
    await evalCmd.execute(cLoop);
    const sLoop = session.get(cLoop.remoteJid, cLoop.sender);
    assert.ok(sLoop && sLoop.onMessage, 'pediu confirmação');
    const cLoop2 = fakeCtx({ text: 'sim' });
    const t0 = Date.now();
    await sLoop.onMessage(cLoop2);
    const elapsed = Date.now() - t0;
    // o laço precisa TER rodado e sido cortado no timeout (senão o teste passaria
    // de graça com um erro de sintaxe)
    assert.ok(elapsed >= 4500, `o laço rodou até o timeout (${elapsed}ms)`);
    assert.ok(elapsed < 9000, `interrompido em ${elapsed}ms (antes travaria para sempre)`);
    const out = cLoop2.replies.join('\n');
    assert.match(out, /timed out|Erro/i, 'respondeu com erro em vez de travar');
    assert.ok(!/at\s+\w+\.js:\d+/.test(out), 'sem stack na resposta');
    ok(`!eval com laço infinito: interrompido em ${elapsed}ms com erro amigável (não trava o bot)`);
  } finally {
    CONFIG.limits.evalEnabled = evalEnabledBefore;
    session.clear('120363000000000000@g.us', '5511911110001@s.whatsapp.net');
  }

  database.close();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
  }
  console.log(`\n✅ correções críticas da auditoria: ${n} verificações, 0 falhas`);
  process.exit(0);
})().catch((err) => {
  console.error(`\n❌ core-fixes: ${err.stack || err.message}`);
  process.exit(1);
});
