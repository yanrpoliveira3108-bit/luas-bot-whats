/**
 * menus/html/moldura.js — a moldura dos cards HTML (menu e jogos).
 *
 * Existem DUAS molduras de propósito:
 *
 * 1) MENU — `css()`: altura **px FIXO** + `overflow:hidden` na página, com a
 *    rolagem acontecendo dentro (`#lua-tabs`, `#lua-list`, `#lua-panel-body`,
 *    comandadas pelas setas ↑ ↓ ← →). Motivo: arrastar o dedo dentro da
 *    mensagem briga com os gestos do WhatsApp (responder), então a lista rola
 *    por botão. Aqui o corte vertical é esperado e NAVEGÁVEL.
 *
 * 2) JOGOS (caça e tigrinho) — `cssLivre()`: **nenhuma altura declarada**.
 *    Motivo medido no aparelho em 25/09: com altura fixa de 640px o card do
 *    tigrinho saiu PEQUENO e com o botão de girar CORTADO (o conteúdo passa de
 *    640px), e o tabuleiro do caça ficou com poucos botões alcançáveis — os de
 *    baixo não apareciam e não havia como rolar até eles. Regra aprendida: o
 *    WebView do card dimensiona a viewport pelo CONTEÚDO; declarar altura
 *    menor que o conteúdo = corte puro, sem rolagem. Sem declaração, o card
 *    cresce com o conteúdo e nada é cortado.
 *
 * REGRESSÃO (não repetir): uma tentativa anterior usou `height:min(520px,100vh)`.
 * Como a segunda declaração SOBREPÕE a primeira e o `100vh` resolve para um
 * valor degenerado dentro desse WebView (a janela de layout mede ~0-1px no
 * primeiro layout), o card INTEIRO colapsava numa faixa de ~1px. Medido: com
 * viewport de 60px, html/body/#__wrap iam para 60px e a lista para 6px (antes:
 * 520px/520px/309px). Portanto: nada de `vh`, `min()` ou `@media (max-height:)`
 * em altura de card — só medida absoluta (`NNNpx`) ou nenhuma medida.
 *
 * Os números do menu continuam num lugar só (`./dimensoes.js`);
 * `MENU_HTML_HEIGHT` sobrescreve a altura declarada do MENU.
 */

'use strict';

const { DIM } = require('./dimensoes');

/**
 * Altura declarada do card, em px. `MENU_HTML_HEIGHT` sobrescreve (zona da
 * faixa aceita), senão o padrão de `dimensoes.js`.
 */
function alturaDoCard() {
  const bruto = Number(process.env.MENU_HTML_HEIGHT);
  if (Number.isFinite(bruto) && bruto >= DIM.alturaMin && bruto <= DIM.alturaMax) return Math.round(bruto);
  return DIM.altura;
}

/** Altura saneada (dentro da faixa) — sempre um inteiro em px. */
function alturaValida(pedida) {
  const n = Number(pedida);
  const base = Number.isFinite(n) && n > 0 ? n : alturaDoCard();
  return Math.max(DIM.alturaMin, Math.min(DIM.alturaMax, Math.round(base)));
}

/**
 * Regras da moldura (sem a tag `<style>`, para entrar junto do CSS do card).
 * `#__wrap` é o contêiner de altura cheia do MENU (hoje quem injeta é
 * `templates.travarAltura`; `css()` fica como referência da regra do menu).
 */
function css(altura) {
  const n = alturaValida(altura);
  return (
    `html,body{margin:0;padding:0;height:${n}px;max-height:${n}px;overflow:hidden}` +
    `#__wrap{height:${n}px;max-height:${n}px;overflow:hidden;display:flex;flex-direction:column;` +
    'overscroll-behavior:contain}'
  );
}

/** A mesma moldura, já em `<style>` (uso direto nos documentos do menu). */
function travarAltura(altura) {
  return `<style>${css(altura)}</style>`;
}

/**
 * Moldura LIVRE — para os cards de JOGO (caça e tigrinho).
 *
 * Por que NÃO usar aqui a altura fixa do menu: medido no aparelho (25/09) —
 * com `height:640px;overflow:hidden` o card do tigrinho saiu cortado e o botão
 * de girar ficou fora da área visível. O WebView do card se dimensiona pelo
 * CONTEÚDO quando não há altura declarada (foi assim que os cards dos jogos
 * sempre apareceram inteiros). Então: nenhuma altura fixa, nenhum
 * `overflow:hidden` — o card cresce com o conteúdo e nada é cortado.
 *
 * O menu continua com altura fixa + rolagem interna com setas (é uma lista
 * longa, com controles próprios): lá o corte é esperado e navegável.
 */
function cssLivre() {
  return 'html,body{margin:0;padding:0;overflow-x:hidden}*{box-sizing:border-box}';
}

/**
 * Diagnóstico de tamanho DENTRO do card do jogo: toque no cabeçalho mostra a
 * área real que o aplicativo está dando (é o número que o dono consegue ler e
 * mandar de volta — sem ele, qualquer ajuste de altura é chute).
 */
function cssMedida() {
  return (
    '.mol-medida{margin:6px 2px 0;font:11px/1.4 monospace;color:#ffd86b;background:rgba(0,0,0,.45);' +
    'border:1px dashed rgba(255,216,107,.5);border-radius:8px;padding:6px 8px}' +
    '.mol-medida[hidden]{display:none}'
  );
}
function htmlMedida() {
  return '<div class="mol-medida" id="lua-medida" hidden></div>';
}
function jsMedida() {
  return (
    '(function(){\n' +
    'var el=document.getElementById("lua-medida");if(!el)return;\n' +
    'var alvo=document.querySelector(".head");\n' +
    'function med(){\n' +
    ' var raiz=document.documentElement;\n' +
    ' var h=raiz.clientHeight||0,w=raiz.clientWidth||0;\n' +
    ' var conteudo=document.body?Math.round(document.body.scrollHeight):0;\n' +
    ' var janela=window.innerHeight||0;\n' +
    ' el.textContent="area do card aqui: "+h+"px de altura x "+w+"px de largura" +\n' +
    '  " (conteudo "+conteudo+"px, janela "+janela+"px)";\n' +
    ' el.hidden=!el.hidden;\n' +
    '}\n' +
    'if(alvo)alvo.addEventListener("click",med);\n' +
    'el.addEventListener("click",med);\n' +
    '})();'
  );
}

module.exports = { alturaDoCard, alturaValida, css, travarAltura, cssLivre, cssMedida, htmlMedida, jsMedida };
