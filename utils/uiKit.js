/**
 * utils/uiKit.js — camada central de componentes visuais (Lua 2.0).
 *
 * Tudo que é "cara do bot" sai daqui: cabeçalhos, separadores, cards, barras
 * de progresso, listas, mensagens de erro/sucesso/loading. Nenhum comando
 * monta template visual na mão.
 *
 *   const ui = require('../utils/uiKit');
 *   ui.header('PLAY', 'music');
 *   ui.card('Resultado', [['Título', t], ['Duração', d]], 'music');
 *   ui.progress(45);            // ▰▰▰▰▱▱▱▱▱▱ 45%
 *   ui.success('Sticker criado!');
 *
 * Regras:
 *  - comandos/URLs/ids nunca são estilizados (fonts.safe);
 *  - tamanho sempre por code point (truncate não corta emoji no meio);
 *  - nenhuma string visual duplicada: fontes/dividers/ícones vêm dos módulos.
 */

'use strict';

const fonts = require('./fonts');
const divider = require('./dividers');
const icons = require('./icons');

/* ------------------------------ limites WhatsApp ------------------------------ */

const LIMITS = {
  message: 4000, // legenda/texto
  caption: 1024,
  footer: 120,
  button: 24,
  listRow: 24,
  listDesc: 72,
  buttons: 3,
  listRows: 10,
};

/* ------------------------------ texto seguro ------------------------------ */

/** Trunca por code point sem quebrar emoji/combining. */
function truncate(text, max = 200, suffix = '…') {
  const value = String(text === undefined || text === null ? '' : text);
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  const cut = chars.slice(0, Math.max(0, max - Array.from(suffix).length)).join('');
  return cut + suffix;
}

/** Texto pronto para o WhatsApp: normaliza quebras e remove controle. */
function safeText(text, max = LIMITS.message) {
  let s = String(text === undefined || text === null ? '' : text);
  s = s.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, ' ');
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return truncate(s, max);
}

/** Quebra em páginas de N itens. */
function paginate(items, page = 0, size = 10) {
  const list = Array.isArray(items) ? items : [];
  const per = Math.max(1, size);
  const pages = Math.max(1, Math.ceil(list.length / per));
  const index = Math.min(Math.max(0, page), pages - 1);
  return {
    page: index,
    pages,
    total: list.length,
    items: list.slice(index * per, index * per + per),
    hasNext: index < pages - 1,
    hasPrev: index > 0,
  };
}

/* ------------------------------ componentes ------------------------------ */

/** Cabeçalho com caixa + título estilizado (comandos nunca estilizados). */
function header(title, category = 'system', opts = {}) {
  const th = icons.theme(category);
  const style = opts.style || 'boldScript';
  const label = opts.raw ? String(title) : fonts.safe(String(title), style);
  const box = divider.box(`${th.icon} ${label}`, { pad: opts.pad });
  return `${box.top}\n${box.body}\n${box.bottom}`;
}

/** Rodapé padrão (versão + prefixo, sem repetir em cada comando). */
function footer(text, opts = {}) {
  const CONFIG = require('../config');
  const base = text || `${CONFIG.bot.name} • v${CONFIG.bot.version}`;
  return truncate(safeText(base, LIMITS.footer), opts.max || LIMITS.footer);
}

/** Separador (delega ao catálogo central). */
function div(category, width) {
  return divider(category, width);
}

/** Linha "chave: valor" com ícone. */
function row(label, value, icon) {
  const ic = icon || '';
  return `${ic ? ic + ' ' : ''}*${label}:* ${value === undefined || value === null ? '-' : value}`;
}

/** Card com bordas e linhas (ui.card('INFO', [['Versão','2.0']], 'music')). */
function card(title, rows, category = 'system', opts = {}) {
  const th = icons.theme(category);
  const lines = (rows || []).filter((r) => r && r[0] !== undefined);
  const width = Math.max(
    18,
    ...lines.map(([k, v]) => Array.from(`${k}: ${v}`).length + 4),
    Array.from(String(title)).length + 10
  );
  const top = `╭─〔 ${th.icon} ${fonts.safe(String(title), opts.style || 'bold')} 〕`;
  const bottom = `╰${'─'.repeat(Math.min(width, 26))}`;
  const body = lines.length
    ? ['│', ...lines.map(([k, v, ic]) => `│ ${row(k, v, ic)}`), '│'].join('\n')
    : '';
  return [top, body, bottom].filter(Boolean).join('\n');
}

