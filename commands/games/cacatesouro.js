/**
 * commands/games/cacatesouro.js — 🗺️ CAÇA AO TESOURO.
 *
 * Tabuleiros de 3×3 até 13×13 com a carteira REAL do projeto (LuaCoins) e
 * escolha de aposta pelo painel compartilhado (utils/betPanel.js) — o MESMO
 * painel usado pelo 🐯 tigrinho. Nada de carteira paralela nem fichas.
 *
 * Camadas (padrão do projeto — nada duplicado):
 *   lógica pura   → utils/treasureGame.js  (mapa, pistas, pagamento)
 *   financeiro    → utils/gameWallet.js    (carteira real, limites, idempotência)
 *   storage       → database/treasure.js   (partida, escavações, fim, expiração)
 *   painel HTML   → utils/betPanel.js      (carteira + aposta, compartilhado)
 *   envio HTML    → utils/richHtml.js      (mesmo caminho dos outros cards)
 *   interface     → este arquivo           (tabuleiro + fluxo textual)
 *
 * O card NÃO tem canal de volta ao bot (limite do formato WebView, medido nos
 * projetos de referência): a interface serve para ESCOLHER e COPIAR o comando.
 * Quem cobra, sorteia, revela e paga é o bot — a cada ação ele revalida
 * remetente, chat, partida, coordenada, saldo e limites.
 *
 * Comandos (prefixo real do bot):
 *   {p}cacatesouro                  → painel: tamanho, carteira e aposta
 *   {p}cacatesouro 3 | 13           → mesmo painel, já naquele tamanho
 *   {p}cacatesouro jogar <3-13> <valor>      → abre a expedição (cobra UMA vez)
 *   {p}cacatesouro cavar <partida> <A1..M13> → escava uma casa
 *   {p}cacatesouro continuar / mapa → mostra a expedição ativa
 *   {p}cacatesouro sair              → encerra (a aposta não volta; a regra avisa antes)
 *   {p}cacatesouro regras [3-13]     → regras + carteira
 *   {p}cacatesouro saldo             → carteira e estatísticas
 *   {p}cacatesouro rapido            → jogo rápido 3×3 casual (o antigo, preservado)
 *
 * A aposta sai da CARTEIRA (economy.wallet) — não exige personagem do RPG/vida;
 * o personagem só entra no XP.
 * Com a carteira indisponível o caça roda em modo
 * CASUAL: expedição por pontuação, sem movimentar carteira. O painel diz como
 * criar o personagem ({p}vida <nome>) para apostar valendo.
 *
 * O modo de interface segue as configurações do bot: `{p}modohtml on/off`
 * (com o fluxo textual equivalente em todos os dados/ações) e o modo seguro
 * nunca envia card.
 */

'use strict';

const CONFIG = require('../../config');
const jogo = require('../../utils/treasureGame');
const store = require('../../database/treasure');
const wallet = require('../../utils/gameWallet');
const betPanel = require('../../utils/betPanel');
// moldura do card: altura FIXA em px e página que não rola — os MESMOS números
// do card do menu (menus/html/dimensoes.js). Sem isso o WebView do card mede o
// conteúdo e o card sai minúsculo/tremendo (ver MENU-HTML.md §2.1).
const moldura = require('../../menus/html/moldura');
const richHtml = require('../../utils/richHtml');
const menuFormat = require('../../utils/menuFormat');
const life = require('../../database/life');
const session = require('../../utils/session');
const games = require('../../database/games');
const { formatMoney } = require('../../utils/formatter');
const logger = require('../../utils/logger').child('tesouro');

/** Valor que já vem digitado no painel (nunca o saldo todo). */
const APOSTA_SUGERIDA = 100;

const SUBCMD = {
  jogar: ['jogar', 'iniciar', 'comecar', 'começar', 'apostar'],
  cavar: ['cavar', 'escavar', 'cava', 'abrir', 'mina'],
  continuar: ['continuar', 'voltar', 'retomar', 'atual', 'tabuleiro', 'mapa'],
  sair: ['sair', 'encerrar', 'desistir', 'fechar', 'cancelar'],
  regras: ['regras', 'ajuda', 'help', 'como', 'info'],
  rapido: ['rapido', 'rápido', 'classico', 'clássico', 'antigo', 'quick'],
  saldo: ['saldo', 'carteira', 'fichas', 'banco'],
};

function subcomando(ctx) {
  const a = String((ctx.args && ctx.args[0]) || '').toLowerCase().trim();
  for (const [chave, aliases] of Object.entries(SUBCMD)) {
    if (aliases.includes(a)) return chave;
  }
  return null;
}

function prefixoDe(ctx) {
  return (ctx && ctx.prefix) || CONFIG.bot.prefix || '!';
}

function moeda() {
  const c = (CONFIG.life && CONFIG.life.currency) || {};
  return { emoji: c.emoji || '🪙', simbolo: c.symbol || 'LC' };
}

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

/* ------------------------------- carteira ------------------------------ */

/**
 * Estado do jogador no RPG/vida, SEM criar nada (usa `life.getPlayer`, que não
 * cria linha). Serve para: XP (quem tem personagem) e para detectar FALHA de
 * consulta — que nunca pode virar "saldo 0".
 *   'ok'            → tem personagem
 *   'sem_cadastro'  → não tem personagem (aposta continua valendo: a moeda é a
 *                     carteira, que existe para todo mundo)
 *   'indisponivel'  → a consulta falhou
 */
function estadoDoJogador(userId) {
  try {
    const p = life.getPlayer(userId);
    return p && p.name ? 'ok' : 'sem_cadastro';
  } catch (err) {
    logger.warn({ err: err && err.message }, 'falha ao consultar o cadastro do jogador');
    return 'indisponivel';
  }
}

/**
 * Dados do painel lidos do BOT (nunca do HTML).
 * Falha de consulta → `indisponivel: true` + motivo, com o saldo mostrado como
 * "—" (jamais 0 inventado).
 * @returns {{estado:string, indisponivel:boolean, saldo:object, limites:object, bloqueio:string, cfg:object}}
 */
