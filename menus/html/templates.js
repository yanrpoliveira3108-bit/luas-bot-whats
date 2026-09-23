/**
 * menus/html/templates.js — os templates HTML, um por menu.
 *
 *   menuPrincipal(info)  → menu principal (todas as categorias)
 *   menuAdmin(info)      → menuadm (categoria admin)
 *   menuMembro(info)     → menumembros (categoria members)
 *   menuCategoria(info)  → qualquer categoria do projeto (menus/*.js)
 *
 * Os quatro compartilham components.js (cartões, abas, cabeçalho, rodapé),
 * styles.js (CSS do tema) e client.js (JS de navegação/busca). O corpo é o
 * MESMO documento: o que muda é qual aba abre ativa — assim a navegação entre
 * categorias funciona sem novas mensagens e sem duplicar template.
 *
 * `info` (montado em menus/html/index.js) traz:
 *   { prefix, botName, version, botDigits, botEmoji, escopoTexto, grupo }
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
        botDigits: info.botDigits,
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

  return (
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${comp.escapeHtml(info.botName)} • ${comp.escapeHtml(grupo.titulo)}</title>` +
    `<style>${buildCss()}</style></head><body><div class="wrap" id="lua-menu">` +
    cabecalho +
    abasHtml +
    buscaHtml +
    `<main id="lua-list">${secoes || '<p class="empty">Nenhum comando carregado.</p>'}</main>` +
    '<p class="empty" id="lua-empty" style="display:none">🔎 Nada encontrado. Tente outro termo.</p>' +
    '<div class="top"><button type="button" id="lua-top">↑ Voltar ao topo</button></div>' +
    comp.rodape({ prefix: info.prefix, botDigits: info.botDigits }) +
    `</div><script>${buildJs(inicial)}</script></body></html>`
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

module.exports = { documento, menuPrincipal, menuAdmin, menuMembro, menuCategoria, emojiDeComando };
