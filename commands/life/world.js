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
    description: 'Mostra o evento ativo ou gerencia eventos cooperativos de grupo.',
    usage: '!evento | !evento entrar | !evento agir | !evento status',
    cooldown: 2000,
    execute: async (ctx) => {
      const sub = (ctx.args[0] || '').toLowerCase();

      // Subcomandos do Evento Cooperativo de Grupo (Raid / Chefe Mundial)
      if (['entrar', 'join', 'agir', 'atacar', 'bater', 'status', 'raid', 'chefe'].includes(sub)) {
        const coopEvents = require('../../utils/coopEvents');
        return coopEvents.handleEventCommand(ctx, sub);
      }

      // Comportamento original preservado: evento ativo semanal do Life
      const ev = weather.currentEvent();
      const m = weather.multipliers();
      if (!ev) return ctx.reply('🎪 Nenhum evento ativo no momento.');
      await ctx.reply(
        [
          `${ev.emoji} *EVENTO ATIVO: ${ev.name}*`,
          '',
          '📈 *Bônus do Mundo:*',
          m.priceMul !== 1 ? `▸ Preços: x${m.priceMul.toFixed(2)}` : '',
          m.xpMul !== 1 ? `▸ XP: x${m.xpMul.toFixed(2)}` : '',
          m.fishingMul !== 1 ? `▸ Pesca: x${m.fishingMul.toFixed(2)}` : '',
          m.miningMul !== 1 ? `▸ Mineração: x${m.miningMul.toFixed(2)}` : '',
          m.farmingMul !== 1 ? `▸ Agricultura: x${m.farmingMul.toFixed(2)}` : '',
          m.shopMul !== 1 ? `▸ Loja: x${m.shopMul.toFixed(2)}` : '',
          '',
          `⚔️ *Evento Cooperativo:* digite *${ctx.prefix}evento status* ou *${ctx.prefix}evento entrar* para a Raid do Grupo!`,
          '',
          `Próximos: ${EVENTS.map((e) => e.emoji).join(' ')}`,
        ].filter((l) => l !== '').join('\n')
      );
    },
  },
];
