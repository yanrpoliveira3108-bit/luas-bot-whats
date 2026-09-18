/**
 * test/services.test.js — Fase 5: camada de serviços.
 *
 * Cobre:
 *   1) EconomyService   — saldo, depósito, saque, transferência, erros de
 *                         domínio, histórico, venda, concorrência
 *   2) ModerationService— casos, consultas, regra de advertências, validação
 *   3) RpgService       — XP por mensagem (throttle), progressão
 *   4) Repository       — waterPlantation/fertilizePlantation (SQL que saiu
 *                         dos comandos)
 *   5) REGRESSÃO        — os comandos migrados respondem EXATAMENTE como antes
 *                         (mesmas mensagens, mesmas permissões)
 */

'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));
process.env.DATABASE_FILE = path.resolve(__dirname, '../database/lua-test-services.db');
const fs = require('fs');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.rmSync(process.env.DATABASE_FILE + suffix, { force: true }); } catch (_) {}
}

const database = require('../database/database');
database.open();
const { loadCommands } = require('../commands/loader');
const { registry } = require('../engine/plugins');
loadCommands(true);

const economy = require('../database/economy');
const users = require('../database/users');
const groups = require('../database/groups');
const casesRepo = require('../database/moderationCases');
const rpg = require('../database/rpg');

const economyService = require('../services/economyService');
const moderationService = require('../services/moderationService');
const rpgService = require('../services/rpgService');

const GROUP = '120363000000000001@g.us';
const ADMIN = '5511911110001@s.whatsapp.net';
let seq = 0;
function userJid(tag) {
  seq += 1;
  return `55119${String(seq).padStart(7, '0')}${tag || 0}@s.whatsapp.net`;
}

/** Captura o que o comando respondeu. */
function fakeCtx(sender, args, opts = {}) {
  const replies = [];
  return {
    sender,
    senderJid: sender,
    remoteJid: opts.chat || sender,
    isGroup: !!opts.chat,
    chat: opts.chat || sender,
    isAdmin: !!opts.isAdmin,
    isOwner: false,
    isBotAdmin: true,
    args: args || [],
    mentionedJid: opts.mentions || [],
    prefix: '!',
    text: '',
    socket: {
      groupMetadata: async () => ({ id: opts.chat, subject: 'G', participants: [] }),
      groupParticipantsUpdate: async () => (opts.onKick ? opts.onKick() : {}),
    },
    reply: async (text, extra) => { replies.push({ text: String(text), extra }); return {}; },
    replies,
  };
}

async function runCommand(trigger, ctx) {
  const cmd = registry.resolveTrigger(trigger);
  assert.ok(cmd, 'comando não encontrado: ' + trigger);
  await cmd.execute(ctx);
  return ctx.replies.map((r) => r.text).join('\n');
}

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

/** Espera um erro com um `.code` específico. */
async function expectCode(code, fn) {
  try {
    await fn();
  } catch (err) {
    assert.strictEqual(err.code, code, `esperava ${code}, veio ${err.code} (${err.message})`);
    return err;
  }
  throw new Error('esperava erro ' + code + ', mas não lançou');
}

