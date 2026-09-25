/**
 * utils/htmlTheme.js — aparência dos MENUS HTML (cores, fonte, emojis).
 *
 * FONTE ÚNICA das preferências visuais do card. Guardadas em `settings`
 * (chave `menu_html_visual`, JSON) — o mesmo armazenamento e o mesmo ESCOPO
 * GLOBAL do `!modohtml` e do `!tema` (alterar = dono). Sem nada salvo, o card
 * fica EXATAMENTE como antes: paleta do `!tema` ativo, fonte do sistema e
 * emojis ligados.
 *
 * Paleta com 2 ou 3 cores escolhidas pelo usuário:
 *   fundo (bg) · destaque principal (primary) · destaque secundário (opcional)
 * Todo o resto (texto, texto secundário, superfícies, bordas, texto sobre o
 * botão, estados) é DERIVADO com contraste calculado (WCAG) — o texto nunca
 * sai da mesma cor do fundo. Os temas prontos usam exatamente o mesmo caminho.
 *
 * Segurança: só aceita #RGB/#RRGGBB (normalizado para #RRGGBB). Nada de CSS
 * livre, URL ou HTML no lugar de cor — as variáveis saem de valores validados.
 */

'use strict';

const textStyles = require('../config/textStyles');

const KEY = 'menu_html_visual';
const ESCOPO = 'global';

/** Temas prontos (mesmo sistema das cores personalizadas). */
const PRESETS = Object.freeze({
  'preto-azul': { label: 'Preto e azul', bg: '#0B0B10', primary: '#3B82F6', secondary: null },
  'roxo-verde': { label: 'Roxo e verde', bg: '#1E1033', primary: '#22C55E', secondary: null },
  'preto-vermelho': { label: 'Preto e vermelho', bg: '#111111', primary: '#EF4444', secondary: null },
  'vermelho-roxo': { label: 'Vermelho e roxo', bg: '#2B0A10', primary: '#A855F7', secondary: '#F87171' },
  'preto-vermelho-roxo': { label: 'Preto, vermelho e roxo', bg: '#111111', primary: '#EF4444', secondary: '#A855F7' },
  'amoled-ciano': { label: 'AMOLED e ciano', bg: '#000000', primary: '#06B6D4', secondary: null },
  claro: { label: 'Claro e limpo', bg: '#F8FAFC', primary: '#2563EB', secondary: '#64748B' },
  'claro-verde': { label: 'Claro com verde discreto', bg: '#F6F8F6', primary: '#15803D', secondary: null },
});

const DEFAULTS = Object.freeze({ preset: null, bg: null, primary: null, secondary: null, emojis: true, font: 'padrao' });

/* ------------------------------ cores ------------------------------ */

