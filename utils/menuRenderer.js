/**
 * utils/menuRenderer.js — renderizador central de menus (Lua Bot 2.0).
 *
 * É o ponto único que transforma dados (categorias, comandos, status) em texto
 * de menu. Tudo que é visual vem dos módulos centrais:
 *   fonts    → estilo do título (apresentação)
 *   dividers → barras e separadores (por modo/contexto)
 *   icons    → ícones por categoria
 *   uiKit    → limites do WhatsApp (truncate/paginate)
 *
 * REGRA: comandos executáveis, URLs e ids NUNCA são estilizados. Só o que é
 * decoração passa por fonts.
 */

'use strict';

const fonts = require('./fonts');
const divider = require('./dividers');
const icons = require('./icons');
const ui = require('./uiKit');
const CONFIG = require('../config');
const settings = require('../database/settings');
const groups = require('../database/groups');

/** Modos visuais (briefing 12/82/83): fonte + família de separadores. */
const MODES = {
  default: { label: 'Padrão 🌙', font: 'boldScript', div: 'royal', hint: 'o clássico do Lua' },
  dark: { label: 'Dark 🖤', font: 'fraktur', div: 'dark', hint: 'sério, alto contraste' },
  cute: { label: 'Cute 🌸', font: 'script', div: 'cute', hint: 'floral e delicado' },
  minimal: { label: 'Minimal ⚪', font: 'sans', div: 'minimal', hint: 'limpo, sem enfeite' },
  royal: { label: 'Royal 👑', font: 'boldItalic', div: 'floral', hint: 'floral nobre' },
  cyber: { label: 'Cyber ⚡', font: 'mono', div: 'cyber', hint: 'tech, monoespaçado' },
};

const SETTING_KEY = 'menuMode';
const DEFAULT_MODE = 'default';

const isGroup = (jid) => /@g\.us$/.test(String(jid || ''));

/** Modo do grupo (se definido); senão o global; senão o padrão. */
function currentModeName(jid) {
  if (isGroup(jid)) {
    try {
      const gs = groups.getSettings(jid) || {};
      const val = String(gs[SETTING_KEY] || '').toLowerCase().trim();
      if (MODES[val]) return val;
    } catch (_) {
      /* grupo ainda sem linha no banco — segue para o global */
    }
  }
  try {
    const raw = String(settings.get(SETTING_KEY, DEFAULT_MODE) || DEFAULT_MODE).toLowerCase().trim();
    if (MODES[raw]) return raw;
  } catch (_) {
    /* banco fechado (startup/testes) — não quebra o menu */
  }
  return DEFAULT_MODE;
}

/** Escopo em que o modo vale: o grupo, ou global no PV. */
function modeScope(jid) {
  return isGroup(jid) ? 'grupo' : 'global';
}

function mode(name) {
  return MODES[name] || MODES[DEFAULT_MODE];
}

/** Modo efetivo para um chat. */
function modeFor(jid) {
  return MODES[currentModeName(jid)];
}

function setMode(name, jid) {
  const key = String(name || '').toLowerCase().trim();
  if (!MODES[key]) return false;
  try {
    if (isGroup(jid)) groups.setSetting(jid, SETTING_KEY, key);
    else settings.set(SETTING_KEY, key);
  } catch (_) {
    return false;
  }
  return true;
}

function listModes(jid) {
  const active = currentModeName(jid);
  return Object.keys(MODES).map((id) => Object.assign({ id, active: id === active }, MODES[id]));
}

/* ----------------------------- decoração ----------------------------- */

/** Estiliza APENAS apresentação (títulos, seções). */
function style(text, fontName, jid) {
  // fonts.apply(texto, estilo) — a ordem importa: texto primeiro
  return fonts.apply(String(text == null ? '' : text), fontName || modeFor(jid).font);
}

/** Comando executável: sempre texto puro, copiável. */
function command(prefix, name) {
  const p = prefix || (CONFIG.bot && CONFIG.bot.prefix) || '!';
  return `${p}${name}`;
}

/** Separador do modo atual (ou de outra categoria, por contexto). */
function dividerLine(kind, jid) {
  return divider(kind || modeFor(jid).div);
}

/** Separador variado: alterna por contexto para não repetir sempre o mesmo. */
function dividerFor(context, jid) {
  const byContext = {
    music: 'music',
    audio: 'music',
    downloads: 'wave',
    download: 'wave',
    sticker: 'cute',
    stickers: 'cute',
    admin: 'heavy',
    moderation: 'heavy',
    owner: 'royal',
    group: 'classic',
    ai: 'cyber',
    error: 'warning',
    warning: 'warning',
    system: 'minimal',
    general: 'classic',
    games: 'anime',
    anime: 'anime',
    fun: 'cute',
    utility: 'minimal',
  };
  return divider(byContext[String(context || '').toLowerCase()] || modeFor(jid).div);
}

