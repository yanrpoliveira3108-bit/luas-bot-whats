/**
 * commands/life/world.js — clima, evento e calendário virtuais.
 */

'use strict';

const weather = require('../../plugins/life/weather');
const { EVENTS } = require('../../plugins/life/config');

module.exports = [
  {
    name: 'clima',
    commands: ['clima'],
    category: 'life',
    description: 'Mostra o clima virtual atual.',
    usage: '!clima',
    cooldown: 2000,
    execute: async (ctx) => {
      const wx = weather.currentWeather();
      const period = weather.periodOfDay();
      const m = weather.multipliers();
      await ctx.reply(
        [
          '🌦️ *CLIMA DE HOJE*',
          `▸ ${wx.emoji} ${wx.name}`,
          `▸ Período: ${period.emoji} ${period.name}`,
          '',
          '📈 *Efeitos nas atividades:*',
          `▸ Agricultura: x${m.farmingMul.toFixed(2)}`,
          `▸ Pesca: x${m.fishingMul.toFixed(2)}`,
          `▸ Mineração: x${m.miningMul.toFixed(2)}`,
        ].join('\n')
      );
    },
  },
  {
    name: 'evento',
    commands: ['evento', 'eventos'],
    category: 'life',
    description: 'Mostra o evento ativo da semana.',
    usage: '!evento',
    cooldown: 2000,
    execute: async (ctx) => {
      const ev = weather.currentEvent();
      const m = weather.multipliers();
      if (!ev) return ctx.reply('🎪 Nenhum evento ativo no momento.');
      await ctx.reply(
        [
          `${ev.emoji} *EVENTO ATIVO: ${ev.name}*`,
          '',
          '📈 *Bônus:*',
          m.priceMul !== 1 ? `▸ Preços: x${m.priceMul.toFixed(2)}` : '',
          m.xpMul !== 1 ? `▸ XP: x${m.xpMul.toFixed(2)}` : '',
          m.fishingMul !== 1 ? `▸ Pesca: x${m.fishingMul.toFixed(2)}` : '',
          m.miningMul !== 1 ? `▸ Mineração: x${m.miningMul.toFixed(2)}` : '',
          m.farmingMul !== 1 ? `▸ Agricultura: x${m.farmingMul.toFixed(2)}` : '',
          m.shopMul !== 1 ? `▸ Loja: x${m.shopMul.toFixed(2)}` : '',
          '',
          `Próximos: ${EVENTS.map((e) => e.emoji).join(' ')}`,
        ].filter((l) => l !== '').join('\n')
      );
    },
  },
];