function dadosDoPainel(sender, size, prefix) {
  const cfg = jogo.configDoTabuleiro(size);
  const vazio = { wallet: 0, disponivel: 0, comprometido: 0, pendentes: [], quando: horaAgora() };
  // aposta sugerida no campo: nunca o saldo inteiro — um valor pequeno e fixo,
  // só para o botão já estar pronto para o toque (o jogador troca se quiser)
  const sugerida = (max) => (max >= APOSTA_SUGERIDA ? APOSTA_SUGERIDA : 0);
  const estado = estadoDoJogador(sender);
  const base = {
    estado,
    indisponivel: estado === 'indisponivel',
    cfg,
    saldo: vazio,
    limites: { min: 1, max: 0, tetoJogo: null },
    bloqueio: '',
  };

  if (estado === 'indisponivel') {
    base.bloqueio = 'Não consegui consultar sua carteira agora. Tente novamente — nada foi cobrado.';
    return base;
  }

  try {
    const lim = wallet.maximoPermitido(sender, 'cacatesouro');
    const s = wallet.saldo(sender);
    base.saldo = {
      wallet: s.wallet,
      disponivel: s.disponivel,
      comprometido: lim.comprometido,
      pendentes: wallet.pendentes(sender),
      quando: horaAgora(),
    };
    base.limites = { min: lim.min, max: lim.max, tetoJogo: lim.limiteDoJogo };
    base.valorSugerido = sugerida(lim.max);
    if (lim.max <= 0) {
      // saldo 0 (ou tudo comprometido) NÃO impede jogar: o casual é sem carteira
      base.bloqueio =
        'Seu saldo disponível é 0 agora — sem aposta possível. ' +
        `A expedição casual (sem apostar) continua: \`${prefix}cacatesouro jogar ${cfg.size} casual\``;
    }
    return base;
  } catch (err) {
    logger.warn({ err: err && err.message }, 'não consegui ler a carteira do jogador');
    base.estado = 'indisponivel';
    base.indisponivel = true;
    base.bloqueio = 'Não consegui consultar seu saldo agora. Use o botão de atualizar saldo para tentar de novo.';
    return base;
  }
}

/* -------------------------------- HTML --------------------------------- */

/** Célula do tabuleiro: sempre mostra a coordenada; revelada = conteúdo real. */
function celulaHtml(g, idx) {
  const coord = jogo.coordDeIdx(idx, g.size);
  const rev = g.revealed.find((c) => c.idx === idx);
  const k = rev ? rev.k : '?';
  const emoji = jogo.EMOJI_CASA[k] || '▫️';
  const dica = rev && rev.k !== 't' ? `vizinhos: ${rev.d}` : '';
  const cls = ['tc', rev ? 'rev' : 'fechada', rev ? `k-${k}` : ''].join(' ');
  const rotulo = !rev
    ? `Casa ${coord}, não escavada`
    : rev.k === 't'
      ? `Casa ${coord}, tesouro encontrado`
      : rev.k === 'a'
        ? `Casa ${coord}, armadilha escavada`
        : `Casa ${coord}, vazia, ${rev.d} tesouro(s) nas casas vizinhas`;
  return (
    `<button type="button" class="${cls}" data-idx="${idx}" data-coord="${coord}" aria-label="${betPanel.esc(rotulo)}">` +
    `<span class="tcoord">${coord}</span><span class="temoji">${emoji}</span>` +
    (dica ? `<span class="tdica">${betPanel.esc(dica)}</span>` : '') +
    '</button>'
  );
}

/** Tamanho da janela visível (casas na tela por vez) — mapa grande usa setas. */
const JANELA = { cols: 5, linhas: 5 };

/**
 * Tabuleiro em HTML: todas as casas do mapa (as fechadas não dizem nada) e, em
 * cada uma, só o que o jogador JÁ escavou. O mapa verdadeiro não entra aqui.
 *
 * Todas as casas existem no DOM e a janela só ESCONDE as de fora — é assim que
 * a navegação por setas funciona sem carregar nenhum recurso externo (o card
 * não tem rede) e sem reenviar a mensagem a cada toque.
 */
function tabuleiroHtml(g, prefix, { cols = JANELA.cols, linhas = JANELA.linhas } = {}) {
  const jan = jogo.janelaVisivel(g.size, { x: 0, y: 0, cols, linhas });
  const idEsc = betPanel.esc(g.id);
  const linhasHtml = [];
  for (let ly = 0; ly < g.size; ly++) {
    const casas = [];
    for (let lx = 0; lx < g.size; lx++) {
      const idx = jogo.idxDe(lx, ly, g.size);
      const dentro = lx >= jan.x && lx <= jan.x2 && ly >= jan.y && ly <= jan.y2;
      const celula = celulaHtml(g, idx);
      casas.push(dentro ? celula : celula.replace('<button type="button"', '<button type="button" style="display:none"'));
    }
    linhasHtml.push(`<div class="trow">${casas.join('')}</div>`);
  }
  const restantes = Math.max(0, g.digsTotal - g.digsUsed);
  const ultima = g.revealed.length ? g.revealed[g.revealed.length - 1] : null;
  const ultimoTxt = ultima
    ? `${jogo.EMOJI_CASA[ultima.k]} ${ultima.c}: ` +
      (ultima.k === 't'
        ? 'TESOURO!'
        : ultima.k === 'a'
          ? 'armadilha — queimou uma escavação extra'
          : `vazio · ${ultima.d} tesouro(s) nas 8 casas vizinhas`)
    : 'nada escavado ainda';

  return (
    `<div class="tb" id="tb-${idEsc}" data-partida="${idEsc}" data-cols="${jan.cols}" data-linhas="${jan.linhas}"` +
    ` data-size="${g.size}">` +
    `<div class="tb-top"><span class="tb-id">partida ${idEsc}</span>` +
    `<span class="tb-jan" id="tb-jan-${idEsc}">${betPanel.esc(jan.rotulo)}</span></div>` +
    '<div class="tb-wrap">' +
    `<button type="button" class="tnav tnav-l" id="tb-l-${idEsc}" aria-label="Ver colunas à esquerda">←</button>` +
    `<div class="tb-grid" id="tb-grid-${idEsc}">${linhasHtml.join('')}</div>` +
    `<button type="button" class="tnav tnav-r" id="tb-r-${idEsc}" aria-label="Ver colunas à direita">→</button>` +
    '</div>' +
    '<div class="tb-vert">' +
    `<button type="button" class="tnav" id="tb-u-${idEsc}" aria-label="Ver linhas acima">↑</button>` +
    `<button type="button" class="tnav" id="tb-d-${idEsc}" aria-label="Ver linhas abaixo">↓</button>` +
    '</div>' +
    '<div class="tb-stats">' +
    `<span>💎 ${g.treasuresFound}/${g.treasuresTotal} tesouros</span>` +
    `<span>⛏️ ${restantes} escavações restantes</span>` +
    `<span>💰 aposta ${betPanel.valor(g.bet)} ${betPanel.esc(moeda().simbolo)} (pela expedição inteira)</span>` +
    '</div>' +
    `<div class="tb-ult">▸ último resultado: <b id="tb-ult-${idEsc}">${betPanel.esc(ultimoTxt)}</b></div>` +
    `<div class="tb-sel">▸ selecionada: <b id="tb-sel-${idEsc}">nenhuma</b></div>` +
    `<div class="tb-acoes">` +
    `<button type="button" class="tb-cavar" id="tb-go-${idEsc}" disabled aria-label="Escavar a casa selecionada">⛏️ Escavar</button>` +
    `<span class="tb-hint">Escolha uma casa e toque em Escavar: o card copia o comando completo` +
    ` <code>${betPanel.esc(prefix)}cacatesouro cavar ${idEsc} A1</code> (troque A1 pela casa) para você enviar no chat. ` +
    'Copiar não executa: quem escava é o bot, quando recebe o comando.</span>' +
    '</div>' +
    '<div class="tb-legenda">' +
    '<span><b>▫️</b> não escavada</span><span><b>💎</b> tesouro</span><span><b>💥</b> armadilha</span>' +
    '<span><b>·</b> vazio (mostra quantos tesouros há nas casas vizinhas)</span>' +
    '</div></div>'
  );
}

