#!/usr/bin/env node
/**
 * test/tesouro.test.js — 🗺️ CAÇA AO TESOURO (3×3 até 13×13) + carteira.
 *
 * O que este teste cobre (o que dá para verificar sem aparelho):
 *  1) lógica pura: parâmetros 3..13, vitória possível, coordenadas/limites,
 *     mapa válido, dicas e EXPECTATIVA de retorno (não imprime dinheiro)
 *  2) carteira: valor inválido/negativo/zero/decimal/malformado, acima do saldo,
 *     cobrança ÚNICA por ref, prêmio ÚNICO por aposta, saldo nunca negativo,
 *     apostas SIMULTÂNEAS entre jogos (caça + tigrinho)
 *  3) pipeline real do comando (ctx falso igual ao dos outros testes):
 *     painel, card HTML sem segredos, modohtml on/off, casual sem cadastro,
 *     cobrança única na mensagem repetida, escavação/repetição/dono/limites,
 *     vitória, derrota, saída, expiração, saldo mudando entre abrir e confirmar,
 *     carteira vazia, falha de consulta ("—", nunca 0), recuperação pós-reinício
 *  4) cartão (jsdom, opcional): seleção de casa, cópia do comando, navegação
 *     pelas 4 setas, extremidades desativadas, janela C..G / linhas, painel de
 *     aposta (validação, chips, prévia) — sem nada de rede
 *
 * Sem jsdom instalado, o bloco 4 é PULADO com aviso (o resto roda igual).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');

const DB = require('./dbtmp').tmpFile('lua-tesouro-test.db');

let falhas = 0;
let feitos = 0;
function ok(l) {
  feitos++;
  console.log('✅ ' + l);
}
function fail(l, e) {
  falhas++;
  console.log('❌ ' + l + ' — ' + (e && e.message));
}
function skip(l, motivo) {
  console.log('⏭  ' + l + ' — pulado: ' + motivo);
}

/** ctx falso com socket que registra os envios (mesmo padrão dos outros testes). */
function fakeCtx(opts = {}) {
  const enviados = [];
  const ctx = {
    enviados,
    socket: {
      user: { id: '5511977776666:3@s.whatsapp.net' },
      relayMessage: async (jid, message, o) => {
        enviados.push({ jid, message, o });
        if (opts.relayFalha) throw new Error('stanza rejeitada');
        return { key: { id: 'ABC' } };
      },
    },
    remoteJid: opts.remoteJid || '120363000000000000@g.us',
    isGroup: opts.isGroup === undefined ? true : opts.isGroup,
    isOwner: !!opts.isOwner,
    isAdmin: !!opts.isAdmin,
    prefix: '!',
    sender: opts.sender || '5511999999999@s.whatsapp.net',
    args: opts.args || [],
    command: opts.command || 'cacatesouro',
    text: opts.text || '',
    message: { key: { id: opts.msgId || 'MSG' + Math.random().toString(36).slice(2) } },
    replies: [],
    reply: async (m) => {
      ctx.replies.push(String(m));
      return {};
    },
    replyWithMentions: async (m) => {
      ctx.replies.push(String(m));
      return {};
    },
    react: async () => ({}),
    presence: async () => ({}),
  };
  return ctx;
}

/** HTML do card que o comando enviou (falha explicando o que veio no lugar). */
function card(ctx) {
  if (!ctx.enviados.length) {
    throw new Error('nenhum card enviado; respostas: ' + ctx.replies.join(' | ').slice(0, 300));
  }
  return htmlDoEnvio(ctx.enviados[0]);
}

/** HTML do card de um envio fake. */
function htmlDoEnvio(enviado) {
  const rich = enviado.message.botForwardedMessage.message.richResponseMessage;
  return JSON.parse(rich.unifiedResponse.data.toString('utf8')).sections[0].view_model.primitive.payload;
}

/** Cria o personagem do jogador com o saldo pedido (carteira REAL do projeto). */
function comCarteira(life, userId, saldo) {
  life.createCharacter(userId, { name: 'Teste', age: 25, city: 'Sumaré' });
  const economy = require('../database/economy');
  economy.setWallet(userId, saldo);
}

