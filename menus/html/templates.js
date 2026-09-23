/**
 * menus/html/templates.js — os templates HTML, um por menu.
 *
 *   menuPrincipal(info)  → menu principal (todas as categorias)
 *   menuAdmin(info)      → menuadm (categoria admin)
 *   menuMembro(info)     → menumembros (categoria members)
 *   menuCategoria(info)  → qualquer categoria do projeto (menus/*.js)
 *
 * Os quatro compartilham components.js (cartões, abas, cabeçalho, rodapé),
 * styles.js (CSS do tema) e client.js (navegação/busca/painel do Usar). O corpo
 * é o MESMO documento: o que muda é qual aba abre ativa — assim a navegação
 * entre categorias funciona sem novas mensagens e sem duplicar template.
 *
 * Duas TELAS no mesmo documento (troca local, sem reenviar nada):
 *   #lua-view-list  → cabeçalho, abas, busca, lista de comandos
 *   #lua-view-panel → painel do "Usar" (campos + comando pronto para copiar)
 * O botão "Voltar" do painel devolve a lista com categoria, busca, campos e
 * rolagem restaurados (ver menus/html/client.js).
 *
 * ÁREAS DE ROLAGEM (cada uma independente; quem rola é sempre um contêiner
 * interno, NUNCA a página — mover a página inteira brigaria com os gestos do
 * WhatsApp, que era o problema relatado):
 *
 *   #lua-tabs   → faixa horizontal de categorias (overflow-x). Fica ENTRE as
 *                 setas ← →, que são fixas nas extremidades.
 *   #lua-list   → comandos da categoria ativa (overflow-y). Fica ao lado da
 *                 barra vertical de setas ↑ ↓.
 *   #lua-panel-body → conteúdo do painel do "Usar" (overflow-y), mesma barra.
 *
 * As setas ficam FORA das áreas de rolagem (são irmãs delas, não filhos): por
 * isso continuam no lugar enquanto o conteúdo anda e nunca cobrem um comando
 * (o espaço é reservado no layout, nada de posicionamento sobre o conteúdo).
 * É o client.js que liga/desliga cada seta conforme os limites.
 *
 * `info` (montado em menus/html/index.js) traz:
 *   { prefix, botName, version, botEmoji, escopoTexto, grupo, altura, passo }
 * `passo` = fração da área visível deslocada por toque (padrão 0.7 = 70%).
 */

'use strict';

const comp = require('./components');
const { buildCss } = require('./styles');
const { buildJs } = require('./client');

/** Emoji do comando (usa utils/commandEmoji, igual ao menu tradicional). */
function emojiDeComando(cmd) {
  try {
    return require('../../utils/commandEmoji').commandEmoji(cmd);
  } catch (_) {
    return '▸';
  }
}

/**
 * Altura do card: valor FIXO em px (igual à versão que renderizava bem).
 *
 * REGRESSÃO (não repetir): uma tentativa anterior usou
 * `height:min(520px,100vh)` para o card encolher em WebView baixo. Como a
 * segunda declaração SOBREPÕE a primeira, bastou o `100vh` resolver para um
 * valor degenerado — o WebView do card é dimensionado pelo próprio conteúdo,
 * então a janela de layout mede ~0-1px no primeiro layout — para o card
 * INTEIRO colapsar numa faixa de ~1px, mesmo com a declaração em px na frente.
 * Medido: com viewport de 60px, o html/body/#__wrap iam para 60px e a lista
 * para 6px (antes: 520px/520px/309px).
 *
 * Conclusão: este WebView NÃO oferece medida de viewport confiável. Portanto
 * aqui só entra medida absoluta (`${n}px`), sem `vh`, sem `min()`, sem
 * `@media (max-height:)`. Quem trata WebView mais baixo é o client.js, em
 * runtime, com guardas (só encolhe se a medida for plausível — ver `encaixar`).
 *
 * `overflow:hidden` no html/body/#__wrap é proposital: a página NÃO rola. Toda
 * rolagem acontece nos contêineres internos (#lua-tabs, #lua-list,
 * #lua-panel-body), o que evita o gesto de arrastar virar "responder" no
 * WhatsApp.
 */
function travarAltura(px) {
  const { DIM } = require('./dimensoes');
  const n = Math.max(DIM.alturaMin, Math.min(DIM.alturaMax, Number(px) || DIM.altura));
  return (
    `<style>html,body{margin:0;padding:0;height:${n}px;max-height:${n}px;overflow:hidden}` +
    `#__wrap{height:${n}px;max-height:${n}px;overflow:hidden;display:flex;flex-direction:column;` +
    'overscroll-behavior:contain}</style>'
  );
}

/** Envolve o corpo no contêiner (#__wrap) antes do client rodar. */
const ENVOLVER =
  '<script>(function(){var b=document.body,n=[],i;for(i=0;i<b.childNodes.length;i++)n.push(b.childNodes[i]);' +
  'var w=document.createElement("div");w.id="__wrap";' +
  'for(i=0;i<n.length;i++)w.appendChild(n[i]);b.appendChild(w);})();</script>';

/** Seta da barra vertical (rolagem dos comandos/painel). */
function setaVertical(id, dir, rotulo) {
  return (
    `<button type="button" class="vnav" id="${id}" aria-label="${rotulo}" disabled>` +
    `<span aria-hidden="true">${dir}</span></button>`
  );
}

/**
 * Documento HTML completo.
 * @param {object} info dados do bot/chat
 * @param {object} grupo { categorias, inicial, titulo, emoji, total }
 * @param {object} [opts] { categoriaLabel, foco, compacto }
 */