/** JS do tabuleiro: seleção + navegação + cópia do comando (sem `${` aninhado). */
function tabuleiroJs(g, prefix) {
  const id = betPanel.esc(g.id).replace(/[^a-zA-Z0-9_-]/g, '');
  const cmd = `${prefix}cacatesouro cavar ${g.id}`;
  return (
    '(function(){\n' +
    'var CMD=' + JSON.stringify(cmd) + ';\n' +
    'var tb=document.getElementById("tb-' + id + '");if(!tb)return;\n' +
    'var sel=null;\n' +
    'var rot=document.getElementById("tb-sel-' + id + '");\n' +
    'var out=document.getElementById("tb-ult-' + id + '");\n' +
    'var go=document.getElementById("tb-go-' + id + '");\n' +
    'function copiar(texto,cb){var fim=false;function pronto(ok){if(fim)return;fim=true;cb(ok)}\n' +
    ' function legado(){try{var ta=document.createElement("textarea");ta.value=texto;ta.setAttribute("readonly","");\n' +
    '  ta.style.position="absolute";ta.style.left="-9999px";document.body.appendChild(ta);ta.select();\n' +
    '  if(ta.setSelectionRange)ta.setSelectionRange(0,texto.length);\n' +
    '  var ok=!!(document.execCommand&&document.execCommand("copy"));document.body.removeChild(ta);return ok}catch(e){return false}}\n' +
    ' try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(texto).then(function(){pronto(true)},function(){pronto(legado())});return}}catch(e){}\n' +
    ' pronto(legado())}\n' +
    'if(!CMD)CMD="!cacatesouro cavar "+tb.getAttribute("data-partida");\n' +
    'function rotulo(px,py,cols,linhas,size){var L="ABCDEFGHIJKLM";\n' +
    '  return "Colunas "+L.charAt(px)+"\\u2013"+L.charAt(px+cols-1)+" \\u00b7 Linhas "+(py+1)+"\\u2013"+(py+linhas)}\n' +
    'var size=Number(tb.getAttribute("data-size"))||3,cols=Number(tb.getAttribute("data-cols"))||3,linhas=Number(tb.getAttribute("data-linhas"))||3;\n' +
    'var px=0,py=0,jan=document.getElementById("tb-jan-' + id + '");\n' +
    'function mostra(){if(jan)jan.textContent=rotulo(px,py,cols,linhas,size);\n' +
    '  [].slice.call(tb.querySelectorAll(".tc")).forEach(function(c){\n' +
    '    var i=Number(c.getAttribute("data-idx"))||0,x=i%size,y=Math.floor(i/size);\n' +
    '    c.style.display=(x>=px&&x<px+cols&&y>=py&&y<py+linhas)?"":"none";\n' +
    '  });\n' +
    '  if(bl)bl.disabled=px<=0;if(br)br.disabled=px+cols>=size;\n' +
    '  if(bu)bu.disabled=py<=0;if(bd)bd.disabled=py+linhas>=size;\n' +
    '}\n' +
    '[].slice.call(tb.querySelectorAll(".tc.fechada")).forEach(function(c){\n' +
    '  c.addEventListener("click",function(){\n' +
    '    [].slice.call(tb.querySelectorAll(".tc.sel")).forEach(function(o){o.classList.remove("sel")});\n' +
    '    c.classList.add("sel");sel=c.getAttribute("data-coord");\n' +
    '    if(rot)rot.textContent=sel;if(go)go.disabled=false;\n' +
    '  });\n' +
    '});\n' +
    'if(go)go.addEventListener("click",function(){\n' +
    '  if(!sel)return;var comando=CMD+" "+sel;\n' +
    '  copiar(comando,function(ok){\n' +
    '    if(out)out.textContent=(ok?"✅ copiado: ":"⚠️ copie manualmente: ")+comando+" — envie esta mensagem no chat";\n' +
    '  });\n' +
    '});\n' +
    'var bl=document.getElementById("tb-l-' + id + '"),br=document.getElementById("tb-r-' + id + '"),\n' +
    '    bu=document.getElementById("tb-u-' + id + '"),bd=document.getElementById("tb-d-' + id + '");\n' +
    'function mexe(dx,dy){px=Math.max(0,Math.min(Math.max(0,size-cols),px+dx));py=Math.max(0,Math.min(Math.max(0,size-linhas),py+dy));mostra()}\n' +
    'if(bl)bl.addEventListener("click",function(){mexe(-1,0)});\n' +
    'if(br)br.addEventListener("click",function(){mexe(1,0)});\n' +
    'if(bu)bu.addEventListener("click",function(){mexe(0,-1)});\n' +
    'if(bd)bd.addEventListener("click",function(){mexe(0,1)});\n' +
    'mostra();\n' +
    'window.__tesouro={rotulo:function(){return rotulo(px,py,cols,linhas,size)},x:function(){return px},y:function(){return py},sel:function(){return sel}};\n' +
    '})();'
  );
}

function cssBase() {
  return (
    '*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}\n' +
    'body{margin:0;background:#0b0614;font-family:Arial,sans-serif;color:#efe7ff}\n' +
    // #__wrap = moldura de altura cheia; a rolagem fica AQUI dentro (gesto de
    // arrastar na página viraria "responder" no WhatsApp)
    '.wrap{width:100%;max-width:560px;margin:0 auto;padding:10px;flex:1 1 auto;min-height:0;' +
    'overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}\n' +
    '.head{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:14px;' +
    'padding:6px 2px 2px;border-bottom:1px solid rgba(199,146,255,.25)}\n' +
    '.head span{font-size:11px;color:rgba(199,146,255,.9)}\n' +
    '.tb-tamanhos{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}\n' +
    '.tb-tam{padding:6px 10px;border-radius:999px;font-size:11px;border:1px solid rgba(199,146,255,.35);' +
    'background:rgba(255,255,255,.04);color:rgba(239,231,255,.85)}\n' +
    '.tb-tam.on{border-color:#a78bfa;background:rgba(167,139,250,.25);color:#fff;font-weight:bold}\n'
  );
}

