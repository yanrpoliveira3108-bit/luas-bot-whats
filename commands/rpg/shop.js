'use strict';

const rpg = require('../../database/rpg');
const economy = require('../../database/economy');
const { withLock } = require('../../utils/keyedMutex');
const { formatMoney } = require('../../utils/formatter');

module.exports = [
  {
    name: 'loja',
    commands: ['loja', 'shop'],
    category: 'rpg',
    description: 'Mostra os itens da loja.',
    usage: '!loja',
    cooldown: 2000,
    execute: async (ctx) => {
      const items = rpg.getShopItems();
      const lines = items.map((i) => `${i.emoji} *${i.name}* — ${formatMoney(i.price)}\n▸ ${i.description}`);
      await ctx.reply(`🏪 *Loja do RPG*\n${lines.join('\n')}\n\nCompre com ${ctx.prefix}comprar <item>.`);
    },
  },
  {
    name: 'comprar',
    commands: ['comprar', 'buy'],
    category: 'rpg',
    description: 'Compra um item da loja.',
    usage: '!comprar <item> [quantidade]',
    cooldown: 2000,
    execute: async (ctx) => {
      const id = (ctx.args[0] || '').toLowerCase();
      const qty = Math.max(1, parseInt(ctx.args[1], 10) || 1);
      const item = rpg.getShopItem(id);
      if (!item) return ctx.reply(`⚠️ Item não encontrado. Veja: ${ctx.prefix}loja`);

      const total = item.price * qty;
      const eco = economy.get(ctx.sender);
      if (eco.wallet < total) return ctx.reply(`💸 Saldo insuficiente. Você precisa de ${formatMoney(total)}.`);

      await withLock(ctx.sender, () => {
        economy.addWallet(ctx.sender, -total);
        if (item.type === 'animal') {
          for (let i = 0; i < qty; i++) rpg.addAnimal(ctx.sender, item.id, item.name);
        } else {
          economy.addItem(ctx.sender, item.id, qty);
        }
        economy.recordTransaction(ctx.sender, 'compra', -total, item.name);
      });

      await ctx.reply(`🛒 Comprado: ${item.emoji} *${item.name}* x${qty} por ${formatMoney(total)}.`);
    },
  },
  {
    name: 'vender',
    commands: ['vender', 'sell'],
    category: 'rpg',
    description: 'Vende um item do inventário.',
    usage: '!vender <item> [quantidade]',
    cooldown: 2000,
    execute: async (ctx) => {
      const id = (ctx.args[0] || '').toLowerCase();
      const qty = Math.max(1, parseInt(ctx.args[1], 10) || 1);
      const item = rpg.getShopItem(id);
      if (!item) return ctx.reply(`⚠️ Item não encontrado. Use ${ctx.prefix}inventario.`);
      const has = economy.getItem(ctx.sender, id);
      if (!has || has.quantity < qty) return ctx.reply('📦 Você não possui essa quantidade do item.');

      const total = item.sell_price * qty;
      await withLock(ctx.sender, () => {
        economy.removeItem(ctx.sender, id, qty);
        economy.addWallet(ctx.sender, total);
        economy.recordTransaction(ctx.sender, 'venda', total, item.name);
      });
      await ctx.reply(`💰 Vendido: ${item.emoji} *${item.name}* x${qty} por ${formatMoney(total)}.`);
    },
  },
  {
    name: 'inventario',
    commands: ['inventario', 'mochila', 'inv'],
    category: 'rpg',
    description: 'Mostra seu inventário.',
    usage: '!inventario',
    cooldown: 2000,
    execute: async (ctx) => {
      const items = economy.inventory(ctx.sender);
      if (!items.length) return ctx.reply('🎒 Seu inventário está vazio. Compre itens na loja!');
      const lines = items.map((i) => `${i.emoji || '📦'} *${i.name || i.item_id}* x${i.quantity}`);
      await ctx.reply(`🎒 *Inventário*\n${lines.join('\n')}`);
    },
  },
  {
    name: 'usar',
    commands: ['usar', 'use'],
    category: 'rpg',
    description: 'Usa um item consumível.',
    usage: '!usar <item>',
    cooldown: 2000,
    execute: async (ctx) => {
      const id = (ctx.args[0] || '').toLowerCase();
      const has = economy.getItem(ctx.sender, id);
      if (!has || has.quantity < 1) return ctx.reply('📦 Você não possui esse item.');
      if (id === 'pocao_energia') {
        await withLock(ctx.sender, () => {
          economy.removeItem(ctx.sender, id, 1);
          rpg.addEnergy(ctx.sender, 100);
        });
        const p = rpg.getPlayer(ctx.sender);
        return ctx.reply(`⚡ Energia restaurada! Agora: ${p.energy}/200.`);
      }
      if (id === 'fertilizante') {
        const plants = rpg.getPlantations(ctx.sender);
        if (!plants.length) return ctx.reply('🌱 Você não tem plantações para fertilizar.');
        const plant = plants[0];
        const newReady = new Date(new Date(plant.ready_at).getTime() - 0.25 * (new Date(plant.ready_at).getTime() - Date.now())).toISOString();
        await withLock(ctx.sender, () => {
          economy.removeItem(ctx.sender, id, 1);
          rpg.fertilizePlantation(plant.id, newReady);
        });
        return ctx.reply('💩 Fertilizante aplicado! O tempo de crescimento foi reduzido.');
      }
      await ctx.reply('ℹ️ Este item não é consumível.');
    },
  },
];
