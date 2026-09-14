/**
 * utils/fonts.js — fontes Unicode centralizadas (identidade visual do Lua 2.0).
 *
 * Regras (item 57 do briefing):
 *  - fonte estilizada é DECORAÇÃO: nunca aplicar em comandos, URLs, IDs,
 *    telefones, tokens, caminhos ou qualquer texto que precise ser copiado;
 *  - caracteres sem equivalente no estilo caem no original (fallback), nunca
 *    viram "?" ou desaparecem;
 *  - contagem de tamanho sempre por code point (Array.from), não por .length,
 *    para não cortar um emoji/símbolo matemático no meio.
 *
 * Uso:
 *   const fonts = require('./fonts');
 *   fonts.apply('LUA BOT', 'boldScript');   // 𝓛𝓤𝓐 𝓑𝓞𝓣
 *   fonts.decorate('PLAY', 'music');        // título pronto p/ header
 *   fonts.safe('!play música', 'bold');     // NÃO estiliza o comando
 */

'use strict';

/* ----------------------------- alfabetos base ---------------------------- */

const AZ = 'abcdefghijklmnopqrstuvwxyz';
const upper = (s) => s.toUpperCase();

/** Gera mapa A-Z / a-z / 0-9 a partir de um code point inicial. */
function sequential(startUpper, startLower, startDigit) {
  const map = {};
  for (let i = 0; i < 26; i++) {
    map[upper(AZ[i])] = String.fromCodePoint(startUpper + i);
    map[AZ[i]] = String.fromCodePoint(startLower + i);
  }
  if (startDigit) {
    for (let i = 0; i < 10; i++) map[String(i)] = String.fromCodePoint(startDigit + i);
  }
  return map;
}

/** Mescla um mapa sequencial com exceções pontuais (estilos com furos). */
function withExceptions(base, exceptions) {
  return Object.assign({}, base, exceptions);
}

const STYLES = {
  // 𝐀𝐁𝐂 / 𝐚𝐛𝐜 / 𝟎𝟏𝟐
  bold: sequential(0x1d400, 0x1d41a, 0x1d7ce),
  // 𝐴𝐵𝐶 (h minúsculo não existe no bloco: ℎ U+210E)
  italic: withExceptions(sequential(0x1d434, 0x1d44e, null), { h: '\u210E' }),
  // 𝑨𝑩𝑪
  boldItalic: sequential(0x1d468, 0x1d482, null),
  // 𝒜𝒞𝒟 — com os furos clássicos do script
  script: withExceptions(sequential(0x1d49c, 0x1d4b6, null), {
    B: '\u212C', E: '\u2130', F: '\u2131', H: '\u210B', I: '\u2110', L: '\u2112',
    M: '\u2133', R: '\u211B', e: '\u212F', g: '\u210A', o: '\u2134',
  }),
  // 𝓐𝓑𝓒 (script negrito, sem furos)
  boldScript: sequential(0x1d4d0, 0x1d4ea, null),
  // 𝔄𝔅ℭ — fraktur com furos
  fraktur: withExceptions(sequential(0x1d504, 0x1d51e, null), {
    C: '\u212D', H: '\u210C', I: '\u2111', R: '\u211C', Z: '\u2128',
  }),
  // 𝖆𝖇𝖈
  boldFraktur: sequential(0x1d56c, 0x1d586, null),
  // 𝔸𝔹ℂ — double struck com furos
  double: withExceptions(sequential(0x1d538, 0x1d552, 0x1d7d8), {
    C: '\u2102', H: '\u210D', N: '\u2115', P: '\u2119', Q: '\u211A', R: '\u211D', Z: '\u2124',
  }),
  // 𝙰𝙱𝙲
  mono: sequential(0x1d670, 0x1d68a, 0x1d7f6),
  // 𝖠𝖡𝖢
  sans: sequential(0x1d5a0, 0x1d5ba, 0x1d7e2),
  // 𝗔𝗕𝗖
  sansBold: sequential(0x1d5d4, 0x1d5ee, 0x1d7ec),
  // 𝘈𝘉𝘊
  sansItalic: sequential(0x1d608, 0x1d622, null),
  // 𝘼𝘽𝘾
  sansBoldItalic: sequential(0x1d63c, 0x1d656, null),
};

/* Estilos que não são "bloco matemático": mapas explícitos. */

/** ᴀʙᴄ — small caps (minúsculas viram versaletes). */
STYLES.smallCaps = (() => {
  const lowerMap = {
    a: '\u1D00', b: '\u0299', c: '\u1D04', d: '\u1D05', e: '\u1D07', f: '\uA730',
    g: '\u0262', h: '\u029C', i: '\u026A', j: '\u1D0A', k: '\u1D0B', l: '\u029F',
    m: '\u1D0D', n: '\u0274', o: '\u1D0F', p: '\u1D18', q: '\u01EB', r: '\u0280',
    s: '\uA731', t: '\u1D1B', u: '\u1D1C', v: '\u1D20', w: '\u1D21', x: '\u0078',
    y: '\u028F', z: '\u1D22',
  };
  const map = {};
  for (const k of Object.keys(lowerMap)) {
    map[k] = lowerMap[k];
    map[upper(k)] = lowerMap[k];
  }
  return map;
})();