function cssTabuleiro() {
  return (
    '.tb{margin:12px 0 0;padding:10px;border-radius:16px;background:rgba(20,10,35,.72);' +
    'border:1px solid rgba(199,146,255,.35);color:#efe7ff}\n' +
    '.tb-top{display:flex;justify-content:space-between;gap:8px;font-size:10px;letter-spacing:.5px;' +
    'text-transform:uppercase;color:rgba(199,146,255,.85);margin-bottom:8px}\n' +
    '.tb-jan{font-weight:bold;text-transform:none;letter-spacing:0}\n' +
    '.tb-wrap{display:flex;align-items:center;gap:6px}\n' +
    '.tb-grid{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px}\n' +
    '.trow{display:flex;gap:4px}\n' +
    '.tc{flex:1 1 0;min-width:0;min-height:52px;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:1px;border-radius:10px;border:1px solid rgba(199,146,255,.3);' +
    'background:rgba(0,0,0,.42);color:#efe7ff;cursor:pointer;padding:2px}\n' +
    '.tc .tcoord{font-size:9px;color:rgba(199,146,255,.75)}\n' +
    '.tc .temoji{font-size:17px;line-height:1}\n' +
    '.tc .tdica{font-size:8px;color:#fde68a}\n' +
    '.tc.k-t{border-color:rgba(250,204,21,.75);background:rgba(250,204,21,.14)}\n' +
    '.tc.k-a{border-color:rgba(248,113,113,.75);background:rgba(248,113,113,.14)}\n' +
    '.tc.k-v{border-color:rgba(199,146,255,.5);background:rgba(199,146,255,.1)}\n' +
    '.tc.sel{outline:2px solid #a78bfa;outline-offset:1px}\n' +
    '.tc.rev{cursor:default}\n' +
    '.tnav{flex:0 0 44px;min-height:52px;border-radius:12px;border:1px solid rgba(199,146,255,.4);' +
    'background:rgba(0,0,0,.45);color:#e9d5ff;font-size:18px;font-weight:bold;cursor:pointer}\n' +
    '.tnav[disabled]{opacity:.35;cursor:default}\n' +
    '.tb-vert{display:flex;gap:6px;margin-top:6px}\n' +
    '.tb-vert .tnav{flex:1 1 0}\n' +
    '.tb-stats{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px;font-size:12px;color:#efe7ff}\n' +
    '.tb-ult,.tb-sel{margin-top:6px;font-size:12px;color:#fde68a}\n' +
    '.tb-acoes{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px}\n' +
    '.tb-cavar{min-height:52px;padding:0 18px;border-radius:14px;border:1px solid rgba(199,146,255,.6);' +
    'background:linear-gradient(135deg,rgba(139,92,246,.85),rgba(76,29,149,.7));color:#fff;font-weight:bold;' +
    'font-size:15px;cursor:pointer}\n' +
    '.tb-cavar[disabled]{opacity:.45;cursor:not-allowed}\n' +
    '.tb-hint{flex:1 1 180px;font-size:11px;color:rgba(239,231,255,.8)}\n' +
    '.tb-hint code{color:#d8b4fe;font-weight:bold;word-break:break-all}\n' +
    '.tb-legenda{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:8px;font-size:10.5px;color:rgba(239,231,255,.8)}\n' +
    '@media (prefers-reduced-motion: reduce){.tb *{animation:none!important;transition:none!important}}\n'
  );
}

/**
 * Documento do tabuleiro = tabuleiro + painel compartilhado.
 * O painel aparece SEMPRE: enquanto a expedição está aberta ele fica informativo
 * (confirmação bloqueada com o motivo), e depois de encerrada volta a permitir
 * abrir a próxima.
 */
function buildHtml(g, prefix) {
  const cfg = jogo.configDoTabuleiro(g.size);
  const p = dadosDoPainel(g.userId, g.size, prefix);
  const ativa = g.status === store.STATUS.ATIVA;
  const painel = betPanel.montar({
    id: 'tesouro',
    moeda: moeda(),
    saldo: p.saldo,
    limites: p.limites,
    comando: `${prefix}cacatesouro jogar ${cfg.size} {valor}`,
    comandoRefresh: `${prefix}cacatesouro continuar`,
    regras: regrasDoJogo(cfg),
    indisponivel: p.indisponivel,
    rodada: ativa ? g.id : '',
    bloqueio: ativa
      ? 'Expedição em andamento: use o botão Escavar. Para abrir outra, termine esta ou use sair (a aposta atual não volta).'
      : p.bloqueio,
    titulo: ativa ? '💼 Carteira (expedição em andamento)' : '💼 Carteira e próxima expedição',
    rotuloConfirmar: '🗺️ Abrir expedição (copia o comando)',
    // valor já digitado = aposta sugerida (o jogador troca; o saldo todo nunca)
    valorInicial: ativa ? null : p.valorSugerido,
  });

  const cabecalho = ativa
    ? `🗺️ <b>CAÇA AO TESOURO</b><span>${g.size}×${g.size} · ${Math.max(0, g.digsTotal - g.digsUsed)} escavações restantes</span>`
    : `🗺️ <b>CAÇA AO TESOURO</b><span>${fimTexto(g)}</span>`;

  return (
    '<style>' + moldura.css() + cssBase() + cssTabuleiro() + painel.css + '</style>' +
    '<body><div id="__wrap"><div class="wrap"><div class="head">' + cabecalho + '</div>' +
    tabuleiroHtml(g, prefix, {}) +
    painel.markup +
    '</div></div></body>' +
    '<script>' + painel.js + '</script>' +
    '<script>' + tabuleiroJs(g, prefix) + '</script>'
  );
}

function regrasDoJogo(cfg) {
  return [
    `💎 Tesouros: ${cfg.tesouros} · 💥 armadilhas: ${cfg.armadilhas} (queimam uma escavação extra)`,
    `⛏️ Escavações: ${cfg.escavacoes} de ${cfg.casas} casas — cada casa só pode ser escavada uma vez`,
    '🔎 Cada casa escavada diz quantos tesouros existem nas 8 casas vizinhas',
    `🏆 Vitória: achar todos os tesouros antes de acabar as escavações (+${Math.round(jogo.BONUS_VITORIA * 100)}% da aposta)`,
    '💀 Derrota: as escavações acabam com tesouro no chão — a aposta é perdida',
    '🚪 Sair no meio paga os tesouros já achados, sem bônus, e não devolve a aposta',
    `💰 Cada tesouro paga ${pctPorTesouro(cfg)}% da sua aposta (arredondado para baixo) e o tesouro só é pago uma vez`,
    '⚠️ A aposta vale pela expedição inteira: cobrada UMA vez, não devolvida — nem ao sair, nem ao expirar',
    `⭐ Experiência: ${store.XP_POR_TESOURO} por tesouro + ${store.XP_VITORIA} ao completar (com personagem do RPG/vida)`,
    '🪙 A moeda é inteira: valores sem centavos',
  ];
}

/**
 * Quanto cada tesouro paga, em % da aposta: (casas/escavações) ÷ tesouros × RTP.
 * Percentual derivado dos parâmetros reais (utils/treasureGame) — nada fictício.
 */
function pctPorTesouro(cfg) {
  const pct = (cfg.casas / cfg.escavacoes) * (jogo.RTP_BASE / cfg.tesouros) * 100;
  return pct.toFixed(1).replace('.', ',');
}

function fimTexto(g) {
  const t = {
    [store.STATUS.VITORIA]: '🏆 expedição completa',
    [store.STATUS.DERROTA]: '💀 escavações esgotadas',
    [store.STATUS.ENCERRADA]: '🚪 encerrada por você',
    [store.STATUS.EXPIRADA]: '⌛ expirada por inatividade',
  }[g.status];
  return `${g.size}×${g.size}${t ? ' · ' + t : ''}`;
}

