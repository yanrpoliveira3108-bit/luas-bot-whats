/**
 * commands/rpg/investimento.js — fundo de investimento do Lua.
 *
 * O rendimento muda por dia (pode subir ou cair) e é acumulado desde o
 * investimento. Transações atômicas via withLock, sem saldo negativo.
 */

'use strict';

const economy = require('../../database/economy');
const investments = require('../../database/investments');
const { withLock } = require('../../utils/keyedMutex');
const { formatMoney } = require('../../utils/formatter');

module.exports = [
  {
    name: 'investir',
    commands: ['investir', 'investimento', 'aplicar'],
    category: 'rpg',
    description: 'Investe LuaCoins no fundo (rendimento diário variável).',
    usage: '!investir <valor|tudo>',
    cooldown: 3000,
    execute: async (ctx) => {
      const arg = (ctx.args[0] || '').toLowerCase();
      const eco = economy.get(ctx.sender);
      const value = arg === 'tudo' || arg === 'all' ? eco.wallet : parseInt(ctx.args[0], 10);
      if (!Number.isFinite(value) || value <= 0) return ctx.reply('⚠️ Use: !investir <valor> ou !investir tudo');
      try {
        const r = await withLock(ctx.sender, () => investments.invest(ctx.sender, value));
        const rate = investments.todayRate();
        await ctx.reply(
          [
            '📈 *Investimento aplicado*',
            `▸ Aplicado: ${formatMoney(value)}`,
            `▸ Total no fundo: ${formatMoney(r.invested)}`,
            `▸ Taxa de hoje: ${(rate * 100).toFixed(1)}%/dia`,
            '',
            '💡 O rendimento muda todo dia (pode subir ou cair). Resgate com !resgatar.',
          ].join('\n')
        );
      } catch (_) {
        await ctx.reply('💸 Saldo insuficiente para investir.');
      }
    },
  },
  {
    name: 'resgatar',
    commands: ['resgatar', 'resgate', 'sacarinvestimento'],
    category: 'rpg',
    description: 'Resgata seu investimento (com rendimento).',
    usage: '!resgatar <valor|tudo>',
    cooldown: 3000,
    execute: async (ctx) => {
      const row = investments.get(ctx.sender);
      const current = investments.valueOf(row.invested, Date.parse(row.invested_at || Date.now()));
      if (!row.invested || current <= 0) return ctx.reply('📉 Você não tem nada investido.\nUse !investir para começar.');
      const arg = (ctx.args[0] || '').toLowerCase();
      const amount = arg === 'tudo' || arg === 'all' ? null : parseInt(ctx.args[0], 10);
      if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) return ctx.reply('⚠️ Use: !resgatar <valor> ou !resgatar tudo');
      try {
        const r = await withLock(ctx.sender, () => investments.redeem(ctx.sender, amount));
        const profit = r.amount - Math.floor((row.invested || 0) * (r.amount / Math.max(1, r.current)));
        await ctx.reply(
          [
            '🏦 *Resgate realizado*',
            `▸ Recebeu: ${formatMoney(r.amount)}`,
            `▸ ${profit >= 0 ? '📈 Rendimento' : '📉 Perda'}: ${formatMoney(Math.abs(profit))}`,
            `▸ Restante no fundo: ${formatMoney(r.remaining)}`,
          ].join('\n')
        );
      } catch (_) {
        await ctx.reply('⚠️ Não foi possível resgatar esse valor.');
      }
    },
  },
  {
    name: 'investimentos',
    commands: ['investimentos', 'fundo', 'meuinvestimento'],
    category: 'rpg',
    description: 'Mostra seu investimento e o rendimento atual.',
    usage: '!investimentos',
    cooldown: 3000,
    execute: async (ctx) => {
      const row = investments.get(ctx.sender);
      const current = investments.valueOf(row.invested, Date.parse(row.invested_at || Date.now()));
      if (!row.invested) return ctx.reply('📉 Você não tem investimentos.\nUse !investir <valor> para começar.');
      const profit = current - row.invested;
      const rate = investments.todayRate();
      await ctx.reply(
        [
          '📊 *Seu fundo de investimento*',
          `▸ Aplicado: ${formatMoney(row.invested)}`,
          `▸ Valor atual: ${formatMoney(current)}`,
          `▸ ${profit >= 0 ? '📈 Rendimento' : '📉 Perda'}: ${formatMoney(Math.abs(profit))}`,
          `▸ Taxa de hoje: ${(rate * 100).toFixed(1)}%/dia`,
          '',
          '💡 Resgate com !resgatar tudo.',
        ].join('\n')
      );
    },
  },
];
