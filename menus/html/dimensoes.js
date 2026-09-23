/**
 * menus/html/dimensoes.js — TODOS os números de tamanho do card, num lugar só.
 *
 * Por que existe: o card já foi pequeno demais por causa de medidas espalhadas
 * (`height` num arquivo, `max-width` em outro, fontes em outro). Aqui ficam os
 * valores-base e a escala; `styles.js` (CSS), `templates.js` (trava de altura) e
 * `index.js` (altura pedida no envio) leem daqui — mudar o tamanho do card é
 * mudar UM número.
 *
 * REGRA QUE NÃO PODE VOLTAR (ver MENUS-HTML.md §2.1): a altura do card é px
 * FIXO, nunca unidade de viewport (`vh`/`min()`/`calc()`). No WebView do card a
 * viewport acompanha o conteúdo; um `height:min(520px,100vh)` já colapsou o card
 * inteiro numa faixa de 1px. Nada aqui depende de viewport.
 *
 * O que define o tamanho do card (evidência em MENUS-HTML.md §2.2):
 *   1. a altura em px declarada no próprio HTML — é o único controle real; o
 *      helper de referência (`htmlSection(..., {height})`) faz o mesmo: injeta
 *      `<style>html,body{height:NNpx}</style>`. NÃO existe campo de altura no
 *      payload (a primitiva carrega só payload/url/trusted_sources);
 *   2. a largura que o WebView dá ao card (a bolha da mensagem): usamos 100%
 *      dela; `larguraMax` só limita em tela larga (tablet/desktop);
 *   3. o limite do host: o card não pode ser mais alto que a área que o
 *      WhatsApp desenha. Esse teto é do aplicativo, não nosso — por isso o
 *      cliente mede em runtime (`encaixar()`) e encolhe se a janela for menor.
 */

'use strict';

/**
 * Escala geral de textos, toque e respiro (1 = como estava antes deste ajuste).
 * Use 1.0 para o card antigo, 1.15 para 15% maior, 1.3 para bem grande.
 * NÃO afeta a altura do card (essa é `altura`, abaixo) nem o passo das setas.
 */
const ESCALA = 1.15;

/** "base" px → px já escalado, como string CSS (ex.: px(13) → '15px'). */
const px = (base) => `${Math.round(base * ESCALA)}px`;

/** "base" px → número já escalado (quando o valor não é usado em CSS). */
const tam = (base) => Math.round(base * ESCALA);

const DIM = {
  escala: ESCALA,

  // ---- caixa do card -------------------------------------------------------
  /** Altura pedida ao host, em px. `MENU_HTML_HEIGHT` sobrescreve. */
  altura: 640,
  /** Faixa aceita para a altura (evita card minúsculo ou absurdo). */
  alturaMin: 240,
  alturaMax: 900,
  /**
   * Abaixo disso o cliente aperta o topo (body.curto): o cabeçalho fica com uma
   * linha, a linha da categoria na lista sai (ela já aparece no cabeçalho e na
   * aba ativa), a descrição fica com 1 linha e o rodapé some. Tudo isso é
   * espaço que vai para a lista de comandos — é o caso em que o card recebe
   * menos área do que pedimos.
   */
  alturaCurta: 480,
  /** Limite de largura em tela larga; no celular o card usa 100% da bolha. */
  larguraMax: 720,
  /** Respiro do card dentro da moldura do WebView (antes: 12px / 28px). */
  folgaLateral: 8,
  folgaInferior: 8,

  // ---- densidade (quantos comandos cabem na tela) --------------------------
  /** Altura do botão "Usar" dentro do cartão (o toque mais usado do card). */
  botaoUsar: 46,
  /** Altura do campo de busca (fica no topo fixo; cada px aqui é um px de comando). */
  busca: 50,
  /** Respiro interno do cartão de comando. */
  cartaoPadding: 10,
  /** Coluna do emoji do comando. */
  icone: 22,
  /** Linhas da descrição no cartão (o texto completo fica no painel do "Usar"). */
  descLinhas: 2,
  /** Linhas da descrição quando a área é pequena (`body.curto`). */
  descLinhasCurto: 1,

  // ---- alvos de toque ------------------------------------------------------
  /** Área mínima de toque (recomendação de acessibilidade: ≥ 48px). */
  toque: tam(48),
  /** Largura da barra das setas ↑↓ (e do ⇱) à direita. */
  rail: tam(48),
  /** Largura das setas ← → que ficam nas pontas da faixa de categorias. */
  snav: 46,
  /** Altura das abas de categoria (cabe mais categoria na largura da tela). */
  tabAltura: 48,

  // ---- passo da rolagem ----------------------------------------------------
  /** Fração da área visível andada por toque (base de `MENU_HTML_STEP`). */
  passo: 0.7,
};

module.exports = { DIM, ESCALA, px, tam };