async function main() {
  try {
    fs.rmSync(DB, { force: true });
  } catch (_) {}
  process.env.OWNER_NUMBER = '5511999999999';
  process.env.DATABASE_FILE = DB;
  process.env.BUTTONS_ENABLED = 'true';

  const database = require('../database/database');
  database.open();
  require('../commands/loader').loadCommands(true);

  const jogo = require('../utils/treasureGame');
  const store = require('../database/treasure');
  const carteira = require('../utils/gameWallet');
  const economy = require('../database/economy');
  const life = require('../database/life');
  const settings = require('../database/settings');
  const menuFormat = require('../utils/menuFormat');
  const { registry } = require('../engine/plugins');
  const cmd = require('../commands/games/cacatesouro').find((c) => c.name === 'cacatesouro');

  const U = '5511999999999@s.whatsapp.net';
  const OUTRO = '5511888888888@s.whatsapp.net';

  /* ------------------------- 1) lógica pura -------------------------- */
  try {
    for (let n = 3; n <= 13; n++) {
      const c = jogo.configDoTabuleiro(n);
      assert.strictEqual(c.size, n, 'tamanho ' + n);
      assert.strictEqual(c.casas, n * n, 'casas = n²');
      assert.ok(c.tesouros >= 2, 'pelo menos 2 tesouros');
      assert.ok(c.armadilhas >= 1, 'pelo menos 1 armadilha');
      assert.ok(c.tesouros + c.armadilhas <= c.casas, 'cabe no tabuleiro');
      assert.ok(c.escavacoes >= c.tesouros, `escavações (${c.escavacoes}) >= tesouros (${c.tesouros}) → vitória possível`);
      assert.ok(c.escavacoes <= c.casas - 1, 'não é tudo de graça');
      const mapa = jogo.gerarMapa(n, 12345);
      assert.strictEqual(mapa.tesouros.length, c.tesouros, `tesouros do mapa ${n}`);
      assert.strictEqual(mapa.armadilhas.length, c.armadilhas, `armadilhas do mapa ${n}`);
      assert.ok(
        mapa.tesouros.every((i) => i >= 0 && i < c.casas) && mapa.armadilhas.every((i) => i >= 0 && i < c.casas),
        'índices dentro do tabuleiro'
      );
      assert.ok(!mapa.tesouros.some((i) => mapa.armadilhas.includes(i)), 'tesouro e armadilha não na mesma casa');
      const dicas = Array.from({ length: c.casas }, (_, i) => jogo.dicaDoMapa(mapa, n, i));
      assert.ok(dicas.every((d) => d >= 0 && d <= 8), 'dica = nº de tesouros vizinhos (0..8)');
      assert.ok(dicas.some((d) => d > 0), 'alguma dica revela vizinhança');
      assert.deepStrictEqual(jogo.gerarMapa(n, 999), jogo.gerarMapa(n, 999), 'mapa determinístico pelo seed');
      for (let i = 0; i < n * n; i++) {
        assert.strictEqual(jogo.idxDe(jogo.parseCoord(jogo.coordDeIdx(i, n), n).x, jogo.parseCoord(jogo.coordDeIdx(i, n), n).y, n), i, 'ida e volta da coordenada');
      }
    }
    ok('1: 3..13 — parâmetros, mapa, dicas e coordenadas (A1..M13) válidos');
  } catch (e) {
    fail('1: lógica pura', e);
  }

  try {
    // limites de coordenada (por tamanho) e entradas malformadas
    assert.strictEqual(jogo.parseCoord('A1', 3).coord, 'A1', 'A1 no 3×3');
    assert.strictEqual(jogo.parseCoord('c3', 3).coord, 'C3', 'minúscula aceita');
    assert.strictEqual(jogo.parseCoord('M13', 13).coord, 'M13', 'M13 no 13×13');
    assert.strictEqual(jogo.parseCoord('M13', 3), null, 'M13 fora do 3×3');
    assert.strictEqual(jogo.parseCoord('N1', 13), null, 'N (depois de M) inválido');
    assert.strictEqual(jogo.parseCoord('A14', 13), null, 'linha 14 inválida');
    assert.strictEqual(jogo.parseCoord('A0', 13), null, 'linha 0 inválida');
    assert.strictEqual(jogo.parseCoord('', 13), null, 'vazio');
    assert.strictEqual(jogo.parseCoord('A 1', 13).coord, 'A1', 'espaço interno tolerado');
    assert.strictEqual(jogo.parseCoord('<script>', 13), null, 'texto estranho');
    ok('2: coordenadas — dentro/fora do mapa e entradas malformadas');
  } catch (e) {
    fail('2: coordenadas', e);
  }

  try {
    // retorno esperado NÃO passa da aposta (o jogo não imprime dinheiro):
    // simulação com jogador aleatório, vários tamanhos
    const rng = jogo.criarRng(7);
    for (const n of [3, 5, 8, 13]) {
      const c = jogo.configDoTabuleiro(n);
      let aposta = 0;
      let retorno = 0;
      const rodadas = 400;
      for (let r = 0; r < rodadas; r++) {
        const mapa = jogo.gerarMapa(n, Math.floor(rng() * 1e9) + 1);
        const apostaR = 100;
        aposta += apostaR;
        // jogador aleatório: escava casas distintas até acabar as escavações
        const casas = Array.from({ length: c.casas }, (_, i) => i);
        for (let i = casas.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [casas[i], casas[j]] = [casas[j], casas[i]];
        }
        let usadas = 0;
        let achados = 0;
        for (const casa of casas) {
          if (usadas >= c.escavacoes) break;
          usadas += mapa.armadilhas.includes(casa) ? 2 : 1;
          if (mapa.tesouros.includes(casa)) achados++;
        }
        const calc = jogo.calcularRecompensa({ bet: apostaR, size: n, encontrados: achados, total: c.tesouros });
        retorno += calc.total;
      }
      const rtp = retorno / aposta;
      assert.ok(rtp <= 1.0, `RTP do ${n}×${n} não passa de 100% (${(rtp * 100).toFixed(1)}%)`);
      assert.ok(rtp > 0.2, `paga alguma coisa (${(rtp * 100).toFixed(1)}%)`);
    }
    ok('3: retorno esperado ≤ aposta em 3×3, 5×5, 8×8 e 13×13 (simulação determinística)');
  } catch (e) {
    fail('3: RTP', e);
  }

  try {
    // valor por tesouro cresce com a aposta e é inteiro; bônus só na vitória
    const c5 = jogo.configDoTabuleiro(5);
    const formula = (bet) => Math.floor(bet * (c5.casas / c5.escavacoes) * (jogo.RTP_BASE / c5.tesouros));
    const v100 = jogo.valorPorTesouro(100, 5);
    assert.ok(Number.isInteger(v100) && v100 > 0, 'valor inteiro por tesouro');
    assert.strictEqual(v100, formula(100), 'valor = aposta × (casas/escavações) ÷ tesouros × RTP');
    assert.strictEqual(jogo.valorPorTesouro(200, 5), formula(200), 'escala com a aposta');
    assert.strictEqual(jogo.valorPorTesouro(0, 5), 0, 'aposta 0 → 0');
    const semVitoria = jogo.calcularRecompensa({ bet: 100, size: 5, encontrados: 2, total: 3 });
    const comVitoria = jogo.calcularRecompensa({ bet: 100, size: 5, encontrados: 3, total: 3 });
    assert.strictEqual(semVitoria.bonus, 0, 'sem bônus quando não completa');
    assert.strictEqual(comVitoria.bonus, Math.floor(100 * jogo.BONUS_VITORIA), 'bônus de vitória');
    assert.strictEqual(comVitoria.total - comVitoria.bonus, comVitoria.porTesouro * 3, 'soma = tesouros + bônus');
    ok('4: pagamento — valor por tesouro proporcional, bônus só na vitória');
  } catch (e) {
    fail('4: pagamento', e);
  }

  /* ------------------------- 5) carteira ----------------------------- */
  try {
    const caso = (entrada, esperado) => {
      const r = carteira.parseValor(entrada, { min: 1, max: 500 });
      assert.strictEqual(r.ok, false, `recusa "${entrada}"`);
      assert.strictEqual(r.motivo, carteira.MOTIVO[esperado], `motivo de "${entrada}"`);
    };
    caso('', 'VAZIO');
    caso('   ', 'VAZIO');
    caso('-5', 'NEGATIVO');
    caso('0', 'ZERO');
    caso('1,5', 'DECIMAL');
    caso('1.50', 'DECIMAL');
    caso('abc', 'MALFORMADO');
    caso('12a', 'MALFORMADO');
    caso('1e5', 'MALFORMADO');
    caso('Infinity', 'MALFORMADO');
    caso('999', 'ACIMA_LIMITE');
    assert.strictEqual(carteira.parseValor('1.000', { min: 1, max: 5000 }).valor, 1000, 'milhar com ponto');
    assert.strictEqual(carteira.parseValor(' 250 ', { min: 1, max: 5000 }).valor, 250, 'espaços');
    ok('5: valor da aposta — vazio/negativo/zero/decimal/malformado/limite e milhar');
  } catch (e) {
    fail('5: parseValor', e);
  }

  try {
    comCarteira(life, U, 1000);
    // acima do saldo × acima do teto têm motivos DIFERENTES
    const v = carteira.validarAposta(U, 1500, 'cacatesouro');
    assert.strictEqual(v.ok, false, 'recusa acima do saldo');
    assert.strictEqual(v.motivo, carteira.MOTIVO.ACIMA_SALDO, 'motivo = saldo insuficiente');
    assert.strictEqual(v.max, 1000, 'mostra o máximo permitido');
    assert.strictEqual(v.disponivel, 1000, 'mostra o disponível');
    // cobrança única pela MESMA ref
    const r1 = await carteira.cobrarAposta({ userId: U, game: 'cacatesouro', valor: 100, ref: 'ref-1', status: 'pending' });
    assert.strictEqual(r1.duplicado, false, 'primeira cobrança');
    const r2 = await carteira.cobrarAposta({ userId: U, game: 'cacatesouro', valor: 100, ref: 'ref-1', status: 'pending' });
    assert.strictEqual(r2.duplicado, true, 'mensagem repetida não cobra de novo');
    assert.strictEqual(economy.get(U).wallet, 900, 'cobrou UMA vez (1000 - 100)');
    // prêmio único
    const p1 = await carteira.pagarPremio(r1.id, 250);
    assert.strictEqual(p1.duplicado, false, 'primeiro pagamento');
    const p2 = await carteira.pagarPremio(r1.id, 250);
    assert.strictEqual(p2.duplicado, true, 'pagamento repetido não credita');
    assert.strictEqual(economy.get(U).wallet, 1150, '900 + 250 = 1150 (uma vez)');
    // nunca negativo
    await assert.rejects(
      () => carteira.cobrarAposta({ userId: U, game: 'tigrinho', valor: 999999, ref: 'ref-2' }),
      /saldo|ACIMA|insuficiente/i
    );
    assert.ok(economy.get(U).wallet >= 0, 'saldo nunca negativo');
    ok('6: carteira — acima do saldo, cobrança única por ref, prêmio único, sem saldo negativo');
  } catch (e) {
    fail('6: carteira', e);
  }

  try {
    // apostas SIMULTÂNEAS em jogos diferentes com saldo para UMA só
    const S = '5511777777777@s.whatsapp.net';
    comCarteira(life, S, 800);
    const resultados = await Promise.allSettled([
      Promise.resolve().then(() => carteira.cobrarAposta({ userId: S, game: 'cacatesouro', valor: 700, ref: 'sim-1', status: 'pending' })),
      Promise.resolve().then(() => carteira.cobrarAposta({ userId: S, game: 'tigrinho', valor: 700, ref: 'sim-2', status: 'pending' })),
    ]);
    const okCount = resultados.filter((r) => r.status === 'fulfilled').length;
    assert.strictEqual(okCount, 1, 'só uma aposta passa (saldo para uma)');
    assert.strictEqual(economy.get(S).wallet, 100, '800 - 700 = 100 (nunca negativo)');
    ok('7: apostas simultâneas caça + tigrinho — serializadas, sem saldo negativo');
  } catch (e) {
    fail('7: concorrência', e);
  }

  /* ------------- 8) pipeline real: painel, card e segredos ------------ */
  try {
    const ctx = fakeCtx({ args: [], msgId: 'PAINEL1' });
    await cmd.execute(ctx);
    assert.strictEqual(ctx.enviados.length, 1, 'enviou um card');
    const html = htmlDoEnvio(ctx.enviados[0]);
    assert.ok(/CAÇA AO TESOURO/.test(html), 'cabeçalho do jogo');
    assert.ok(/Saldo na carteira/.test(html) && /Máximo neste jogo/.test(html), 'painel de carteira no card');
    assert.ok(/Disponível para apostar/.test(html), 'disponível no card');
    assert.ok(/Valor da aposta/.test(html), 'campo de valor no card');
    assert.ok(/🪙/.test(html) || /LC/.test(html), 'moeda do projeto');
    // o card NÃO pode carregar o mapa verdadeiro nem sementes
    assert.ok(!/secret/i.test(html), 'sem campo secreto no card');
    assert.ok(!/seed|semente/i.test(html), 'sem semente no card');
    assert.ok(!/"t","t"/.test(html), 'sem lista de posições de tesouro');
    // e nada de rede (regra do card no aparelho)
    assert.ok(!/fetch\(|XMLHttpRequest|new WebSocket|<img|<iframe/.test(html), 'sem rede/recurso remoto');
    ok('8: painel no card — saldo/min/máx/valor lidos pelo bot, sem segredos e sem rede');
  } catch (e) {
    fail('8: painel', e);
  }

  try {
    // !modohtml off → fluxo textual equivalente (mesmos dados e ações)
    settings.setMenuHtmlEnabled(false);
    try {
      const ctx = fakeCtx({ args: [], msgId: 'PAINEL2' });
      await cmd.execute(ctx);
      assert.strictEqual(ctx.enviados.length, 0, 'modohtml off não envia card');
      const txt = ctx.replies.join('\n');
      assert.ok(/CAÇA AO TESOURO/.test(txt), 'texto com o título');
      assert.ok(/Saldo:/.test(txt), 'texto mostra o saldo');
      assert.ok(/Aposta mínima/.test(txt) && /máximo permitido agora/.test(txt), 'texto mostra mín/máx');
      assert.ok(/cacatesouro jogar 3 <valor>/.test(txt), 'texto traz o comando de aposta');
      assert.ok(/cacatesouro rapido/.test(txt), 'texto traz o jogo rápido');
      assert.ok(/vitória|Vitória/.test(txt) && /armadilha/i.test(txt), 'texto traz as regras (vitória/armadilha)');
    } finally {
      settings.setMenuHtmlEnabled(true);
    }
    assert.strictEqual(menuFormat.usarHtmlJogo().usar, true, 'modo de volta ao card');
    ok('9: !modohtml off — fluxo textual com os mesmos dados e o comando completo');
  } catch (e) {
    fail('9: modohtml off', e);
  }

  /* --------------- 10) aposta: cobrança, repetição, dono -------------- */
  let partidaId = null;
  try {
    const S = '5511666666666@s.whatsapp.net';
    comCarteira(life, S, 1000);
    const ctx = fakeCtx({ args: ['jogar', '3', '100'], sender: S, msgId: 'AP-1' });
    await cmd.execute(ctx);
    const linha = database.get().prepare('SELECT * FROM treasure_games WHERE user_id = ?').get(S);
    assert.ok(linha, 'expedição criada no banco');
    assert.strictEqual(linha.status, 'active', 'status ativa');
    assert.strictEqual(linha.bet, 100, 'aposta gravada');
    assert.strictEqual(linha.digs_total, jogo.configDoTabuleiro(3).escavacoes, 'escavações do 3×3');
    assert.strictEqual(economy.get(S).wallet, 900, 'cobrou 100');
    const bets = database.get().prepare('SELECT * FROM game_bets WHERE user_id = ?').all(S);
    assert.strictEqual(bets.length, 1, 'uma linha de aposta');
    partidaId = linha.id;

    // MESMA mensagem repetida → nem cobra, nem cria outra partida
    const ctx2 = fakeCtx({ args: ['jogar', '3', '100'], sender: S, msgId: 'AP-1' });
    await cmd.execute(ctx2);
    assert.strictEqual(economy.get(S).wallet, 900, 'mensagem repetida não cobrou de novo');
    assert.strictEqual(database.get().prepare('SELECT COUNT(*) c FROM treasure_games WHERE user_id = ?').get(S).c, 1, 'não criou partida nova');

    // nova tentativa com OUTRA mensagem e o jogo aberto → não cobra, avisa
    const ctx3 = fakeCtx({ args: ['jogar', '3', '50'], sender: S, msgId: 'AP-2' });
    await cmd.execute(ctx3);
    assert.strictEqual(economy.get(S).wallet, 900, 'expedição aberta não permite segunda aposta');
    assert.ok(ctx3.replies.some((r) => /já tem uma expedição aberta/i.test(r)), 'explica que já existe uma aberta');
    ok('10: aposta — cobrança única, mensagem repetida e expedição simultânea bloqueadas');
  } catch (e) {
    fail('10: aposta', e);
  }

  try {
    const S = '5511666666666@s.whatsapp.net';
    // dono, coordenada, repetição
    const outro = fakeCtx({ args: ['cavar', partidaId, 'A1'], sender: OUTRO, msgId: 'CV-OUTRO' });
    await cmd.execute(outro);
    assert.ok(outro.replies.some((r) => /outro jogador/i.test(r)), 'partida alheia recusada');
    assert.strictEqual(economy.get(OUTRO).wallet, 0, 'nada mexeu na carteira do outro');

    const fora = fakeCtx({ args: ['cavar', partidaId, 'Z9'], sender: S, msgId: 'CV-FORA' });
    await cmd.execute(fora);
    assert.ok(fora.replies.some((r) => /fora do mapa/i.test(r)), 'coordenada fora do mapa recusada');

    const casa = fakeCtx({ args: ['cavar', partidaId, 'A1'], sender: S, msgId: 'CV-1' });
    await cmd.execute(casa);
    let g = store.get(partidaId);
    assert.strictEqual(g.revealed.length, 1, 'uma casa revelada');
    assert.ok(g.digsUsed >= 1, 'gastou escavação');

    const repetida = fakeCtx({ args: ['cavar', partidaId, 'A1'], sender: S, msgId: 'CV-2' });
    await cmd.execute(repetida);
    const g2 = store.get(partidaId);
    assert.strictEqual(g2.revealed.length, 1, 'casa repetida não revela de novo');
    assert.strictEqual(g2.digsUsed, g.digsUsed, 'casa repetida não gasta escavação');
    assert.ok(repetida.replies.some((r) => /já foi escavada|já tinha sido processada/i.test(r)), 'avisa a repetição');

    const retransmitida = fakeCtx({ args: ['cavar', partidaId, 'A1'], sender: S, msgId: 'CV-1' });
    await cmd.execute(retransmitida);
    assert.strictEqual(store.get(partidaId).digsUsed, g.digsUsed, 'mensagem retransmitida não gasta de novo');
    ok('11: escavação — dono, coordenada, casa repetida e mensagem retransmitida');
  } catch (e) {
    fail('11: escavação', e);
  }

  /* --------------- 12) vitória completa + pagamento 1× ---------------- */
  try {
    const S = '5511555555555@s.whatsapp.net';
    comCarteira(life, S, 500);
    const ctx = fakeCtx({ args: ['jogar', '3', '100'], sender: S, msgId: 'WIN-1' });
    await cmd.execute(ctx);
    const g0 = store.ativaDo(S);
    const mapa = JSON.parse(database.get().prepare('SELECT secret FROM treasure_games WHERE id = ?').get(g0.id).secret);
    const tesouros = mapa.tesouros;
    const coord = (i) => jogo.coordDeIdx(i, g0.size);
    for (let k = 0; k < tesouros.length; k++) {
      const c = fakeCtx({ args: ['cavar', g0.id, coord(tesouros[k])], sender: S, msgId: 'WIN-' + (k + 2) });
      await cmd.execute(c);
    }
    const g = store.get(g0.id);
    assert.strictEqual(g.status, 'won', 'vitória com todos os tesouros');
    const esperado = jogo.calcularRecompensa({ bet: 100, size: 3, encontrados: g.treasuresFound, total: g.treasuresTotal });
    assert.strictEqual(g.reward, esperado.total, 'retorno gravado igual ao cálculo');
    assert.strictEqual(economy.get(S).wallet, 400 + esperado.total, 'saldo = 500-100+retorno');
    // mexer na partida encerrada não paga de novo
    const depois = fakeCtx({ args: ['cavar', g0.id, 'C3'], sender: S, msgId: 'WIN-9' });
    await cmd.execute(depois);
    assert.ok(depois.replies.some((r) => /já foi encerrada|acabaram/i.test(r)), 'partida encerrada recusa nova escavação');
    assert.strictEqual(economy.get(S).wallet, 400 + esperado.total, 'nada pagou duas vezes');
    ok('12: vitória — retorno calculado e creditado UMA vez; partida encerrada recusa ações');
  } catch (e) {
    fail('12: vitória', e);
  }

  /* ---------------------- 13) derrota (escavações) -------------------- */
  try {
    const S = '5511444444444@s.whatsapp.net';
    comCarteira(life, S, 300);
    const ctx = fakeCtx({ args: ['jogar', '3', '50'], sender: S, msgId: 'LOSE-1' });
    await cmd.execute(ctx);
    const g0 = store.ativaDo(S);
    const mapa = JSON.parse(database.get().prepare('SELECT secret FROM treasure_games WHERE id = ?').get(g0.id).secret);
    // escava só casas que NÃO são tesouro até esgotar
    const alvo = Array.from({ length: g0.size * g0.size }, (_, i) => i).filter(
      (i) => !mapa.tesouros.includes(i) && !mapa.armadilhas.includes(i)
    );
    let n = 0;
    for (const i of alvo) {
      const g = store.get(g0.id);
      if (g.status !== 'active') break;
      const c = fakeCtx({ args: ['cavar', g0.id, jogo.coordDeIdx(i, g0.size)], sender: S, msgId: 'L-' + n++ });
      await cmd.execute(c);
    }
    const g = store.get(g0.id);
    assert.strictEqual(g.status, 'lost', 'derrota ao esgotar as escavações');
    assert.strictEqual(g.treasuresFound, 0, 'não achou tesouro');
    assert.strictEqual(g.reward, 0, 'sem retorno com 0 tesouros');
    assert.strictEqual(economy.get(S).wallet, 250, 'perda determinada: 300 - 50, sem devolução');
    ok('13: derrota — escavações esgotadas, retorno 0 e aposta não devolvida');
  } catch (e) {
    fail('13: derrota', e);
  }

  /* ------------- 14) armadilha queima 2 escavações -------------------- */
  try {
    const S = '5511333333333@s.whatsapp.net';
    comCarteira(life, S, 1000);
    await cmd.execute(fakeCtx({ args: ['jogar', '13', '10'], sender: S, msgId: 'TRAP-1' }));
    const g0 = store.ativaDo(S);
    const mapa = JSON.parse(database.get().prepare('SELECT secret FROM treasure_games WHERE id = ?').get(g0.id).secret);
    const armadilha = mapa.armadilhas[0];
    await cmd.execute(fakeCtx({ args: ['cavar', g0.id, jogo.coordDeIdx(armadilha, g0.size)], sender: S, msgId: 'TRAP-2' }));
    const g = store.get(g0.id);
    assert.strictEqual(g.digsUsed, 2, 'armadilha queima 2 escavações');
    assert.strictEqual(g.revealed[0].k, 'a', 'armadilha revelada como armadilha');
    // 13×13 fica em 1s: uma expedição por vez, então encerra para os próximos testes
    await cmd.execute(fakeCtx({ args: ['sair'], sender: S, msgId: 'TRAP-3' }));
    ok('14: armadilha — queima uma escavação extra e fica registrada');
  } catch (e) {
    fail('14: armadilha', e);
  }

  /* --------- 15) saldo mudou entre abrir a tela e confirmar ----------- */
  try {
    const S = '5511222222222@s.whatsapp.net';
    comCarteira(life, S, 1000);
    const tela = fakeCtx({ args: [], sender: S, msgId: 'MUD-1' });
    await cmd.execute(tela);
    const html = card(tela);
    assert.ok(/1\.000/.test(html), 'card mostrou o saldo do momento (1.000)');
    // o saldo muda ANTES do comando chegar (outro comando, outro jogo...)
    economy.addWallet(S, -950);
    const ctx = fakeCtx({ args: ['jogar', '3', '900'], sender: S, msgId: 'MUD-2' });
    await cmd.execute(ctx);
    assert.strictEqual(economy.get(S).wallet, 50, 'nada foi cobrado');
    assert.strictEqual(store.ativaDo(S), null, 'nenhuma expedição aberta');
    assert.ok(ctx.replies.some((r) => /não aceita|insuficiente/i.test(r)), 'recusa explicando o motivo');
    assert.ok(ctx.replies.some((r) => /50/.test(r)), 'mostra o máximo permitido agora');
    // com valor válido para o novo saldo, aceita
    const ok2 = fakeCtx({ args: ['jogar', '3', '40'], sender: S, msgId: 'MUD-3' });
    await cmd.execute(ok2);
    assert.strictEqual(economy.get(S).wallet, 10, '50 - 40 = 10 (revalidado no servidor)');
    await cmd.execute(fakeCtx({ args: ['sair'], sender: S, msgId: 'MUD-4' }));
    ok('15: saldo revalidado na confirmação — recusa e nunca confia na tela');
  } catch (e) {
    fail('15: revalidação', e);
  }

  /* ------------------- 16) carteira vazia / sem cadastro -------------- */
  try {
    const V = '5511111111111@s.whatsapp.net';
    comCarteira(life, V, 0);
    const tela = fakeCtx({ args: [], sender: V, msgId: 'VAZIA-1' });
    await cmd.execute(tela);
    const html = card(tela);
    assert.ok(/saldo disponível é 0|Saldo disponível é 0/i.test(html), 'explica o saldo 0 real');
    assert.ok(/Saldo na carteira<\/span><b class="bp-v">—|🪙 0 LC/.test(html) || /0 LC/.test(html), 'mostra 0 (saldo real, não inventado)');
    const aposta = fakeCtx({ args: ['jogar', '3', '100'], sender: V, msgId: 'VAZIA-2' });
    await cmd.execute(aposta);
    assert.ok(aposta.replies.some((r) => /insuficiente|não aceita/i.test(r)), 'aposta recusada sem saldo');
    assert.strictEqual(economy.get(V).wallet, 0, 'saldo continua 0');

    // SEM cadastro → modo casual (sem carteira), e o painel explica como criar
    const N = '5511000000000@s.whatsapp.net';
    const semCad = fakeCtx({ args: [], sender: N, msgId: 'SEM-1' });
    await cmd.execute(semCad);
    const htmlN = card(semCad);
    assert.ok(/vida <nome>/.test(htmlN) || /vida/.test(htmlN), 'diz como criar o personagem');
    const casual = fakeCtx({ args: ['jogar', '3', 'casual'], sender: N, msgId: 'SEM-2' });
    await cmd.execute(casual);
    const gN = store.ativaDo(N);
    assert.ok(gN, 'expedição casual aberta');
    assert.strictEqual(gN.bet, 0, 'casual não aposta');
    assert.strictEqual(database.get().prepare('SELECT COUNT(*) c FROM game_bets WHERE user_id = ?').get(N).c, 0, 'casual não escreve no livro-caixa');
    assert.strictEqual(economy.get(N).wallet, 0, 'carteira intacta');
    await cmd.execute(fakeCtx({ args: ['sair'], sender: N, msgId: 'SEM-3' }));
    ok('16: carteira vazia (recusa) e sem cadastro (casual sem carteira)');
  } catch (e) {
    fail('16: vazia/sem cadastro', e);
  }

  /* --------------- 17) falha de consulta → "—", nunca 0 -------------- */
  try {
    const S = '5511999999998@s.whatsapp.net';
    comCarteira(life, S, 700);
    const life2 = require('../database/life');
    const original = life2.getPlayer;
    life2.getPlayer = () => {
      throw new Error('banco fora do ar');
    };
    const tela = fakeCtx({ args: [], sender: S, msgId: 'FALHA-1' });
    await cmd.execute(tela);
    const html = tela.enviados.length ? card(tela) : tela.replies.join('\n');
    assert.ok(/Não consegui consultar/i.test(html), 'avisa que não conseguiu consultar');
    assert.ok(!/🪙 0 LC/.test(html), 'NÃO mostra saldo 0 fictício');
    assert.ok(/data-indisponivel="1"|indisponível no momento|—/.test(html), 'marca o saldo como indisponível');
    const tentar = fakeCtx({ args: ['jogar', '3', '100'], sender: S, msgId: 'FALHA-2' });
    await cmd.execute(tentar);
    assert.strictEqual(store.ativaDo(S), null, 'não abriu expedição com a consulta falhando');
    assert.strictEqual(economy.get(S).wallet, 700, 'nada foi cobrado');
    assert.ok(tentar.replies.some((r) => /Tente de novo|Não consegui consultar/i.test(r)), 'pede nova tentativa');
    life2.getPlayer = original;
    // recuperado: agora abre normalmente
    const volta = fakeCtx({ args: ['jogar', '3', '100'], sender: S, msgId: 'FALHA-3' });
    await cmd.execute(volta);
    assert.ok(store.ativaDo(S), 'depois da falha, a nova tentativa funciona');
    await cmd.execute(fakeCtx({ args: ['sair'], sender: S, msgId: 'FALHA-4' }));
    ok('17: falha de consulta — saldo "—", sem 0 inventado, nada cobrado, retentativa funciona');
  } catch (e) {
    fail('17: falha de consulta', e);
  }

  /* ------------------ 18) sair, expirar, reiniciar -------------------- */
  try {
    const S = '5511977777777@s.whatsapp.net';
    comCarteira(life, S, 1000);
    await cmd.execute(fakeCtx({ args: ['jogar', '3', '100'], sender: S, msgId: 'SAIR-1' }));
    const g0 = store.ativaDo(S);
    // acha 1 tesouro para ter retorno parcial
    const mapa = JSON.parse(database.get().prepare('SELECT secret FROM treasure_games WHERE id = ?').get(g0.id).secret);
    const t = mapa.tesouros[0];
    await cmd.execute(fakeCtx({ args: ['cavar', g0.id, jogo.coordDeIdx(t, g0.size)], sender: S, msgId: 'SAIR-2' }));
    const antes = economy.get(S).wallet;
    const saida = fakeCtx({ args: ['sair'], sender: S, msgId: 'SAIR-3' });
    await cmd.execute(saida);
    const g = store.get(g0.id);
    const porTesouro = jogo.valorPorTesouro(100, 3);
    assert.strictEqual(g.status, 'closed', 'encerrada');
    assert.strictEqual(g.reward, porTesouro, 'retorno pelos tesouros achados (sem bônus)');
    assert.strictEqual(economy.get(S).wallet, antes + porTesouro, 'creditou o retorno parcial UMA vez');
    const saida2 = fakeCtx({ args: ['sair'], sender: S, msgId: 'SAIR-4' });
    await cmd.execute(saida2);
    assert.strictEqual(economy.get(S).wallet, antes + porTesouro, 'encerrar de novo não paga outra vez');
    assert.ok(saida2.replies.some((r) => /não tem expedição ativa|não encontrada|encerrada/i.test(r)), 'avisa que não há expedição ativa');

    // EXPIRAÇÃO: TTL estourado → status expirado, sem devolução e sem duplicar
    await cmd.execute(fakeCtx({ args: ['jogar', '3', '100'], sender: S, msgId: 'EXP-1' }));
    const gExp = store.ativaDo(S);
    const saldoAntes = economy.get(S).wallet;
    database
      .get()
      .prepare('UPDATE treasure_games SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 60000).toISOString(), gExp.id);
    const tela = fakeCtx({ args: [], sender: S, msgId: 'EXP-2' });
    await cmd.execute(tela);
    const gDepois = store.get(gExp.id);
    assert.strictEqual(gDepois.status, 'expired', 'expirou por inatividade');
    assert.strictEqual(economy.get(S).wallet, saldoAntes, 'expiração não devolve nem cobra');
    const bet = database.get().prepare('SELECT * FROM game_bets WHERE id = ?').get(`cacatesouro:${S}:${gExp.id}`);
    assert.strictEqual(bet.status, 'settled', 'livro-caixa fechado na expiração (sem pendência eterna)');
    // partida expirada recusa ação e o jogador pode abrir outra
    const acao = fakeCtx({ args: ['cavar', gExp.id, 'A1'], sender: S, msgId: 'EXP-3' });
    await cmd.execute(acao);
    assert.ok(acao.replies.some((r) => /expirou|encerrada/i.test(r)), 'partida expirada recusa escavação');
    await cmd.execute(fakeCtx({ args: ['jogar', '3', '50'], sender: S, msgId: 'EXP-4' }));
    assert.ok(store.ativaDo(S), 'nova expedição depois da expiração');
    ok('18: sair e expirar — retorno parcial 1×, sem devolução da aposta, sem ação em partida morta');
  } catch (e) {
    fail('18: sair/expirar', e);
  }

  try {
    // RECUPERAÇÃO após reiniciar: um PROCESSO NOVO lê o mesmo banco
    const S = '5511966666666@s.whatsapp.net';
    comCarteira(life, S, 1000);
    await cmd.execute(fakeCtx({ args: ['jogar', '5', '100'], sender: S, msgId: 'REST-1' }));
    const g0 = store.ativaDo(S);
    await cmd.execute(fakeCtx({ args: ['cavar', g0.id, 'B2'], sender: S, msgId: 'REST-2' }));
    const antes = store.get(g0.id);
    assert.strictEqual(antes.revealed.length, 1, 'uma casa escavada antes do reinício');

    const { execFileSync } = require('child_process');
    const script =
      `process.env.DATABASE_FILE=${JSON.stringify(DB)};` +
      `process.env.OWNER_NUMBER='5511999999999';` +
      `require('${process.cwd()}/database/database').open();` +
      `require('${process.cwd()}/commands/loader').loadCommands(true);` +
      `const s=require('${process.cwd()}/database/treasure');` +
      `const g=s.ativaDo(${JSON.stringify(S)});` +
      `console.log(JSON.stringify(g&&{id:g.id,revealed:g.revealed.length,digs:g.digsUsed,status:g.status,bet:g.bet}));`;
    const saida = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env: process.env });
    const json = JSON.parse(saida.trim().split('\n').pop());
    assert.strictEqual(json.id, g0.id, 'mesma partida depois do reinício');
    assert.strictEqual(json.revealed, 1, 'casas reveladas preservadas');
    assert.strictEqual(json.status, 'active', 'expedição continua ativa');
    assert.strictEqual(json.bet, 100, 'aposta preservada');

    const cont = fakeCtx({ args: ['continuar'], sender: S, msgId: 'REST-3' });
    await cmd.execute(cont);
    const html = card(cont);
    assert.ok(/B2/.test(html), 'tabuleiro mostra a casa já escavada (B2)');
    // e o jogador pode continuar escavando depois do reinício
    const depois = fakeCtx({ args: ['cavar', g0.id, 'C3'], sender: S, msgId: 'REST-4' });
    await cmd.execute(depois);
    assert.strictEqual(store.get(g0.id).revealed.length, 2, 'escavação nova depois do reinício');
    await cmd.execute(fakeCtx({ args: ['sair'], sender: S, msgId: 'REST-5' }));
    ok('19: recuperação pós-reinício (processo novo) — partida e escavações preservadas');
  } catch (e) {
    fail('19: reinício', e);
  }

  /* --------- 20) rapido (o antigo) e menus preservados ---------------- */
  try {
    // o loader invalida o cache a cada carga: o objeto do teste é o do REGISTRO
    const reg2 = require('../engine/plugins').registry;
    const c = reg2.getCommand('cacatesouro');
    assert.ok(c, 'caça ao tesouro registrado');
    assert.strictEqual(reg2.resolveTrigger('cacar'), c, 'trigger "cacar" resolve para o caça');
    assert.strictEqual(reg2.resolveTrigger('tesouro'), c, 'trigger "tesouro" resolve para o caça');
    assert.deepStrictEqual(c.commands, ['cacatesouro', 'cacar', 'tesouro'], 'os 3 comandos preservados');
    assert.deepStrictEqual(c.aliases, [], 'sem alias novo inventado');
    assert.strictEqual(c.category, 'games', 'categoria games (menu)');
    assert.ok(c.usage.length > 0 && c.description.length > 0, 'menu tem descrição/uso');
    assert.ok(!require('../engine/plugins').registry.skipped.length, 'nenhum comando foi descartado no registro');
    const ctx = fakeCtx({ args: ['rapido'], msgId: 'RAP-1' });
    await c.execute(ctx);
    assert.ok(ctx.replies.some((r) => /3 tentativas/i.test(r)), 'jogo rápido 3×3 preservado');
    // tigrinho continua no arquivo e categoria de sempre
    const tg = reg2.resolveTrigger('tigrinho');
    assert.strictEqual(tg.category, 'rpg', 'tigrinho segue em rpg');
    // o loader invalida o cache: compara o CONTEÚDO do registrado com os dois arquivos
    const rpgTig = require('../commands/rpg/tigrinho').find((c) => c.name === 'tigrinho');
    const gamesTig = require('../commands/games/tigrinho').find((c) => c.name === 'tigrinho');
    assert.strictEqual(tg.description, rpgTig.description, 'o tigrinho REGISTRADO é o de commands/rpg');
    assert.notStrictEqual(tg.description, gamesTig.description, 'o de commands/games segue sombreado');
    assert.strictEqual(tg.category, 'rpg', 'categoria rpg no menu');
    ok('20: jogo rápido e registro de comandos preservados (caça + tigrinho no menu)');
  } catch (e) {
    fail('20: registro', e);
  }

  /* ------------------- 21) jsdom: o cartão funciona ------------------- */
  let jsdom = null;
  try {
    jsdom = require('jsdom');
  } catch (_) {
    skip('21: cartão no jsdom', 'jsdom não instalado');
  }
  if (jsdom) {
    try {
      const S = '5511988888888@s.whatsapp.net';
      comCarteira(life, S, 1000);
      if (!store.ativaDo(S)) {
        await cmd.execute(fakeCtx({ args: ['jogar', '13', '100'], sender: S, msgId: 'JS-1' }));
      }
      const g = store.ativaDo(S);
      const cCont = fakeCtx({ args: ['continuar'], sender: S, msgId: 'JS-2' });
      await cmd.execute(cCont);
      const html = card(cCont);
      const dom = new jsdom.JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
      const doc = dom.window.document;
      // todas as casas do 13×13 existem no DOM (a janela só esconde)
      assert.strictEqual(doc.querySelectorAll('.tc').length, 13 * 13, '169 casas no DOM');
      assert.ok(doc.querySelectorAll('.tc.fechada').length > 0, 'casas fechadas clicáveis');
      // selecionar + escavar → comando completo copiado
      const casa = doc.querySelector('.tc.fechada[data-coord="G7"]');
      assert.ok(casa, 'casa G7 existe');
      casa.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.strictEqual(doc.getElementById('tb-sel-' + g.id).textContent, 'G7', 'seleção aparece');
      const go = doc.getElementById('tb-go-' + g.id);
      assert.strictEqual(go.disabled, false, 'botão Escavar habilitado com seleção');
      doc.getElementById('tb-escavar') || null;
      go.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const saida = doc.getElementById('tb-ult-' + g.id).textContent;
      assert.ok(new RegExp(`cacatesouro cavar ${g.id} G7`).test(saida), 'copiou o comando completo: ' + saida);
      // navegação: extremidades desativadas e rótulo da janela
      const jan = doc.getElementById('tb-jan-' + g.id);
      assert.strictEqual(jan.textContent, 'Colunas A–E · Linhas 1–5', 'janela inicial');
      const bl = doc.getElementById('tb-l-' + g.id);
      const br = doc.getElementById('tb-r-' + g.id);
      const bu = doc.getElementById('tb-u-' + g.id);
      const bd = doc.getElementById('tb-d-' + g.id);
      assert.strictEqual(bl.disabled, true, 'seta ← desativada no extremo');
      assert.strictEqual(bu.disabled, true, 'seta ↑ desativada no extremo');
      assert.strictEqual(br.disabled, false, 'seta → ativa');
      for (let i = 0; i < 20; i++) br.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.strictEqual(br.disabled, true, 'seta → desativada no outro extremo');
      assert.ok(/Colunas I–M/.test(jan.textContent), 'chega às últimas colunas: ' + jan.textContent);
      for (let i = 0; i < 20; i++) bd.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.ok(/Linhas 9–13/.test(jan.textContent), 'chega às últimas linhas: ' + jan.textContent);
      const m13 = doc.querySelector('.tc[data-coord="M13"]');
      assert.ok(m13 && m13.style.display !== 'none', 'M13 (canto oposto) visível na janela');
      // todas as casas alcançáveis: nenhuma ficou fora do mapa
      assert.strictEqual(doc.querySelectorAll('.tc[style*="display: none"], .tc[style*="display:none"]').length, 13 * 13 - 25, '25 casas visíveis por vez');
      ok('21: cartão (jsdom) — seleção, cópia do comando, setas nos extremos e janela 13×13');
    } catch (e) {
      fail('21: cartão jsdom', e);
    }

    try {
      const S = '5511988888888@s.whatsapp.net';
      const c = fakeCtx({ args: ['sair'], sender: S, msgId: 'JS-FIM' });
      await cmd.execute(c);
      const tela = fakeCtx({ args: ['7'], sender: S, msgId: 'JS-3' });
      await cmd.execute(tela);
      const dom = new jsdom.JSDOM(card(tela), { runScripts: 'dangerously', pretendToBeVisual: true });
      const doc = dom.window.document;
      const inp = doc.getElementById('bp-in-tesouro');
      const go = doc.getElementById('bp-go-tesouro');
      const erro = doc.getElementById('bp-erro-tesouro');
      const est = doc.getElementById('bp-est-tesouro');
      assert.strictEqual(go.disabled, true, 'confirmar desativado sem valor');
      assert.ok(/Informe um valor/i.test(erro.textContent), 'pede o valor');
      const digitar = (v) => {
        inp.value = v;
        inp.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      };
      digitar('0');
      assert.strictEqual(go.disabled, true, 'zero recusado na tela');
      assert.ok(/maior que zero/i.test(erro.textContent), 'explica o zero');
      digitar('1,5');
      assert.ok(/sem centavos/i.test(erro.textContent), 'recusa decimal na tela');
      digitar('99999999');
      assert.ok(/insuficiente|limite/i.test(erro.textContent), 'recusa acima do máximo');
      const disponivel = Number(doc.getElementById('bp-tesouro').getAttribute('data-disp'));
      digitar('100');
      assert.strictEqual(go.disabled, false, 'valor válido habilita');
      const esperado = (disponivel - 100).toLocaleString('pt-BR');
      assert.ok(
        /estimativa/i.test(est.textContent) && est.textContent.includes(esperado),
        `prévia do saldo pós-aposta (disponível ${disponivel} - 100 = ${esperado}): ${est.textContent}`
      );
      go.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const copiado = doc.getElementById('bp-cmd-tesouro').textContent;
      assert.ok(/cacatesouro jogar 7 100/.test(copiado), 'confirmar copia o comando: ' + copiado);
      ok('22: painel de aposta (jsdom) — validação, prévia e cópia do comando');
    } catch (e) {
      fail('22: painel jsdom', e);
    }
  }

  console.log(`\n${feitos} ✅ · ${falhas} ❌`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ erro fatal:', e);
  process.exit(1);
});