/* -------------------------------- texto -------------------------------- */

/** Tabuleiro em texto (mesmos dados do card, para quando o HTML está desligado). */
function tabuleiroTexto(g) {
  const cabecalho = '   ' + jogo.LETRAS.slice(0, g.size).join(' ');
  const linhas = [];
  for (let y = 0; y < g.size; y++) {
    const casas = [];
    for (let x = 0; x < g.size; x++) {
      const idx = jogo.idxDe(x, y, g.size);
      const rev = g.revealed.find((c) => c.idx === idx);
      casas.push(rev ? jogo.EMOJI_CASA[rev.k] : '▫️');
    }
    linhas.push(`${String(y + 1).padStart(2, ' ')} ${casas.join(' ')}`);
  }
  return [cabecalho, ...linhas].join('\n');
}

function resumoTexto(g, prefix) {
  const restantes = Math.max(0, g.digsTotal - g.digsUsed);
  const ultima = g.revealed.length ? g.revealed[g.revealed.length - 1] : null;
  const linhas = [
    `🗺️ *CAÇA AO TESOURO* — ${g.size}×${g.size} (partida \`${g.id}\`)`,
    `▸ 💎 Tesouros: ${g.treasuresFound}/${g.treasuresTotal} · ⛏️ Escavações restantes: ${restantes}`,
    `▸ 💰 Aposta: ${formatMoney(g.bet)} (pela expedição inteira)`,
  ];
  if (ultima) {
    linhas.push(
      `▸ Último: ${jogo.EMOJI_CASA[ultima.k]} ${ultima.c} — ` +
        (ultima.k === 't'
          ? 'TESOURO!'
          : ultima.k === 'a'
            ? 'armadilha (queimou uma escavação extra)'
            : `vazio · ${ultima.d} tesouro(s) nas 8 casas vizinhas`)
    );
  }
  if (g.status === store.STATUS.ATIVA) {
    linhas.push('', tabuleiroTexto(g), '');
    linhas.push(`⛏️ Escave: \`${prefix}cacatesouro cavar ${g.id} A1\` (troque A1 pela casa)`);
    linhas.push(`▸ \`${prefix}cacatesouro continuar\` · \`${prefix}cacatesouro sair\``);
  } else {
    linhas.push(
      `▸ ${fimTexto(g)}`,
      `▸ 💰 Retorno: ${formatMoney(g.reward)} (aposta ${formatMoney(g.bet)}; o retorno ${
        g.reward >= g.bet ? 'inclui' : 'não cobre'
      } a aposta — lucro líquido ${formatMoney(g.reward - g.bet)})`
    );
  }
  return linhas.join('\n');
}

function painelTexto(p, prefix, cfg) {
  const m = moeda();
  if (p.indisponivel) {
    return [
      '🗺️ *CAÇA AO TESOURO*',
      `⚠️ ${p.bloqueio}`,
      '▸ Saldo: — (indisponível no momento; nenhum valor foi inventado)',
      `▸ Nova tentativa: \`${prefix}cacatesouro ${cfg.size}\``,
      `▸ Sem aposta: \`${prefix}cacatesouro rapido\``,
    ].join('\n');
  }
  if (p.bloqueio) {
    // saldo 0 (ou comprometido) não impede jogar: o casual é sem carteira
    return [
      '🗺️ *CAÇA AO TESOURO*',
      jogo.regrasTexto(cfg.size),
      '',
      '💼 *Carteira*',
      `▸ Saldo na carteira: ${formatMoney(p.saldo.wallet)} ${m.simbolo}`,
      `▸ Disponível para apostar: ${formatMoney(p.saldo.disponivel)}`,
      `⚠️ ${p.bloqueio}`,
      '',
      `🧭 Modo casual (sem apostar): \`${prefix}cacatesouro jogar ${cfg.size} casual\``,
      `⚡ Jogo rápido 3×3 (o antigo, sem aposta): \`${prefix}cacatesouro rapido\``,
    ].join('\n');
  }
  return [
    '🗺️ *CAÇA AO TESOURO*',
    jogo.regrasTexto(cfg.size),
    '',
    '💼 *Sua carteira* (lida pelo bot)',
    `▸ Saldo: ${formatMoney(p.saldo.wallet)}`,
    p.saldo.comprometido > 0 ? `▸ Comprometido em expedições abertas: ${formatMoney(p.saldo.comprometido)}` : '',
    `▸ Disponível para apostar: ${formatMoney(p.saldo.disponivel)}`,
    `▸ Aposta mínima: ${formatMoney(p.limites.min)} · máximo permitido agora: ${formatMoney(p.limites.max)}`,
    `▸ Estimativa (aposta mínima): ${formatMoney(Math.max(0, p.saldo.disponivel - p.limites.min))} depois de confirmar`,
    '',
    `▶️ Abrir expedição: \`${prefix}cacatesouro jogar ${cfg.size} <valor>\``,
    `🔄 Saldo: \`${prefix}cacatesouro saldo\` · \`${prefix}cacatesouro continuar\` · \`${prefix}cacatesouro sair\``,
    `⚡ Sem aposta: \`${prefix}cacatesouro rapido\` (jogo rápido 3×3)`,
  ]
    .filter(Boolean)
    .join('\n');
}

/* ------------------------------- envio --------------------------------- */

/** Envia o card quando permitido; devolve false para o chamador usar texto. */
async function enviarHtml(ctx, html, titulo) {
  if (!menuFormat.usarHtmlJogo().usar) return false;
  try {
    await richHtml.sendHtml(ctx.socket, ctx.remoteJid, html, { title: titulo || '🗺️ Caça ao Tesouro' });
    return true;
  } catch (err) {
    logger.warn({ err: err && err.message }, 'card do caça falhou — usando o texto');
    return false;
  }
}

async function mostrar(ctx, g, prefix, titulo) {
  let html = null;
  try {
    html = buildHtml(g, prefix);
  } catch (err) {
    // se a MONTAGEM do card falhar, o jogo continua no texto (nunca "algo deu errado")
    logger.error({ err: err && err.message, partida: g && g.id }, '[TESOURO] falha ao montar o card — usando texto');
  }
  const enviado = html ? await enviarHtml(ctx, html, titulo) : false;
  if (!enviado) await ctx.reply(resumoTexto(g, prefix));
  return true;
}

/* ------------------------------- fluxos -------------------------------- */