(async () => {
  console.log('══════════ SERVICES TEST (Fase 5) ══════════');

  /* ------------------------------------------------ 1. EconomyService */

  await check('economy: saldo reflete carteira + banco', () => {
    const u = userJid();
    economy.setWallet(u, 500);
    economy.addBank(u, 250);
    const b = economyService.balance(u);
    assert.deepStrictEqual(b, { wallet: 500, bank: 250, total: 750 });
  });

  await check('economy: depósito move da carteira para o banco', async () => {
    const u = userJid();
    economy.setWallet(u, 500);
    const r = await economyService.deposit(u, 200);
    assert.strictEqual(r.amount, 200);
    assert.deepStrictEqual(economyService.balance(u), { wallet: 300, bank: 200, total: 500 });
  });

  await check('economy: saque move do banco para a carteira', async () => {
    const u = userJid();
    economy.setWallet(u, 100);
    economy.addBank(u, 400);
    await economyService.withdraw(u, 150);
    assert.deepStrictEqual(economyService.balance(u), { wallet: 250, bank: 250, total: 500 });
  });

  await check('economy: transferência desloca o valor entre carteiras', async () => {
    const a = userJid(); const b = userJid();
    economy.setWallet(a, 1000);
    const r = await economyService.transfer(a, b, 300);
    assert.strictEqual(r.amount, 300);
    assert.strictEqual(economyService.balance(a).wallet, 700);
    assert.strictEqual(economyService.balance(b).wallet, 300);
  });

  await check('economy: saldo insuficiente lança INSUFFICIENT_FUNDS e não move nada', async () => {
    const a = userJid(); const b = userJid();
    economy.setWallet(a, 100);
    await expectCode('INSUFFICIENT_FUNDS', () => economyService.transfer(a, b, 500));
    assert.strictEqual(economyService.balance(a).wallet, 100, 'o saldo mudou numa transferência falha');
    assert.strictEqual(economyService.balance(b).wallet, 0, 'o destinatário recebeu dinheiro');
  });

  await check('economy: valor inválido (0, negativo, texto) lança INVALID_AMOUNT', async () => {
    const a = userJid(); const b = userJid();
    economy.setWallet(a, 1000);
    for (const bad of [0, -50, 'abc', null, undefined, 1.5]) {
      await expectCode('INVALID_AMOUNT', () => economyService.transfer(a, b, bad));
    }
    assert.strictEqual(economyService.balance(a).wallet, 1000);
  });

  await check('economy: transferência para si mesmo lança SELF_TRANSFER', async () => {
    const a = userJid();
    economy.setWallet(a, 1000);
    await expectCode('SELF_TRANSFER', () => economyService.transfer(a, a, 10));
    assert.strictEqual(economyService.balance(a).wallet, 1000);
  });

  await check('economy: depósito além do saldo não altera nada', async () => {
    const u = userJid();
    economy.setWallet(u, 50);
    await expectCode('INSUFFICIENT_FUNDS', () => economyService.deposit(u, 500));
    assert.deepStrictEqual(economyService.balance(u), { wallet: 50, bank: 0, total: 50 });
  });

  await check('economy: histórico registra os dois lados da transferência', async () => {
    const a = userJid(); const b = userJid();
    economy.setWallet(a, 1000);
    await economyService.transfer(a, b, 250);
    const ha = economyService.ledger(a, 5);
    const hb = economyService.ledger(b, 5);
    assert.ok(ha.some((t) => t.type === 'transferencia' && t.amount === -250), 'lançamento de saída faltando');
    assert.ok(hb.some((t) => t.type === 'transferencia' && t.amount === 250), 'lançamento de entrada faltando');
  });

  await check('economy: grant/deduct creditam e debitam com lançamento', async () => {
    const u = userJid();
    await economyService.grant(u, 300, 'evento', 'teste');
    assert.strictEqual(economyService.balance(u).wallet, 300);
    await economyService.deduct(u, 100, 'multa', 'teste');
    assert.strictEqual(economyService.balance(u).wallet, 200);
    await expectCode('INSUFFICIENT_FUNDS', () => economyService.deduct(u, 9999));
    assert.strictEqual(economyService.balance(u).wallet, 200, 'débito acima do saldo alterou a carteira');
  });

  await check('economy: sellItem remove do inventário e credita na carteira', async () => {
    const u = userJid();
    economy.addItem(u, 'peixe_tilapia', 4);
    const r = await economyService.sellItem(u, 'peixe_tilapia', 4, 25);
    assert.strictEqual(r.qty, 4);
    assert.strictEqual(r.total, 100);
    assert.strictEqual(economyService.balance(u).wallet, 100);
    const left = economy.getItem(u, 'peixe_tilapia');
    assert.ok(!left || left.quantity === 0, 'o item não saiu do inventário');
    assert.ok(economyService.ledger(u, 3).some((t) => t.type === 'venda' && t.amount === 100));
  });

  await check('economy: sellItem sem estoque suficiente lança e não credita', async () => {
    const u = userJid();
    economy.addItem(u, 'peixe_tilapia', 2);
    await expectCode('INSUFFICIENT_FUNDS', () => economyService.sellItem(u, 'peixe_tilapia', 10, 25));
    assert.strictEqual(economyService.balance(u).wallet, 0);
    assert.strictEqual(economy.getItem(u, 'peixe_tilapia').quantity, 2, 'removeu item numa venda falha');
  });

  await check('economy: concorrência — duas transferências simultâneas, saldo só paga uma', async () => {
    const a = userJid(); const b = userJid(); const c = userJid();
    economy.setWallet(a, 100);
    const settled = await Promise.allSettled([
      economyService.transfer(a, b, 100),
      economyService.transfer(a, c, 100),
    ]);
    const ok = settled.filter((s) => s.status === 'fulfilled');
    const fail = settled.filter((s) => s.status === 'rejected');
    assert.strictEqual(ok.length, 1, 'as duas transferências passaram com saldo para uma');
    assert.strictEqual(fail.length, 1);
    assert.strictEqual(fail[0].reason.code, 'INSUFFICIENT_FUNDS');
    assert.strictEqual(economyService.balance(a).wallet, 0);
    const total = economyService.balance(b).wallet + economyService.balance(c).wallet;
    assert.strictEqual(total, 100, 'dinheiro foi criado: ' + total);
  });

  /* ------------------------------------------- 2. ModerationService */

  await check('moderation: recordCase grava e devolve o caso com id estável', () => {
    const alvo = userJid();
    const caso = moderationService.recordCase({
      groupId: GROUP, userId: alvo, moderatorId: ADMIN,
      action: 'warn', reason: 'spam', metadata: { source: 'teste' },
    });
    assert.ok(caso.id > 0, 'case_id inválido');
    const lido = moderationService.getCase(caso.id);
    assert.strictEqual(lido.id, caso.id);
    assert.strictEqual(lido.action, 'warn');
    assert.strictEqual(lido.status, 'open');
    assert.deepStrictEqual(lido.metadata, { source: 'teste' });
  });

  await check('moderation: motivo vazio vira o padrão e a ação é normalizada', () => {
    const caso = moderationService.recordCase({
      groupId: GROUP, userId: userJid(), action: '  KICK  ', reason: '   ',
    });
    assert.strictEqual(caso.action, 'kick', 'ação não foi normalizada');
    assert.strictEqual(caso.reason, moderationService.DEFAULT_REASON);
  });

  await check('moderation: grupo/usuário/ação inválidos são rejeitados', () => {
    const antes = casesRepo.count();
    for (const [bad, code] of [
      [{ userId: 'u@s.whatsapp.net', action: 'warn' }, 'INVALID_GROUP'],
      [{ groupId: GROUP, action: 'warn' }, 'INVALID_USER'],
      [{ groupId: GROUP, userId: 'u@s.whatsapp.net' }, 'INVALID_ACTION'],
    ]) {
      let pegou = null;
      try { moderationService.recordCase(bad); } catch (err) { pegou = err; }
      assert.ok(pegou, 'deveria ter lançado para ' + code);
      assert.strictEqual(pegou.code, code, `esperava ${code}, veio ${pegou.code}`);
    }
    assert.strictEqual(casesRepo.count(), antes, 'caso inválido foi gravado');
  });

  await check('moderation: consultas por grupo, usuário e grupo+usuário', () => {
    const alvo = userJid();
    const outroGrupo = '120363000000000002@g.us';
    moderationService.recordCase({ groupId: GROUP, userId: alvo, action: 'warn' });
    moderationService.recordCase({ groupId: GROUP, userId: alvo, action: 'mute' });
    moderationService.recordCase({ groupId: outroGrupo, userId: alvo, action: 'ban' });
    moderationService.recordCase({ groupId: GROUP, userId: userJid(), action: 'warn' });

    assert.ok(moderationService.listCasesByGroup(GROUP, 50).length >= 3);
    assert.strictEqual(moderationService.listCasesByUser(alvo, 50).length, 3);
    assert.strictEqual(moderationService.listCasesByGroupAndUser(GROUP, alvo, 50).length, 2);
  });

  await check('moderation: regra de advertência usa os thresholds do grupo', () => {
    const alvo = userJid();
    groups.ensure(GROUP, 'Grupo');
    // padrão do projeto: 1/2/3 → aviso
    const r1 = moderationService.applyWarning({ groupId: GROUP, userId: alvo, reason: 'um', moderatorId: ADMIN });
    assert.strictEqual(r1.count, 1);
    assert.strictEqual(r1.action, 'aviso');
    const r2 = moderationService.applyWarning({ groupId: GROUP, userId: alvo, reason: 'dois', moderatorId: ADMIN });
    assert.strictEqual(r2.count, 2);
    assert.strictEqual(r2.action, 'aviso');
    assert.ok(r2.caseId > r1.caseId, 'cada advertência gera um caso novo');
    // o caso guarda o contexto
    const caso = moderationService.getCase(r2.caseId);
    assert.strictEqual(caso.metadata.warnCount, 2);
    assert.strictEqual(caso.metadata.source, 'manual');
  });

  await check('moderation: grupo configurado com kick no 3º aviso resolve kick', () => {
    const alvo = userJid();
    const g = '120363000000000003@g.us';
    groups.ensure(g, 'Grupo Kick');
    groups.setSetting(g, 'warning_thresholds', { 1: 'aviso', 2: 'aviso', 3: 'kick' });
    moderationService.applyWarning({ groupId: g, userId: alvo, reason: '1' });
    moderationService.applyWarning({ groupId: g, userId: alvo, reason: '2' });
    const terceira = moderationService.applyWarning({ groupId: g, userId: alvo, reason: '3' });
    assert.strictEqual(terceira.count, 3);
    assert.strictEqual(terceira.action, 'kick');
    // clamp: o 4º aviso continua usando a faixa 3 (comportamento anterior)
    assert.strictEqual(moderationService.resolveWarningAction(g, 9), 'kick');
  });

  await check('moderation: closeCase fecha e mantém o histórico', () => {
    const alvo = userJid();
    const caso = moderationService.recordCase({ groupId: GROUP, userId: alvo, action: 'ban', reason: 'motivo original' });
    // sem motivo de fechamento: o motivo original PRECISA permanecer
    const soFechado = moderationService.closeCase(caso.id);
    assert.strictEqual(soFechado.status, 'closed');
    assert.ok(soFechado.closed_at, 'closed_at deveria ser preenchido');
    assert.strictEqual(soFechado.reason, 'motivo original', 'o motivo original foi apagado');
    // com motivo de fechamento: o repository substitui (comportamento da Fase 4)
    const outro = moderationService.recordCase({ groupId: GROUP, userId: alvo, action: 'mute', reason: 'r1' });
    assert.strictEqual(moderationService.closeCase(outro.id, 'resolvido').reason, 'resolvido');
  });

  /* -------------------------------------------------- 3. RpgService */

  await check('rpg: XP por mensagem concede 1-3 e respeita o intervalo de 30s', () => {
    const u = userJid();
    users.upsert(u, 'Tester');
    rpgService.resetThrottle(u);
    const t0 = Date.now();
    const primeiro = rpgService.grantMessageXp(u, t0);
    assert.ok(primeiro, 'a primeira mensagem deveria conceder XP');
    assert.ok(primeiro.xp >= 1 && primeiro.xp <= 3, 'XP fora da faixa 1-3: ' + primeiro.xp);

    const bloqueado = rpgService.grantMessageXp(u, t0 + 1000);
    assert.strictEqual(bloqueado, null, 'deveria estar no cooldown de XP');
    assert.strictEqual(users.get(u).xp, primeiro.xp, 'XP foi concedido durante o cooldown');

    const depois = rpgService.grantMessageXp(u, t0 + rpgService.XP_MIN_INTERVAL + 1);
    assert.ok(depois, 'deveria conceder XP após o intervalo');
    assert.ok(depois.xp > primeiro.xp, 'o XP não acumulou');
  });

  await check('rpg: progressão bate com a fórmula do repositório', () => {
    const u = userJid();
    users.upsert(u, 'Tester');
    users.addXp(u, 1000);
    const p = rpgService.progression(u);
    assert.strictEqual(p.level, rpgService.levelFromXp(p.xp));
    assert.strictEqual(p.xpForNext, rpgService.xpForNextLevel(p.level));
    assert.strictEqual(p.remaining, Math.max(0, p.xpForNext - p.xp));
    assert.ok(p.percent >= 0 && p.percent <= 100, 'percentual fora de 0-100: ' + p.percent);
  });

  await check('rpg: mapa de throttle não cresce sem limite', () => {
    rpgService.resetThrottle();
    const base = Date.now();
    // acima do teto (5000) com entradas velhas: a poda deve acontecer
    for (let i = 0; i < 5200; i++) {
      rpgService.grantMessageXp(`551190000${i}@s.whatsapp.net`, base - (i < 5100 ? 10 * 60 * 1000 : 0));
    }
    assert.ok(rpgService.throttleSize <= 5000,
      'o mapa de throttle ficou com ' + rpgService.throttleSize + ' entradas');
    rpgService.resetThrottle();
  });

  /* ------------------------------------- 4. SQL que saiu dos comandos */

  await check('repository: waterPlantation e fertilizePlantation (SQL fora do comando)', () => {
    const u = userJid();
    rpg.ensureFarm(u);
    const prontoEm = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    rpg.addPlantation(u, 'trigo', prontoEm);
    const antes = rpg.getPlantations(u).find((p) => p.crop === 'trigo');
    assert.ok(antes, 'plantação não foi criada');

    const novoReady = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    rpg.waterPlantation(antes.id, novoReady);
    const regada = rpg.getPlantation(antes.id);
    assert.strictEqual(regada.ready_at, novoReady);
    assert.ok(regada.watered_at, 'watered_at deveria ser gravado');

    const fertilizada = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    rpg.fertilizePlantation(antes.id, fertilizada);
    assert.strictEqual(rpg.getPlantation(antes.id).ready_at, fertilizada);
  });

  /* ------------------------- 5. REGRESSÃO dos comandos migrados */

  await check('regressão: !depositar responde igual e move o dinheiro', async () => {
    const u = userJid();
    economy.setWallet(u, 1000);
    const ctx = fakeCtx(u, ['400']);
    const texto = await runCommand('depositar', ctx);
    assert.match(texto, /^🏦 Depositado:/, 'resposta mudou: ' + texto);
    assert.deepStrictEqual(economyService.balance(u), { wallet: 600, bank: 400, total: 1000 });
  });

  await check('regressão: !depositar sem saldo mantém a mensagem antiga', async () => {
    const u = userJid();
    economy.setWallet(u, 10);
    const texto = await runCommand('depositar', fakeCtx(u, ['9999']));
    assert.strictEqual(texto, '💸 Saldo insuficiente.');
  });

  await check('regressão: !sacar responde igual', async () => {
    const u = userJid();
    economy.addBank(u, 500);
    const texto = await runCommand('sacar', fakeCtx(u, ['200']));
    assert.match(texto, /^🏧 Sacado:/, 'resposta mudou: ' + texto);
    assert.strictEqual(economyService.balance(u).wallet, 200);
  });

  await check('regressão: !transferir responde igual e menciona o alvo', async () => {
    const a = userJid(); const b = userJid();
    economy.setWallet(a, 1000);
    // splitCommand mantém a menção dentro de args: ['@alvo', '300']
    const ctx = fakeCtx(a, ['@alvo', '300'], { mentions: [b] });
    const texto = await runCommand('transferir', ctx);
    assert.match(texto, /^💸 Transferido .* para @/, 'resposta mudou: ' + texto);
    assert.deepStrictEqual(ctx.replies[0].extra, { mentions: [b] }, 'a menção sumiu');
    assert.strictEqual(economyService.balance(b).wallet, 300);
  });

  /* ------------------------------------------------------------------ *
   * !pagar / !presente — parsing de args com menção                     *
   *                                                                    *
   * BUG CORRIGIDO: o parser (utils/messages.splitCommand) só corta por    *
   * espaços, então "!pagar @fulano 150" gera args ['@fulano','150'] e     *
   * mentionedJid vem do contextInfo, por outro caminho. O comando lia o    *
   * valor em args[0] justamente quando havia menção — ou seja, lia         *
   * "@fulano" — e parseInt devolvia NaN: o comando NUNCA pagava, só        *
   * devolvia o aviso de uso. A correção remove os tokens de menção das     *
   * args antes da leitura (utils/messages.dropMentionArgs) e valida o      *
   * valor como inteiro positivo (toPositiveInt) para "1.5" não virar 1.    *
   * Este teste protege contra a volta do bug.                            *
   * ------------------------------------------------------------------ */
  const USO_PAGAR = '⚠️ Use: !pagar @usuario <valor>';

  await check('!pagar: menção + valor paga de verdade (regressão do bug de índice)', async () => {
    const a = userJid(); const b = userJid();
    economy.setWallet(a, 1000);
    const ctx = fakeCtx(a, ['@' + b.split('@')[0], '150'], { mentions: [b] });
    const texto = await runCommand('pagar', ctx);
    assert.match(texto, /^💸 Você pagou /, 'não pagou: ' + texto);
    assert.strictEqual(economyService.balance(b).wallet, 150, 'o alvo não recebeu');
    assert.strictEqual(economyService.balance(a).wallet, 850, 'saldo do pagador errado');
    assert.deepStrictEqual(ctx.replies[0].extra, { mentions: [b] }, 'a menção sumiu da resposta');
  });

  await check('!pagar: confirma destinatário e valor na resposta', async () => {
    const a = userJid(); const b = userJid();
    economy.setWallet(a, 500);
    const texto = await runCommand('pagar', fakeCtx(a, ['@' + b.split('@')[0], '75'], { mentions: [b] }));
    assert.ok(texto.includes('@' + b.split('@')[0]), 'o destinatário não aparece: ' + texto);
    assert.ok(texto.includes('75'), 'o valor não aparece: ' + texto);
    assert.strictEqual(economyService.balance(b).wallet, 75);
  });

  await check('!pagar: valor antes da menção também funciona', async () => {
    const a = userJid(); const b = userJid();
    economy.setWallet(a, 500);
    const texto = await runCommand('pagar', fakeCtx(a, ['60', '@' + b.split('@')[0]], { mentions: [b] }));
    assert.match(texto, /^💸 Você pagou /, 'não pagou: ' + texto);
    assert.strictEqual(economyService.balance(b).wallet, 60);
  });

  await check('!pagar: argumentos extras são ignorados', async () => {
    const a = userJid(); const b = userJid();
    economy.setWallet(a, 500);
    const texto = await runCommand('pagar', fakeCtx(a, ['@' + b.split('@')[0], '40', 'obrigado', 'amigo'], { mentions: [b] }));
    assert.match(texto, /^💸 Você pagou /, 'não pagou: ' + texto);
    assert.strictEqual(economyService.balance(b).wallet, 40, 'pagou o valor errado');
  });

  await check('!pagar: múltiplas menções pagam à primeira', async () => {
    const a = userJid(); const b = userJid(); const c = userJid();
    economy.setWallet(a, 500);
    const args = ['@' + b.split('@')[0], '@' + c.split('@')[0], '30'];
    const texto = await runCommand('pagar', fakeCtx(a, args, { mentions: [b, c] }));
    assert.match(texto, /^💸 Você pagou /, 'não pagou: ' + texto);
    assert.strictEqual(economyService.balance(b).wallet, 30, 'a primeira menção não recebeu');
    assert.strictEqual(economyService.balance(c).wallet, 0, 'a segunda menção recebeu sem dever');
  });

  await check('!pagar: sem menção devolve o aviso de uso (não é forma suportada)', async () => {
    const a = userJid();
    economy.setWallet(a, 500);
    const texto = await runCommand('pagar', fakeCtx(a, ['150']));
    assert.strictEqual(texto, USO_PAGAR);
    assert.strictEqual(economyService.balance(a).wallet, 500);
  });

  await check('!pagar: valor ausente devolve o aviso de uso', async () => {
    const a = userJid(); const b = userJid();
    economy.setWallet(a, 500);
    const texto = await runCommand('pagar', fakeCtx(a, ['@' + b.split('@')[0]], { mentions: [b] }));
    assert.strictEqual(texto, USO_PAGAR);
    assert.strictEqual(economyService.balance(b).wallet, 0);
  });

  await check('!pagar: valor inválido (abc / 1.5 / -5 / 0) não paga nada', async () => {
    const a = userJid(); const b = userJid();
    economy.setWallet(a, 500);
    for (const ruim of ['abc', '1.5', '-5', '0', '1e3']) {
      const texto = await runCommand('pagar', fakeCtx(a, ['@' + b.split('@')[0], ruim], { mentions: [b] }));
      assert.strictEqual(texto, USO_PAGAR, `valor "${ruim}" não foi rejeitado: ${texto}`);
    }
    assert.strictEqual(economyService.balance(a).wallet, 500, 'saldo mudou com valor inválido');
    assert.strictEqual(economyService.balance(b).wallet, 0);
  });

  await check('!pagar: saldo insuficiente mantém a mensagem antiga', async () => {
    const a = userJid(); const b = userJid();
    economy.setWallet(a, 10);
    const texto = await runCommand('pagar', fakeCtx(a, ['@' + b.split('@')[0], '9999'], { mentions: [b] }));
    assert.strictEqual(texto, '💸 Saldo insuficiente para pagar.');
    assert.strictEqual(economyService.balance(a).wallet, 10, 'o saldo foi debitado mesmo assim');
  });

  await check('!pagar: pagar a si mesmo mantém o aviso antigo', async () => {
    const a = userJid();
    economy.setWallet(a, 500);
    const texto = await runCommand('pagar', fakeCtx(a, ['@' + a.split('@')[0], '10'], { mentions: [a] }));
    assert.strictEqual(texto, '🤨 Não dá para pagar a si mesmo.');
    assert.strictEqual(economyService.balance(a).wallet, 500);
  });

  await check('!presente: menção + item + quantidade presenteia (mesma classe de bug)', async () => {
    const a = userJid(); const b = userJid();
    economy.addItem(a, 'fertilizante', 5);
    const args = ['@' + b.split('@')[0], 'fertilizante', '3'];
    const texto = await runCommand('presente', fakeCtx(a, args, { mentions: [b] }));
    assert.match(texto, /^🎁 Você presenteou /, 'não presenteou: ' + texto);
    assert.strictEqual(economy.getItem(b, 'fertilizante').quantity, 3);
    assert.strictEqual(economy.getItem(a, 'fertilizante').quantity, 2);
  });

  await check('!presente: sem quantidade assume 1', async () => {
    const a = userJid(); const b = userJid();
    economy.addItem(a, 'fertilizante', 5);
    const texto = await runCommand('presente', fakeCtx(a, ['@' + b.split('@')[0], 'fertilizante'], { mentions: [b] }));
    assert.match(texto, /^🎁 Você presenteou /, 'não presenteou: ' + texto);
    assert.strictEqual(economy.getItem(b, 'fertilizante').quantity, 1);
  });

  await check('!presente: quantidade inválida vira aviso de uso (antes caía em 1)', async () => {
    const a = userJid(); const b = userJid();
    economy.addItem(a, 'fertilizante', 5);
    const texto = await runCommand('presente', fakeCtx(a, ['@' + b.split('@')[0], 'fertilizante', 'muito'], { mentions: [b] }));
    assert.strictEqual(texto, '⚠️ Use: !presente @usuario <item> [qtd]');
    assert.strictEqual(economy.getItem(a, 'fertilizante').quantity, 5, 'presenteou mesmo com qtd inválida');
  });

  await check('!presente: sem item devolve o aviso de uso', async () => {
    const a = userJid(); const b = userJid();
    const texto = await runCommand('presente', fakeCtx(a, ['@' + b.split('@')[0]], { mentions: [b] }));
    assert.strictEqual(texto, '⚠️ Use: !presente @usuario <item> [qtd]');
  });

  await check('!transferir: continua funcionando depois da troca para o helper', async () => {
    const a = userJid(); const b = userJid();
    economy.setWallet(a, 800);
    const ctx = fakeCtx(a, ['@' + b.split('@')[0], '120'], { mentions: [b] });
    const texto = await runCommand('transferir', ctx);
    assert.match(texto, /^💸 Transferido .* para @/, 'resposta mudou: ' + texto);
    assert.strictEqual(economyService.balance(b).wallet, 120);
  });

  await check('regressão: !transferir para si mesmo mantém o aviso antigo', async () => {
    const a = userJid();
    economy.setWallet(a, 1000);
    const texto = await runCommand('transferir', fakeCtx(a, ['@eu', '10'], { mentions: [a] }));
    assert.strictEqual(texto, '🤨 Não dá para transferir para você mesmo.');
    assert.strictEqual(economyService.balance(a).wallet, 1000);
  });

  await check('regressão: !advertir aplica o aviso e responde no formato antigo', async () => {
    const alvo = userJid();
    const g = '120363000000000004@g.us';
    groups.ensure(g, 'Grupo Adv');
    let kickChamado = 0;
    const ctx = fakeCtx(ADMIN, ['@alvo', 'motivo', 'de', 'teste'], {
      chat: g, isAdmin: true, mentions: [alvo], onKick: () => { kickChamado += 1; },
    });
    const texto = await runCommand('advertir', ctx);
    assert.match(texto, /⚠️ \*Advertência aplicada\*/, 'resposta mudou: ' + texto);
    assert.match(texto, /▸ Total: 1/);
    assert.match(texto, /▸ Ação: 📢 aviso enviado/);
    assert.strictEqual(kickChamado, 0, 'não deveria ter kickado no 1º aviso');
    // e o caso foi registrado pela camada de serviço
    assert.ok(moderationService.listCasesByGroupAndUser(g, alvo, 10).length >= 1,
      'a advertência não gerou caso');
  });

  await check('regressão: !advertir com threshold de kick remove o usuário e registra o caso', async () => {
    const alvo = userJid();
    const g = '120363000000000005@g.us';
    groups.ensure(g, 'Grupo Kick2');
    groups.setSetting(g, 'warning_thresholds', { 1: 'kick', 2: 'kick', 3: 'kick' });
    let kickChamado = 0;
    const ctx = fakeCtx(ADMIN, ['@alvo', 'reincidencia'], {
      chat: g, isAdmin: true, mentions: [alvo], onKick: () => { kickChamado += 1; },
    });
    const texto = await runCommand('advertir', ctx);
    assert.match(texto, /▸ Ação: 👢 usuário removido/, 'resposta mudou: ' + texto);
    assert.strictEqual(kickChamado, 1, 'o kick deveria ter sido executado uma vez');
    const casos = moderationService.listCasesByGroupAndUser(g, alvo, 10);
    const kick = casos.find((c) => c.action === 'kick');
    assert.ok(kick, 'o kick não foi registrado como caso');
    assert.strictEqual(kick.metadata.source, 'warnings');
  });

  await check('regressão: !venderpeixes vende tudo e paga o sell_price', async () => {
    const u = userJid();
    const { FISH } = require('../plugins/life/config');
    const primeiro = FISH[0];
    const item = rpg.getShopItem(primeiro.id);
    assert.ok(item, 'item de peixe não existe na loja');
    economy.addItem(u, primeiro.id, 3);
    const texto = await runCommand('venderpeixes', fakeCtx(u, []));
    assert.match(texto, /^💰 Vendeu 3 peixe\(s\) por /, 'resposta mudou: ' + texto);
    assert.strictEqual(economyService.balance(u).wallet, item.sell_price * 3);
  });

  /* ---------------------------------------------------------- resumo */
  const falhas = results.filter(([, ok]) => !ok);
  console.log(`\n=== SERVICES TEST: ${results.length - falhas.length} passou, ${falhas.length} falhou `
    + `(registry: ${registry.count()} comandos) ===`);
  if (falhas.length) {
    for (const [label, , err] of falhas) console.log('  FALHA: ' + label + ' — ' + err);
    process.exitCode = 1;
  } else {
    console.log('=== SERVICES TEST: TUDO OK ===');
  }
})().catch((err) => { console.error('SERVICES TEST quebrou:', err); process.exitCode = 1; });
