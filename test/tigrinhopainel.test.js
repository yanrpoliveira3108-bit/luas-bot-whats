#!/usr/bin/env node
/**
 * test/tigrinhopainel.test.js — 🐯 TIGRINHO com o painel de carteira/aposta.
 *
 * O tigrinho NÃO foi recriado: continua o mesmo comando, com os mesmos
 * subcomandos e a mesma tabela de prêmios. O que este teste garante é a
 * integração financeira e a honestidade do card:
 *
 *  1) o card abre com a carteira REAL (saldo/disponível/mín/máx) e o campo de
 *     valor, e NÃO sorteia nada ao abrir (reabrir mostra o mesmo resultado)
 *  2) o resultado validado pelo bot é o que o card mostra (o HTML não decide)
 *  3) `!tigrinho jogar`: cobrança ÚNICA (idempotente pelo id da mensagem),
 *     prêmio creditado UMA vez, saldo/limites revalidados na hora
 *  4) mensagem repetida não gira de novo; giro em sequência cai no cooldown
 *  5) rodada pendente (queda no meio): conclui uma vez; rodada sem resultado
 *     devolve a aposta
 *  6) `!modohtml off` → texto com os MESMOS dados e comandos
 *  7) subcomandos antigos preservados (fichas/historico/ranking/ajuda)
 *  8) apostas simultâneas entre jogos (tigrinho + caça) não estouram o saldo
 *  9) [jsdom, opcional] painel valida/copia o comando e o botão de rever a
 *     rodada termina exatamente no resultado validado
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const { execFileSync } = require('child_process');

const DB = require('./dbtmp').tmpFile('lua-tigrinho-painel-test.db');

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

let chatsCriados = 0;
function fakeCtx(opts = {}) {
  const enviados = [];
  // cada ctx nasce num chat próprio: o tigrinho manda UM card por conversa
  // (quando o teste precisa repetir o MESMO chat, ele passa opts.remoteJid)
  chatsCriados++;
  const ctx = {
    enviados,
    socket: {
      user: { id: '5511977776666:3@s.whatsapp.net' },
      relayMessage: async (jid, message, o) => {
        enviados.push({ jid, message, o });
        return { key: { id: 'XYZ' } };
      },
    },
    remoteJid: opts.remoteJid || `12036300000000${String(chatsCriados).padStart(4, '0')}@g.us`,
    isGroup: true,
    prefix: '!',
    sender: opts.sender || '5511999999999@s.whatsapp.net',
    args: opts.args || [],
    command: opts.command || 'tigrinho',
    message: { key: { id: opts.msgId || 'T' + Math.random().toString(36).slice(2) } },
    replies: [],
    reply: async (m) => {
      ctx.replies.push(String(m));
      return {};
    },
  };
  return ctx;
}

function card(ctx) {
  if (!ctx.enviados.length) {
    throw new Error('nenhum card enviado; respostas: ' + ctx.replies.join(' | ').slice(0, 300));
  }
  const rich = ctx.enviados[0].message.botForwardedMessage.message.richResponseMessage;
  return JSON.parse(rich.unifiedResponse.data.toString('utf8')).sections[0].view_model.primitive.payload;
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

  const store = require('../database/tigrinho');
  const rounds = require('../database/gameRounds');
  const wallet = require('../utils/gameWallet');
  const economy = require('../database/economy');
  const settings = require('../database/settings');
  const menuFormat = require('../utils/menuFormat');
  const { registry } = require('../engine/plugins');
  const cmd = registry.getCommand('tigrinho');

  const U = '5511999999999@s.whatsapp.net';

  /* ------------- 1) abrir: carteira no card, sem sorteio -------------- */
  try {
    economy.setWallet(U, 1000);
    const mesmoChat = '120363000000000000@g.us'; // este teste repete o MESMO chat
    const ctx = fakeCtx({ args: [], msgId: 'OPEN-1', remoteJid: mesmoChat });
    await cmd.execute(ctx);
    const html = card(ctx);
    assert.ok(/LUA TIGRINHO/.test(html), 'card do tigrinho');
    assert.ok(/Saldo na carteira/.test(html) && /Disponível para apostar/.test(html), 'painel de carteira no card');
    assert.ok(/Valor da aposta/.test(html) && /Mínimo/.test(html) && /Máximo/.test(html), 'campo de valor com mín/máx');
    assert.ok(/Jogar agora/.test(html), 'botão de jogar (copia o comando) já na abertura');
    assert.ok(/value="100"/.test(html), 'a aposta padrão (100) já vem no campo — nunca o saldo todo');
    assert.ok(!/replay/.test(html), 'sem o botão de rever a rodada');
    assert.ok(/tigrinho jogar \{valor\}|tigrinho jogar &lt;valor&gt;/.test(html), 'comando do giro no card');
    assert.ok(/NENHUMA RODADA VALIDADA|ULTIMA RODADA VALIDADA|ÚLTIMA RODADA VALIDADA/.test(html), 'estado da rodada informado');
    assert.ok(/nada foi cobrado|Nada é cobrado/.test(html), 'deixa claro que abrir/consultar não cobra');
    // reabrir NA MESMA CONVERSA não manda outro HTML: responde em texto com os
    // mesmos dados (é a regra "um card por vez" — pedido do dono)
    const ctx2 = fakeCtx({ args: [], msgId: 'OPEN-2', remoteJid: mesmoChat });
    await cmd.execute(ctx2);
    assert.strictEqual(ctx2.enviados.length, 0, 'o segundo pedido não criou outro card');
    const txt2 = ctx2.replies.join('\n');
    assert.ok(/já está aberto acima/.test(txt2), 'explica que o card já está aberto acima');
    assert.ok(/Saldo/.test(txt2) && /Disponível para apostar/.test(txt2), 'o texto traz saldo e disponível');
    // e o card continua o mesmo (mesmos rolos do bot, sem sorteio no card)
    const reels = (h) => (h.match(/class="cell">([^<]+)</g) || []).join('|');
    assert.ok(reels(html).length > 0, 'o card aberto tem os rolos do último resultado validado');
    ok('1: card abre com a carteira real, sem sortear nada (e não duplica HTML na mesma conversa)');
  } catch (e) {
    fail('1: abrir', e);
  }

  /* ------------ 2) girar: cobrança única, prêmio único ---------------- */
  try {
    const antes = economy.get(U).wallet;
    const ctx = fakeCtx({ args: ['jogar', '100'], msgId: 'SPIN-1' });
    await cmd.execute(ctx);
    const txt = ctx.replies.join('\n');
    assert.ok(/Aposta:/.test(txt) && /Saldo:/.test(txt), 'resposta traz aposta e saldo');
    assert.ok(/Lucro líquido:/.test(txt), 'diferencia retorno e lucro líquido');
    const rodada = rounds.get(`tigrinho:${U}:SPIN-1`);
    assert.ok(rodada, 'rodada gravada com o id da aposta');
    assert.strictEqual(rodada.state, 'settled', 'rodada concluída');
    assert.strictEqual(rodada.bet, 100, 'aposta gravada');
    assert.ok(Array.isArray(rodada.payload.reels) && rodada.payload.reels.length === 5, 'resultado (5 rolos) guardado');
    const esperado = antes - 100 + rodada.reward;
    assert.strictEqual(economy.get(U).wallet, esperado, `saldo = ${antes} - 100 + ${rodada.reward}`);
    const p = store.getPlayer(U);
    assert.strictEqual(p.spins, 1, 'estatística contada UMA vez');
    assert.strictEqual(p.wins, rodada.reward > 0 ? 1 : 0, 'vitória contada conforme o resultado');

    // o card depois do giro mostra o resultado VALIDADO (mesmos rolos do banco)
    const ctxCard = fakeCtx({ args: [], msgId: 'OPEN-3' });
    await cmd.execute(ctxCard);
    const html = card(ctxCard);
    const rolos = rodada.payload.reels.map((col) => col[1]).join('');
    rolos.split('').length;
    for (const s of rodada.payload.reels.map((col) => col[1])) {
      assert.ok(html.includes(s), `o card mostra o símbolo validado ${s}`);
    }
    assert.ok(html.includes(String(economy.get(U).wallet)) || /SALDO/.test(html), 'card traz o saldo atualizado');
    ok('2: giro — cobrança única, prêmio único, estatística única e card com o resultado do bot');
  } catch (e) {
    fail('2: giro', e);
  }

  /* -------- 3) mensagem repetida e cooldown não duplicam giro --------- */
  try {
    const saldo = economy.get(U).wallet;
    const spins = store.getPlayer(U).spins;
    const repetida = fakeCtx({ args: ['jogar', '100'], msgId: 'SPIN-1' });
    await cmd.execute(repetida);
    assert.strictEqual(economy.get(U).wallet, saldo, 'mensagem repetida não cobrou nem pagou de novo');
    assert.strictEqual(store.getPlayer(U).spins, spins, 'mensagem repetida não contou estatística');
    assert.ok(repetida.replies.some((r) => /já (foi|tinha)|repetid/i.test(r)), 'avisa que o giro já era conhecido');

    const seguida = fakeCtx({ args: ['jogar', '100'], msgId: 'SPIN-2' });
    await cmd.execute(seguida);
    assert.strictEqual(economy.get(U).wallet, saldo, 'giro em sequência (cooldown) não movimentou nada');
    assert.ok(seguida.replies.some((r) => /Aguarde/i.test(r)), 'cooldown avisado');
    ok('3: mensagem repetida e cooldown — nenhum giro duplicado');
  } catch (e) {
    fail('3: repetição/cooldown', e);
  }

  /* ---------- 4) rodada pendente: conclui UMA vez --------------------- */
  try {
    const V = '5511911111111@s.whatsapp.net';
    economy.setWallet(V, 1000);
    // simula a queda: aposta cobrada + rodada gravada com resultado, sem pagamento
    const cobranca = await wallet.cobrarAposta({ userId: V, game: 'tigrinho', valor: 100, ref: 'QUEDA-1', status: 'pending' });
    await rounds.criar({
      id: cobranca.id,
      userId: V,
      game: 'tigrinho',
      bet: 100,
      reward: 250,
      payload: { reels: [['🐯'], ['🐯'], ['🐯'], ['🐯'], ['🐯']], jackpot: false, won: true, mult: 2.5 },
    });
    assert.strictEqual(economy.get(V).wallet, 900, 'aposta cobrada e rodada pendente');
    const ctx = fakeCtx({ args: [], sender: V, msgId: 'REC-1' });
    await cmd.execute(ctx);
    assert.strictEqual(economy.get(V).wallet, 1150, 'paga 250 UMA vez ao reabrir (900 + 250)');
    assert.strictEqual(rounds.get(cobranca.id).state, 'settled', 'rodada fechada');
    assert.strictEqual(store.getPlayer(V).spins, 1, 'estatística registrada UMA vez');
    // reabrir de novo NÃO paga outra vez
    const ctx2 = fakeCtx({ args: [], sender: V, msgId: 'REC-2' });
    await cmd.execute(ctx2);
    assert.strictEqual(economy.get(V).wallet, 1150, 'reabrir não paga de novo');
    assert.ok(ctx2.replies.length || ctx2.enviados.length, 'segunda abertura responde normalmente');
    ok('4: recuperação de rodada pendente — paga e registra uma vez só');
  } catch (e) {
    fail('4: recuperação', e);
  }

  /* ---------- 5) rodada pendente SEM resultado: devolve -------------- */
  try {
    const W = '5511922222222@s.whatsapp.net';
    economy.setWallet(W, 500);
    const cobranca = await wallet.cobrarAposta({ userId: W, game: 'tigrinho', valor: 100, ref: 'QUEDA-2', status: 'pending' });
    await rounds.criar({ id: cobranca.id, userId: W, game: 'tigrinho', bet: 100, reward: 0, payload: null });
    assert.strictEqual(economy.get(W).wallet, 400, 'aposta cobrada, rodada sem resultado');
    const ctx = fakeCtx({ args: [], sender: W, msgId: 'SEMRES-1' });
    await cmd.execute(ctx);
    assert.strictEqual(economy.get(W).wallet, 500, 'aposta DEVOLVIDA (não havia giro a concluir)');
    const r = rounds.get(cobranca.id);
    assert.strictEqual(r.state, 'settled', 'rodada fechada');
    assert.strictEqual(r.payload.devolvida, true, 'marcada como devolvida');
    assert.strictEqual(store.getPlayer(W).spins, 0, 'não conta giro que não houve');
    const txt = ctx.replies.join(' ') + card(ctx);
    assert.ok(/devolv|Completei|pendente/i.test(txt), 'explica a devolução');
    ok('5: rodada sem resultado — aposta devolvida e nada de estatística');
  } catch (e) {
    fail('5: sem resultado', e);
  }

  /* ---------------- 6) saldo insuficiente / sem saldo ---------------- */
  try {
    const Z = '5511933333333@s.whatsapp.net';
    economy.setWallet(Z, 50);
    const ctx = fakeCtx({ args: ['jogar', '999'], sender: Z, msgId: 'FUND-1' });
    await cmd.execute(ctx);
    assert.strictEqual(economy.get(Z).wallet, 50, 'nada cobrado');
    assert.strictEqual(rounds.pendente(Z, 'tigrinho'), null, 'nenhuma rodada criada');
    const txt = ctx.replies.join('\n');
    assert.ok(/não aceita|insuficiente/i.test(txt), 'recusa explica o motivo');
    assert.ok(/50/.test(txt), 'mostra o máximo permitido agora');
    ok('6: aposta acima do saldo — recusa com o motivo e sem movimentar nada');
  } catch (e) {
    fail('6: saldo insuficiente', e);
  }

  /* --------------- 7) !modohtml off → texto equivalente -------------- */
  try {
    settings.setMenuHtmlEnabled(false);
    try {
      const ctx = fakeCtx({ args: [], msgId: 'TXT-1' });
      await cmd.execute(ctx);
      assert.strictEqual(ctx.enviados.length, 0, 'modo desligado não envia card');
      const txt = ctx.replies.join('\n');
      assert.ok(/CARTEIRA E APOSTA/.test(txt), 'texto tem o painel');
      assert.ok(/Saldo:/.test(txt) && /Disponível/.test(txt), 'texto traz o saldo');
      assert.ok(/Aposta mínima/.test(txt) && /máxima agora/.test(txt), 'texto traz mín/máx');
      assert.ok(/tigrinho jogar <valor>/.test(txt), 'texto traz o comando do giro');
      assert.ok(/Última rodada validada|Nenhuma rodada validada/.test(txt), 'texto traz o estado da rodada');
    } finally {
      settings.setMenuHtmlEnabled(true);
    }
    ok('7: !modohtml off — fluxo textual com os mesmos dados e comandos');
  } catch (e) {
    fail('7: modohtml off', e);
  }

  /* ------------- 8) subcomandos antigos preservados ------------------ */
  try {
    assert.strictEqual(cmd.category, 'rpg', 'categoria rpg preservada');
    assert.deepStrictEqual(cmd.commands, ['tigrinho'], 'trigger preservado');
    assert.deepStrictEqual(cmd.aliases, [], 'sem alias novo');
    const casos = [
      [['fichas'], /SALDO|Saldo/],
      [['historico'], /HISTÓRICO|HISTORICO|ainda não girou/i],
      [['ranking'], /RANKING|vazio/i],
      [['ajuda'], /AJUDA|JACKPOT/],
      [['acelerar'], /AJUDA|JACKPOT/],
    ];
    // com o card desligado, `fichas` (/saldo) responde em TEXTO — nada se perde
    const antes = require('../utils/menuFormat');
    const md = require('../database/settings');
    md.setMenuHtmlEnabled(false);
    const ctxTxt = fakeCtx({ args: ['saldo'] });
    await cmd.execute(ctxTxt);
    assert.ok(/Saldo:/.test(ctxTxt.replies.join('\n')) && !ctxTxt.enviados.length, 'fichas/saldo em texto com o HTML desligado');
    assert.ok(/tigrinho jogar/.test(ctxTxt.replies.join('\n')), 'e ensina o comando de jogar');
    md.setMenuHtmlEnabled(true);
    assert.ok(antes.usarHtmlJogo().usar, 'modo HTML restaurado para os próximos testes');
    for (const [args, re] of casos) {
      const ctx = fakeCtx({ args });
      await cmd.execute(ctx);
      // `fichas`/`saldo` agora abre o card (saldo real + botão de jogar); os
      // demais continuam em texto — o teste aceita as duas formas
      const saida = ctx.enviados.length ? card(ctx) : ctx.replies.join('\n');
      assert.ok(re.test(saida), `!tigrinho ${args.join(' ')} responde`);
    }
    ok('8: subcomandos do tigrinho preservados (fichas/saldo em card, historico/ranking/ajuda em texto)');
  } catch (e) {
    fail('8: subcomandos', e);
  }

  /* ------- 9) apostas simultâneas entre jogos não estouram saldo ----- */
  try {
    const S = '5511944444444@s.whatsapp.net';
    economy.setWallet(S, 300);
    const cacatesouro = registry.getCommand('cacatesouro');
    const a = fakeCtx({ args: ['jogar', '3', '250'], sender: S, msgId: 'SIM-CACA' });
    const b = fakeCtx({ args: ['jogar', '250'], sender: S, msgId: 'SIM-TIG' });
    await Promise.all([cacatesouro.execute(a), cmd.execute(b)]);
    assert.ok(economy.get(S).wallet >= 0, 'saldo nunca negativo');
    const apostas = database.get().prepare('SELECT * FROM game_bets WHERE user_id = ?').all(S);
    assert.strictEqual(apostas.length, 1, 'só uma aposta foi registrada (a outra foi recusada)');
    assert.strictEqual(apostas[0].bet, 250, 'a aposta registrada é a de 250');
    const rodadas = database.get().prepare('SELECT * FROM game_rounds WHERE user_id = ?').all(S);
    const premio = rodadas.length ? rodadas[0].reward : 0;
    assert.strictEqual(
      economy.get(S).wallet,
      300 - 250 + premio,
      `300 - 250 + ${premio} (prêmio do giro que passou) = saldo íntegro`
    );
    ok('9: apostas simultâneas caça + tigrinho — uma só passa, saldo íntegro');
  } catch (e) {
    fail('9: simultâneas', e);
  }

  /* ------------------ 10) jsdom: painel + rever rodada --------------- */
  let jsdom = null;
  try {
    jsdom = require('jsdom');
  } catch (_) {
    skip('10: card no jsdom', 'jsdom não instalado');
  }
  if (jsdom) {
    try {
      const J = '5511955555555@s.whatsapp.net';
      economy.setWallet(J, 800);
      // um giro real para ter resultado validado
      const girar = fakeCtx({ args: ['jogar', '200'], sender: J, msgId: 'JS-SPIN' });
      await cmd.execute(girar);
      const rodada = rounds.get(`tigrinho:${J}:JS-SPIN`);
      const ctx = fakeCtx({ args: [], sender: J, msgId: 'JS-OPEN' });
      await cmd.execute(ctx);
      const dom = new jsdom.JSDOM(card(ctx), { runScripts: 'dangerously', pretendToBeVisual: true });
      const win = dom.window;
      const doc = win.document;
      // o card entrega o resultado VALIDADO (nada de prêmio calculado no HTML)
      // atençao: arrays criados dentro do jsdom são de outro "realm" — comparar por valor
      const resultado = win.__tigrinho.resultado();
      assert.strictEqual(resultado.reward, rodada.reward, 'prêmio do card = prêmio validado pelo bot');
      assert.strictEqual(resultado.bet, 200, 'aposta do card = aposta cobrada');
      assert.strictEqual(
        JSON.stringify(resultado.reels.map((c) => c[1])),
        JSON.stringify(rodada.payload.reels.map((c) => c[1])),
        'rolos do card = rolos validados'
      );
      // painel: validação e cópia do comando do giro
      const inp = doc.getElementById('bp-in-tigrinho');
      const go = doc.getElementById('bp-go-tigrinho');
      const erro = doc.getElementById('bp-erro-tigrinho');
      assert.ok(inp && go, 'painel presente no card');
      const digitar = (v) => {
        inp.value = v;
        inp.dispatchEvent(new win.Event('input', { bubbles: true }));
      };
      digitar('-10');
      assert.strictEqual(go.disabled, true, 'negativo recusado na tela');
      assert.ok(/negativo/i.test(erro.textContent), 'explica o negativo');
      digitar('0');
      assert.ok(/maior que zero/i.test(erro.textContent), 'explica o zero');
      digitar('1,5');
      assert.ok(/centavos/i.test(erro.textContent), 'explica os centavos');
      digitar('9999999');
      assert.ok(/insuficiente|limite/i.test(erro.textContent), 'explica o limite/saldo');
      digitar('150');
      assert.strictEqual(go.disabled, false, 'valor válido habilita');
      go.dispatchEvent(new win.Event('click', { bubbles: true }));
      assert.ok(/tigrinho jogar 150/.test(doc.getElementById('bp-cmd-tigrinho').textContent), 'copia o comando do giro');
      // botão de JOGAR (o "rever a última rodada" saiu a pedido do dono)
      assert.strictEqual(doc.getElementById('replay'), null, 'o botão de rever a rodada não existe mais');
      assert.ok(/Jogar agora/i.test(go.textContent), 'o botão do painel é o de jogar');
      assert.ok(/ULTIMO RESULTADO VALIDADO/i.test(doc.getElementById('rodada').textContent), 'a faixa mostra o último resultado validado');
      ok('10: card no jsdom — painel valida/copia e o card mostra o resultado do bot');
    } catch (e) {
      fail('10: jsdom', e);
    }

    try {
      // sem rodada validada o botão fica desativado (não inventa giro)
      const N = '5511966666666@s.whatsapp.net';
      economy.setWallet(N, 500);
      const ctx = fakeCtx({ args: [], sender: N, msgId: 'JS-EMPTY' });
      await cmd.execute(ctx);
      const dom = new jsdom.JSDOM(card(ctx), { runScripts: 'dangerously', pretendToBeVisual: true });
      const doc = dom.window.document;
      assert.strictEqual(doc.getElementById('replay'), null, 'sem botão de rever');
      assert.ok(/NENHUMA RODADA VALIDADA/i.test(doc.getElementById('status').textContent), 'diz o que falta');
      const inp0 = doc.getElementById('bp-in-tigrinho');
      const go0 = doc.getElementById('bp-go-tigrinho');
      assert.strictEqual(inp0.value, '100', 'a aposta PADRÃO já vem preenchida (nunca o saldo todo)');
      assert.strictEqual(go0.disabled, false, 'o botão de jogar já está pronto para o toque');
      ok('11: sem rodada validada — o card não finge girar, mostra o que falta e já deixa o jogar pronto');
    } catch (e) {
      fail('11: jsdom vazio', e);
    }
  }

  /* ---------------- 12) reinício não apaga rodada -------------------- */
  try {
    const R = '5511977777777@s.whatsapp.net';
    economy.setWallet(R, 600);
    await cmd.execute(fakeCtx({ args: ['jogar', '100'], sender: R, msgId: 'REST-TIG' }));
    const saldo = economy.get(R).wallet;
    const spins = store.getPlayer(R).spins;
    const script =
      `process.env.DATABASE_FILE=${JSON.stringify(DB)};` +
      `process.env.OWNER_NUMBER='5511999999999';` +
      `require('${process.cwd()}/database/database').open();` +
      `require('${process.cwd()}/commands/loader').loadCommands(true);` +
      `const s=require('${process.cwd()}/database/tigrinho');` +
      `const r=require('${process.cwd()}/database/gameRounds');` +
      `const w=require('${process.cwd()}/utils/gameWallet');` +
      `console.log(JSON.stringify({saldo:w.saldo(${JSON.stringify(R)}).wallet,spins:s.getPlayer(${JSON.stringify(
        R
      )}).spins,ultima:!!r.ultima(${JSON.stringify(R)},'tigrinho')}));`;
    const saida = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env: process.env });
    const json = JSON.parse(saida.trim().split('\n').pop());
    assert.strictEqual(json.saldo, saldo, 'saldo preservado depois do reinício');
    assert.strictEqual(json.spins, spins, 'estatística preservada');
    assert.strictEqual(json.ultima, true, 'rodada validada continua disponível para o card');
    ok('12: reinício — rodada, saldo e estatística continuam no banco');
  } catch (e) {
    fail('12: reinício', e);
  }

  /* ---------- 13) card sem altura fixa: o botão de girar nunca é cortado ---------- */
  try {
    const M = '5511955550001@s.whatsapp.net';
    economy.setWallet(M, 400);
    const ctx = fakeCtx({ args: [], sender: M, msgId: 'MOLD-TIG' });
    await cmd.execute(ctx);
    const html = card(ctx);
    assert.ok(!/html,body\{[^}]*height:\d+px/.test(html), 'sem altura fixa (medido no aparelho: cortava o botão de girar)');
    assert.ok(!/id="__wrap"/.test(html), 'sem contêiner de altura cheia');
    assert.ok(/overflow-x:hidden/.test(html), 'moldura livre (cresce com o conteúdo)');
    assert.ok(/id="lua-medida"/.test(html), 'tem o diagnóstico de área (toque no cabeçalho)');
    assert.ok(/<details class="paytable"/.test(html), 'tabela de prêmios recolhida (card mais curto)');
    assert.ok(/height:34px/.test(html), 'rolos mais compactos');
    const corpo = html.slice(html.indexOf('<body'), html.indexOf('<script>'));
    const iMaq = corpo.indexOf('machine');
    const iPainel = corpo.indexOf('bp-');
    const iPay = corpo.indexOf('paytable');
    assert.ok(iMaq > 0 && iPainel > iMaq && iPainel < iPay, 'ordem: máquina → painel (botão girar) → paytable');
    assert.ok(/<details class="bp-mais"><summary>💼 Carteira e limites/.test(html), 'painel compacto: carteira detalhada a um toque');
    ['Saldo na carteira', 'Disponível para apostar', 'Aposta mínima', 'Máximo neste jogo'].forEach((t) =>
      assert.ok(html.includes(t), `o painel do tigrinho ainda mostra "${t}"`)
    );
    assert.ok(/data-pct="100"/.test(html), 'o atalho Máx continua no card (aposta pré-selecionada nunca é o saldo todo)');
    const iCampoT = html.indexOf('bp-lbl');
    const iBtnsT = html.indexOf('bp-btns');
    const iDetT = html.indexOf('<details class="bp-mais"');
    assert.ok(iCampoT > 0 && iCampoT < iBtnsT && iBtnsT < iDetT, 'no card: valor → botões (girar) → detalhes da carteira');
    const aberturas = (html.match(/<div/g) || []).length;
    const fechamentos = (html.match(/<\/div>/g) || []).length;
    assert.strictEqual(aberturas, fechamentos, 'divs balanceadas');
    assert.ok(/<style>/.test(html) && /<\/style>/.test(html), 'CSS dentro de <style>');
    ok('13: card do tigrinho cresce com o conteúdo — botão de girar antes da paytable, sem corte');
  } catch (e) {
    fail('13: moldura', e);
  }

  /* ---- 14) UM card por conversa: `tigrinho saldo` abre e já dá para girar ----
   * Pedido do dono: "quero que rode tigrinho saldo, mostre valor a adicionar e
   * já possa girar, não criar vários html". Aqui: o card aparece no `saldo` (com
   * o valor já preenchido e o botão de girar), o GIRO responde em texto (sem
   * card novo) e pedir o saldo de novo na mesma conversa responde em texto. */
  try {
    const V = '5511933330001@s.whatsapp.net';
    economy.setWallet(V, 900);
    const conversa = '120363000000999999@g.us';

    const abertura = fakeCtx({ args: ['saldo'], msgId: 'UM-1', sender: V, remoteJid: conversa });
    await cmd.execute(abertura);
    const html = card(abertura);
    assert.ok(/value="100"/.test(html), 'o card do saldo já vem com o VALOR preenchido (o que ele adiciona)');
    assert.ok(/Jogar agora/.test(html), 'e com o botão de girar pronto');
    assert.ok(/bp-go/.test(html), 'botão de girar presente no painel');

    const giro = fakeCtx({ args: ['jogar', '100'], msgId: 'UM-2', sender: V, remoteJid: conversa });
    await cmd.execute(giro);
    assert.strictEqual(giro.enviados.length, 0, 'o GIRO não manda card novo (só o card da carteira existe)');
    const txt = giro.replies.join('\n');
    assert.ok(/LUA TIGRINHO/.test(txt) && /Saldo:/.test(txt), 'o resultado sai em texto, com o saldo');

    const denovo = fakeCtx({ args: ['saldo'], msgId: 'UM-3', sender: V, remoteJid: conversa });
    await cmd.execute(denovo);
    assert.strictEqual(denovo.enviados.length, 0, 'pedir o saldo de novo na mesma conversa não cria outro HTML');
    assert.ok(/já está aberto acima/.test(denovo.replies.join('\n')), 'diz onde está o card e o que fazer');
    assert.ok(/Saldo/.test(denovo.replies.join('\n')), 'e mesmo assim informa o saldo no texto');

    const outra = fakeCtx({ args: ['saldo'], msgId: 'UM-4', sender: V, remoteJid: '120363000000888888@g.us' });
    await cmd.execute(outra);
    assert.strictEqual(outra.enviados.length, 1, 'em outra conversa o card sai normalmente');
    ok('14: `tigrinho saldo` abre o card com valor e botão; giro e pedidos repetidos não criam vários HTML');
  } catch (e) {
    fail('14: um card por conversa', e);
  }

  console.log(`\n${feitos} ✅ · ${falhas} ❌`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ erro fatal:', e);
  process.exit(1);
});