/**
 * Barra de progresso. Só use com progresso REAL (item 17): sem percentual,
 * use `states()` para mostrar a etapa atual.
 * @param {number} percent 0..100
 * @param {{width?: number, filled?: string, empty?: string, showPercent?: boolean}} [opts]
 */
function progress(percent, opts = {}) {
  const width = opts.width || 10;
  const filled = opts.filled || '▰';
  const empty = opts.empty || '▱';
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const n = Math.round((p / 100) * width);
  const bar = filled.repeat(n) + empty.repeat(width - n);
  return opts.showPercent === false ? bar : `${bar} ${p}%`;
}

/** Barra "block" (█▒) — estilo alternativo. */
function progressBar(percent, opts = {}) {
  return progress(percent, Object.assign({ filled: '█', empty: '▒' }, opts || {}));
}

/** Lista numerada simples. */
function list(items, opts = {}) {
  const start = (opts && opts.start) || 1;
  return (items || [])
    .map((it, i) => {
      const text = typeof it === 'string' ? it : it && it.label ? String(it.label) : String(it);
      return `${start + i}. ${truncate(safeText(text, 160), 160)}`;
    })
    .join('\n');
}

/** Botão (id + rótulo sanitizado). */
function button(id, label, opts = {}) {
  return {
    id: String(id || '').slice(0, 64),
    text: truncate(safeText(label, LIMITS.button).replace(/\n/g, ' '), opts.max || LIMITS.button),
  };
}

/* ------------------------------ mensagens ------------------------------ */

/** Mensagem de erro uniforme — nunca expõe stack/token/caminho. */
function error(message, opts = {}) {
  const title = opts.title || 'ERRO';
  const body = truncate(safeText(message || 'Não consegui processar sua solicitação.', 400), 400);
  const reason = opts.reason ? `\n│\n│ Motivo: ${truncate(safeText(opts.reason, 200), 200)}` : '';
  const hint = opts.hint ? `\n│\n│ ${truncate(safeText(opts.hint, 200), 200)}` : '';
  // título do erro fica SEM fonte estilizada: é rótulo técnico e precisa ser
  // legível (e copiável) — decoração só em menu/cabeçalho de categoria.
  return `╭─〔 ${icons.error} ${safeText(title, 40)} 〕\n│\n│ ${body}${reason}${hint}\n│\n╰${'─'.repeat(14)}`;
}

/** Mensagem de sucesso. */
function success(message, opts = {}) {
  const d = divider(opts.divider || 'floral');
  return `${d}\n${icons.success} ${safeText(message, 300)}\n${d}`;
}

/** Mensagem de loading (sem porcentagem inventada). */
function loading(message, opts = {}) {
  const style = opts.style || 0;
  const frames = [
    (t) => `⋘ ${t} ⋙`,
    (t) => `⏳ ${t}...`,
    (t) => `${icons.loading} ${t}`,
    (t) => `▰▱▱ ${t}`,
  ];
  return frames[style % frames.length](safeText(message || 'Aguarde', 200));
}

/** Sem permissão. */
function permission(message, opts = {}) {
  return `${icons.lock} ${safeText(message || 'Você não tem permissão para usar este comando.', 240)}${
    opts && opts.need ? `\n▸ Necessário: ${safeText(opts.need, 120)}` : ''
  }`;
}

/** Não encontrado (com sugestões). */
function notFound(what, suggestions = [], opts = {}) {
  const lines = (suggestions || []).map((s) => `▸ ${opts.prefix || '!'}${s}`).join('\n');
  return `${icons.search || '🔎'} Não encontrei *${safeText(what, 60)}*.${
    lines ? `\n\n💡 Talvez você queira:\n${lines}` : ''
  }`;
}

/** Informação simples. */
function info(message, opts = {}) {
  return `${icons.info} ${safeText(message, 300)}${opts && opts.divider ? `\n${divider(opts.divider)}` : ''}`;
}

/* ------------------------------ legado ------------------------------ */

const legacy = require('./ui');

module.exports = {
  LIMITS,
  // texto
  truncate,
  safeText,
  paginate,
  // componentes
  header,
  footer,
  divider: div,
  row,
  card,
  progress,
  progressBar,
  list,
  button,
  // mensagens
  messages: { error, success, loading, permission, notFound, info },
  error,
  success,
  loading,
  permission,
  notFound,
  info,
  // módulos centrais (reexportados para um único ponto de import)
  fonts,
  divider2: divider,
  icons,
  legacy,
};