async function abrirPainel(ctx, prefix, size) {
  const ativa = store.ativaDo(ctx.sender);
  if (ativa) return mostrar(ctx, ativa, prefix, '🗺️ Caça ao Tesouro');

  const cfg = jogo.configDoTabuleiro(size);
  const p = dadosDoPainel(ctx.sender, cfg.size, prefix);
  const painel = betPanel.montar({
    id: 'tesouro',
    moeda: moeda(),
    saldo: p.saldo,
    limites: p.limites,
    comando: `${prefix}cacatesouro jogar ${cfg.size} {valor}`,
    comandoRefresh: `${prefix}cacatesouro ${cfg.size}`,
    regras: regrasDoJogo(cfg),
    bloqueio: p.bloqueio,
    indisponivel: p.indisponivel,
    titulo: `🗺️ Expedição ${cfg.size}×${cfg.size}`,
    rotuloConfirmar: '▶️ Confirmar aposta e abrir o mapa',
    // aposta sugerida já digitada (o saldo todo NUNCA é pré-selecionado)
    valorInicial: p.valorSugerido,
  });

  // a MONTAGEM do card fica protegida: se falhar, o painel sai em texto (o
  // jogador nunca recebe só "algo deu errado" por causa do card)
  let doc = null;
  try {
    doc =
      '<style>' + moldura.css() + cssBase() + painel.css + '</style><body><div id="__wrap"><div class="wrap">' +
      '<div class="head">🗺️ <b>CAÇA AO TESOURO</b><span>escolha o tamanho e a aposta</span></div>' +
      '<div class="tb-tamanhos">' +
      jogo.TAMANHOS.map((n) => `<span class="tb-tam${n === cfg.size ? ' on' : ''}">${n}×${n}</span>`).join('') +
      '</div>' +
      `<p class="tb-jan">Para outro tamanho: <code>${betPanel.esc(prefix)}cacatesouro &lt;3 a 13&gt;</code> · ` +
      `casual sem aposta: <code>${betPanel.esc(prefix)}cacatesouro jogar ${cfg.size} casual</code></p>` +
      painel.markup +
      '</div></div></body><script>' + painel.js + '</script>';
  } catch (err) {
    logger.error({ err: err && err.message }, '[TESOURO] falha ao montar o painel — usando texto');
  }
  const enviado = doc ? await enviarHtml(ctx, doc, '🗺️ Caça ao Tesouro') : false;
  if (!enviado) await ctx.reply(painelTexto(p, prefix, cfg));
  return true;
}

/** Abre a expedição (aposta cobrada UMA vez) e mostra o tabuleiro. */
async function jogar(ctx, prefix, sizeTexto, valorTexto) {
  const cfg = jogo.configDoTabuleiro(parseInt(sizeTexto, 10));
  const msgId = (ctx.message && ctx.message.key && ctx.message.key.id) || null;
  const estado = estadoDoJogador(ctx.sender);
  if (estado === 'indisponivel') {
    // não iniciar aposta nem casual com o cadastro/carteira sem resposta
    await ctx.reply(
      '⚠️ Não consegui consultar sua carteira agora, então NÃO abri nenhuma expedição (nada foi cobrado). ' +
        `Tente de novo: \`${prefix}cacatesouro jogar ${cfg.size} <valor>\``
    );
    return true;
  }
  // apostar NÃO exige personagem do RPG/vida: a moeda mora na carteira
  // (economy.wallet). O personagem só é usado para XP/estatística.
  const temPersonagem = estado === 'ok';
  const pediuCasual = String(valorTexto || '').toLowerCase().trim() === 'casual';

  if (pediuCasual) {
    const ref = msgId ? `${msgId}:casual` : `casual:${Date.now()}`;
    let casual;
    try {
      casual = await store.criarExpedicao({ userId: ctx.sender, chatId: ctx.remoteJid, size: cfg.size, bet: 0, ref, casual: true });
    } catch (err) {
      logger.error({ err: err && err.message }, 'não consegui abrir a expedição casual');
      await ctx.reply('⚠️ Não consegui abrir a expedição casual agora. Tente de novo em instantes.');
      return true;
    }
    const g = casual.game;
    if (casual.cobranca && casual.cobranca.jaAtiva) {
      await ctx.reply(`🗺️ Você já tem uma expedição aberta (partida \`${g.id}\`) — terminando ela você abre outra.`);
    } else {
      await ctx.reply(
        '🧭 Expedição CASUAL: sem aposta e sem prêmio em moeda — vale XP e estatística.' +
          (temPersonagem ? '' : ' (Dica: para apostar valendo, use `<valor>` no lugar de `casual`.)')
      );
    }
    return mostrar(ctx, g, prefix, '🗺️ Caça ao Tesouro (casual)');
  }

  // aposta valendo: a MESMA `ref` da mensagem garante cobrança única mesmo com
  // reenvio/clique duplo — e a mensagem repetida devolve a mesma partida
  let r;
  try {
    r = await store.criarExpedicao({
      userId: ctx.sender,
      chatId: ctx.remoteJid,
      size: cfg.size,
      bet: valorTexto,
      ref: msgId || `t${Date.now()}`,
    });
  } catch (err) {
    logger.warn({ err: err && err.message, user: ctx.sender }, 'aposta recusada');
    let lim = { saldo: null, disponivel: null, min: 1, max: null, limiteDoJogo: null };
    try {
      lim = wallet.maximoPermitido(ctx.sender, 'cacatesouro');
    } catch (_) {
      /* se nem o saldo puder ser lido, a mensagem abaixo já diz o motivo */
    }
    await ctx.reply(
      [
        '⚠️ *Aposta não aceita*',
        `▸ ${(err && (err.motivo || err.message)) || 'não consegui apostar'}`,
        lim.disponivel == null ? '▸ Não consegui consultar seu saldo agora — tente de novo.' : '',
        lim.disponivel == null ? '' : `▸ Saldo disponível: ${formatMoney(lim.disponivel)}`,
        lim.disponivel == null ? '' : `▸ Mínimo ${formatMoney(lim.min)} · máximo permitido agora ${formatMoney(lim.max)}`,
        `▸ Tente de novo: \`${prefix}cacatesouro jogar ${cfg.size} <valor>\``,
      ]
        .filter(Boolean)
        .join('\n')
    );
    return true;
  }

  const g = r.game;
  if (r.cobranca && r.cobranca.jaAtiva) {
    await ctx.reply(`🗺️ Você já tem uma expedição aberta (partida \`${g.id}\`) — nada foi cobrado de novo.`);
  } else if (r.cobranca && r.cobranca.duplicado) {
    await ctx.reply(`🗺️ Esta aposta já estava registrada (partida \`${g.id}\`) — nada foi cobrado de novo.`);
  } else {
    await ctx.reply(
      `✅ Aposta cobrada UMA vez: ${formatMoney(g.bet)} · expedição aberta no ${g.size}×${g.size} (partida \`${g.id}\`).`
    );
  }
  return mostrar(ctx, g, prefix, '🗺️ Caça ao Tesouro');
}

