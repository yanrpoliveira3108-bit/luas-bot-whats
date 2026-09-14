/**
 * utils/dividers.js — biblioteca central de separadores (Lua 2.0).
 *
 * Todo separador do bot sai daqui: nada de strings decorativas espalhadas por
 * comandos/menus. Cada categoria agrupa estilos com a mesma "personalidade",
 * o que permite variar por contexto (música, admin, owner, erro...) mantendo
 * consistência.
 *
 * Uso:
 *   const divider = require('./dividers');
 *   divider('floral');            // um separador floral
 *   divider('dark', 24);          // com largura alvo
 *   divider.random('music');      // variação aleatória da categoria
 *   divider.box('PLAY');          // ╔═...╗ / título / ╚═...╝
 *   divider.pair('PLAY','music'); // { top, bottom }
 */

'use strict';

/* ------------------------------ catálogo ------------------------------ */

const CATALOG = {
  floral: [
    '◦•●◉✿  ✿◉●•◦',
    '◌⑅⃝●♡⋆♡  ♡⋆♡●⑅⃝◌',
    '*＊✿❀  ❀✿＊*',
    '✿･｡ﾟ ✿｡.･✿',
    '❀•···························•❀',
  ],
  dark: [
    '☆࿐ཽ༵༆༒  ༒༆࿐ཽ༵☆',
    '‧͙⁺˚*･༓☾  ☽༓･*˚⁺‧͙',
    '✧༺✦✮✦༻∞  ∞༺✦✮✦༻✧',
    '⋆｡°✩ ☾ ✩°｡⋆',
    '─── ◦ ◈ ◦ ───',
  ],
  minimal: [
    '· · ─ ─ ─ · ·',
    '━━━━━━ ◦ ❖ ◦ ━━━━━━',
    '┈┈┈┈┈┈┈┈┈┈┈┈',
    '─ · ─ · ─ · ─',
    '──────────',
  ],
  music: [
    '♪·.·´¯`·.·♪  ♪·.·´¯`·.·♪',
    '🎵 ───── ◦ ❖ ◦ ───── 🎵',
    '♫•*¨*•.¸¸♪  ♪¸¸.•*¨*•♫',
    '⋆⁺₊⋆ 🎧 ⋆⁺₊⋆',
  ],
  cute: [
    '(◕‿◕)♡ ─────── ♡(◕‿◕)',
    '·:¨༻ ♡ ༺¨:·',
    '˚ ༘ ೀ⋆｡˚ ⋆｡˚ ೀ༘ ˚',
    '♡･｡ﾟ  ･｡ﾟ♡',
  ],
  royal: [
    '─────────ೋღ 🌺 ღೋ─────────',
    '╔═══════ ೋღ 🌺 ღೋ ═══════╗',
    '╚═══════ ೋღ 🌺 ღೋ ═══════╝',
    '༺ ⚜ ༻  ⚜  ༺ ⚜ ༻',
    '꧁━━━༺♛༻━━━꧂',
  ],
  warning: [
    '⚠️ ━━━━━━━━━━━━ ⚠️',
    '▓▒░ ⚠ ░▒▓ ━━━━━━ ▓▒░ ⚠ ░▒▓',
    '‼️ ┈┈┈┈┈┈┈┈┈┈┈┈ ‼️',
  ],
  box: [
    '╔════════════════╗',
    '╚════════════════╝',
    '╭───────────────╮',
    '╰───────────────╯',
    '├┬┴┬┴  ┬┴┬┴┤',
  ],
  wave: [
    '≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈',
    '∿∿∿∿∿∿∿∿∿∿∿∿∿∿',
    '»»————>  <————««',
    '～～～～～～～～～～～',
  ],
  heavy: [
    '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
    '████████████████',
    '▰▰▰▰▰▰▱▱▱▱',
    '◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆',
  ],
  anime: [
    '✧･ﾟ: *✧･ﾟ:*  *:･ﾟ✧*:･ﾟ✧',
    '★彡[ ᴘʟᴀʏ ]彡★',
    '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧',
    '░▒▓█ ⋆ ⋆ ⋆ █▓▒░',
  ],
  cyber: [
    '▙▚▜▛⬛▜▛▙▚ ⏣ ⏣ ⏣',
    '⌁⌁⌁ ⏦ ⌁⌁⌁ ⏦ ⌁⌁⌁',
    '╬╬╬╬╬╬ ⎔ ╬╬╬╬╬╬',
    '▀▄▀▄▀▄ ⏃ ⏃ ⏃ ▄▀▄▀▄▀',
  ],
  classic: [
    '════════════════════',
    '────────────────────',
    '━━━━━━━━━━━━━━━━━━━━',
    '▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁',
  ],
};

