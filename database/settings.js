/**
 * database/settings.js — chave/valor de configurações do bot (prefixo, plugins).
 */

'use strict';

const { prepare } = require('./database');
const CONFIG = require('../config');

function get(key, fallback) {
  const row = prepare('get_setting', `SELECT value FROM settings WHERE key = ?`).get(key);
  if (!row) return fallback === undefined ? null : fallback;
  return row.value;
}

function set(key, value) {
  return prepare(
    'set_setting',
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

function getBool(key, fallback = false) {
  const v = get(key, null);
  if (v === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function getInt(key, fallback = 0) {
  const v = get(key, null);
  if (v === null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Prefixo efetivo (pode ser alterado em runtime via !prefix). */
function effectivePrefix() {
  const v = get('prefix', null);
  // aceita do banco apenas valores curtos e que não sejam caminhos (defesa
  // extra contra o PREFIX do Termux ou valor corrompido)
  if (v && v.length <= 3 && !v.includes('/') && !v.includes('\\')) return v;
  return CONFIG.bot.prefix;
}

/**
 * Estado efetivo dos botões interativos.
 * FONTE ÚNICA DE VERDADE: o banco (settings). Se nunca foi alterado,
 * usa o padrão do .env (BUTTONS_ENABLED). !botao on/off persiste aqui.
 */
function buttonsEnabled() {
  return getBool('buttons_enabled', CONFIG.interactive.buttonsEnabled);
}

function setButtonsEnabled(enabled) {
  set('buttons_enabled', enabled ? 'true' : 'false');
}

module.exports = { get, set, getBool, getInt, effectivePrefix, buttonsEnabled, setButtonsEnabled };
