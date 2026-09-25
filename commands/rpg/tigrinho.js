/**
 * commands/rpg/tigrinho.js — 🐯 LUA TIGRINHO (caça-níquel).
 *
 * Caça-níquel de 5 rolos × 3 linhas jogado com os MESMOS LuaCoins (LC) da
 * carteira RPG — mesma moeda do cassino, cripto e investimentos. Sem economia
 * paralela, sem dinheiro real, sem compra/venda/saque/conversão.
 *
 * Arquitetura (padrão do Lua, sem reescrever nada):
 *   - lógica pura  → utils/tigrinhoGame.js   (config, pesos, resultado)
 *   - storage      → database/tigrinho.js    (estatísticas + carteira RPG)
 *   - interface    → este arquivo            (HTML visual + fallback textual)
 *   - envio HTML   → utils/richHtml.js       (relayMessage, padrão cobrinha.js)
 *
 * O resultado é SEMPRE calculado no backend (spinReels/computeReward). O
 * dinheiro anda pela camada financeira COMPARTILHADA com o caça ao tesouro
 * (utils/gameWallet): a aposta é cobrada UMA vez (idempotente pelo id da
 * mensagem/rodada), o prêmio é creditado UMA vez e o livro-caixa (`game_bets`)
 * registra cada movimentação. Estatísticas/histórico continuam no
 * database/tigrinho.js.
 *
 * O CARD mostra a carteira (painel compartilhado) e o resultado JÁ VALIDADO da
 * última rodada: a animação dos rolos é só apresentação — o HTML nunca sorteia
 * nem decide prêmio. Para girar de verdade, o card copia o comando
 * `{prefix}tigrinho jogar <valor>` e o bot processa (revalidando tudo).
 *
 * Comandos:
 *   {prefix}tigrinho                        → interface visual
 *   {prefix}tigrinho jogar [aposta|tudo]    → girar valendo LC (backend)
 *   {prefix}tigrinho saldo (fichas)         → card com o saldo real + botão de jogar
 *   {prefix}tigrinho jogar <valor>          → gira: o BOT cobra, sorteia e paga
 *   {prefix}tigrinho historico              → últimos giros
 *   {prefix}tigrinho ranking                → melhores jogadores
 *   {prefix}tigrinho ajuda                  → regras e prêmios
 */

'use strict';

const CONFIG = require('../../config');
const {
  TIGRINHO_CONFIG,
  spinReels,
  computeReward,
  renderGridText,
  formatChips,
} = require('../../utils/tigrinhoGame');
const store = require('../../database/tigrinho');
const rounds = require('../../database/gameRounds');
const wallet = require('../../utils/gameWallet');
const betPanel = require('../../utils/betPanel');
// mesma moldura do card do menu: altura FIXA em px, página que não rola
const moldura = require('../../menus/html/moldura');
const richHtml = require('../../utils/richHtml');
const menuFormat = require('../../utils/menuFormat');
const { formatMoney } = require('../../utils/formatter');
const logger = require('../../utils/logger').child('tigrinho');

logger.info('[LUA TIGRINHO] Plugin carregado');

const SUBCMD = {
  jogar: ['jogar', 'girar', 'spin', 'play', 'rodar'],
  fichas: ['fichas', 'saldo', 'balance', 'chips', 'creditos'],
  historico: ['historico', 'history', 'hist', 'giros'],
  ranking: ['ranking', 'rank', 'top'],
  ajuda: ['ajuda', 'help', 'regras', 'como'],
};

function subcommand(ctx) {
  const a = String(ctx.args[0] || '').toLowerCase().trim();
  for (const [key, aliases] of Object.entries(SUBCMD)) {
    if (aliases.includes(a)) return key;
  }
  return a; // '' ou desconhecido
}

/* ------------------------------------------------------------------ */
/*  Interface visual (HTML) — caça-níquel premium de 5 rolos           */
/* ------------------------------------------------------------------ */

/**
 * Card do tigrinho: máquina + PAINEL DE CARTEIRA/APOSTA compartilhado
 * (utils/betPanel.js — o mesmo do caça ao tesouro) + o resultado JÁ VALIDADO.
 *
 * @param {object} o
 * @param {number} o.balance        saldo REAL (lido pelo bot)
 * @param {number} o.jackpots       estatística
 * @param {string} o.coin           emoji da moeda
 * @param {string} o.prefix         prefixo real do bot
 * @param {object} o.painel         { css, markup, js } do betPanel
 * @param {object|null} o.ultima    última rodada validada { reels, bet, reward, jackpot, mult }
 * @param {object|null} o.recuperada rodada concluída agora (se houve)
 * @param {string} o.aviso          aviso extra (sem saldo, falha de consulta)
 */