/** ᶠᵒⁿᵗᵉ — superescrito (modifier letters). */
STYLES.squiggle = (() => {
  const lowerMap = {
    a: '\u1D43', b: '\u1D47', c: '\u1D9C', d: '\u1D48', e: '\u1D49', f: '\u1DA0',
    g: '\u1D4D', h: '\u02B0', i: '\u2071', j: '\u02B2', k: '\u1D4F', l: '\u02E1',
    m: '\u1D50', n: '\u207F', o: '\u1D52', p: '\u1D56', q: '\u01A3', r: '\u02B3',
    s: '\u02E2', t: '\u1D57', u: '\u1D58', v: '\u1D5B', w: '\u02B7', x: '\u02E3',
    y: '\u02B8', z: '\u1DBB',
  };
  const map = {};
  for (const k of Object.keys(lowerMap)) {
    map[k] = lowerMap[k];
    map[upper(k)] = lowerMap[k];
  }
  return map;
})();

/** ＡＢＣ — fullwidth (largura cheia). */
STYLES.fullwidth = (() => {
  const map = {};
  const chars = AZ + upper(AZ) + '0123456789';
  const base = { a: 0xff41, A: 0xff21, 0: 0xff10 };
  for (const c of chars) {
    if (/[a-z]/.test(c)) map[c] = String.fromCodePoint(base.a + (c.charCodeAt(0) - 97));
    else if (/[A-Z]/.test(c)) map[c] = String.fromCodePoint(base.A + (c.charCodeAt(0) - 65));
    else map[c] = String.fromCodePoint(base[0] + Number(c));
  }
  return map;
})();

/** a̲b̲c̲ — sublinhado com combining char. */
STYLES.underline = (() => {
  const map = {};
  for (const c of AZ + upper(AZ)) map[c] = `${c}\u0332`;
  return map;
})();

/** a̶b̶c̶ — tachado com combining char. */
STYLES.strike = (() => {
  const map = {};
  for (const c of AZ + upper(AZ)) map[c] = `${c}\u0336`;
  return map;
})();

/* ------------------------------ proteção ------------------------------ */

/**
 * Trechos que NUNCA podem ser estilizados: comandos, URLs, menções de
 * arquivo/caminho, jids, telefones, tokens longos e blocos de código.
 */
const PROTECTED = [
  /```[\s\S]*?```/g, // bloco de código
  /`[^`]*`/g, // código inline
  /https?:\/\/\S+/gi, // URL
  /\b[\w.-]+\.(com|net|org|br|io|dev|app|me)\b\S*/gi, // domínio
  /[!\.?][a-z0-9]{2,}(?:\s+\S+)?/gi, // comando com prefixo (!play x)
  /\b\d{6,}\b/g, // números longos (telefone/id)
  /\b[\w.-]+@(?:s\.whatsapp\.net|g\.us|broadcast|newsletter)\b/gi, // jid
  /\b[A-Za-z0-9_./-]*(?:tmp|home|data|storage)[A-Za-z0-9_./-]*/gi, // caminho
];

/* ------------------------------- API ------------------------------- */

/** Lista de estilos disponíveis. */
function styles() {
  return Object.keys(STYLES).sort();
}

/** O estilo existe? */
function has(style) {
  return Object.prototype.hasOwnProperty.call(STYLES, style);
}

/**
 * Aplica o estilo caractere a caractere, preservando o que não tem equivalente.
 * @param {string} text
 * @param {string} style
 * @returns {string}
 */
function apply(text, style = 'bold') {
  const value = text === undefined || text === null ? '' : String(text);
  if (!value) return '';
  const map = STYLES[style];
  if (!map) return value; // estilo desconhecido → texto original (fallback)
  let out = '';
  for (const ch of value) out += map[ch] !== undefined ? map[ch] : ch;
  return out;
}

/** Tamanho real em code points (não corta emoji no meio). */
function length(text) {
  return Array.from(String(text === undefined || text === null ? '' : text)).length;
}

/**
 * Aplica o estilo SOMENTE fora dos trechos protegidos (comandos, URLs, ids...).
 * É a forma correta de estilizar uma frase que contém algo copiável.
 */
function safe(text, style = 'bold') {
  const value = String(text === undefined || text === null ? '' : text);
  if (!value) return '';
  const marks = new Array(value.length).fill(true); // true = pode estilizar
  for (const re of PROTECTED) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(value))) {
      if (!m[0]) {
        re.lastIndex++;
        continue;
      }
      for (let i = m.index; i < m.index + m[0].length; i++) marks[i] = false;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  let out = '';
  for (let i = 0; i < value.length; i++) {
    out += marks[i] ? apply(value[i], style) : value[i];
  }
  return out;
}

/** Atalhos nomeados (bold(), italic(), mono(), script()...). */
const shortcuts = {};
for (const name of Object.keys(STYLES)) {
  shortcuts[name] = (text) => apply(text, name);
}

/**
 * Título decorado pronto para cabeçalho de menu (sem tocar em comandos).
 * @param {string} title
 * @param {string} [style]
 */
function decorate(title, style = 'boldScript') {
  return safe(title, style);
}

module.exports = Object.assign(
  {
    styles,
    has,
    apply,
    safe,
    decorate,
    length,
    STYLES,
  },
  shortcuts
);
