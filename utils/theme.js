/**
 * utils/theme.js — tema ativo do Lua.
 *
 * O preset padrão vem do .env (LUA_THEME); em runtime pode ser trocado com
 * `!tema <preset>` (dono) e é persistido no banco (settings), igual ao
 * `!botao on/off`. Nunca duplica a paleta: as cores vivem em config/themes.js.
 */

'use strict';

const CONFIG = require('../config');
const themes = require('../config/themes');

/** Id do tema ativo (config .env ou persistência do banco). */
function activeId() {
  try {
    const settings = require('../database/settings');
    const saved = settings.get('theme');
    if (saved && themes.exists(saved)) return themes.get(saved).id;
  } catch (_) {
    /* banco indisponível: segue com o .env */
  }
  return themes.get(CONFIG.ui.theme).id;
}

/** Tema ativo (objeto completo). */
function active() {
  return themes.get(activeId());
}

/** Troca o tema (persistido no banco). Retorna true se o preset existe. */
function setActive(id) {
  if (!themes.exists(id)) return false;
  try {
    const settings = require('../database/settings');
    settings.set('theme', themes.get(id).id);
  } catch (_) {
    /* sem banco: não persiste, mas a troca em runtime continua válida */
  }
  return true;
}

/** Cores do tema ativo. */
function colors() {
  return themes.colorsOf(activeId());
}

/** Variáveis CSS do tema ativo (para HTML). */
function cssVars() {
  return themes.cssVars(activeId());
}

module.exports = { activeId, active, setActive, colors, cssVars, list: themes.list };