function buildMachineHtml({ balance, jackpots, coin, prefix, painel, ultima, recuperada, aviso }) {
  // balance null = consulta falhou: mostra "—", nunca 0 inventado
  const b = balance === null || balance === undefined ? null : Number(balance) || 0;
  const j = Number(jackpots) || 0;
  const coinEmoji = coin || '🪙';

  // rolos iniciais = RESULTADO VALIDADO (nunca sorteio no card)
  const vazio = ['🍒', '🔔', '👑'];
  const rolos = [];
  for (let c = 0; c < 5; c++) {
    const col = ultima && Array.isArray(ultima.reels) && ultima.reels[c] ? ultima.reels[c] : vazio;
    const meio = col[1] !== undefined ? col[1] : col[0];
    rolos.push([col[0] || vazio[0], meio || vazio[1], col[2] || vazio[2]]);
  }
  const reelsHtml = rolos
    .map(
      (col, i) =>
        `<div class="reel" id="reel${i}">` +
        col.map((sym) => `<div class="cell">${betPanel.esc(sym)}</div>`).join('') +
        '</div>'
    )
    .join('\n');

  const textoResultado = ultima
    ? `ULTIMA RODADA VALIDADA · aposta ${betPanel.valor(ultima.bet)} · ` +
      (ultima.jackpot
        ? `JACKPOT +${betPanel.valor(ultima.reward)}`
        : ultima.reward > 0
          ? `ganhou +${betPanel.valor(ultima.reward)}${ultima.mult ? ` (x${ultima.mult})` : ''}`
          : 'nao ganhou · 0')
    : 'NENHUMA RODADA VALIDADA AINDA — escolha o valor e envie o comando';

  // resultado validado em JSON — o JS do card só LÊ isto, nunca calcula prêmio
  const resultadoJson = JSON.stringify(
    ultima
      ? {
          reels: rolos,
          reward: Number(ultima.reward) || 0,
          bet: Number(ultima.bet) || 0,
          jackpot: !!ultima.jackpot,
          won: (Number(ultima.reward) || 0) > 0,
          mult: ultima.mult || 0,
        }
      : null
  );

  const css =
    `*{-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;box-sizing:border-box}\n` +
    `body{margin:0;background:transparent;font-family:Arial,sans-serif;color:#f6d77a;touch-action:manipulation}\n` +
    // SEM altura fixa e SEM corte (medido no aparelho em 25/09: com
    // height:640px o botão de girar ficava fora da área visível)
    `.wrap{width:100%;max-width:560px;margin:auto;padding:10px}\n` +
    `.card{position:relative;background:linear-gradient(165deg,#180902,#2a0d04 40%,#120602);border:1px solid rgba(255,190,60,.5);border-radius:20px;overflow:hidden;box-shadow:0 0 44px rgba(255,150,20,.25),0 12px 36px rgba(0,0,0,.65)}\n` +
    `.marquee{overflow:hidden;background:linear-gradient(90deg,#8b0000,#c02800 50%,#8b0000);border-bottom:1px solid rgba(255,190,60,.5);white-space:nowrap;padding:5px 0}\n` +
    `.marquee span{display:inline-block;padding-left:100%;animation:scroll 14s linear infinite;font-size:10px;letter-spacing:2px;color:#ffd86b;font-weight:bold}\n` +
    `@keyframes scroll{0%{transform:translateX(0)}100%{transform:translateX(-100%)}}\n` +
    `.head{padding:14px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px;background:linear-gradient(135deg,rgba(139,0,0,.5),rgba(255,190,60,.08))}\n` +
    `.brand{display:flex;align-items:center;gap:8px}\n` +
    `.tiger{font-size:30px;filter:drop-shadow(0 0 10px rgba(255,170,30,.7));animation:pulse 2s ease-in-out infinite}\n` +
    `@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}\n` +
    `.brand .tt{font-size:16px;font-weight:bold;color:#ffc63c;letter-spacing:1px}\n` +
    `.stats{display:flex;gap:14px;text-align:right}\n` +
    `.value{font:700 17px monospace;color:#ffd54a}\n` +
    `.label{font-size:8px;color:rgba(255,196,60,.65);letter-spacing:1px;text-transform:uppercase}\n` +
    `.main{padding:10px 12px 8px}\n` +
    `.machine{position:relative;background:radial-gradient(130% 130% at 50% -10%,rgba(139,0,0,.45),rgba(0,0,0,.8));border:2px solid rgba(255,190,60,.55);border-radius:16px;padding:10px 8px 8px;margin-bottom:8px;box-shadow:inset 0 0 30px rgba(139,0,0,.4)}\n` +
    `.payline{display:flex;justify-content:center;gap:8px;margin-bottom:8px}\n` +
    `.payline i{width:38px;text-align:center;font-style:normal;color:#ffb830;font-size:9px;letter-spacing:1px;opacity:.8}\n` +
    `.reels{display:flex;gap:6px;justify-content:center}\n` +
    `.reel{flex:1;max-width:64px;background:rgba(0,0,0,.6);border:1px solid rgba(255,190,60,.4);border-radius:10px;padding:4px 0;box-shadow:inset 0 0 14px rgba(0,0,0,.7);overflow:hidden}\n` +
    `.cell{height:34px;display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1;transition:none}\n` +
    `.reel.spinning .cell{filter:blur(1.2px)}\n` +
    `.machine.win .reels{animation:winGlow .55s ease 3}\n` +
    `.machine.jackpot .reels{animation:jackGlow .45s ease 5}\n` +
    `@keyframes winGlow{0%,100%{box-shadow:0 0 0 rgba(255,210,60,0)}50%{box-shadow:0 0 36px rgba(255,210,60,.7)}}\n` +
    `@keyframes jackGlow{0%,100%{box-shadow:0 0 0 rgba(255,120,20,0);transform:scale(1)}50%{box-shadow:0 0 52px rgba(255,150,20,.95);transform:scale(1.03)}}\n` +
    `.rodada{width:100%;min-height:44px;display:flex;align-items:center;justify-content:center;border:1px dashed rgba(255,190,60,.55);border-radius:12px;color:#ffd86b;font-weight:bold;font-size:13px;background:rgba(0,0,0,.35);padding:6px 8px;text-align:center}\n` +
    `.status{text-align:center;font:10px monospace;color:rgba(255,196,60,.85);margin-top:12px;min-height:12px;letter-spacing:.4px}\n` +
    `.paytable{padding:8px 14px;border-top:1px dashed rgba(255,190,60,.25);background:rgba(0,0,0,.35);font-size:11px}\n` +
    `.paytable summary{cursor:pointer;list-style:none}\n` +
    `.paytable .pt{font-size:9px;letter-spacing:1.2px;color:rgba(255,196,60,.75);text-transform:uppercase;margin-bottom:4px}\n` +
    `.paytable .rows{display:flex;flex-wrap:wrap;gap:4px 12px}\n` +
    `.paytable .r{font-size:11px;color:#ffe9ad}\n` +
    `.foot{padding:10px 16px;border-top:1px solid rgba(255,190,60,.2);font-size:10px;color:rgba(255,196,60,.7);text-align:center;background:rgba(0,0,0,.4)}\n` +
    `.foot b{color:#ffc63c}\n` +
    `.foot code{color:#ffd86b;font-weight:bold;word-break:break-all}\n` +
    `.aviso{margin:10px 0 0;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,120,60,.5);background:rgba(139,0,0,.35);color:#ffd7a8;font-size:11px}\n` +
    `@media (prefers-reduced-motion: reduce){.marquee span,.tiger{animation:none!important}.machine,.machine *{animation:none!important;transition:none!important}}\n`;

  const html =
    '<body><div class="wrap"><div class="card">' +
    `<div class="marquee"><span>✦ LUA TIGRINHO ✦ VALENDO ${coinEmoji} ✦ O RESULTADO VEM DO BOT ✦ LUA TIGRINHO ✦ VALENDO ${coinEmoji} ✦</span></div>` +
    '<div class="head" title="Toque aqui para ver a área do card">' +
    '<div class="brand"><div class="tiger">🐯</div><div><div class="tt">LUA TIGRINHO</div></div></div>' +
    `<div class="stats"><div><div class="label">SALDO</div><div class="value" id="chips">${b === null ? '—' : b}</div></div>` +
    `<div><div class="label">JACKPOTS</div><div class="value" id="jackpots">${j}</div></div></div></div>` +
    moldura.htmlMedida() +
    '<div class="main"><div class="machine" id="machine">' +
    '<div class="payline"><i>1</i><i>2</i><i>3</i><i>4</i><i>5</i></div>' +
    `<div class="reels">${reelsHtml}</div></div>` +
    `<div class="rodada" id="rodada">${betPanel.esc(ultima ? '🎬 ÚLTIMO RESULTADO VALIDADO (do bot)' : '🎰 NENHUMA RODADA AINDA — ESCOLHA O VALOR E TOQUE EM JOGAR')}</div>` +
    `<div class="status" id="status">${betPanel.esc(textoResultado)}</div>` +
    (aviso ? `<div class="aviso">⚠️ ${betPanel.esc(aviso)}</div>` : '') +
    (recuperada
      ? `<div class="aviso">♻️ ${
          recuperada.devolvida
            ? 'Uma rodada ficou sem resultado registrado — devolvi a aposta de ' + betPanel.valor(recuperada.bet)
            : 'Concluí uma rodada que estava pendente: aposta ' +
              betPanel.valor(recuperada.bet) +
              ' · prêmio ' +
              betPanel.valor(recuperada.reward)
        }.</div>`
      : '') +
    '</div>' +
    (painel ? painel.markup : '') +
    '<details class="paytable"><summary class="pt">Tabela de premios (toque para abrir)</summary><div class="rows">' +
    '<div class="r">🐯×5 <b>425x</b></div><div class="r">👑×5 <b>130x</b></div><div class="r">💎×5 <b>65x</b></div>' +
    '<div class="r">🔔×5 <b>32x</b></div><div class="r">🍒×5 <b>16x</b></div><div class="r">🍊×5 <b>16x</b></div>' +
    '<div class="r">🍋×5 <b>12x</b></div><div class="r">3/4 iguais <b>menor</b></div><div class="r">2 iguais <b>0,2x</b></div>' +
    '</div></details>' +
    '<div class="foot">O bot decide aposta, sorteio e prêmio: <code>' +
    betPanel.esc(`${prefix}tigrinho jogar <valor>`) +
    '</code> · ' +
    betPanel.esc(`${prefix}tigrinho fichas`) +
    ' · ' +
    betPanel.esc(`${prefix}tigrinho historico`) +
    '</div>' +
    '</div></div>';

  // JS: só apresenta o resultado VALIDADO (nada de sorteio nem cálculo de prêmio)
  const js =
    '(function(){\n' +
    'var R=' + resultadoJson + ';\n' +
    'var machine=document.getElementById("machine");\n' +
    'var faixa=document.getElementById("rodada");\n' +
    'var statusEl=document.getElementById("status");\n' +
    'var reels=[document.getElementById("reel0"),document.getElementById("reel1"),document.getElementById("reel2"),document.getElementById("reel3"),document.getElementById("reel4")];\n' +
    'var SYM=["🍒","🍋","🍊","🔔","💎","👑","🐯"];\n' +
    'function set(t){if(statusEl)statusEl.textContent=t}\n' +
    'function final(){return R&&R.reels?R.reels:[[],[],[],[],[]]}\n' +
    'function texto(){if(!R)return "NENHUMA RODADA VALIDADA AINDA";\n' +
    ' return "ULTIMA RODADA VALIDADA · aposta "+R.bet+" · "+(R.jackpot?"JACKPOT +"+R.reward:(R.reward>0?"ganhou +"+R.reward+(R.mult?" (x"+R.mult+")":""):"nao ganhou · 0"))}\n' +
    'function pinta(){if(!reels.length)return;var f=final();\n' +
    ' reels.forEach(function(reel,idx){var cells=reel.querySelectorAll(".cell");var col=f[idx]||[];\n' +
    '  for(var k=0;k<3;k++)cells[k].textContent=col[k]!==undefined?col[k]:SYM[(idx+k)%SYM.length];\n' +
    '  reel.classList.remove("spinning")})}\n' +
    'pinta();set(texto());\n' +
    'if(faixa&&R)faixa.textContent="🎬 ULTIMO RESULTADO VALIDADO (do bot)";\n' +
    'window.__tigrinho={resultado:function(){return R},texto:texto};\n' +
    '})();';

  // diagnóstico de área dentro do card (toque no cabeçalho): é o número que o
  // dono consegue ler e mandar — sem ele, ajustar altura é chute
  const estilos = moldura.cssLivre() + css + moldura.cssMedida() + (painel ? painel.css : '');
  const scripts =
    (painel ? '<script>' + painel.js + '</script>' : '') +
    '<script>' + js + '</script>' +
    '<script>' + moldura.jsMedida() + '</script>';
  return '<style>' + estilos + '</style>' + html + scripts;
}

