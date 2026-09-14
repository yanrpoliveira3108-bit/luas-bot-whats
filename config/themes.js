/**
 * config/themes.js — sistema central de temas/presets do Lua.
 *
 * Identidade: Lua + noite + roxo + espaço + tecnologia + elegância.
 * Todas as cores vivem AQUI (variáveis centrais) — nunca espalhadas pelos
 * comandos. Cada preset expõe as mesmas chaves, para que HTML, imagens e
 * textos usem a mesma fonte de verdade.
 *
 * Presets:
 *   LUA_NIGHT · LUA_VIOLET · LUA_GALAXY · LUA_MYSTIC · LUA_ECLIPSE
 *   LUA_COSMIC · LUA_ROYAL · LUA_LAVENDER · LUA_NEON · LUA_AMOLED
 */

'use strict';

/**
 * Chaves de cor de um tema:
 *   bg            — fundo da página (HTML) / superfície raiz
 *   bgAmoled      — preto AMOLED puro (economia de energia)
 *   bgSecondary   — fundo secundário (seções)
 *   card          — fundo de cards/painéis
 *   primary       — roxo principal
 *   primaryLight  — roxo claro
 *   neon          — roxo neon (destaque brilhante)
 *   primaryDark   — roxo escuro
 *   textPrimary   — texto principal
 *   textSecondary — texto secundário
 *   accent        — destaque (detalhes)
 *   chart         — cor da linha do gráfico de latência
 *   glow          — cor do glow/brilho
 */
const THEMES = {
  LUA_NIGHT: {
    id: 'LUA_NIGHT',
    name: 'Lua Night',
    emoji: '🌙',
    tagline: 'Beyond the ordinary.',
    bg: '#05030A',
    bgAmoled: '#000000',
    bgSecondary: '#0B0614',
    card: '#120A1F',
    primary: '#8B5CF6',
    primaryLight: '#A78BFA',
    neon: '#C084FC',
    primaryDark: '#4C1D95',
    textPrimary: '#FFFFFF',
    textSecondary: '#B8A9D9',
    accent: '#D8B4FE',
    chart: '#A78BFA',
    glow: 'rgba(139,92,246,.45)',
  },

  LUA_VIOLET: {
    id: 'LUA_VIOLET',
    name: 'Lua Violet',
    emoji: '💜',
    tagline: 'Powered by the night.',
    bg: '#0A0512',
    bgAmoled: '#000000',
    bgSecondary: '#12072A',
    card: '#1A0F33',
    primary: '#9D4EDD',
    primaryLight: '#C77DFF',
    neon: '#D8A6FF',
    primaryDark: '#5A189A',
    textPrimary: '#FFFFFF',
    textSecondary: '#C9B6E4',
    accent: '#E0AAFF',
    chart: '#C77DFF',
    glow: 'rgba(157,78,221,.45)',
  },

  LUA_GALAXY: {
    id: 'LUA_GALAXY',
    name: 'Lua Galaxy',
    emoji: '🌌',
    tagline: 'Powered by the night.',
    bg: '#05060F',
    bgAmoled: '#000000',
    bgSecondary: '#070B1A',
    card: '#0D1226',
    primary: '#7C6CF6',
    primaryLight: '#9E8CFA',
    neon: '#6E7BFF',
    primaryDark: '#3C1D95',
    textPrimary: '#FFFFFF',
    textSecondary: '#A9B4E8',
    accent: '#A5B4FC',
    chart: '#6E7BFF',
    glow: 'rgba(110,123,255,.45)',
  },

  LUA_MYSTIC: {
    id: 'LUA_MYSTIC',
    name: 'Lua Mystic',
    emoji: '🔮',
    tagline: 'Beyond the ordinary.',
    bg: '#0A0412',
    bgAmoled: '#000000',
    bgSecondary: '#0D0517',
    card: '#160A24',
    primary: '#7B2FBF',
    primaryLight: '#A66BE0',
    neon: '#9D4EDD',
    primaryDark: '#3A0E5E',
    textPrimary: '#FFFFFF',
    textSecondary: '#C3A8E0',
    accent: '#C9A0F0',
    chart: '#A66BE0',
    glow: 'rgba(123,47,191,.5)',
  },

  LUA_ECLIPSE: {
    id: 'LUA_ECLIPSE',
    name: 'Lua Eclipse',
    emoji: '🌑',
    tagline: 'Powered by the night.',
    bg: '#040308',
    bgAmoled: '#000000',
    bgSecondary: '#060409',
    card: '#0A0710',
    primary: '#6D4A9E',
    primaryLight: '#8A6BB8',
    neon: '#5B3D85',
    primaryDark: '#2A1A40',
    textPrimary: '#FFFFFF',
    textSecondary: '#9A8FA8',
    accent: '#8A6BB8',
    chart: '#8A6BB8',
    glow: 'rgba(109,74,158,.35)',
  },

  LUA_COSMIC: {
    id: 'LUA_COSMIC',
    name: 'Lua Cosmic',
    emoji: '☄️',
    tagline: 'Beyond the ordinary.',
    bg: '#05070F',
    bgAmoled: '#000000',
    bgSecondary: '#060A14',
    card: '#0C1120',
    primary: '#8B5CF6',
    primaryLight: '#A78BFA',
    neon: '#60A5FA',
    primaryDark: '#312E81',
    textPrimary: '#FFFFFF',
    textSecondary: '#A5B4E0',
    accent: '#93C5FD',
    chart: '#60A5FA',
    glow: 'rgba(96,165,250,.4)',
  },

  LUA_ROYAL: {
    id: 'LUA_ROYAL',
    name: 'Lua Royal',
    emoji: '👑',
    tagline: 'Beyond the ordinary.',
    bg: '#07040C',
    bgAmoled: '#000000',
    bgSecondary: '#0A0612',
    card: '#140A20',
    primary: '#6D28D9',
    primaryLight: '#A78BFA',
    neon: '#C084FC',
    primaryDark: '#3B0764',
    textPrimary: '#FFFFFF',
    textSecondary: '#C0AEE0',
    accent: '#F5C542',
    chart: '#A78BFA',
    glow: 'rgba(245,197,66,.35)',
  },

  LUA_LAVENDER: {
    id: 'LUA_LAVENDER',
    name: 'Lua Lavender',
    emoji: '🪻',
    tagline: 'Powered by the night.',
    bg: '#0D0A16',
    bgAmoled: '#000000',
    bgSecondary: '#0F0B18',
    card: '#171126',
    primary: '#B39DDB',
    primaryLight: '#D1C4E9',
    neon: '#C4A5E8',
    primaryDark: '#7E57C2',
    textPrimary: '#FFFFFF',
    textSecondary: '#CBC0E0',
    accent: '#E6D9FF',
    chart: '#C4A5E8',
    glow: 'rgba(179,157,219,.4)',
  },

  LUA_NEON: {
    id: 'LUA_NEON',
    name: 'Lua Neon',
    emoji: '⚡',
    tagline: 'Beyond the ordinary.',
    bg: '#080310',
    bgAmoled: '#000000',
    bgSecondary: '#0B0414',
    card: '#140720',
    primary: '#A855F7',
    primaryLight: '#C084FC',
    neon: '#D946EF',
    primaryDark: '#6B21A8',
    textPrimary: '#FFFFFF',
    textSecondary: '#C7A8E8',
    accent: '#F0ABFC',
    chart: '#D946EF',
    glow: 'rgba(217,70,239,.5)',
  },

  LUA_AMOLED: {
    id: 'LUA_AMOLED',
    name: 'Lua AMOLED',
    emoji: '🖤',
    tagline: 'Powered by the night.',
    bg: '#000000',
    bgAmoled: '#000000',
    bgSecondary: '#000000',
    card: '#0A0A0C',
    primary: '#8B5CF6',
    primaryLight: '#A78BFA',
    neon: '#C084FC',
    primaryDark: '#4C1D95',
    textPrimary: '#FFFFFF',
    textSecondary: '#8E8E93',
    accent: '#D8B4FE',
    chart: '#8B5CF6',
    glow: 'rgba(139,92,246,.3)',
  },
};

