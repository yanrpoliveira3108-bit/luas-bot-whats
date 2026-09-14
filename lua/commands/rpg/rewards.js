'use strict';

const rpg = require('../../database/rpg');
const economy = require('../../database/economy');
const { withLock } = require('../../utils/keyedMutex');
const { formatMoney, formatDuration } = require('../../utils/formatter');

module.exports = [
  {
    name: 'daily',
    commands: ['daily', 'diario'],
    category: 'rpg',
    description: 'Resgata sua recompensa diária (com sequência).',
    usage: '!daily',
    cooldown: 2000,
    execute: async (ctx) => {
      try {
        const engine = require('../../plugins/life/engine');
        const r = await engine.dailyClaim(ctx.sender);
        await ctx.reply(
          [
            '🎁 *Presente diário*',
            `▸ Ganhou: ${formatMoney(r.reward)}`,
            `▸ 🔥 Sequência: ${r.streak} dia(s)`,
            r.streak >= 7 ? '👑 Sequência máxima! Bônus aplicado.' : '',
            '',
            `Volte amanhã para continuar a sequência!`,
          ].filter(Boolean).join('\n')
        );
      } catch (err) {
        await ctx.reply((err && err.message) || '⏳ Você já resgatou hoje. Volte amanhã!');
      }
    },
  },
  {
    name: 'semanal',
    commands: ['semanal', 'weekly'],
    category: 'rpg',
    description: 'Resgata sua recompensa semanal.',
    usage: '!semanal',
    cooldown: 2000,
    execute: async (ctx) => {
      const remaining = rpg.getCooldownRemaining('rpg', ctx.sender, 'semanal');
      if (remaining > 0) {
        return ctx.reply(`⏳ Você já resgatou a semanal. Volte em ${formatDuration(remaining)}.`);
      }
      const reward = 1500 + Math.floor(Math.random() * 1500);
      await withLock(ctx.sender, () => {
        economy.addWallet(ctx.sender, reward);
        economy.recordTransaction(ctx.sender, 'semanal', reward, 'recompensa semanal');
        rpg.setCooldown('rpg', ctx.sender, 'semanal', 7 * 24 * 3600 * 1000);
        rpg.addEnergy(ctx.sender, 100);
      });
      await ctx.reply(`🎉 *Recompensa semanal*\n▸ Ganhou: ${formatMoney(reward)}\n▸ Energia: +100`);
    },
  },
  {
    name: 'rankrpg',
    commands: ['rankrpg', 'toprpg'],
    category: 'rpg',
    description: 'Ranking dos jogadores do RPG.',
    usage: '!rankrpg',
    cooldown: 3000,
    execute: async (ctx) => {
      const { renderRanking } = require('../_shared/ranking');
      await ctx.reply(await renderRanking(ctx, 'rpg', 10));
    },
  },
];