/** "#abc" / "#AABBCC" → "#AABBCC"; qualquer outra coisa → null. */
function normalizarCor(txt) {
  const s = String(txt === undefined || txt === null ? '' : txt).trim();
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return '#' + h.toUpperCase();
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexDe([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Mistura a→b (t = 0..1). */
function misturar(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  return hexDe(A.map((v, i) => v + (B[i] - v) * t));
}

function luminancia(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste WCAG (1..21). */
function contraste(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgba(hex, a) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Aproxima `cor` de `alvo` até atingir o contraste mínimo com `fundo`. */
function garantirContraste(cor, fundo, alvo, minimo) {
  let c = cor;
  for (let i = 0; i < 12 && contraste(c, fundo) < minimo; i++) c = misturar(c, alvo, 0.15);
  return c;
}

/**
 * Deriva a paleta completa a partir de 2 ou 3 cores.
 * @returns {object} chaves → valores CSS já validados
 */
function derivarPaleta(bg, primary, secondary) {
  const escuro = contraste('#FFFFFF', bg) >= contraste('#000000', bg);
  const texto = escuro ? '#F8FAFC' : '#0F172A';
  const card = escuro ? misturar(bg, '#FFFFFF', 0.07) : luminancia(bg) > 0.9 ? '#FFFFFF' : misturar(bg, '#FFFFFF', 0.65);
  const bgSec = escuro ? misturar(bg, '#000000', 0.3) : misturar(bg, texto, 0.04);
  const texto2 = garantirContraste(misturar(texto, bg, 0.32), card, texto, 4.5);
  const destaqueTexto = garantirContraste(primary, card, texto, 4.5); // nomes de comando, rótulos
  const sec = secondary || misturar(primary, texto, 0.3);
  const secTexto = garantirContraste(sec, bg, texto, 3);
  const sobrePrimaria = contraste('#FFFFFF', primary) >= contraste('#0B0B0F', primary) ? '#FFFFFF' : '#0B0B0F';
  const primariaEscura = misturar(primary, '#000000', 0.28);
  return {
    escuro,
    '--lua-bg': bg,
    '--lua-bg-amoled': bg,
    '--lua-bg-secondary': bgSec,
    '--lua-card': card,
    '--lua-primary': primary,
    '--lua-primary-light': secTexto,
    '--lua-neon': destaqueTexto,
    '--lua-primary-dark': primariaEscura,
    '--lua-text': texto,
    '--lua-text-secondary': texto2,
    '--lua-accent': sec,
    '--lua-chart': sec,
    '--lua-glow': rgba(primary, 0.22),
    '--lua-secondary': sec,
    '--lua-on-primary': sobrePrimaria,
    '--lua-line': rgba(texto, escuro ? 0.1 : 0.12),
    '--lua-border': rgba(texto, escuro ? 0.15 : 0.16),
    '--lua-border-soft': rgba(texto, escuro ? 0.08 : 0.1),
    '--lua-border-strong': rgba(texto, escuro ? 0.2 : 0.24),
    '--lua-chip': rgba(texto, escuro ? 0.08 : 0.06),
    '--lua-warn-text': escuro ? '#FDE68A' : '#92400E',
    '--lua-ok-text': escuro ? '#6EE7B7' : '#047857',
    '--lua-bad-text': escuro ? '#FCA5A5' : '#B91C1C',
    '--lua-tag-dono': escuro ? '#FACC15' : '#854D0E',
    '--lua-tag-grupo': escuro ? '#93C5FD' : '#1D4ED8',
    '--lua-tag-admin': escuro ? '#FCA5A5' : '#B91C1C',
    '--lua-tag-pv': escuro ? '#6EE7B7' : '#047857',
    '--lua-scheme': escuro ? 'dark' : 'light',
  };
}

/* ------------------------------ persistência ------------------------------ */

function settingsDb() {
  return require('../database/settings');
}

function normalizar(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const bg = normalizarCor(r.bg);
  const primary = normalizarCor(r.primary);
  const temCores = !!(bg && primary);
  return {
    preset: temCores && r.preset && PRESETS[r.preset] ? r.preset : null,
    bg: temCores ? bg : null,
    primary: temCores ? primary : null,
    secondary: temCores ? normalizarCor(r.secondary) : null,
    emojis: r.emojis !== false,
    font: textStyles.resolverFonteHtml(r.font) || 'padrao',
  };
}

/** Preferências visuais atuais (sempre válidas). Nunca lança. */
function get() {
  try {
    const raw = settingsDb().get(KEY, null);
    if (!raw) return { ...DEFAULTS };
    return normalizar(JSON.parse(raw));
  } catch (_) {
    return { ...DEFAULTS };
  }
}

/**
 * Altera propriedades (as demais são preservadas). Valida TUDO antes de
 * gravar; relê do banco e só devolve se conferir (senão lança). Entrada
 * inválida nunca chega a sobrescrever a configuração anterior.
 */
function set(patch) {
  const atual = get();
  const next = { ...atual };
  if (patch.cores) {
    const bg = normalizarCor(patch.cores.bg);
    const primary = normalizarCor(patch.cores.primary);
    const temSec = patch.cores.secondary !== undefined && patch.cores.secondary !== null;
    const secondary = temSec ? normalizarCor(patch.cores.secondary) : null;
    if (!bg || !primary || (temSec && !secondary)) {
      const e = new Error('cor inválida');
      e.code = 'cor-invalida';
      throw e;
    }
    next.bg = bg;
    next.primary = primary;
    next.secondary = secondary;
    next.preset = patch.cores.preset && PRESETS[patch.cores.preset] ? patch.cores.preset : null;
  }
  if (patch.emojis !== undefined) next.emojis = !!patch.emojis;
  if (patch.font !== undefined) {
    const f = textStyles.resolverFonteHtml(patch.font);
    if (!f) {
      const e = new Error('fonte inválida');
      e.code = 'fonte-invalida';
      throw e;
    }
    next.font = f;
  }
  settingsDb().set(KEY, JSON.stringify(next));
  const relido = get();
  if (JSON.stringify(relido) !== JSON.stringify(normalizar(next))) {
    const e = new Error('a configuração relida do banco não confere');
    e.code = 'save-failed';
    throw e;
  }
  return relido;
}

/** Restaura SÓ as preferências visuais do HTML (nada mais é tocado). */
function restaurar() {
  settingsDb().set(KEY, JSON.stringify({ ...DEFAULTS }));
  const relido = get();
  if (JSON.stringify(relido) !== JSON.stringify(DEFAULTS)) {
    const e = new Error('a configuração relida do banco não confere');
    e.code = 'save-failed';
    throw e;
  }
  return relido;
}

function aplicarPreset(id) {
  const p = PRESETS[String(id || '').trim().toLowerCase()];
  if (!p) {
    const e = new Error('tema inexistente');
    e.code = 'preset-inexistente';
    throw e;
  }
  return set({ cores: { bg: p.bg, primary: p.primary, secondary: p.secondary, preset: String(id).trim().toLowerCase() } });
}

/* ------------------------------ saída CSS ------------------------------ */

/**
 * Variáveis CSS que SOBRESCREVEM o tema do `!tema` (vazio = visual padrão).
 * Todos os valores vêm de cores validadas/derivadas e de pilhas de fontes fixas.
 */
function cssOverrides(visual) {
  const v = visual || get();
  const partes = [];
  if (v.bg && v.primary) {
    const pal = derivarPaleta(v.bg, v.primary, v.secondary);
    for (const [k, val] of Object.entries(pal)) {
      if (k.startsWith('--')) partes.push(`${k}:${val}`);
    }
    // controles nativos do WebView (rolagem, placeholder) seguem o fundo
    partes.push(`color-scheme:${pal.escuro ? 'dark' : 'light'}`);
  }
  const fonte = textStyles.HTML_FONTS[v.font] || textStyles.HTML_FONTS.padrao;
  if (v.font && v.font !== 'padrao') partes.push(`--lua-font:${fonte.stack}`);
  return partes.join(';').replace(/[<>{}]/g, '');
}

/** Esquema de cor (para `color-scheme`, controles nativos do WebView). */
function esquema(visual) {
  const v = visual || get();
  if (!(v.bg && v.primary)) return 'dark';
  return derivarPaleta(v.bg, v.primary, v.secondary).escuro ? 'dark' : 'light';
}

function listarPresets() {
  return Object.entries(PRESETS).map(([id, p]) => ({ id, ...p, claro: !derivarPaleta(p.bg, p.primary, p.secondary).escuro }));
}

module.exports = {
  KEY,
  ESCOPO,
  PRESETS,
  DEFAULTS,
  normalizarCor,
  contraste,
  derivarPaleta,
  get,
  set,
  restaurar,
  aplicarPreset,
  cssOverrides,
  esquema,
  listarPresets,
};
