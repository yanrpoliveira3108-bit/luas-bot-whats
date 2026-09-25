/**
 * menus/html/moldura.js — a moldura de TODO card HTML (menu e jogos).
 *
 * Por que existe: a altura do card precisa ser **px FIXO** e a página **não pode
 * rolar** (a rolagem acontece dentro, nos contêineres internos). Isso é o que
 * impede o host de medir o conteúdo — o comportamento medido no upstream como
 * "card tremendo", e a razão de um card poder sair minúsculo/colapsado.
 *
 * REGRESSÃO (não repetir): uma tentativa anterior usou `height:min(520px,100vh)`
 * para o card encolher em WebView baixo. Como a segunda declaração SOBREPÕE a
 * primeira, bastou o `100vh` resolver para um valor degenerado — o WebView do
 * card é dimensionado pelo próprio conteúdo, então a janela de layout mede
 * ~0-1px no primeiro layout — para o card INTEIRO colapsar numa faixa de ~1px,
 * mesmo com a declaração em px na frente. Medido: com viewport de 60px, o
 * html/body/#__wrap iam para 60px e a lista para 6px (antes: 520px/520px/309px).
 *
 * Conclusão: este WebView NÃO oferece medida de viewport confiável. Portanto
 * aqui só entra medida absoluta (`NNNpx`), sem `vh`, sem `min()`, sem
 * `@media (max-height:)`. Quem trata WebView mais baixo é o `client.js` do menu,
 * em runtime, com guardas (só encolhe se a medida for plausível — `encaixar`).
 *
 * Os números continuam num lugar só (`./dimensoes.js`); `MENU_HTML_HEIGHT`
 * sobrescreve a altura declarada, e vale para o menu E para os jogos — mudar o
 * tamanho de todos os cards é mudar um número.
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
 * `#__wrap` é o contêiner de altura cheia que recebe o conteúdo do card.
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

module.exports = { alturaDoCard, alturaValida, css, travarAltura };