function formatUptime(ms) {
  const s = Math.max(0, Math.floor((ms || process.uptime() * 1000) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/* ----------------------------- componentes ---------------------------- */

/**
 * Cabeçalho em caixa com o título estilizado.
 * header({ title: 'LUA BOT', subtitle: '...' })
 */
function header(opts = {}) {
  const title = String(opts.title == null ? CONFIG.bot.name : opts.title);
  const box = divider.box(style(title, opts.font, opts.jid), 26);
  const lines = [box.top, box.body, box.bottom];
  if (opts.subtitle) lines.push('', ui.truncate(String(opts.subtitle), 120));
  return lines.join('\n');
}

/** Linha de item. `text` chega pronto — se for comando, chega puro. */
function row(opts = {}) {
  const icon = opts.icon ? `${opts.icon} ` : '';
  const bullet = opts.bullet || '▸';
  const note = opts.note ? ` — ${ui.truncate(String(opts.note), 60)}` : '';
  return `${bullet} ${icon}${opts.text || ''}${note}`.trimEnd();
}

/** Seção com título estilizado + separador por contexto. */
function section(opts = {}) {
  const title = String(opts.title || '').toUpperCase();
  const icon = opts.emoji || (opts.category ? icons.forCategory(opts.category) : '') || '';
  const head = `${icon ? `${icon} ` : ''}${style(title, opts.font, opts.jid)}`;
  const lines = [head, dividerFor(opts.category || opts.context, opts.jid)];
  for (const item of opts.items || []) lines.push(typeof item === 'string' ? item : row(item));
  return lines.join('\n');
}

/** Indicador de paginação honesto (nada de % inventado). */
function page(opts = {}) {
  const pages = Math.max(1, Number(opts.pages) || 1);
  const page = Math.min(Math.max(1, Number(opts.page) || 1), pages);
  const filled = Math.max(1, Math.round((page / pages) * 10));
  return `📄 Página ${page}/${pages} ${'▰'.repeat(filled)}${'▱'.repeat(Math.max(0, 10 - filled))}`;
}

/** Rodapé com dicas (comandos em texto puro). */
function footer(opts = {}) {
  const lines = [dividerLine(opts.div, opts.jid)];
  for (const hint of opts.hints || []) lines.push(`╰─➤ ${hint}`);
  lines.push('');
  lines.push(
    `${icons.get('clock') || '🕒'} ${CONFIG.bot.name} v${CONFIG.bot.version} • ${formatUptime()}`.trim()
  );
  return lines.join('\n');
}

/** Bloco de status (versão/uptime/comandos/status). */
function statusBlock(info = {}) {
  const lines = [
    `🟢 Status : ${info.status || 'Online'}`,
    `📦 Version: ${CONFIG.bot.version}`,
    `⏱️ Uptime : ${formatUptime(info.uptimeMs)}`,
    `🧩 Comands: ${Number.isFinite(Number(info.commands)) ? info.commands : 0}`,
  ];
  if (info.prefix) lines.push(`⚡ Prefix : ${info.prefix}`);
  if (info.user) lines.push(`👤 User   : ${info.user}`);
  return lines.join('\n');
}

/**
 * Menu principal completo.
 * mainMenu({ categories: [{ id, title, emoji }], ... })
 */
function mainMenu(opts = {}) {
  const parts = [
    header({
      title: opts.title || CONFIG.bot.name,
      subtitle: opts.subtitle || '«WhatsApp Multi-Function System»',
      jid: opts.jid,
    }),
    '',
    statusBlock(opts),
    '',
    dividerLine(null, opts.jid),
    '',
  ];
  const categories = opts.categories || [];
  for (const cat of categories) {
    parts.push(`${cat.emoji || icons.forCategory(cat.id) || '◈'} ${cat.title}`);
  }
  parts.push('');
  parts.push(
    footer({
      jid: opts.jid,
      hints: opts.hints || [`${opts.prefix || '!'}menu <categoria>`, `${opts.prefix || '!'}help <comando>`],
    })
  );
  return parts.join('\n');
}

module.exports = {
  MODES,
  DEFAULT_MODE,
  SETTING_KEY,
  mode,
  modeFor,
  modeScope,
  setMode,
  listModes,
  currentModeName,
  style,
  command,
  dividerLine,
  dividerFor,
  formatUptime,
  header,
  row,
  section,
  page,
  footer,
  statusBlock,
  mainMenu,
};
