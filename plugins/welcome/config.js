/**
 * plugins/welcome/config.js — identidade visual e parâmetros do Welcome/Goodbye.
 *
 * Todos os valores importantes centralizados aqui (tema, cores, fontes,
 * posições, tamanhos, lista de templates). O tema é único ("purple-moon") para
 * manter a identidade consistente entre todos os templates.
 */

'use strict';

const CONFIG = require('../../config');

const T = CONFIG.welcome || {};

module.exports = {
  size: { width: T.width || 1280, height: T.height || 720 },

  theme: {
    name: T.theme || 'purple-moon',
    botName: T.botName || 'LUA BOT',
    colors: {
      bgTop: '#0a0118',
      bgBottom: '#1c0638',
      bgTopDark: '#05010c',   // goodbye (céu mais escuro)
      bgBottomDark: '#120522',
      neon: [178, 107, 255],   // roxo neon (borda/glow)
      neonSoft: [123, 47, 247],
      gold: [245, 200, 106],
      moon: [238, 228, 255],
      text: [255, 255, 255],
      muted: [201, 184, 232],
      bar: [13, 3, 26],        // fundo das faixas de texto
    },
  },

  photo: {
    size: 240,      // diâmetro da foto circular
    ring: 288,      // diâmetro do anel neon externo
    x: 220,         // centro X
    y: 270,         // centro Y
  },

  // fontes Jimp (bitmap, sem dependências externas)
  fonts: {
    title: 'FONT_SANS_64_WHITE',
    subtitle: 'FONT_SANS_32_WHITE',
    name: 'FONT_SANS_64_WHITE',
    value: 'FONT_SANS_32_WHITE',
    label: 'FONT_SANS_16_WHITE',
    brand: 'FONT_SANS_32_WHITE',
    small: 'FONT_SANS_16_WHITE',
  },

  // textos fixos por tipo de evento
  labels: {
    welcome: { title: 'BEM VINDO', subtitle: 'NOVO MEMBRO', action: 'Bem-vindo(a), ' },
    goodbye: { title: 'ATÉ LOGO', subtitle: 'MEMBRO REMOVIDO', action: 'Até logo, ' },
  },

  templates: {
    welcome: ['welcome-01', 'welcome-02', 'welcome-03', 'welcome-04'],
    goodbye: ['goodbye-01', 'goodbye-02', 'goodbye-03', 'goodbye-04'],
  },

  cache: {
    photoTtlMs: T.photoTtlMs || 10 * 60 * 1000,
  },

  // caminhos de assets (gerados/cacheados localmente)
  paths: {
    welcomeDir: CONFIG.paths.assetsDir + '/welcome',
    goodbyeDir: CONFIG.paths.assetsDir + '/goodbye',
    defaultsDir: CONFIG.paths.assetsDir + '/welcome/defaults',
  },
};