const DEFAULT_THEME = 'LUA_NIGHT';

/** Lista ordenada de presets (para exibição/!tema). */
function list() {
  return Object.values(THEMES).map((t) => ({
    id: t.id,
    name: t.name,
    emoji: t.emoji,
    tagline: t.tagline,
  }));
}

/** Resolve um id de tema (case-insensitive). Sempre retorna um tema válido. */
function get(id) {
  const key = String(id || '').trim().toUpperCase();
  return THEMES[key] || THEMES[DEFAULT_THEME];
}

function exists(id) {
  return Object.prototype.hasOwnProperty.call(THEMES, String(id || '').trim().toUpperCase());
}

/** Cores de um tema (objeto simples, para uso em código). */
function colorsOf(id) {
  const t = get(id);
  return { ...t };
}

/**
 * Variáveis CSS (custom properties) de um tema — usadas pelo HTML do ping2
 * e por qualquer outro componente HTML futuro.
 */
function cssVars(id) {
  const t = get(id);
  return [
    `--lua-bg:${t.bg}`,
    `--lua-bg-amoled:${t.bgAmoled}`,
    `--lua-bg-secondary:${t.bgSecondary}`,
    `--lua-card:${t.card}`,
    `--lua-primary:${t.primary}`,
    `--lua-primary-light:${t.primaryLight}`,
    `--lua-neon:${t.neon}`,
    `--lua-primary-dark:${t.primaryDark}`,
    `--lua-text:${t.textPrimary}`,
    `--lua-text-secondary:${t.textSecondary}`,
    `--lua-accent:${t.accent}`,
    `--lua-chart:${t.chart}`,
    `--lua-glow:${t.glow}`,
  ].join(';');
}

module.exports = {
  THEMES,
  DEFAULT_THEME,
  list,
  get,
  exists,
  colorsOf,
  cssVars,
};
