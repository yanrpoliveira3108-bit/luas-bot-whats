'use strict';

const economy = require('../../database/economy');
const economyService = require('../../services/economyService');
const { formatMoney } = require('../../utils/formatter');
const { dropMentionArgs } = require('../../utils/messages');

function parseAmount(ctx, index = 0) {
  const arg = (ctx.args[index] || '').toLowerCase();
  const eco = economy.get(ctx.sender);
  if (arg === 'tudo' || arg === 'all') return eco.wallet;
  const n = parseInt(ctx.args[index], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

module.exports = [
  {
    name: 'saldo',
    commands: ['saldo', 'carteira', 'bal'],
    category: 'rpg',
    description: 'Mostra seu saldo (carteira + banco).',
    usage: '!saldo',
    cooldown: 2000,
    execute: async (ctx) => {
      const eco = economy.get(ctx.sender);
      await ctx.reply(`💰 *Saldo*\n▸ Carteira: ${formatMoney(eco.wallet)}\n▸ Banco: ${formatMoney(eco.bank)}\n▸ Total: ${formatMoney(eco.wallet + eco.bank)}`);
    },
  },
  {
    name: 'banco',
    commands: ['banco', 'meubanco'],
    category: 'rpg',
    description: 'Mostra seu banco.',
    usage: '!banco',
    cooldown: 2000,
    execute: async (ctx) => {
      const eco = economy.get(ctx.sender);
      await ctx.reply(`🏦 *Banco*\n▸ Saldo: ${formatMoney(eco.bank)}\nUse !depositar <valor> ou !sacar <valor>.`);
    },
  },
  {
    name: 'depositar',
    commands: ['depositar', 'dep'],
    category: 'rpg',
    description: 'Deposita dinheiro no banco.',
    usage: '!depositar <valor|tudo>',
    cooldown: 2000,
    execute: async (ctx) => {
      const amount = parseAmount(ctx);
      if (!amount) return ctx.reply('⚠️ Use: !depositar <valor> ou !depositar tudo');
      try {
        await economyService.deposit(ctx.sender, amount);
        await ctx.reply(`🏦 Depositado: ${formatMoney(amount)}.`);
      } catch (_) {
        await ctx.reply('💸 Saldo insuficiente.');
      }
    },
  },
  {
    name: 'sacar',
    commands: ['sacar', 'saque'],
    category: 'rpg',
    description: 'Saca dinheiro do banco.',
    usage: '!sacar <valor|tudo>',
    cooldown: 2000,
    execute: async (ctx) => {
      const eco = economy.get(ctx.sender);
      const arg = (ctx.args[0] || '').toLowerCase();
      const amount = arg === 'tudo' || arg === 'all' ? eco.bank : parseInt(ctx.args[0], 10);
      if (!amount || amount <= 0) return ctx.reply('⚠️ Use: !sacar <valor> ou !sacar tudo');
      try {
        await economyService.withdraw(ctx.sender, amount);
        await ctx.reply(`🏧 Sacado: ${formatMoney(amount)}.`);
      } catch (_) {
        await ctx.reply('💸 Saldo do banco insuficiente.');
      }
    },
  },
  {
    name: 'transferir',
    commands: ['transferir', 'enviar'],
    category: 'rpg',
    description: 'Transfere moedas para outro usuário.',
    usage: '!transferir @usuario <valor>',
    cooldown: 5000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0];
      // a menção também está dentro de ctx.args: sem remover, o valor lido
      // era o texto "@fulano" (parseInt -> NaN) e o comando nunca funcionava
      const args = dropMentionArgs(ctx.args, ctx.mentionedJid);
      const amount = parseInt(args[0], 10);
      if (!target || !amount || amount <= 0) return ctx.reply('⚠️ Use: !transferir @usuario <valor>');
      if (target === ctx.sender) return ctx.reply('🤨 Não dá para transferir para você mesmo.');
      try {
        await economyService.transfer(ctx.sender, target, amount);
        await ctx.reply(`💸 Transferido ${formatMoney(amount)} para @${target.split('@')[0]}.`, { mentions: [target] });
      } catch (_) {
        await ctx.reply('💸 Saldo insuficiente para transferir.');
      }
    },
  },
];