function documento(info, grupo, opts = {}) {
  const categorias = grupo.categorias || [];
  const inicial = String(opts.foco || grupo.inicial || '');
  const abas = categorias.map((c) => comp.abaDeCategoria(c)).join('');
  const secoes = categorias
    .map((c) =>
      comp.secaoDeCategoria(c, c.comandos, {
        prefix: info.prefix,
        emojiDe: emojiDeComando,
        compacto: opts.compacto,
        avisoCorte: c.avisoCorte,
      })
    )
    .join('');

  const rotuloInicial = (() => {
    const c = categorias.find((x) => x.id === inicial);
    return c ? `${c.emoji} ${c.title}` : grupo.titulo;
  })();

  const cabecalho = comp.cabecalho({
    botName: info.botName,
    version: info.version,
    emoji: info.botEmoji || '🌙',
    prefix: info.prefix,
    total: grupo.total,
    categoriaLabel: rotuloInicial,
    escopoTexto: info.escopoTexto,
  });

  // Faixa de categorias com as setas nas EXTREMIDADES: [←][ rolagem ][→].
  // Só as setas ficam fixas; a faixa se move entre elas.
  const tabsHtml = abas
    ? '<div class="tabsrow">' +
      '<button type="button" class="snav" id="lua-cat-prev" aria-label="Mostrar categorias anteriores" disabled>' +
      '<span aria-hidden="true">←</span></button>' +
      `<nav class="tabs" id="lua-tabs" role="tablist" aria-label="Categorias">${abas}</nav>` +
      '<button type="button" class="snav" id="lua-cat-next" aria-label="Mostrar próximas categorias" disabled>' +
      '<span aria-hidden="true">→</span></button>' +
      '</div>'
    : '';

  const buscaHtml =
    '<div class="searchbar">' +
    '<input id="lua-q" type="search" inputmode="search" autocomplete="off" ' +
    'placeholder="Buscar comando (nome, descrição, categoria)…" aria-label="Buscar comando">' +
    '</div>';

  // #lua-list é a ÁREA DE ROLAGEM dos comandos (a única coisa que as setas ↑↓
  // movem na lista). O rodapé e o "voltar ao topo" vivem no fim dela para não
  // roubar altura da área visível.
  const telaLista =
    '<div class="screen" id="lua-view-list">' +
    cabecalho +
    tabsHtml +
    buscaHtml +
    '<main id="lua-list" tabindex="-1" aria-label="Comandos da categoria">' +
    (secoes || '<p class="empty">Nenhum comando carregado.</p>') +
    '<p class="empty" id="lua-empty" hidden>🔎 Nada encontrado. Tente outro termo.</p>' +
    comp.rodape({ prefix: info.prefix }) +
    '</main>' +
    '</div>';

  const telaPainel =
    '<div class="screen" id="lua-view-panel" hidden>' +
    '<div class="pn-top">' +
    '<button type="button" class="pn-back" data-voltar="raiz" aria-label="Voltar para a lista de comandos">← Voltar</button>' +
    '<div class="pn-title">Usar comando</div>' +
    '</div>' +
    '<div id="lua-panel-body" tabindex="-1" aria-label="Comando e campos">' +
    '<div id="lua-panel-conteudo"></div>' +
    '</div>' +
    '</div>';

  // A barra vertical fica FORA das telas (irmã delas): assim continua acessível
  // na lista e no painel, nunca cobre um comando e não rola junto.
  // A barra guarda as duas setas e o atalho "topo". Nada disso rola junto com a
  // lista, então está sempre acessível — inclusive de qualquer ponto do meio.
  const barraVertical =
    '<div class="vrail" role="group" aria-label="Rolagem do conteúdo">' +
    setaVertical('lua-up', '↑', 'Rolar comandos para cima') +
    setaVertical('lua-down', '↓', 'Rolar comandos para baixo') +
    '<button type="button" class="vtop" id="lua-top" aria-label="Voltar ao topo da lista">' +
    '<span aria-hidden="true">⇱</span></button>' +
    '</div>';

  return (
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${comp.escapeHtml(info.botName)} • ${comp.escapeHtml(grupo.titulo)}</title>` +
    travarAltura(info.altura) +
    `<style>${buildCss()}</style></head>` +
    `<body data-prefix="${comp.escapeAttr(info.prefix)}"><div class="wrap" id="lua-menu">` +
    `<div class="screens" id="lua-screens">${telaLista}${telaPainel}</div>` +
    barraVertical +
    '</div>' +
    `${ENVOLVER}<script>${buildJs(inicial, { passo: info.passo, altura: info.altura })}</script></body></html>`
  );
}

/** Menu principal (`!menu`) — cartões compactos (navegar + buscar). */
function menuPrincipal(info) {
  return documento(info, { ...info.grupo }, { compacto: true });
}

/** Menu de administração (`!menuadm`) — detalhado. */
function menuAdmin(info) {
  return documento(info, info.grupo);
}

/** Menu de membros (`!menumembros`) — detalhado. */
function menuMembro(info) {
  return documento(info, info.grupo);
}

/**
 * Menu de uma categoria qualquer (usado por `menus/*.js` via categoryMenu).
 * @param {object} info
 * @param {string} [foco] id da categoria que abre ativa
 */
function menuCategoria(info, foco) {
  return documento(info, info.grupo, { foco });
}

module.exports = {
  documento,
  menuPrincipal,
  menuAdmin,
  menuMembro,
  menuCategoria,
  emojiDeComando,
  travarAltura,
};