/* ------------------------------------------------------------------ */
/*  Carteira/aposta (painel COMPARTILHADO) e rodadas                   */
/* ------------------------------------------------------------------ */

function horaAgora() {
  try {
    return new Date().toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (_) {
    return 'agora';
  }
}

function moeda() {
  const c = (CONFIG.life && CONFIG.life.currency) || {};
  return { emoji: c.emoji || '🪙', simbolo: c.symbol || 'LC' };
}

/**
 * Saldo/limites lidos pelo BOT (o HTML nunca informa valor).
 * Falha de consulta → `indisponivel` (mostra "—", jamais 0 inventado).
 */
function dadosPainel(userId) {
  const base = {
    saldo: { wallet: 0, disponivel: 0, comprometido: 0, pendentes: [], quando: horaAgora() },
    limites: { min: 1, max: 0, tetoJogo: null },
    bloqueio: '',
    indisponivel: false,
  };
  try {
    const lim = wallet.maximoPermitido(userId, 'tigrinho');
    const s = wallet.saldo(userId);
    base.saldo = {
      wallet: s.wallet,
      disponivel: s.disponivel,
      comprometido: lim.comprometido,
      pendentes: wallet.pendentes(userId),
      quando: horaAgora(),
    };
    base.limites = { min: lim.min, max: lim.max, tetoJogo: lim.limiteDoJogo };
    if (lim.max <= 0) base.bloqueio = 'Seu saldo disponível é 0 — sem aposta possível agora.';
  } catch (err) {
    logger.warn({ err: err && err.message, user: userId }, '[LUA TIGRINHO] não consegui ler a carteira');
    base.indisponivel = true;
    base.bloqueio = 'Não consegui consultar seu saldo agora. Tente novamente — nada foi cobrado.';
  }
  return base;
}

/** Regras mostradas ANTES de confirmar (sempre derivadas da config real). */
function regrasDoJogo() {
  return [
    `🎰 Aposta padrão: ${formatMoney(TIGRINHO_CONFIG.betCost)} · aposta mínima 1 LC`,
    `⏳ Um giro a cada ${(TIGRINHO_CONFIG.cooldownMs / 1000).toFixed(1)}s por jogador`,
    TIGRINHO_CONFIG.rewards.cherry,
    TIGRINHO_CONFIG.rewards.lemon,
    TIGRINHO_CONFIG.rewards.orange,
    TIGRINHO_CONFIG.rewards.bell,
    TIGRINHO_CONFIG.rewards.diamond,
    TIGRINHO_CONFIG.rewards.crown,
    TIGRINHO_CONFIG.rewards.jackpot,
    TIGRINHO_CONFIG.rewards.note,
    '💰 O débito da aposta e o crédito do prêmio acontecem no BOT, uma única vez, quando o comando chega',
    '🎬 O card só mostra o resultado JÁ VALIDADO — a animação não sorteia e não decide prêmio',
    '🧮 Moeda inteira (LC): valores sem centavos',
  ];
}

/** Painel compartilhado (utils/betPanel.js) com a carteira e o valor da aposta. */
function montarPainel(userId, prefix, extra = {}) {
  const d = dadosPainel(userId);
  const painel = betPanel.montar({
    id: 'tigrinho',
    // card curto: valor, atalhos e o botão de girar primeiro; o detalhamento da
    // carteira fica a um toque (medido no aparelho: o botão caía fora da área)
    compacto: true,
    moeda: moeda(),
    saldo: d.saldo,
    limites: d.limites,
    comando: `${prefix}tigrinho jogar {valor}`,
    comandoRefresh: `${prefix}tigrinho fichas`,
    regras: regrasDoJogo(),
    bloqueio: d.bloqueio,
    indisponivel: d.indisponivel,
    titulo: '💼 Carteira e aposta do giro',
    rotuloConfirmar: '🎰 Jogar agora (copia o comando)',
    // valor já preenchido = aposta PADRÃO do jogo (nunca o saldo inteiro; se o
    // saldo não alcança, o painel abre vazio e explica)
    valorInicial: Math.max(d.limites.min, TIGRINHO_CONFIG.betCost),
    ...extra,
  });
  return { painel, dados: d };
}

/** Última rodada JÁ VALIDADA pelo bot (novo formato ou histórico antigo). */
function rodadaValidada(userId) {
  const r = rounds.ultima(userId, 'tigrinho');
  if (r) {
    const p = r.payload || {};
    return {
      reels: Array.isArray(p.reels) ? p.reels : [],
      bet: r.bet,
      reward: r.reward,
      jackpot: !!p.jackpot,
      won: p.won === undefined ? r.reward > 0 : !!p.won,
      mult: p.mult || 0,
      em: r.createdAt,
    };
  }
  // rodadas antigas (antes do livro de rodadas): o histórico já guarda o resultado
  const h = store.getHistory(userId, 1)[0];
  if (!h) return null;
  let reels = [];
  try {
    reels = JSON.parse(h.reels) || [];
  } catch (_) {
    reels = [];
  }
  return { reels, bet: Number(h.bet) || 0, reward: Number(h.reward) || 0, jackpot: !!h.jackpot, won: Number(h.reward) > 0, mult: 0, em: h.created_at };
}

/**
 * Termina uma rodada que ficou no meio (gravada com resultado, mas sem
 * pagamento/estatística — queda do processo). Paga UMA vez (idempotente pelo id
 * da rodada) e registra uma vez. Devolve o resumo ou null se não havia nada.
 */
async function recuperarPendente(userId) {
  const pend = rounds.pendente(userId, 'tigrinho');
  if (!pend) return null;
  const p = pend.payload || {};
  logger.info({ user: userId, rodada: pend.id }, '[LUA TIGRINHO] rodada pendente encontrada — concluindo');

  // rodada SEM resultado registrado (queda entre a cobrança e o sorteio):
  // não existe giro a concluir, então a aposta é DEVOLVIDA e nada é estatística
  const semResultado = !Array.isArray(p.reels) || !p.reels.length;
  if (semResultado) {
    try {
      await wallet.pagarPremio(pend.id, pend.bet); // devolução pelo próprio livro-caixa
    } catch (err) {
      if (!(err && err.code === 'APOSTA_NAO_ENCONTRADA')) throw err;
    }
    try {
      await rounds.concluir(pend.id, { reward: pend.bet, payload: { devolvida: true, reels: [] } });
    } catch (_) {
      /* o essencial (devolver) já foi feito */
    }
    logger.info({ user: userId, rodada: pend.id, devolvido: pend.bet }, '[LUA TIGRINHO] rodada sem resultado — aposta devolvida');
    return { bet: pend.bet, reward: pend.bet, devolvida: true };
  }

  let pago = { reward: pend.reward, duplicado: false };
  try {
    pago = await wallet.pagarPremio(pend.id, pend.reward || 0);
  } catch (err) {
    if (err && err.code === 'APOSTA_NAO_ENCONTRADA') {
      // nada foi cobrado (a aposta não chegou ao livro-caixa): fecha sem pagar
      logger.warn({ user: userId, rodada: pend.id }, '[LUA TIGRINHO] rodada sem aposta registrada — fechando sem pagar');
      try {
        await rounds.concluir(pend.id, { reward: 0 });
      } catch (_) {
        /* segue: o essencial (não pagar) já foi feito */
      }
      return { bet: pend.bet, reward: 0, semAposta: true };
    }
    throw err;
  }
  try {
    await store.registrarRodada({
      userId,
      bet: pend.bet,
      reward: pend.reward || 0,
      reels: Array.isArray(p.reels) ? p.reels : [],
      jackpot: !!p.jackpot,
      won: p.won === undefined ? (pend.reward || 0) > 0 : !!p.won,
      roundId: pend.id,
    });
  } catch (err) {
    logger.error({ err: err && err.message, rodada: pend.id }, '[LUA TIGRINHO] rodada paga mas estatística falhou (recuperável)');
  }
  return { bet: pend.bet, reward: pend.reward || 0, duplicado: !!pago.duplicado };
}

/* ------------------------------------------------------------------ */
/*  Handlers dos subcomandos                                           */
/* ------------------------------------------------------------------ */

async function handleSpin(ctx, prefix) {
  // 1) uma rodada que ficou pendente é concluída ANTES de girar de novo
  const rec = await recuperarPendente(ctx.sender);

  // 2) MENSAGEM REPETIDA/retransmitida: nem cooldown, nem sorteio — devolve a
  //    rodada que já existe para esta mensagem (idempotência antes de tudo)
  const msgId = (ctx.message && ctx.message.key && ctx.message.key.id) || null;
  const ref = msgId || `tigrinho-${Date.now()}`;
  const chave = wallet.chaveAposta(ctx.sender, 'tigrinho', ref);
  const jaExiste = rounds.get(chave);
  if (jaExiste) {
    if (jaExiste.state === rounds.ESTADO.PENDENTE) {
      const fim = await recuperarPendente(ctx.sender);
      return ctx.reply(
        [
          '🔁 Este giro já tinha sido registrado — concluí a rodada em vez de girar de novo.',
          `▸ Aposta: ${formatMoney(jaExiste.bet)}`,
          `▸ Prêmio: ${formatMoney(fim ? fim.reward : jaExiste.reward)}`,
          `▸ Saldo: ${formatMoney(wallet.saldo(ctx.sender).wallet)}`,
        ].join('\n')
      );
    }
    const rodada = rodadaValidada(ctx.sender);
    return ctx.reply(
      [
        '🔁 Este giro já foi processado (nada foi cobrado de novo).',
        rodada ? renderRodadaTexto(rodada) : '📜 Nenhuma rodada registrada.',
        `💰 Saldo: ${formatMoney(wallet.saldo(ctx.sender).wallet)}`,
        `▸ ${prefix}tigrinho historico  → últimos giros`,
      ].join('\n')
    );
  }

  // 3) cooldown individual (timestamp) — vale só para giro NOVO
  const cd = store.canSpin(ctx.sender);
  if (!cd.allowed) {
    const seg = Math.max(1, Math.ceil(cd.remaining / 100) / 10);
    const aviso = rec
      ? rec.devolvida
        ? ` (devolvi ${formatMoney(rec.bet)} de uma rodada que ficou sem resultado)`
        : ` (terminei uma rodada pendente: +${formatMoney(rec.reward)})`
      : '';
    return ctx.reply(`⏳ Calma, tigre! Aguarde ${seg}s para girar de novo.${aviso}`);
  }

  const player = store.getPlayer(ctx.sender);

  // 3) valor da aposta (comportamento antigo: vazio = padrão, "tudo" = saldo)
  const arg = String(ctx.args[1] || '').toLowerCase().trim();
  let bet = TIGRINHO_CONFIG.betCost;
  if (arg === 'tudo' || arg === 'all') {
    bet = player.balance;
  } else if (arg) {
    const n = parseInt(ctx.args[1], 10);
    if (!Number.isFinite(n) || n <= 0) {
      return ctx.reply(`⚠️ Use: ${prefix}tigrinho jogar [aposta]  (ex.: ${prefix}tigrinho jogar ${TIGRINHO_CONFIG.betCost})`);
    }
    bet = n;
  }

  // 5) COBRA a aposta pela camada financeira compartilhada (idempotente pelo id
  //    da mensagem): clique duplo/retransmissão não cobra duas vezes
  let cobranca;
  try {
    cobranca = await wallet.cobrarAposta({ userId: ctx.sender, game: 'tigrinho', valor: bet, ref, status: 'pending' });
  } catch (err) {
    logger.warn({ err: err && err.message, user: ctx.sender, bet }, '[LUA TIGRINHO] aposta recusada');
    const d = dadosPainel(ctx.sender);
    return ctx.reply(
      [
        '❌ *Aposta não aceita*',
        `▸ ${(err && (err.motivo || err.message)) || 'não consegui apostar'}`,
        d.indisponivel ? '▸ Não consegui consultar seu saldo agora — tente de novo.' : `▸ Saldo: ${formatMoney(d.saldo.wallet)}`,
        d.indisponivel ? '' : `▸ Mínimo ${formatMoney(d.limites.min)} · máximo permitido agora ${formatMoney(d.limites.max)}`,
        `▸ Tente de novo: \`${prefix}tigrinho jogar <valor>\``,
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  // 6) segunda camada de idempotência (corrida entre duas execuções da MESMA
  //    mensagem): se o livro-caixa já tinha a aposta, não sorteia de novo
  if (cobranca.duplicado) {
    const existente = rounds.get(cobranca.id);
    if (existente && existente.state === rounds.ESTADO.PENDENTE) {
      const fim = await recuperarPendente(ctx.sender);
      const p = rounds.get(cobranca.id);
      return ctx.reply(
        [
          '🔁 Este giro já tinha sido registrado (mensagem repetida) — concluí a rodada em vez de girar de novo.',
          `▸ Aposta: ${formatMoney(p ? p.bet : existente.bet)}`,
          `▸ Prêmio: ${formatMoney(fim ? fim.reward : 0)}`,
          `▸ Saldo: ${formatMoney(wallet.saldo(ctx.sender).wallet)}`,
        ].join('\n')
      );
    }
    const rodada = rodadaValidada(ctx.sender);
    return ctx.reply(
      [
        '🔁 Este giro já foi processado (nada foi cobrado de novo).',
        rodada ? renderRodadaTexto(rodada) : '📜 Nenhuma rodada registrada.',
        `💰 Saldo: ${formatMoney(wallet.saldo(ctx.sender).wallet)}`,
        `▸ ${prefix}tigrinho historico  → últimos giros`,
      ].join('\n')
    );
  }

  // 7) resultado calculado NO BACKEND
  const grid = spinReels();
  const { reward, jackpot, mult } = computeReward(cobranca.bet, grid);
  const won = reward > 0;
  const reels = grid.map((col) => col.map((s) => s.emoji));

  // 8) grava a RODADA com o resultado ANTES de pagar: se algo cair no meio, a
  //    rodada fica recuperável (sem perder o resultado nem cobrar de novo)
  await rounds.criar({
    id: cobranca.id,
    userId: ctx.sender,
    game: 'tigrinho',
    bet: cobranca.bet,
    reward,
    state: rounds.ESTADO.PENDENTE,
    payload: { reels, jackpot, won, mult },
  });

  // 9) paga UMA vez (idempotente pelo id da rodada) e registra estatística
  const pagamento = await wallet.pagarPremio(cobranca.id, reward);
  const res = await store.registrarRodada({
    userId: ctx.sender,
    bet: cobranca.bet,
    reward,
    reels,
    jackpot,
    won,
    roundId: cobranca.id,
  });

  logger.info(
    { user: ctx.sender, bet: cobranca.bet, reward, jackpot, balance: res.balance, duplicado: !!pagamento.duplicado },
    '[LUA TIGRINHO] Resultado gerado'
  );

  const lines = ['🐯 *LUA TIGRINHO*', renderGridText(grid), '', `▸ Aposta: ${formatMoney(cobranca.bet)}`];
  if (jackpot) lines.push(`🎉🐯 *JACKPOT!* Você ganhou ${formatMoney(reward)}!`);
  else if (won) lines.push(`✨ Você ganhou ${formatMoney(reward)}! (x${mult})`);
  else lines.push('😿 Não foi dessa vez. Tente de novo!');
  lines.push(`▸ Retorno total: ${formatMoney(reward)} (inclui a aposta)`);
  lines.push(`▸ Lucro líquido: ${formatMoney(reward - cobranca.bet)}`);
  lines.push(`💰 Saldo: ${formatMoney(res.balance)}`);
  if (rec) {
    lines.push(
      rec.devolvida
        ? `♻️ Rodada anterior sem resultado: aposta de ${formatMoney(rec.bet)} devolvida`
        : `♻️ Rodada anterior pendente concluída: +${formatMoney(rec.reward)}`
    );
  }
  lines.push(`_${prefix}tigrinho para a interface visual._`);
  await ctx.reply(lines.join('\n'));

  // 10) card com o resultado VALIDADO e a carteira atualizada (quando permitido)
  await enviarCard(ctx, prefix, { ultima: rodadaValidada(ctx.sender), recuperada: rec });
}

/** Um giro validado em texto (usado no histórico e na mensagem repetida). */
function renderRodadaTexto(r) {
  const rowText = Array.isArray(r.reels) && r.reels.length
    ? r.reels[0].map((_, i) => r.reels.map((col) => col[i]).join(' ')).join(' │ ')
    : '?';
  const premio = r.reward > 0 ? `+${formatMoney(r.reward)}${r.mult ? ` (x${r.mult})` : ''}` : '0';
  return `${rowText}  →  ${premio}${r.jackpot ? ' 🐯' : ''}`;
}

/**
 * Envia o card (máquina + painel) quando o modo HTML permite; devolve false se
 * caiu no texto (o chamador decide o que dizer).
 */
async function enviarCard(ctx, prefix, extra = {}) {
  if (!menuFormat.usarHtmlJogo().usar) return false;
  const { painel, dados } = montarPainel(ctx.sender, prefix);
  const p = store.getPlayer(ctx.sender);
  const ultima = extra.ultima === undefined ? rodadaValidada(ctx.sender) : extra.ultima;
  let html = null;
  try {
    html = buildMachineHtml({
      balance: dados.indisponivel ? null : dados.saldo.wallet,
      jackpots: p.jackpots,
      coin: moeda().emoji,
      prefix,
      painel,
      ultima,
      recuperada: extra.recuperada || null,
      aviso: [dados.indisponivel ? dados.bloqueio : '', extra.aviso || ''].filter(Boolean).join(' · '),
    });
  } catch (err) {
    logger.error({ err: err && err.message }, '[LUA TIGRINHO] falha ao montar o card — seguindo no texto');
    return false;
  }
  if (!html) return false;
  try {
    await richHtml.sendHtml(ctx.socket, ctx.remoteJid, html, { title: '🐯 Lua Tigrinho' });
    return true;
  } catch (err) {
    logger.warn({ err: (err && err.message) || String(err) }, '[LUA TIGRINHO] HTML falhou — usando fallback textual');
    return false;
  }
}

async function handleChips(ctx, prefix) {
  let p = null;
  try {
    p = store.getPlayer(ctx.sender);
  } catch (err) {
    logger.warn({ err: err && err.message }, '[LUA TIGRINHO] saldo indisponível em fichas');
  }
  const detalhe = p
    ? [
        `🎰 Giros: ${p.spins}`,
        `🏆 Vitórias: ${p.wins} · 💔 Derrotas: ${p.losses}`,
        `🐯 Jackpots: ${p.jackpots}`,
        `📈 Maior prêmio: ${formatMoney(p.best_win)}`,
      ].join('\n')
    : '';
  // Com o card ligado, `saldo`/`fichas` abre a MESMA tela do tigrinho: saldo real
  // (lido pelo bot) + BOTÃO DE JOGAR com a aposta padrão já preenchida.
  if (await enviarCard(ctx, prefix, { aviso: detalhe })) return true;
  const saldoTxt = p
    ? `💰 Saldo: ${formatMoney(p.balance)}`
    : '💰 Saldo: — (não consegui consultar agora — tente de novo)';
  await ctx.reply(
    [
      '🐯 *LUA TIGRINHO — SALDO*',
      saldoTxt,
      detalhe,
      `▸ Jogar: \`${prefix}tigrinho jogar <valor>\``,
      `▸ Histórico: \`${prefix}tigrinho historico\``,
    ]
      .filter(Boolean)
      .join('\n')
  );
  return true;
}

async function handleHistory(ctx) {
  const hist = store.getHistory(ctx.sender);
  if (!hist.length) return ctx.reply('📜 Você ainda não girou. Use !tigrinho jogar.');
  const lines = hist.map((h, i) => {
    let grid;
    try {
      grid = JSON.parse(h.reels); // [col][row] de emojis
    } catch (_) {
      grid = [];
    }
    const rowText = grid.length
      ? grid[0].map((_, r) => grid.map((c) => c[r]).join(' ')).join(' │ ')
      : '?';
    const prize = h.reward > 0 ? `+${formatMoney(h.reward)}` : '0';
    return `${i + 1}. ${rowText}  →  ${prize}${h.jackpot ? ' 🐯' : ''}`;
  });
  await ctx.reply('🐯 *TIGRINHO — HISTÓRICO*\n' + lines.join('\n'));
}

async function handleRanking(ctx) {
  const rank = store.getRanking();
  if (!rank.length) return ctx.reply('🏆 Ranking vazio. Seja o primeiro a jogar!');
  const medals = ['🥇', '🥈', '🥉'];
  const lines = rank.map((r, i) => {
    const name = String(r.name || '').split('@')[0].slice(0, 20) || 'jogador';
    const pos = medals[i] || `${i + 1}º`;
    return `${pos} ${name} — ${formatMoney(r.balance)}${r.jackpots ? ' 🐯' : ''}`;
  });
  await ctx.reply('🏆 *LUA TIGRINHO — RANKING*\n' + lines.join('\n'));
}

async function handleHelp(ctx, prefix) {
  const R = TIGRINHO_CONFIG.rewards;
  await ctx.reply(
    [
      '🐯 *LUA TIGRINHO — AJUDA*',
      'Caça-níquel de 5 rolos jogado com seus *LuaCoins* (mesma moeda do RPG).',
      '',
      '🎰 *Prêmios (x aposta)*',
      R.jackpot,
      R.crown,
      R.diamond,
      R.bell,
      R.cherry,
      R.lemon,
      R.orange,
      R.note,
      '',
      `▸ ${prefix}tigrinho  → interface visual`,
      `▸ ${prefix}tigrinho jogar [aposta|tudo]  → girar valendo LC`,
      `▸ ${prefix}tigrinho fichas  → saldo/estatísticas`,
      `▸ ${prefix}tigrinho historico  → últimos giros`,
      `▸ ${prefix}tigrinho ranking  → melhores`,
    ].join('\n')
  );
}

async function handleOpen(ctx, prefix) {
  // conclui rodada pendente (se houver) ANTES de mostrar o card
  let rec = null;
  try {
    rec = await recuperarPendente(ctx.sender);
  } catch (err) {
    logger.error({ err: err && err.message, user: ctx.sender }, '[LUA TIGRINHO] não consegui concluir a rodada pendente');
  }

  const p = store.getPlayer(ctx.sender);
  const { painel, dados } = montarPainel(ctx.sender, prefix);
  const ultima = rodadaValidada(ctx.sender);
  logger.info({ user: ctx.sender, saldo: dados.saldo.wallet }, '[LUA TIGRINHO] Interface aberta');

  if (menuFormat.usarHtmlJogo().usar) {
    try {
      const html = buildMachineHtml({
        balance: dados.indisponivel ? null : dados.saldo.wallet,
        jackpots: p.jackpots,
        coin: moeda().emoji,
        prefix,
        painel,
        ultima,
        recuperada: rec,
        aviso: dados.indisponivel ? dados.bloqueio : '',
      });
      await richHtml.sendHtml(ctx.socket, ctx.remoteJid, html, { title: '🐯 Lua Tigrinho' });
      return;
    } catch (err) {
      logger.warn({ err: (err && err.message) || String(err) }, '[LUA TIGRINHO] HTML falhou — usando fallback textual');
    }
  }

  // fallback textual: MESMOS dados (carteira, limites, última rodada) e ações
  await ctx.reply(textoPainel(ctx.sender, prefix, { dados, ultima, recuperada: rec, p }));
}

/** Texto equivalente ao card (fluxo sem HTML). */
function textoPainel(userId, prefix, { dados, ultima, recuperada, p }) {
  const linhas = [
    '🐯 *LUA TIGRINHO — CARTEIRA E APOSTA*',
    dados.indisponivel ? '⚠️ ' + dados.bloqueio : `▸ Saldo: ${formatMoney(dados.saldo.wallet)}`,
    dados.indisponivel ? '▸ Saldo: — (indisponível agora)' : `▸ Disponível para apostar: ${formatMoney(dados.saldo.disponivel)}`,
    dados.indisponivel
      ? `▸ Nova tentativa: \`${prefix}tigrinho\``
      : `▸ Aposta mínima ${formatMoney(dados.limites.min)} · máxima agora ${formatMoney(dados.limites.max)}`,
    dados.bloqueio && !dados.indisponivel ? `⚠️ ${dados.bloqueio}` : '',
    '',
    `🎰 Giros: ${p.spins} · 🏆 Vitórias: ${p.wins} · 🐯 Jackpots: ${p.jackpots}`,
    ultima ? `▸ Última rodada validada: ${renderRodadaTexto(ultima)}` : '▸ Nenhuma rodada validada ainda — envie o comando para girar',
    recuperada
      ? recuperada.devolvida
        ? `♻️ Rodada sem resultado: aposta de ${formatMoney(recuperada.bet)} devolvida`
        : `♻️ Rodada pendente concluída agora: +${formatMoney(recuperada.reward)}`
      : '',
    '',
    `▶️ Girar valendo: \`${prefix}tigrinho jogar <valor>\` (também aceita \`tudo\`)`,
    `▸ \`${prefix}tigrinho fichas\` · \`${prefix}tigrinho historico\` · \`${prefix}tigrinho ranking\` · \`${prefix}tigrinho ajuda\``,
    '💰 A aposta é debitada e o prêmio creditado pelo bot UMA vez, quando o comando chega.',
  ];
  return linhas.filter(Boolean).join('\n');
}

/* ------------------------------------------------------------------ */

module.exports = [
  {
    name: 'tigrinho',
    commands: ['tigrinho'],
    category: 'rpg',
    description: '🐯 Caça-níquel de 5 rolos (valendo LuaCoins).',
    usage: '!tigrinho [jogar|fichas|historico|ranking|ajuda]',
    cooldown: 2000,
    execute: async (ctx) => {
      const prefix = ctx.prefix || CONFIG.bot.prefix || '!';
      const sub = subcommand(ctx);
      try {
        if (!sub) return await handleOpen(ctx, prefix);
        switch (sub) {
          case 'jogar':
            return await handleSpin(ctx, prefix);
          case 'fichas':
            return await handleChips(ctx, prefix);
          case 'historico':
            return await handleHistory(ctx);
          case 'ranking':
            return await handleRanking(ctx);
          case 'ajuda':
            return await handleHelp(ctx, prefix);
          default:
            return await handleHelp(ctx, prefix);
        }
      } catch (err) {
        const motivo = (err && err.message) || String(err);
        // o primeiro frame do stack diz ONDE falhou (arquivo:linha) — é o que
        // permite achar a causa sem precisar de print da conversa
        const onde = String((err && err.stack) || '').split('\n')[1];
        logger.error({ err: motivo, stack: err && err.stack, sub }, '[LUA TIGRINHO] Erro');
        // o DONO recebe o motivo real (diagnóstico); os outros, a mensagem curta
        await ctx.reply(
          ctx.isOwner
            ? `⚠️ Erro no tigrinho: ${motivo}${onde ? `\n▸ ${onde.trim()}` : ''}\n▸ Detalhes no log (módulo tigrinho).`
            : '⚠️ Algo deu errado no tigrinho. Tente de novo em instantes.'
        );
      }
    },
  },
];