/** Escava uma casa (dono, partida, coordenada e repetição revalidados no bot). */
async function cavar(ctx, prefix, idTexto, coordTexto) {
  const id = String(idTexto || '').trim();
  const coord = String(coordTexto || '').trim();
  if (!id) {
    const ativa = store.ativaDo(ctx.sender);
    if (ativa) {
      await ctx.reply(`⚠️ Informe a partida: \`${prefix}cacatesouro cavar ${ativa.id} ${coord || 'A1'}\``);
      return true;
    }
    await ctx.reply(`🗺️ Você não tem expedição ativa. Abra uma: \`${prefix}cacatesouro\``);
    return true;
  }
  if (!coord) {
    await ctx.reply(`⚠️ Informe a casa: \`${prefix}cacatesouro cavar ${id} A1\``);
    return true;
  }

  const msgId = (ctx.message && ctx.message.key && ctx.message.key.id) || null;
  const r = await store.cavar({ id, userId: ctx.sender, coord, ref: msgId });
  if (!r.ok) {
    const g = r.game;
    const dica = g && g.status === store.STATUS.ATIVA
      ? `\n▸ Escave: \`${prefix}cacatesouro cavar ${g.id} ${coord.toUpperCase()}\``
      : `\n▸ \`${prefix}cacatesouro\` abre uma nova expedição`;
    await ctx.reply(`⚠️ ${r.motivo}${dica}`);
    return true;
  }

  const g = r.game;
  if (r.repetida) {
    await ctx.reply(`🔁 Esta escavação já tinha sido processada (${r.casa && r.casa.c ? r.casa.c : coord}) — nada mudou.`);
    await mostrar(ctx, g, prefix, '🗺️ Caça ao Tesouro');
    return true;
  }

  // O QUE ACONTECEU, em texto: sem isso o resultado só existia dentro do card —
  // quem não via o card (ou via pequeno) ficava sem saber que achou/não achou.
  if (r.terminou) {
    // o XP é pago pelo STORE (database/treasure.premiarXp) na mesma transação do
    // fim da expedição: aqui só mostramos o que ele registrou
    await ctx.reply([resultadoEscavacao(g, r.casa), '', fechamentoTexto(g, r, prefix, r.xp)].join('\n'));
  } else {
    await ctx.reply(resultadoEscavacao(g, r.casa, prefix));
  }
  await mostrar(ctx, g, prefix, '🗺️ Caça ao Tesouro');
  return true;
}

/**
 * Resultado de UMA escavação (o bot é quem revela — o card só repete isto).
 * Sempre traz o progresso e, na aposta valendo, quanto já rendeu até agora.
 */
function resultadoEscavacao(g, casa, prefix) {
  const k = (casa && casa.k) || 'v';
  const coord = (casa && casa.c) || '?';
  const linhas = [];
  if (k === 't') {
    linhas.push(`💎 *TESOURO na casa ${coord}!*`);
  } else if (k === 'a') {
    linhas.push(`💥 *ARMADILHA na casa ${coord}!* Queimou mais uma escavação.`);
  } else {
    linhas.push(`🕳️ Casa ${coord}: vazia.`);
  }
  if (k !== 't') linhas.push(`▸ Pista: ${Number((casa && casa.d) || 0)} tesouro(s) nas 8 casas vizinhas.`);
  linhas.push(`▸ Tesouros: ${g.treasuresFound}/${g.treasuresTotal} · escavações usadas: ${g.digsUsed}/${g.digsTotal}`);
  if (g.bet > 0) {
    const calc = jogo.calcularRecompensa({
      bet: g.bet,
      size: g.size,
      encontrados: g.treasuresFound,
      total: g.treasuresTotal,
    });
    linhas.push(`▸ Retorno acumulado: ${formatMoney(calc.total)} (pago quando a expedição termina)`);
  }
  if (prefix && g.status === store.STATUS.ATIVA) {
    linhas.push(`▸ Próxima escavação: \`${prefix}cacatesouro cavar ${g.id} <casa>\``);
  }
  return linhas.join('\n');
}

/** Fechamento: resultado, tesouros, aposta, retorno e saldo (quando houver carteira). */
function fechamentoTexto(g, r, prefix, xp) {
  const m = moeda().simbolo;
  const linhas = [];
  if (r.venceu) linhas.push(`🏆 *EXPEDIÇÃO COMPLETA!* Você achou os ${g.treasuresTotal} tesouros.`);
  else linhas.push(`💀 *Fim das escavações.* Tesouros: ${g.treasuresFound}/${g.treasuresTotal}.`);
  linhas.push(`▸ Acharam: ${g.treasuresFound} de ${g.treasuresTotal} tesouros · escavações usadas: ${g.digsUsed}/${g.digsTotal}`);
  linhas.push(`▸ Aposta: ${formatMoney(g.bet)}`);
  if (g.bet > 0) {
    const calc = r.premiado || { porTesouro: 0, bonus: 0, total: g.reward };
    linhas.push(
      `▸ Retorno: ${formatMoney(g.reward)} = ${g.treasuresFound} × ${formatMoney(calc.porTesouro)}` +
        (calc.bonus ? ` + bônus de vitória ${formatMoney(calc.bonus)}` : '') +
        ` (o retorno ${g.reward >= g.bet ? 'inclui' : 'não cobre'} a aposta)`
    );
    linhas.push(`▸ Lucro líquido: ${formatMoney(g.reward - g.bet)}`);
    try {
      linhas.push(`▸ Saldo agora: ${formatMoney(wallet.saldo(g.userId).wallet)} ${m}`);
    } catch (_) {
      linhas.push('▸ Saldo: não consegui consultar agora — use o comando de saldo.');
    }
  } else {
    linhas.push('▸ Modo casual: sem aposta, sem prêmio em moeda (vale XP e estatística).');
  }
  if (xp) linhas.push(`⭐ XP: +${xp.ganho} (${xp.tipo === 'life' ? 'Lua Life' : 'RPG'})`);
  linhas.push(`▸ Nova expedição: \`${prefix}cacatesouro\``);
  return linhas.join('\n');
}

async function continuar(ctx, prefix) {
  const ativa = store.ativaDo(ctx.sender);
  if (!ativa) {
    await ctx.reply(
      [
        '🗺️ Você não tem expedição ativa.',
        `▸ Abrir uma: \`${prefix}cacatesouro\` (escolhe tamanho e aposta)`,
        `▸ Ou o rápido 3×3 sem aposta: \`${prefix}cacatesouro rapido\``,
      ].join('\n')
    );
    return true;
  }
  return mostrar(ctx, ativa, prefix, '🗺️ Caça ao Tesouro');
}

async function sair(ctx, prefix) {
  const msgId = (ctx.message && ctx.message.key && ctx.message.key.id) || null;
  const id = String(ctx.args[1] || '').trim();
  if (!id && !store.ativaDo(ctx.sender)) {
    await ctx.reply(`🗺️ Você não tem expedição ativa para encerrar.\n▸ Abrir uma: \`${prefix}cacatesouro\``);
    return true;
  }
  const r = await store.sair({ id, userId: ctx.sender, ref: msgId });
  if (!r.ok) {
    await ctx.reply(`⚠️ ${r.motivo}`);
    return true;
  }
  const g = r.game;
  const xp = r.xp;
  await ctx.reply(
    [
      '🚪 *Expedição encerrada.*',
      `▸ Tesouros encontrados: ${g.treasuresFound}/${g.treasuresTotal}`,
      `▸ Aposta: ${formatMoney(g.bet)} — não devolvida (a regra avisa isso antes de confirmar)`,
      g.bet > 0 ? `▸ Retorno pelos tesouros achados: ${formatMoney(g.reward)}` : '▸ Modo casual: sem aposta, sem retorno em moeda.',
      g.bet > 0 ? `▸ Saldo: ${formatMoney(wallet.saldo(g.userId).wallet)}` : '',
      xp ? `⭐ XP: +${xp.ganho} (${xp.tipo === 'life' ? 'Lua Life' : 'RPG'})` : '',
      `▸ Nova expedição: \`${prefix}cacatesouro\``,
    ]
      .filter(Boolean)
      .join('\n')
  );
  return true;
}

