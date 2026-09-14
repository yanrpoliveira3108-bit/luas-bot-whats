/**
 * utils/formatter.js — formatação de números, tempo, moeda, texto.
 */

'use strict';

/** 1234.5 -> "1.234,5" */
function formatNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

/** Moeda virtual (LuaCoins). Símbolo/emoji vêm do .env (LUA_COIN_*). */
function formatMoney(n) {
  const num = Number(n) || 0;
  let CONFIG = null;
  try {
    CONFIG = require('../config');
  } catch (_) {
    /* sem config, usa padrão */
  }
  const emoji = (CONFIG && CONFIG.life && CONFIG.life.currency && CONFIG.life.currency.emoji) || '🪙';
  const symbol = (CONFIG && CONFIG.life && CONFIG.life.currency && CONFIG.life.currency.symbol) || 'LC';
  return `${emoji} ${formatNumber(num)} ${symbol}`;
}

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatUptime(startedAt) {
  return formatDuration(Date.now() - startedAt);
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Converte "1h30", "90s", "2m", "5d" em milissegundos. */
function parseDuration(str) {
  if (str === undefined || str === null) return null;
  if (typeof str === 'number') return str;
  const s = String(str).trim().toLowerCase();
  const match = s.match(/^(\d+)\s*(ms|s|m|h|d)?$/);
  if (!match) return null;
  const v = parseInt(match[1], 10);
  const unit = match[2] || 's';
  const mult = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return v * mult;
}

/** Remove caracteres de controle (anti injeção em logs/texto). */
function sanitize(str) {
  return String(str || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, 4000);
}

function truncate(str, len = 120) {
  const s = String(str || '');
  return s.length > len ? `${s.slice(0, len - 1)}…` : s;
}

/** Capitaliza a primeira letra. */
function capitalize(str) {
  const s = String(str || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = {
  formatNumber,
  formatMoney,
  formatDuration,
  formatUptime,
  formatDate,
  parseDuration,
  sanitize,
  truncate,
  capitalize,
};
