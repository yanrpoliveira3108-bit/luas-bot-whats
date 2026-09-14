/**
 * plugins/life/weather.js — clima, eventos e calendário virtuais (determinísticos).
 *
 * Clima e evento derivam da data real (ciclos), sem depender de rede. O dono
 * pode forçar um evento com !event <id> (persistido em settings).
 */

'use strict';

const settings = require('../../database/settings');
const { WEATHER, EVENTS } = require('./config');

const DAY = 86400000;

/** Número do dia (desde a época). */
function dayIndex(ts = Date.now()) {
  return Math.floor(ts / DAY);
}

/** Semana do mês virtual (0-based). */
function weekIndex(ts = Date.now()) {
  return Math.floor(ts / (7 * DAY));
}

/** Clima atual (determinístico por dia). */
function currentWeather(ts = Date.now()) {
  return WEATHER[dayIndex(ts) % WEATHER.length];
}

/** Evento ativo (roda semanalmente; override do dono vence). */
function currentEvent(ts = Date.now()) {
  const override = settings.get('life_event_override', '');
  if (override) {
    if (override === 'off') return null;
    const forced = EVENTS.find((e) => e.id === override);
    if (forced) return forced;
  }
  return EVENTS[weekIndex(ts) % EVENTS.length];
}

/** Multiplicadores combinados (evento + clima) por área. */
function multipliers() {
  const ev = currentEvent() || {};
  const wx = currentWeather() || {};
  const pick = (...keys) => keys.reduce((acc, k) => acc * (typeof ev[k] === 'number' ? ev[k] : 1), 1);
  return {
    event: ev,
    weather: wx,
    xpMul: pick('xpMul'),
    priceMul: pick('priceMul'),
    sellMul: pick('sellMul'),
    shopMul: pick('shopMul'),
    fishingMul: pick('fishingMul') * (typeof wx.fishingMul === 'number' ? wx.fishingMul : 1),
    miningMul: pick('miningMul') * (typeof wx.miningMul === 'number' ? wx.miningMul : 1),
    farmingMul: pick('farmingMul') * (typeof wx.farmingMul === 'number' ? wx.farmingMul : 1),
  };
}

/** Fase do dia (manhã/tarde/noite) — cosmética. */
function periodOfDay(ts = Date.now()) {
  const h = new Date(ts).getHours();
  if (h >= 5 && h < 12) return { id: 'manha', name: 'Manhã', emoji: '🌅' };
  if (h >= 12 && h < 18) return { id: 'tarde', name: 'Tarde', emoji: '☀️' };
  return { id: 'noite', name: 'Noite', emoji: '🌙' };
}

module.exports = { currentWeather, currentEvent, multipliers, periodOfDay, dayIndex, weekIndex };