async function regras(ctx, prefix, sizeTexto) {
  const cfg = jogo.configDoTabuleiro(parseInt(sizeTexto, 10) || 3);
  const p = dadosDoPainel(ctx.sender, cfg.size, prefix);
  await ctx.reply([jogo.regrasTexto(cfg.size), '', painelTexto(p, prefix, cfg)].join('\n'));
  return true;
}

async function saldo(ctx, prefix) {
  const p = dadosDoPainel(ctx.sender, 3, prefix);
  if (p.estado === 'indisponivel') {
    await ctx.reply(`⚠️ ${p.bloqueio}\n▸ Nova tentativa: \`${prefix}cacatesouro saldo\``);
    return true;
  }
  const stats = store.estatisticas(ctx.sender);
  const cfg3 = jogo.configDoTabuleiro(3);
  await ctx.reply(
    [
      '🗺️ *CAÇA AO TESOURO — CARTEIRA*',
      `▸ Saldo na carteira: ${formatMoney(p.saldo.wallet)}`,
      p.saldo.comprometido > 0 ? `▸ Comprometido em expedições abertas: ${formatMoney(p.saldo.comprometido)}` : '',
      `▸ Disponível para apostar: ${formatMoney(p.saldo.disponivel)}`,
      `▸ Mínimo ${formatMoney(p.limites.min)} · máximo permitido agora ${formatMoney(p.limites.max)}`,
      p.bloqueio ? '' : `▸ Abrir expedição: \`${prefix}cacatesouro jogar ${cfg3.size} <valor>\``,
      p.bloqueio ? `⚠️ ${p.bloqueio}` : '',
      '',
      `📊 Expedições: ${stats.jogos} · 🏆 ${stats.vitorias} vitórias · 💀 ${stats.derrotas} derrotas`,
      `💎 Tesouros: ${stats.tesouros} · apostado ${formatMoney(stats.apostado)} · recebido ${formatMoney(stats.recebido)}`,
    ]
      .filter(Boolean)
      .join('\n')
  );
  return true;
}

/* ------------------------- jogo rápido (o antigo) ---------------------- */

/**
 * Jogo rápido 3×3 por sessão — comportamento ORIGINAL preservado
 * (`{p}cacatesouro rapido`, 3 tentativas, `!cancelar`).
 */
async function rapido(ctx) {
  const ROWS = ['a', 'b', 'c'];
  const COLS = [1, 2, 3];
  const treasure = `${ROWS[Math.floor(Math.random() * 3)]}${COLS[Math.floor(Math.random() * 3)]}`;
  let attempts = 0;
  session.set(ctx.remoteJid, ctx.sender, {
    type: 'cacatesouro',
    onMessage: async (c) => {
      const guess = c.text.trim().toLowerCase();
      if (guess.startsWith('!cancelar')) {
        session.clear(c.remoteJid, c.sender);
        await c.reply('❌ Caça cancelada.');
        return;
      }
      if (!/^[a-c][1-3]$/.test(guess)) {
        await c.reply('🗺️ Coordenada inválida. Use a1, b2, c3...');
        return;
      }
      attempts++;
      if (guess === treasure) {
        session.clear(c.remoteJid, c.sender);
        games.recordGame(c.sender, 'cacatesouro', 'win');
        await c.reply(`💰 *Tesouro encontrado em ${guess}!* (${attempts} tentativa(s))`);
        return;
      }
      if (attempts >= 3) {
        session.clear(c.remoteJid, c.sender);
        games.recordGame(c.sender, 'cacatesouro', 'loss');
        await c.reply(`💀 Você não encontrou! O tesouro estava em *${treasure}*.`);
        return;
      }
      await c.reply(`❌ Nada em ${guess}. Tente de novo (${3 - attempts} tentativa(s) restantes).`);
    },
  });
  await ctx.reply('🗺️ *Caça ao tesouro*\\nMapa 3x3: linhas a-c, colunas 1-3.\\nDigite uma coordenada (ex.: b2). Você tem 3 tentativas!');
}

/* ------------------------------ comando -------------------------------- */

module.exports = [
  {
    name: 'cacatesouro',
    commands: ['cacatesouro', 'cacar', 'tesouro'],
    category: 'games',
    description: '🗺️ Caça ao tesouro 3×3 até 13×13, com aposta opcional na carteira.',
    usage:
      '!cacatesouro [3-13 | jogar <3-13> <valor|casual> | cavar <partida> <A1..M13> | continuar | sair | regras | saldo | rapido]',
    cooldown: 3000,
    execute: async (ctx) => {
      const prefix = prefixoDe(ctx);
      const args = ctx.args || [];
      const sub = subcomando(ctx);
      try {
        if (!sub) {
          const n = parseInt(args[0], 10);
          return await abrirPainel(ctx, prefix, Number.isFinite(n) ? n : 3);
        }
        switch (sub) {
          case 'jogar': {
            const valor = args.slice(2).join(' ').trim();
            if (!valor) {
              const cfg = jogo.configDoTabuleiro(parseInt(args[1], 10) || 3);
              return await abrirPainel(ctx, prefix, cfg.size);
            }
            return await jogar(ctx, prefix, args[1], valor);
          }
          case 'cavar':
            return await cavar(ctx, prefix, args[1], args[2]);
          case 'continuar':
            return await continuar(ctx, prefix);
          case 'sair':
            return await sair(ctx, prefix);
          case 'regras':
            return await regras(ctx, prefix, args[1]);
          case 'saldo':
            return await saldo(ctx, prefix);
          case 'rapido':
            return await rapido(ctx);
          default:
            return await abrirPainel(ctx, prefix, 3);
        }
      } catch (err) {
        const motivo = (err && err.message) || String(err);
        // o primeiro frame do stack diz ONDE falhou (arquivo:linha) — é o que
        // permite achar a causa sem precisar de print da conversa
        const onde = String((err && err.stack) || '').split('\n')[1];
        logger.error({ err: motivo, stack: err && err.stack, sub }, '[TESOURO] erro no comando');
        // o DONO recebe o motivo real (ajuda a diagnosticar); os outros, a mensagem curta
        await ctx.reply(
          ctx.isOwner
            ? `⚠️ Erro na expedição: ${motivo}${onde ? `\n▸ ${onde.trim()}` : ''}\n▸ Detalhes no log (módulo tesouro).`
            : '⚠️ Algo deu errado na expedição. Tente de novo em instantes.'
        );
      }
    },
  },
];
