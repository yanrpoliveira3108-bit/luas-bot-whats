'use strict';

const rpg = require('../../database/rpg');
const economy = require('../../database/economy');
const { withLock } = require('../../utils/keyedMutex');
const { formatMoney, formatDuration } = require('../../utils/formatter');
const { CROPS, ANIMALS, randomBetween } = require('./_data');

module.exports = [
  {
    name: 'fazenda',
    commands: ['fazenda', 'farm'],
    category: 'rpg',
    description: 'Mostra sua fazenda (plantações e animais).',
    usage: '!fazenda',
    cooldown: 3000,
    execute: async (ctx) => {
      const farm = rpg.getFarm(ctx.sender);
      const plants = rpg.getPlantations(ctx.sender);
      const animals = rpg.getAnimals(ctx.sender);

      const plantLines = plants.map((p) => {
        const crop = CROPS[p.crop] || { name: p.crop, emoji: '🌱' };
        const ready = new Date(p.ready_at).getTime() <= Date.now();
        return `#${p.id} ${crop.emoji} ${crop.name} — ${ready ? '✅ pronto p/ colher' : '⏳ ' + formatDuration(new Date(p.ready_at).getTime() - Date.now())}`;
      });

      const animalLines = animals.map((a) => {
        const def = ANIMALS[a.type] || { name: a.type, emoji: '🐾' };
        const produce = a.type !== 'cavalo' && new Date(a.fed_at).getTime() + def.productMs < Date.now();
        return `#${a.id} ${def.emoji} ${def.name} — ${produce ? '🍼 produção pronta!' : 'ok'}`;
      });

      await ctx.reply(
        [
          `🏡 *${farm.name}* (nível ${farm.level})`,
          '',
          `🌱 *Plantações (${plants.length})*`,
          plantLines.length ? plantLines.join('\n') : '(nenhuma — use !plantar <semente>)',
          '',
          `🐄 *Animais (${animals.length})*`,
          animalLines.length ? animalLines.join('\n') : '(nenhum — use !compraranimal <animal>)',
        ].join('\n')
      );
    },
  },
  {
    name: 'plantar',
    commands: ['plantar'],
    category: 'rpg',
    description: 'Planta uma semente na fazenda.',
    usage: '!plantar <semente>',
    cooldown: 2000,
    execute: async (ctx) => {
      const id = (ctx.args[0] || '').toLowerCase();
      const crop = CROPS[id];
      if (!crop) return ctx.reply(`⚠️ Semente inválida. Opções: ${Object.keys(CROPS).join(', ')}`);

      const hasSeed = economy.getItem(ctx.sender, id);
      if (!hasSeed || hasSeed.quantity < 1) return ctx.reply('🌱 Você não tem essa semente. Compre na loja.');
      const hasRegador = economy.getItem(ctx.sender, 'regador');
      if (!hasRegador || hasRegador.quantity < 1) return ctx.reply('🚿 Você precisa de um Regador para plantar (compre na loja).');

      const readyAt = new Date(Date.now() + crop.growMs).toISOString();
      await withLock(ctx.sender, () => {
        economy.removeItem(ctx.sender, id, 1);
        rpg.addPlantation(ctx.sender, id, readyAt);
      });
      await ctx.reply(`🌱 *${crop.name}* plantado! Fica pronto em ${formatDuration(crop.growMs)}.`);
    },
  },
  {
    name: 'colher',
    commands: ['colher', 'colheita'],
    category: 'rpg',
    description: 'Colhe plantações prontas.',
    usage: '!colher [id|all]',
    cooldown: 3000,
    execute: async (ctx) => {
      const arg = (ctx.args[0] || 'all').toLowerCase();
      const plants = rpg.getPlantations(ctx.sender).filter((p) => new Date(p.ready_at).getTime() <= Date.now());
      if (!plants.length) return ctx.reply('🌱 Nenhuma plantação pronta para colher.');

      let total = 0;
      let xp = 0;
      await withLock(ctx.sender, () => {
        for (const p of plants) {
          if (arg !== 'all' && String(p.id) !== arg) continue;
          const crop = CROPS[p.crop];
          if (!crop) continue;
          const gain = randomBetween(crop.yieldRange);
          economy.addWallet(ctx.sender, gain);
          rpg.addRpgXp(ctx.sender, crop.xp);
          rpg.setPlantationHarvested(p.id);
          total += gain;
          xp += crop.xp;
        }
      });

      if (!total) return ctx.reply('⚠️ Nenhuma plantação com esse ID pronta.');
      require('../../plugins/life/engine').checkAchievement(ctx.sender, 'fazendeiro');
      await ctx.reply(`🧺 *Colheita concluída!*\n▸ Ganhou: ${formatMoney(total)}\n▸ XP: +${xp}`);
    },
  },
  {
    name: 'regar',
    commands: ['regar'],
    category: 'rpg',
    description: 'Rega plantações (acelera o crescimento).',
    usage: '!regar [id|all]',
    cooldown: 5000,
    execute: async (ctx) => {
      const hasRegador = economy.getItem(ctx.sender, 'regador');
      if (!hasRegador || hasRegador.quantity < 1) return ctx.reply('🚿 Você precisa de um Regador.');

      const arg = (ctx.args[0] || 'all').toLowerCase();
      const plants = rpg.getPlantations(ctx.sender).filter((p) => new Date(p.ready_at).getTime() > Date.now());
      if (!plants.length) return ctx.reply('🌱 Nenhuma plantação para regar.');

      let watered = 0;
      await withLock(ctx.sender, () => {
        for (const p of plants) {
          if (arg !== 'all' && String(p.id) !== arg) continue;
          // rega no máximo 1x por hora
          const lastWater = new Date(p.watered_at).getTime();
          if (Date.now() - lastWater < 3600 * 1000) continue;
          const remaining = new Date(p.ready_at).getTime() - Date.now();
          const newReady = new Date(Date.now() + remaining * 0.85).toISOString();
          require('../../database/database').prepare('water_ready', `UPDATE plantations SET ready_at = ?, watered_at = ? WHERE id = ?`).run(newReady, new Date().toISOString(), p.id);
          watered++;
        }
      });

      if (!watered) return ctx.reply('💧 Nada para regar agora (já regado ou pronto).');
      await ctx.reply(`💧 ${watered} plantação(ões) regada(s)! Crescimento acelerado.`);
    },
  },
  {
    name: 'compraranimal',
    commands: ['compraranimal'],
    category: 'rpg',
    description: 'Compra um animal para a fazenda.',
    usage: '!compraranimal <galinha|vaca|cavalo>',
    cooldown: 3000,
    execute: async (ctx) => {
      const id = (ctx.args[0] || '').toLowerCase();
      const item = rpg.getShopItem(id);
      if (!item || item.type !== 'animal') {
        const all = Object.keys(ANIMALS).filter((a) => rpg.getShopItem(a));
        return ctx.reply(`🐄 Animais disponíveis: ${all.join(', ')}.`);
      }

      // capacidade: aves (galinha) → galinheiro; demais → estábulo
      const engine = require('../../plugins/life/engine');
      const isBird = id === 'galinha';
      const owned = rpg.countAnimals(ctx.sender, id);
      const cap = engine.animalCapacity(ctx.sender);
      const limit = isBird ? cap.coopCap : cap.stableCap;
      const totalOwned = rpg.getAnimals(ctx.sender).length;
      if (totalOwned >= (isBird ? cap.coopCap : cap.stableCap)) {
        return ctx.reply(`🐄 Capacidade cheia! Melhore seu ${isBird ? 'galinheiro (!galinheiro)' : 'estábulo (!estabulo)'} (${totalOwned}/${limit}).`);
      }

      const eco = economy.get(ctx.sender);
      if (eco.wallet < item.price) return ctx.reply(`💸 Saldo insuficiente (custa ${formatMoney(item.price)}).`);

      await withLock(ctx.sender, () => {
        economy.addWallet(ctx.sender, -item.price);
        rpg.addAnimal(ctx.sender, id, item.name);
        economy.recordTransaction(ctx.sender, 'compra', -item.price, item.name);
      });
      engine.checkAchievement(ctx.sender, 'primeiro_animal');
      await ctx.reply(`${item.emoji} *${item.name}* comprado(a) e adicionado(a) à fazenda!`);
    },
  },
  {
    name: 'animais',
    commands: ['animais', 'meusanimais'],
    category: 'rpg',
    description: 'Lista os animais da fazenda.',
    usage: '!animais',
    cooldown: 2000,
    execute: async (ctx) => {
      const animals = rpg.getAnimals(ctx.sender);
      if (!animals.length) return ctx.reply('🐄 Você não tem animais. Use !compraranimal.');
      const lines = animals.map((a) => {
        const def = ANIMALS[a.type] || { name: a.type, emoji: '🐾' };
        return `#${a.id} ${def.emoji} ${def.name}`;
      });
      await ctx.reply(`🐄 *Animais (${animals.length})*\n${lines.join('\n')}`);
    },
  },
  {
    name: 'alimentar',
    commands: ['alimentar'],
    category: 'rpg',
    description: 'Alimenta os animais e coleta a produção.',
    usage: '!alimentar [id|all]',
    cooldown: 3000,
    execute: async (ctx) => {
      const arg = (ctx.args[0] || 'all').toLowerCase();
      const animals = rpg.getAnimals(ctx.sender);
      if (!animals.length) return ctx.reply('🐄 Você não tem animais.');

      let total = 0;
      let fed = 0;
      await withLock(ctx.sender, () => {
        for (const a of animals) {
          if (arg !== 'all' && String(a.id) !== arg) continue;
          const def = ANIMALS[a.type];
          if (!def) continue;
          if (def.product) {
            const elapsed = Date.now() - new Date(a.fed_at).getTime();
            const batches = Math.min(5, Math.floor(elapsed / def.productMs));
            if (batches > 0) {
              const gain = def.productPrice * batches;
              economy.addWallet(ctx.sender, gain);
              total += gain;
            }
          }
          rpg.feedAnimal(a.id);
          fed++;
        }
      });

      if (!fed) return ctx.reply('⚠️ Nenhum animal com esse ID.');
      const msg = total > 0 ? `🥛 Você coletou ${formatMoney(total)} da produção!` : '🍽️ Animais alimentados (sem produção pronta).';
      await ctx.reply(`🍽️ *${fed}* animal(is) alimentado(s).\n${msg}`);
    },
  },
  {
    name: 'venderanimal',
    commands: ['venderanimal'],
    category: 'rpg',
    description: 'Vende um animal da fazenda.',
    usage: '!venderanimal <id|all>',
    cooldown: 3000,
    execute: async (ctx) => {
      const arg = (ctx.args[0] || '').toLowerCase();
      if (!arg) return ctx.reply('⚠️ Use: !venderanimal <id> ou !venderanimal all');
      const animals = rpg.getAnimals(ctx.sender);
      if (!animals.length) return ctx.reply('🐄 Você não tem animais.');

      let total = 0;
      let sold = 0;
      await withLock(ctx.sender, () => {
        for (const a of animals) {
          if (arg !== 'all' && String(a.id) !== arg) continue;
          const item = rpg.getShopItem(a.type);
          const price = item ? item.sell_price : 0;
          economy.addWallet(ctx.sender, price);
          rpg.removeAnimal(a.id);
          total += price;
          sold++;
        }
      });

      if (!sold) return ctx.reply('⚠️ Nenhum animal com esse ID.');
      await ctx.reply(`💰 ${sold} animal(is) vendido(s) por ${formatMoney(total)}.`);
    },
  },
];