const CATEGORIES = Object.keys(CATALOG);
const DEFAULT_CATEGORY = 'classic';

/** Cursor determinístico por categoria (para `divider()` variar sem repetir). */
const cursors = new Map();

function normalizeWidth(str, width) {
  const chars = Array.from(String(str));
  if (!width || chars.length >= width) return String(str);
  return String(str) + ' '.repeat(width - chars.length);
}

/* -------------------------------- API -------------------------------- */

/**
 * Um separador da categoria, alternando entre os estilos disponíveis.
 * @param {string} [category] nome da categoria OU string pronta (passa direto)
 * @param {number} [width] largura mínima (preenche com espaço)
 */
function divider(category, width) {
  if (!category) return CATALOG[DEFAULT_CATEGORY][0];
  if (!CATALOG[category]) {
    // string pronta: devolve como veio (aceita separador literal)
    return normalizeWidth(category, width);
  }
  const list = CATALOG[category];
  const i = cursors.get(category) || 0;
  cursors.set(category, (i + 1) % list.length);
  return normalizeWidth(list[i], width);
}

/** Separador aleatório da categoria (variação explícita). */
divider.random = function random(category) {
  const cat = CATALOG[category] ? category : DEFAULT_CATEGORY;
  const list = CATALOG[cat];
  return list[Math.floor(Math.random() * list.length)];
};

/** Um separador de cada categoria (para preview/auditoria). */
divider.categories = function categories() {
  return CATEGORIES.slice();
};

/** Todos os estilos de uma categoria. */
divider.of = function of(category) {
  return (CATALOG[category] || CATALOG[DEFAULT_CATEGORY]).slice();
};

/** Total de estilos disponíveis. */
divider.count = function count() {
  return CATEGORIES.reduce((n, c) => n + CATALOG[c].length, 0);
};

/**
 * Caixa com título centralizado:
 *   ╔══════════╗
 *   ║   PLAY   ║
 *   ╚══════════╝
 * @param {string} title
 * @param {{ch?: string, pad?: number, vertical?: boolean}} [opts]
 */
function box(title, opts = {}) {
  const text = String(title === undefined || title === null ? '' : title);
  const ch = opts.ch || '═';
  const vertical = opts.vertical !== false;
  const inner = Math.max(8, Array.from(text).length + (opts.pad || 6));
  const line = ch.repeat(inner);
  if (!vertical) return { top: line, bottom: line };
  const side = vertical ? '║' : '│';
  const padded = ` ${text} `.padStart(Math.ceil((inner + text.length) / 2)).padEnd(inner);
  return {
    top: `╔${line}╗`,
    bottom: `╚${line}╝`,
    body: `${side}${padded}${side}`,
    toString() {
      return `${this.top}\n${this.body}\n${this.bottom}`;
    },
  };
}
divider.box = box;

/** Par topo/base decorado (usa o estilo royal/floral do catálogo). */
divider.pair = function pair(title, category = 'royal') {
  const cat = CATALOG[category] ? category : 'royal';
  const top = CATALOG[cat].find((s) => s.includes('╔') || s.includes('༺')) || CATALOG[cat][0];
  const bottom = CATALOG[cat].find((s) => s.includes('╚') || s.includes('༻')) || top;
  return { top, bottom, body: `        ${title}` };
};

/** Versão textual de um separador com rótulo no meio: ─── LABEL ─── */
divider.label = function label(text, ch = '─', width = 26) {
  const t = ` ${String(text || '')} `;
  const total = Math.max(width, Array.from(t).length + 6);
  const side = Math.floor((total - Array.from(t).length) / 2);
  return `${ch.repeat(side)}${t}${ch.repeat(Math.max(0, total - Array.from(t).length - side))}`;
};

module.exports = divider;
module.exports.CATALOG = CATALOG;
module.exports.default = divider;
