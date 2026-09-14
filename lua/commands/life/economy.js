/**
 * commands/life/economy.js — patrimônio, mercado entre jogadores, presentes,
 * pagamentos e loteria (economia controlada e anti-exploit).
 */

'use strict';

const life = require('../../database/life');
const economy = require('../../database/economy');
const rpg = require('../../database/rpg');
const engine = require('../../plugins/life/engine');
const market = require('../../plugins/life/market');
const networth = require('../../plugins/life/networth');
const { formatMoney } = require('../../utils/formatter');
const { displayName } = require('../../engine/interactionEngine');
const { withLock } = require('../../utils/keyedMutex');

module.exports = [
  {
    name: 'patrimonio',
    commands: ['patrimonio'],
    category: 'life',
    description: 'Mostra seu patrimônio total.',
    usage: '!patrimonio',
    cooldown: 2000,
    execute: async (ctx) => {
      const nw = networth.compute(ctx.sender);
      await ctx.reply(
        [
          '📊 *Patrimônio*',
          `▸ 💰 Carteira: ${formatMoney(nw.breakdown.wallet)}`,
          `▸ 🏦 Banco: ${formatMoney(nw.breakdown.bank)}`,
          `▸ 🏠 Propriedades: ${formatMoney(nw.breakdown.properties)} (${nw.propertyCount})`,
          `▸ 🏢 Empresas: ${formatMoney(nw.breakdown.businesses)} (${nw.businessCount})`,
          `▸ 🐄 Animais: ${formatMoney(nw.breakdown.animals)} (${nw.animalCount})`,
          '',
          `💰 *Patrimônio total: ${formatMoney(nw.total)}*`,
        ].join('\n')
      );
    },
  },
  {
    name: 'mercado',
    commands: ['mercado'],
    category: 'life',
    description: 'Mostra o mercado (preços e ofertas).',
    usage: '!mercado',
    cooldown: 2000,
    execute: async (ctx) => {
      const m = require('../../plugins/life/weather').multipliers();
      const ev = m.event;
      const wx = m.weather;
      const offers = life.listOffers('active', 5);
      const offLines = offers.length
        ? offers.map((o) => `#${o.id} ${o.item_id} x${o.quantity} — ${formatMoney(o.unit_price)}/un (${displayName(o.seller_id)})`)
        : '_(sem ofertas — crie com !ofertar <item> <qtd> <preço>)_';
      await ctx.reply(
        [
          '📈 *MERCADO*',
          `▸ Clima: ${wx.emoji} ${wx.name}`,
          `▸ Evento: ${ev ? `${ev.emoji} ${ev.name}` : 'nenhum'}`,
          '',
          '🛒 *Ofertas de jogadores:*',
          offLines,
          '',
          `Comprar: ${ctx.prefix}compraroferta <id> · Seus preços: ${ctx.prefix}precos`,
        ].join('\n')
      );
    },
  },
  {
    name: 'precos',
    commands: ['precos'],
    category: 'life',
    description: 'Mostra os preços atuais dos recursos.',
    usage: '!precos',
    cooldown: 3000,
    execute: async (ctx) => {
      const { ORES, FISH } = require('../../plugins/life/config');
      const line = (id) => {
        const item = rpg.getShopItem(id);
        if (!item) return null;
        const price = market.computeSellPrice(id, item.sell_price);
        return `${item.emoji} ${item.name} — ${formatMoney(price)} ${market.trend(id).label}`;
      };
      const ores = ORES.map((o) => line(o.id)).filter(Boolean);
      const fish = FISH.map((f) => line(f.id)).filter(Boolean);
      await ctx.reply(`💰 *Preços de venda hoje*\n\n⛏️ ${ores.join('\n')}\n\n🎣 ${fish.join('\n')}`);
    },
  },
  {
    name: 'ofertar',
    commands: ['ofertar'],
    category: 'life',
    description: 'Cria uma oferta no mercado (vende a jogadores).',
    usage: '!ofertar <item> <qtd> <preço unitário>',
    cooldown: 3000,
    execute: async (ctx) => {
      const itemId = String(ctx.args[0] || '').toLowerCase();
      const qty = parseInt(ctx.args[1], 10);
      const price = parseInt(ctx.args[2], 10);
      if (!itemId || !qty || !price) return ctx.reply('⚠️ Use: !ofertar <item> <qtd> <preço unitário>');
      try {
        const r = await engine.createOffer(ctx.sender, itemId, qty, price);
        await ctx.reply(`📦 Oferta #${r.offerId} criada: ${r.item.emoji} *${r.item.name}* x${qty} por ${formatMoney(price)}/un.\nCancele: ${ctx.prefix}cancelaroferta ${r.offerId}`);
      } catch (err) {
        await ctx.reply((err && err.message) || '😕 Não foi possível criar a oferta.');
      }
    },
  },
  {
    name: 'compraroferta',
    commands: ['compraroferta'],
    category: 'life',
    description: 'Compra uma oferta do mercado.',
    usage: '!compraroferta <id>',
    cooldown: 3000,
    execute: async (ctx) => {
      const id = parseInt(ctx.args[0], 10);
      if (!id) return ctx.reply('⚠️ Use: !compraroferta <id>');
      try {
        const r = await engine.buyOffer(ctx.sender, id);
        await ctx.reply(`🛒 Você comprou ${r.offer.item_id} x${r.offer.quantity} por ${formatMoney(r.total)}.`);
      } catch (err) {
        await ctx.reply((err && err.message) || '😕 Não foi possível comprar.');
      }
    },
  },
  {
    name: 'minhasofertas',
    commands: ['minhasofertas'],
    category: 'life',
    description: 'Lista suas ofertas no mercado.',
    usage: '!minhasofertas',
    cooldown: 2000,
    execute: async (ctx) => {
      const offers = life.listUserOffers(ctx.sender);
      if (!offers.length) return ctx.reply('📦 Você não tem ofertas.');
      const lines = offers.map((o) => `#${o.id} ${o.item_id} x${o.quantity} — ${formatMoney(o.unit_price)}/un (${o.status})`);
      await ctx.reply(`📦 *Suas ofertas*\n${lines.join('\n')}`);
    },
  },
  {
    name: 'cancelaroferta',
    commands: ['cancelaroferta'],
    category: 'life',
    description: 'Cancela uma oferta (devolve o item).',
    usage: '!cancelaroferta <id>',
    cooldown: 2000,
    execute: async (ctx) => {
      const id = parseInt(ctx.args[0], 10);
      if (!id) return ctx.reply('⚠️ Use: !cancelaroferta <id>');
      try {
        await engine.cancelOffer(ctx.sender, id);
        await ctx.reply('✅ Oferta cancelada e item devolvido.');
      } catch (err) {
        await ctx.reply((err && err.message) || '😕 Não foi possível cancelar.');
      }
    },
  },
  {
    name: 'presente',
    commands: ['presente', 'presentear'],
    category: 'life',
    description: 'Envia um item de presente para um usuário.',
    usage: '!presente @usuario <item> [qtd]',
    cooldown: 3000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0];
      const itemId = String(ctx.args[ctx.mentionedJid.length ? 0 : 1] || '').toLowerCase();
      const qty = parseInt(ctx.args[ctx.mentionedJid.length ? 1 : 2], 10) || 1;
      if (!target || !itemId) return ctx.reply('⚠️ Use: !presente @usuario <item> [qtd]');
      if (target === ctx.sender) return ctx.reply('🤨 Você não pode presentear a si mesmo.');
      try {
        const r = await engine.giftItem(ctx.sender, target, itemId, qty);
        await ctx.reply(`🎁 Você presenteou ${displayName(target)} com ${r.item.emoji} *${r.item.name}* x${r.qty}!`);
      } catch (err) {
        await ctx.reply((err && err.message) || '😕 Não foi possível presentear.');
      }
    },
  },
  {
    name: 'pagar',
    commands: ['pagar'],
    category: 'life',
    description: 'Paga LuaCoins para outro usuário.',
    usage: '!pagar @usuario <valor>',
    cooldown: 5000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0];
      const amount = parseInt(ctx.args[ctx.mentionedJid.length ? 0 : 1], 10);
      if (!target || !amount || amount <= 0) return ctx.reply('⚠️ Use: !pagar @usuario <valor>');
      if (target === ctx.sender) return ctx.reply('🤨 Não dá para pagar a si mesmo.');
      try {
        await withLock(ctx.sender, () => economy.transfer(ctx.sender, target, amount));
        await ctx.reply(`💸 Você pagou ${formatMoney(amount)} para @${target.split('@')[0]}.`, { mentions: [target] });
      } catch (_) {
        await ctx.reply('💸 Saldo insuficiente para pagar.');
      }
    },
  },
  {
    name: 'loteria',
    commands: ['loteria', 'lottery'],
    category: 'life',
    description: 'Aposta na loteria (moeda virtual).',
    usage: '!loteria <número 1-10> [valor]',
    cooldown: 3000,
    execute: async (ctx) => {
      const num = parseInt(ctx.args[0], 10);
      const stake = parseInt(ctx.args[1], 10) || 50;
      if (!num) return ctx.reply('🎲 Use: !loteria <número 1-10> [valor]. Prêmio: 7x o valor!');
      try {
        const r = await engine.lottery(ctx.sender, num, stake);
        if (r.won > 0) {
          await ctx.reply(`🎉 *VOCÊ GANHOU!*\n▸ Número: ${r.drawn}\n▸ Prêmio: ${formatMoney(r.won)}`);
        } else {
          await ctx.reply(`😅 Não foi dessa vez.\n▸ Seu número: ${r.num}\n▸ Sorteado: ${r.drawn}\n▸ Aposta: ${formatMoney(r.stake)}`);
        }
      } catch (err) {
        await ctx.reply((err && err.message) || '😕 Não foi possível apostar.');
      }
    },
  },
];
