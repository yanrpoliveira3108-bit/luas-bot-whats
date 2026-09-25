/**
 * commands/rpg/cripto.js — mercado de criptomoedas do Lua.
 *
 * Compra/venda de moedas virtuais com preços que flutuam a cada 15 minutos.
 * Valores mudam sozinhos (sem rede), de forma determinística e justa.
 */

'use strict';

const economy = require('../../database/economy');
const crypto = require('../../database/crypto');
const { withLock } = require('../../utils/keyedMutex');
const { formatMoney } = require('../../utils/formatter');

function marketLines(now) {
  return crypto.COINS.map((c) => {
    const p = crypto.price(c.symbol, now);
    const ch = crypto.changePct(c.symbol, now);
    const arrow = ch > 0 ? '📈' : ch < 0 ? '📉' : '➖';
    return `${c.emoji} *${c.name}* (${c.symbol})\n▸ ${formatMoney(p)} ${arrow} ${ch >= 0 ? '+' : ''}${ch}%`;
  });
}

module.exports = [
  {
    name: 'cripto',
    commands: ['cripto', 'criptomoedas', 'crypto'],
    category: 'rpg',
    description: 'Mercado de criptomoedas (preços mudam a cada 15 min).',
    usage: '!cripto',
    cooldown: 3000,
    execute: async (ctx) => {
      const eco = economy.get(ctx.sender);

      // Card visual em HTML se o modo HTML estiver ativo
      const settings = require('../../database/settings');
      if (settings.menuHtmlEnabled()) {
        try {
          const cryptoHtmlView = require('../../utils/cryptoHtmlView');
          const richHtml = require('../../utils/richHtml');
          const html = cryptoHtmlView.renderCryptoMarketHtml(ctx.sender, ctx.prefix);
          await richHtml.sendHtml(ctx.socket, ctx.remoteJid, html, { title: 'MERCADO DE CRIPTOMOEDAS' });
          return;
        } catch (_) {}
      }

      await ctx.reply(
        [
          '🪙 *MERCADO CRIPTO*',
          `▸ Seu saldo: ${formatMoney(eco.wallet)}`,
          '',
          ...marketLines(),
          '',
          '💡 !comprarcripto <moeda> <valor>',
          '💡 !vendercripto <moeda> <quantidade|tudo>',
          '💡 !carteiracripto para ver seus ativos.',
        ].join('\n')
      );
    },
  },
  {
    name: 'comprarcripto',
    commands: ['comprarcripto', 'comprarcrypto', 'buycrypto'],
    category: 'rpg',
    description: 'Compra criptomoedas com LuaCoins com validação de cotação.',
    usage: '!comprarcripto <BTC|ETH|DOGE|LUA> <valor> [cotacao_max]',
    cooldown: 3000,
    execute: async (ctx) => {
      const symbol = (ctx.args[0] || '').toUpperCase();
      const value = parseInt(ctx.args[1], 10);
      const maxPrice = ctx.args[2] ? parseInt(ctx.args[2], 10) : null;

      if (!crypto.coin(symbol)) return ctx.reply('⚠️ Moedas: BTC, ETH, DOGE ou LUA.');
      if (!Number.isFinite(value) || value <= 0) return ctx.reply('⚠️ Use: !comprarcripto <moeda> <valor>');

      const q = crypto.quote(symbol);
      if (maxPrice && q.price > maxPrice) {
        return ctx.reply(
          `⚠️ Cotação atual (${formatMoney(q.price)}) está acima do teto estipulado (${formatMoney(maxPrice)}). Operação abortada.`
        );
      }

      try {
        const r = await withLock(ctx.sender, () => crypto.buy(ctx.sender, symbol, value));
        await ctx.reply(
          `✅ *Compra realizada*\n▸ ${r.amount.toFixed(6)} ${symbol} por ${formatMoney(value)}.\n▸ Preço da janela: ${formatMoney(r.price)}/${symbol}`
        );
      } catch (err) {
        await ctx.reply('💸 Saldo insuficiente para comprar.');
      }
    },
  },
  {
    name: 'vendercripto',
    commands: ['vendercripto', 'vendercrypto', 'sellcrypto'],
    category: 'rpg',
    description: 'Vende criptomoedas por LuaCoins com validação de cotação.',
    usage: '!vendercripto <BTC|ETH|DOGE|LUA> <quantidade|tudo> [cotacao_min]',
    cooldown: 3000,
    execute: async (ctx) => {
      const symbol = (ctx.args[0] || '').toUpperCase();
      if (!crypto.coin(symbol)) return ctx.reply('⚠️ Moedas: BTC, ETH, DOGE ou LUA.');
      const arg = (ctx.args[1] || '').toLowerCase();
      const amount = arg === 'tudo' || arg === 'all' ? null : parseFloat(ctx.args[1]);
      const minPrice = ctx.args[2] && arg !== 'tudo' && arg !== 'all' ? parseInt(ctx.args[2], 10) : null;

      if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) return ctx.reply('⚠️ Use: !vendercripto <moeda> <quantidade|tudo>');

      const q = crypto.quote(symbol);
      if (minPrice && q.price < minPrice) {
        return ctx.reply(
          `⚠️ Cotação atual (${formatMoney(q.price)}) está abaixo do piso estipulado (${formatMoney(minPrice)}). Operação abortada.`
        );
      }

      try {
        const r = await withLock(ctx.sender, () => crypto.sell(ctx.sender, symbol, amount));
        const lucro = r.gain - r.cost;
        await ctx.reply(
          [
            '💰 *Venda realizada*',
            `▸ Vendeu ${r.amount.toFixed(6)} ${symbol} por ${formatMoney(r.gain)}.`,
            `▸ Preço da janela: ${formatMoney(r.price)}/${symbol}`,
            `▸ ${lucro >= 0 ? '📈 Lucro' : '📉 Prejuízo'}: ${formatMoney(Math.abs(lucro))}`,
          ].join('\n')
        );
      } catch (_) {
        await ctx.reply('⚠️ Você não tem essa quantidade para vender.');
      }
    },
  },
  {
    name: 'carteiracripto',
    commands: ['carteiracripto', 'minhascriptos', 'cryptowallet'],
    category: 'rpg',
    description: 'Mostra seus ativos em criptomoedas.',
    usage: '!carteiracripto',
    cooldown: 3000,
    execute: async (ctx) => {
      const port = crypto.portfolio(ctx.sender);
      if (!port.length) return ctx.reply('🪙 Você ainda não tem criptomoedas.\nUse !comprarcripto para começar.');
      let total = 0;
      const lines = port.map((row) => {
        const p = crypto.price(row.symbol);
        const val = Math.floor(row.amount * p);
        total += val;
        const lucro = val - row.total_cost;
        return `${crypto.coin(row.symbol).emoji} ${row.symbol}: ${row.amount.toFixed(6)}\n▸ Valor: ${formatMoney(val)} (${lucro >= 0 ? '+' : '-'}${formatMoney(Math.abs(lucro))})`;
      });
      await ctx.reply(`💼 *Sua carteira cripto*\n${lines.join('\n')}\n\n▸ Total: ${formatMoney(total)}`);
    },
  },
];
