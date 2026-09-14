/**
 * utils/icons.js — ícones centralizados (Lua 2.0).
 *
 * Nenhum comando deve carregar emoji "solto": tudo passa por aqui, para que a
 * identidade visual mude em um lugar só. Os ícones de comandos específicos
 * continuam no utils/commandEmoji (mapeamento fino); aqui ficam os ícones
 * SEMÂNTICOS (sucesso, erro, loading, música, admin...) e os de categoria.
 */

'use strict';

const SEMANTIC = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  loading: '⏳',
  progress: '⚙️',
  done: '🏁',
  lock: '🔒',
  shield: '🛡️',
  crown: '👑',
  clock: '⏱️',
  pin: '📌',
  spark: '✨',
  fire: '🔥',
  eye: '👁️',
  ban: '🚫',
  mute: '🔇',
  trash: '🗑️',
  gear: '⚙️',
};

const CONTEXT = {
  music: '🎵',
  video: '🎬',
  sticker: '🎨',
  group: '👥',
  admin: '🛡️',
  moderation: '🛡️',
  download: '⬇️',
  upload: '📤',
  search: '🔎',
  owner: '👑',
  system: '⚙️',
  ai: '🤖',
  fun: '🎮',
  utility: '🧰',
  tools: '🧰',
  info: 'ℹ️',
  economy: '🪙',
  rpg: '⚔️',
  life: '🌱',
  anime: '🍥',
  media: '📸',
  audio: '🎧',
  ranking: '🏆',
};

/** Ícone por categoria do registry (categoria real → ícone). */
const CATEGORY = {
  general: '🏠',
  downloads: '⬇️',
  stickers: '🎨',
  members: '👥',
  admin: '🛡️',
  owner: '👑',
  fun: '🎮',
  games: '🎮',
  utility: '🧰',
  rankings: '🏆',
  rpg: '⚔️',
  life: '🌱',
  ai: '🤖',
  anime: '🍥',
  settings: '⚙️',
};

/** Tema visual por categoria (item 83 do briefing). */
const THEMES = {
  music: { accent: 'music', icon: '🎵', header: 'PLAY', divider: 'music' },
  sticker: { accent: 'sticker', icon: '🎨', header: 'STICKER', divider: 'anime' },
  admin: { accent: 'admin', icon: '🛡️', header: 'ADMIN', divider: 'minimal' },
  owner: { accent: 'owner', icon: '👑', header: 'OWNER', divider: 'royal' },
  download: { accent: 'download', icon: '⬇️', header: 'DOWNLOAD', divider: 'wave' },
  group: { accent: 'group', icon: '👥', header: 'GRUPO', divider: 'cute' },
  ai: { accent: 'ai', icon: '🤖', header: 'IA', divider: 'cyber' },
  system: { accent: 'system', icon: '⚙️', header: 'SISTEMA', divider: 'classic' },
};

const FALLBACK = '🌙';

/** Ícone semântico (icons.get('success')). Desconhecido → fallback. */
function get(key) {
  if (!key) return FALLBACK;
  return SEMANTIC[key] || CONTEXT[key] || CATEGORY[key] || FALLBACK;
}

/** Ícone de contexto/categoria (icons.for('music')). */
function forCategory(category) {
  const key = String(category || '').toLowerCase();
  return CATEGORY[key] || CONTEXT[key] || FALLBACK;
}

/** Tema visual da categoria (icons.theme('music')). */
function theme(category) {
  const key = String(category || '').toLowerCase();
  return THEMES[key] || THEMES.system;
}

/** Lista de chaves disponíveis (para auditoria/testes). */
function keys() {
  return [...Object.keys(SEMANTIC), ...Object.keys(CONTEXT), ...Object.keys(CATEGORY)].sort();
}

module.exports = Object.assign(
  {
    get,
    for: forCategory,
    forCategory,
    theme,
    keys,
    FALLBACK,
    SEMANTIC,
    CONTEXT,
    CATEGORY,
    THEMES,
  },
  SEMANTIC
);
