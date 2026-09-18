/**
 * commands/life/gather.js — mineração e pesca (coleta com ferramentas).
 */

'use strict';

const engine = require('../../plugins/life/engine');
const { formatMoney } = require('../../utils/formatter');
const actionImage = require('../../utils/actionImage');

module.exports = [
  {
    name: 'minerar',
    commands: ['minerar', 'mineracao'],
    category: 'life',
    description: 'Minera minérios (precisa de picareta).',
    usage: '!minerar',
    cooldown: 3000,
    execute: async (ctx) => {
      try {
        const r = await engine.mine(ctx.sender);
        const lines = [
          `⛏️ *MINERAÇÃO*`,
          `▸ Encontrou: ${r.ore.emoji} *${r.ore.name}* x${r.qty}`,
          `▸ XP: +${r.xp}`,
          `▸ Energia: ${r.energy}/200`,
          `▸ Picareta: ${r.usesLeft} usos restantes${r.broken ? ' (⚠️ quebrou!)' : ''}`,
        ];
        if (r.leveled) lines.push(`🎉 *Nível ${r.level}!* Novo título: ${r.newTitle}`);
        await actionImage.send(ctx, 'minerar', lines.join('\n'));
      } catch (err) {
        await ctx.reply((err && err.message) || '⛏️ Não foi possível minerar.');
      }
    },
  },
  {
    name: 'pescar',
    commands: ['pescar', 'pesca'],
    category: 'life',
    description: 'Pesca peixes (precisa de vara).',
    usage: '!pescar [isca]',
    cooldown: 3000,
    execute: async (ctx) => {
      const useBait = ['isca', 'comisca', 'bait'].includes(String(ctx.args[0] || '').toLowerCase());
      try {
        const r = await engine.fish(ctx.sender, useBait);
        const lines = [
          `🎣 *PESCA*`,
          `▸ Pescou: ${r.fish.emoji} *${r.fish.name}* x${r.qty}`,
          `▸ XP: +${r.xp}`,
          `▸ Energia: ${r.energy}/200`,
          `▸ Vara: ${r.usesLeft} usos restantes${r.broken ? ' (⚠️ quebrou!)' : ''}`,
        ];
        if (r.leveled) lines.push(`🎉 *Nível ${r.level}!* Novo título: ${r.newTitle}`);
        await actionImage.send(ctx, 'pescar', lines.join('\n'));
      } catch (err) {
        await ctx.reply((err && err.message) || '🎣 Não foi possível pescar.');
      }
    },
  },
  {
    name: 'venderpesca',
    commands: ['venderpeixes', 'venderpeixe'],
    category: 'life',
    description: 'Vende todos os peixes do inventário.',
    usage: '!venderpeixes',
    cooldown: 3000,
    execute: async (ctx) => {
      const { FISH } = require('../../plugins/life/config');
      const rpg = require('../../database/rpg');
      const economyService = require('../../services/economyService');
      // A REGRA (remover do inventário + creditar + lançar no histórico) está em
      // services/economyService.sellItem. O preço continua sendo o sell_price do
      // item, exatamente como antes — o preço de mercado (plugins/life/market)
      // é usado só na exibição do !precos.
      let total = 0;
      let count = 0;
      for (const f of FISH) {
        const item = rpg.getShopItem(f.id);
        if (!item) continue;
        const has = require('../../database/economy').getItem(ctx.sender, f.id);
        if (!has || has.quantity < 1) continue;
        const r = await economyService.sellItem(ctx.sender, f.id, has.quantity, item.sell_price);
        total += r.total;
        count += r.qty;
      }
      if (!count) return ctx.reply('🎣 Você não tem peixes para vender.');
      await ctx.reply(`💰 Vendeu ${count} peixe(s) por ${formatMoney(total)}.`);
    },
  },
];
