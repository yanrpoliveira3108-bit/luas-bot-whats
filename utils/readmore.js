/**
 * utils/readmore.js — sistema de "ler mais" configurável.
 *
 * Controlado por !lermais on/off (persistido em settings) com padrão do .env
 * (LUA_READMORE). Quando ativo e o texto é longo, insere o marcador Unicode
 * que faz o WhatsApp exibir "ler mais" (conteúdo recolhido).
 *
 * Aplica-se a menus, listas grandes, ajuda e comandos extensos via
 * `maybeReadMore(text)`.
 */

'use strict';

const CONFIG = require('../config');
const settings = require('../database/settings');

/** Estado efetivo (fonte única: settings; padrão do .env). */
function enabled() {
  return settings.getBool('readmore', CONFIG.readmore.enabled);
}

function setEnabled(on) {
  settings.set('readmore', on ? 'true' : 'false');
}

/**
 * Aplica o "ler mais" a um texto, se habilitado e longo o suficiente.
 * @returns {string}
 */
function maybeReadMore(text) {
  const s = String(text || '');
  if (!enabled() || s.length < CONFIG.readmore.minLength) return s;
  const marker = CONFIG.readmore.marker.repeat(CONFIG.readmore.repeat);
  // mantém o título visível e empurra o restante para "ler mais"
  const lines = s.split('\n');
  const head = lines[0] || '';
  const rest = lines.slice(1).join('\n');
  if (!rest) return s;
  return `${head}\n${marker}\n${rest}`;
}

module.exports = { enabled, setEnabled, maybeReadMore };
