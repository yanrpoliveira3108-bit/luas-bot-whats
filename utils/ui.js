/**
 * utils/ui.js — componentes de interface em texto (WhatsApp markdown).
 *
 * Identidade visual do Lua: divisórias, cabeçalhos, categorias, linhas de
 * comando e rodapé — tudo centralizado aqui para NÃO espalhar formatação
 * por dezenas de arquivos. Legibilidade primeiro: sem "carnaval de Unicode".
 *
 * Componentes: createHeader, createDivider, createCategory, createCommandRow,
 * createFooter, createButton · helpers: formatTitle, formatSection,
 * formatCommand, formatFooter, bold, italic, mono.
 */

'use strict';

const CONFIG = require('../config');

/* ----------------------------- markdown ------------------------------ */

function bold(s) { return `*${String(s)}*`; }
function italic(s) { return `_${String(s)}_`; }
function mono(s) { return `\`\`\`${String(s)}\`\`\``; }

/* ----------------------------- divisórias ---------------------------- */

/** Divisória grossa (default 20). */
function createDivider(length = 20) {
  const n = Math.max(6, Math.min(40, Math.floor(length)));
  return '━'.repeat(n);
}

/** Divisória fina (estilo leve). */
function thinDivider() {
  return '┄'.repeat(18);
}

/* ----------------------------- componentes --------------------------- */

/**
 * Cabeçalho em caixa:
 *   ╭──────────────────╮
 *   │  🌙 LUA          │
 *   │  Subtítulo       │
 *   ╰──────────────────╯
 */
function createHeader(title, subtitle) {
  const t = String(title || CONFIG.bot.name || 'LUA');
  const s = subtitle ? String(subtitle) : '';
  // largura = maior linha (título ou subtítulo), limitada a 40
  const width = Math.max(6, Math.min(40, Math.max(t.length, s.length) + 2));
  const line = (txt) => {
    const str = txt.length > width - 1 ? `${txt.slice(0, width - 2)}…` : txt;
    return `│ ${str}${' '.repeat(Math.max(0, width - str.length))}│`;
  };
  const bar = '─'.repeat(width);
  const lines = [`╭${bar}╮`, line(t)];
  if (s) lines.push(line(s));
  lines.push(`╰${bar}╯`);
  return lines.join('\n');
}

/** Categoria numerada: `🌙 01 • Principal` */
function createCategory(emoji, title, num) {
  const e = emoji ? `${emoji} ` : '';
  const n = num ? `${String(num).padStart(2, '0')} • ` : '';
  return `${e}${n}${title}`;
}

/** Linha de comando: `▸ !ping — Testa a resposta do bot.` */
function createCommandRow(prefix, name, description) {
  const desc = description ? ` — ${String(description).slice(0, 48)}` : '';
  return `▸ ${prefix}${name}${desc}`;
}

/** Rodapé discreto com a tagline (se habilitado). */
function createFooter(text) {
  return String(text || '');
}

/** Botão de texto (para menus numerados): `[ 1 ] • 🌙 Principal`. */
function createButton(num, label) {
  return `[ ${num} ] • ${label}`;
}

/* ----------------------------- atalhos ------------------------------- */

function formatTitle(text) {
  return bold(String(text || ''));
}

function formatSection(title) {
  return `${createDivider()}\n${bold(title)}`;
}

function formatCommand(prefix, name, description) {
  return createCommandRow(prefix, name, description);
}

function formatFooter(text) {
  return createFooter(text);
}

module.exports = {
  bold,
  italic,
  mono,
  createDivider,
  thinDivider,
  createHeader,
  createCategory,
  createCommandRow,
  createFooter,
  createButton,
  formatTitle,
  formatSection,
  formatCommand,
  formatFooter,
};
