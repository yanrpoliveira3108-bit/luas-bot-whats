/**
 * commands/rpg/cassino.js — cassino do Lua (apostas com LuaCoins).
 *
 * Jogos: coinflip, dados, roleta, slots. Todas as apostas usam a carteira
 * com withLock (atômico, sem saldo negativo, sem duplicação de pagamento).
 */

'use strict';

const economy = require('../../database/economy');
const { withLock } = require('../../utils/keyedMutex');
const { formatMoney } = require('../../utils/formatter');
const actionImage = require('../../utils/actionImage');

const EMOJIS = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'];

function parseBet(ctx) {
  const arg = (ctx.args[0] || '').toLowerCase();
  const eco = economy.get(ctx.sender);
  if (arg === 'tudo' || arg === 'all') return eco.wallet;
  const n = parseInt(ctx.args[0], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Aposta com resultado: paga (bet * mult) se venceu. Lança INSUFFICIENT_FUNDS. */
async function settleBet(ctx, bet, won, mult) {
  return withLock(ctx.sender, () => {
    economy.addWallet(ctx.sender, -bet); // cobra a aposta
    const prize = won ? Math.floor(bet * mult) : 0;
    if (prize > 0) economy.addWallet(ctx.sender, prize);
    return prize;
  });
}

module.exports = [
  {
    name: 'cassino',
    commands: ['cassino', 'casino', 'apostas'],
    category: 'rpg',
    description: 'Menu do cassino (coinflip, dados, roleta, slots).',
    usage: '!cassino',
    cooldown: 2000,
    execute: async (ctx) => {
      const eco = economy.get(ctx.sender);
      await ctx.reply(
        [
          '🎰 *CASSINO DO LUA*',
          `▸ Seu saldo: ${formatMoney(eco.wallet)}`,
          '',
          '🎲 !dados <valor> <1-6|par|impar>  (6x / 2x)',
          '🪙 !coinflip <valor> <cara|coroa>  (2x)',
          '🎡 !roleta <valor> <cor|numero>  (2x/14x/36x)',
          '🕹️ !slots <valor>  (até 10x)',
          '🎯 !apostar <valor> <cara|coroa>  (atalho coinflip)',
          '',
          '💡 Use !apostar tudo para ir com tudo. Boa sorte!',
        ].join('\n')
      );
    },
  },
  {
    name: 'flip',
    commands: ['flip', 'flipar', 'caraoucoroaaposta'],
    category: 'rpg',
    description: 'Aposta cara ou coroa (2x).',
    usage: '!flip <valor> <cara|coroa>',
    cooldown: 3000,
    execute: async (ctx) => {
      const bet = parseBet(ctx);
      const side = (ctx.args[1] || '').toLowerCase();
      if (!bet) return ctx.reply('⚠️ Use: !coinflip <valor> <cara|coroa>');
      if (!['cara', 'coroa'].includes(side)) return ctx.reply('⚠️ Escolha: cara ou coroa.');
      const result = Math.random() < 0.5 ? 'cara' : 'coroa';
      const won = result === side;
      try {
        const prize = await settleBet(ctx, bet, won, 2);
        const lines = [
          `🪙 *COINFLIP*`,
          `▸ Você: ${side} | Resultado: ${result}`,
          won ? `🎉 Ganhou ${formatMoney(prize)}!` : `😞 Perdeu ${formatMoney(bet)}.`,
        ];
        await actionImage.send(ctx, 'cassino', lines.join('\n'));
      } catch (_) {
        await ctx.reply('💸 Saldo insuficiente para apostar.');
      }
    },
  },
  {
    name: 'apostar',
    commands: ['apostar', 'bet'],
    category: 'rpg',
    description: 'Aposta rápida (50/50, 2x).',
    usage: '!apostar <valor> [cara|coroa]',
    cooldown: 3000,
    execute: async (ctx) => {
      const bet = parseBet(ctx);
      if (!bet) return ctx.reply('⚠️ Use: !apostar <valor> [cara|coroa]');
      const side = (ctx.args[1] || '').toLowerCase() || (Math.random() < 0.5 ? 'cara' : 'coroa');
      const result = Math.random() < 0.5 ? 'cara' : 'coroa';
      const won = result === side;
      try {
        const prize = await settleBet(ctx, bet, won, 2);
        await ctx.reply(
          `🎯 *APOSTA*\n▸ Resultado: ${result}\n${won ? `🎉 Ganhou ${formatMoney(prize)}!` : `😞 Perdeu ${formatMoney(bet)}.`}`
        );
      } catch (_) {
        await ctx.reply('💸 Saldo insuficiente para apostar.');
      }
    },
  },
  {
    name: 'dados',
    commands: ['dados', 'rolardado', 'dadoaposta'],
    category: 'rpg',
    description: 'Aposta no dado (número 6x, par/ímpar 2x).',
    usage: '!dados <valor> <1-6|par|impar>',
    cooldown: 3000,
    execute: async (ctx) => {
      const bet = parseBet(ctx);
      const guess = (ctx.args[1] || '').toLowerCase();
      if (!bet) return ctx.reply('⚠️ Use: !dados <valor> <1-6|par|impar>');
      const roll = 1 + Math.floor(Math.random() * 6);
      let won, mult;
      if (guess === 'par' || guess === 'impar') {
        won = (roll % 2 === 0) === (guess === 'par');
        mult = 2;
      } else {
        const n = parseInt(ctx.args[1], 10);
        if (!Number.isFinite(n) || n < 1 || n > 6) return ctx.reply('⚠️ Escolha 1-6, par ou ímpar.');
        won = roll === n;
        mult = 6;
      }
      try {
        const prize = await settleBet(ctx, bet, won, mult);
        await ctx.reply(
          `🎲 *DADOS*\n▸ Dado: ${roll} | Você: ${guess}\n${won ? `🎉 Ganhou ${formatMoney(prize)}!` : `😞 Perdeu ${formatMoney(bet)}.`}`
        );
      } catch (_) {
        await ctx.reply('💸 Saldo insuficiente para apostar.');
      }
    },
  },
  {
    name: 'roleta',
    commands: ['roleta', 'roulette'],
    category: 'rpg',
    description: 'Aposta na roleta (cor 2x, verde 14x, número 36x).',
    usage: '!roleta <valor> <vermelho|preto|verde|0-36>',
    cooldown: 3000,
    execute: async (ctx) => {
      const bet = parseBet(ctx);
      const guess = (ctx.args[1] || '').toLowerCase();
      if (!bet) return ctx.reply('⚠️ Use: !roleta <valor> <vermelho|preto|verde|0-36>');
      const n = Math.floor(Math.random() * 37); // 0-36
      let won, mult;
      const color = n === 0 ? 'verde' : n % 2 === 0 ? 'preto' : 'vermelho';
      if (guess === 'vermelho' || guess === 'preto') {
        won = color === guess;
        mult = 2;
      } else if (guess === 'verde') {
        won = color === 'verde';
        mult = 14;
      } else {
        const num = parseInt(ctx.args[1], 10);
        if (!Number.isFinite(num) || num < 0 || num > 36) return ctx.reply('⚠️ Escolha cor (vermelho/preto/verde) ou número 0-36.');
        won = n === num;
        mult = 36;
      }
      try {
        const prize = await settleBet(ctx, bet, won, mult);
        await ctx.reply(
          `🎡 *ROLETA*\n▸ Número: ${n} (${color}) | Você: ${guess}\n${won ? `🎉 Ganhou ${formatMoney(prize)}!` : `😞 Perdeu ${formatMoney(bet)}.`}`
        );
      } catch (_) {
        await ctx.reply('💸 Saldo insuficiente para apostar.');
      }
    },
  },
  {
    name: 'slots',
    commands: ['slots', 'cacaniquel'],
    category: 'rpg',
    description: 'Caça-níquel (até 10x).',
    usage: '!slots <valor>',
    cooldown: 4000,
    execute: async (ctx) => {
      const bet = parseBet(ctx);
      if (!bet) return ctx.reply('⚠️ Use: !slots <valor>');
      const r = [0, 1, 2].map(() => EMOJIS[Math.floor(Math.random() * EMOJIS.length)]);
      const uniq = new Set(r);
      let mult = 0;
      if (uniq.size === 1) mult = 10;
      else if (uniq.size === 2) mult = 2;
      const won = mult > 0;
      try {
        const prize = await settleBet(ctx, bet, won, mult);
        await ctx.reply(
          `🕹️ *SLOTS*\n▸ ${r.join(' ')}\n${won ? `🎉 Ganhou ${formatMoney(prize)}!` : `😞 Perdeu ${formatMoney(bet)}.`}`
        );
      } catch (_) {
        await ctx.reply('💸 Saldo insuficiente para apostar.');
      }
    },
  },
];
