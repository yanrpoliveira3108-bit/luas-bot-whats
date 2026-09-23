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
 *   #lua-view-list  → cabeçalho, abas, busca, lista de comandos, rodapé
 *   #lua-view-panel → painel do "Usar" (campos + comando pronto para copiar)
 * O botão "Voltar" do painel devolve a lista com categoria, busca, campos e
 * rolagem restaurados (ver menus/html/client.js).
 *
 * `info` (montado em menus/html/index.js) traz:
 *   { prefix, botName, version, botEmoji, escopoTexto, grupo, altura }
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
 * Altura fixa do card (payload). Sem isso o host mede o conteúdo e o conteúdo
 * mede o host, e o card "treme" ao rolar/abrir campos (medido no upstream).
 * O CSS tem que vir ANTES do nosso para não disputar `height`/`overflow`.
 */
function travarAltura(px) {
  const n = Math.max(240, Math.min(900, Number(px) || 520));
  return (
    `<style>html,body{margin:0;padding:0;height:${n}px;max-height:${n}px;overflow:hidden}` +
    `#__wrap{height:${n}px;overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y}</style>`
  );
}

/** Envolve o corpo no contêiner de rolagem (#__wrap) antes do client rodar. */
const ENVOLVER =
  '<script>(function(){var b=document.body,n=[],i;for(i=0;i<b.childNodes.length;i++)n.push(b.childNodes[i]);' +
  'var w=document.createElement("div");w.id="__wrap";' +
  'for(i=0;i<n.length;i++)w.appendChild(n[i]);b.appendChild(w);})();</script>';

/**
 * Documento HTML completo.
 * @param {object} info dados do bot/chat
 * @param {object} grupo { categorias, inicial, titulo, emoji, total }
 * @param {object} [opts] { categoriaLabel, busca }
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

  const abasHtml = abas ? `<nav class="tabs" role="tablist" aria-label="Categorias">${abas}</nav>` : '';
  const buscaHtml =
    '<div class="searchbar">' +
    '<input id="lua-q" type="search" inputmode="search" autocomplete="off" ' +
    'placeholder="Buscar comando (nome, descrição, categoria)…" aria-label="Buscar comando">' +
    '</div>';

  const telaLista =
    '<div class="screen" id="lua-view-list">' +
    cabecalho +
    abasHtml +
    buscaHtml +
    `<main id="lua-list">${secoes || '<p class="empty">Nenhum comando carregado.</p>'}</main>` +
    '<p class="empty" id="lua-empty" hidden>🔎 Nada encontrado. Tente outro termo.</p>' +
    '<div class="top"><button type="button" id="lua-top">↑ Voltar ao topo</button></div>' +
    comp.rodape({ prefix: info.prefix }) +
    '</div>';

  const telaPainel =
    '<div class="screen" id="lua-view-panel" hidden>' +
    '<div class="pn-top">' +
    '<button type="button" class="pn-back" data-voltar="raiz" aria-label="Voltar para a lista de comandos">← Voltar</button>' +
    '<div class="pn-title">Usar comando</div>' +
    '</div>' +
    '<div id="lua-panel-body"></div>' +
    '</div>';

  return (
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${comp.escapeHtml(info.botName)} • ${comp.escapeHtml(grupo.titulo)}</title>` +
    travarAltura(info.altura) +
    `<style>${buildCss()}</style></head>` +
    `<body data-prefix="${comp.escapeAttr(info.prefix)}"><div class="wrap" id="lua-menu">` +
    telaLista +
    telaPainel +
    `</div>${ENVOLVER}<script>${buildJs(inicial)}</script></body></html>`
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
