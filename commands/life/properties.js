/**
 * commands/life/properties.js — casas, terrenos, veículos, galinheiro/estábulo.
 */

'use strict';

const life = require('../../database/life');
const engine = require('../../plugins/life/engine');
const { HOUSES, LANDS, VEHICLES, COOPS } = require('../../plugins/life/config');
const { formatMoney } = require('../../utils/formatter');

const KIND_LABEL = { casa: '🏠 Casa', terreno: '🌱 Terreno', veiculo: '🚗 Veículo', galinheiro: '🐔 Galinheiro', estabulo: '🐄 Estábulo' };

module.exports = [
  {
    name: 'propriedades',
    commands: ['propriedades', 'casa', 'casas'],
    category: 'life',
    description: 'Lista suas propriedades.',
    usage: '!propriedades',
    cooldown: 2000,
    execute: async (ctx) => {
      const props = life.listProperties(ctx.sender);
      if (!props.length) {
        return ctx.reply(`🏠 Você ainda não tem propriedades.\n▸ Casas: ${ctx.prefix}comprarcasa\n▸ Terrenos: ${ctx.prefix}comprarterreno\n▸ Veículos: ${ctx.prefix}veiculos\n▸ Galinheiro: ${ctx.prefix}galinheiro`);
      }
      const lines = props.map((p) => {
        const label = KIND_LABEL[p.kind] || p.kind;
        return `${label} — *${p.spec.replace(/_/g, ' ')}* (nível ${p.level})`;
      });
      await ctx.reply(`🏘️ *Suas propriedades (${props.length})*\n${lines.join('\n')}`);
    },
  },
  {
    name: 'comprarcasa',
    commands: ['comprarcasa'],
    category: 'life',
    description: 'Compra uma casa.',
    usage: '!comprarcasa <barraco|casa_simples|casa_media|casa_grande|mansao>',
    cooldown: 3000,
    execute: async (ctx) => {
      const id = (ctx.args[0] || '').toLowerCase();
      if (!id) {
        const lines = HOUSES.map((h) => `${h.emoji} *${h.name}* — ${formatMoney(h.price)} (nível ${h.levelReq}+)`);
        return ctx.reply(`🏠 *Casas*\n${lines.join('\n')}\n\nUse ${ctx.prefix}comprarcasa <nome>.`);
      }
      try {
        const h = await engine.buyHouse(ctx.sender, id);
        await ctx.reply(`🏠 *${h.name}* comprada por ${formatMoney(h.price)}! Veja em ${ctx.prefix}propriedades.`);
      } catch (err) {
        await ctx.reply((err && err.message) || '😕 Não foi possível comprar.');
      }
    },
  },
  {
    name: 'comprarterreno',
    commands: ['comprarterreno', 'terreno'],
    category: 'life',
    description: 'Compra um terreno.',
    usage: '!comprarterreno <rural|residencial|urbano|premium>',
    cooldown: 3000,
    execute: async (ctx) => {
      const id = (ctx.args[0] || '').toLowerCase();
      if (!id) {
        const lines = LANDS.map((l) => `${l.emoji} *${l.name}* — ${formatMoney(l.price)} (nível ${l.levelReq}+)`);
        return ctx.reply(`🌱 *Terrenos*\n${lines.join('\n')}\n\nUse ${ctx.prefix}comprarterreno <tipo>.`);
      }
      try {
        const l = await engine.buyLand(ctx.sender, id);
        await ctx.reply(`🌱 *Terreno ${l.name}* comprado por ${formatMoney(l.price)}!`);
      } catch (err) {
        await ctx.reply((err && err.message) || '😕 Não foi possível comprar.');
      }
    },
  },
  {
    name: 'melhorar',
    commands: ['melhorar', 'upgrade', 'upgradecasa'],
    category: 'life',
    description: 'Melhora uma propriedade (casa/terreno/veículo).',
    usage: '!melhorar <casa|terreno|veiculo> <spec>',
    cooldown: 3000,
    execute: async (ctx) => {
      const kind = String(ctx.args[0] || '').toLowerCase();
      const spec = String(ctx.args[1] || '').toLowerCase();
      if (!kind || !spec) return ctx.reply('⚠️ Use: !melhorar <casa|terreno|veiculo> <tipo>');
      try {
        const r = await engine.upgradeProperty(ctx.sender, kind, spec);
        await ctx.reply(`🔧 Propriedade melhorada para o *nível ${r.level}* por ${formatMoney(r.cost)}.`);
      } catch (err) {
        await ctx.reply((err && err.message) || '😕 Não foi possível melhorar.');
      }
    },
  },
  {
    name: 'veiculos',
    commands: ['veiculos', 'veiculo'],
    category: 'life',
    description: 'Lista e compra veículos.',
    usage: '!veiculos [comprar <tipo>]',
    cooldown: 3000,
    execute: async (ctx) => {
      const sub = String(ctx.args[0] || '').toLowerCase();
      if (sub === 'comprar') {
        const id = String(ctx.args[1] || '').toLowerCase();
        if (!id) return ctx.reply('⚠️ Use: !veiculos comprar <bicicleta|moto|carro|caminhao|trator|barco>');
        try {
          const v = await engine.buyVehicle(ctx.sender, id);
          return ctx.reply(`${v.emoji} *${v.name}* comprado por ${formatMoney(v.price)}! Reduz o tempo de trabalho.`);
        } catch (err) {
          return ctx.reply((err && err.message) || '😕 Não foi possível comprar.');
        }
      }
      const owned = life.listProperties(ctx.sender).filter((p) => p.kind === 'veiculo');
      const lines = VEHICLES.map((v) => {
        const has = owned.find((p) => p.spec === v.id);
        return `${v.emoji} *${v.name}* — ${formatMoney(v.price)} (nível ${v.levelReq}+)${has ? ' ✅' : ''}`;
      });
      await ctx.reply(`🚗 *Veículos*\n${lines.join('\n')}\n\nCompre: ${ctx.prefix}veiculos comprar <tipo>`);
    },
  },
  {
    name: 'galinheiro',
    commands: ['galinheiro'],
    category: 'life',
    description: 'Compra/melhora o galinheiro (capacidade de aves).',
    usage: '!galinheiro',
    cooldown: 3000,
    execute: async (ctx) => {
      try {
        const r = await engine.buyCoop(ctx.sender, 'galinheiro');
        await ctx.reply(`🐔 *Galinheiro nível ${r.level}* — capacidade: ${r.capacity} aves.`);
      } catch (err) {
        const cur = life.getProperty(ctx.sender, 'galinheiro', 'galinheiro');
        const cap = cur ? COOPS.galinheiro.levels[Math.min(cur.level, 3) - 1].cap : 3;
        await ctx.reply(`${(err && err.message) || ''}\n▸ Galinheiro atual: nível ${cur ? cur.level : 0} (capacidade ${cap}).`);
      }
    },
  },
  {
    name: 'estabulo',
    commands: ['estabulo', 'celeiro'],
    category: 'life',
    description: 'Compra/melhora o estábulo (capacidade de animais grandes).',
    usage: '!estabulo',
    cooldown: 3000,
    execute: async (ctx) => {
      try {
        const r = await engine.buyCoop(ctx.sender, 'estabulo');
        await ctx.reply(`🐄 *Estábulo nível ${r.level}* — capacidade: ${r.capacity} animais.`);
      } catch (err) {
        const cur = life.getProperty(ctx.sender, 'estabulo', 'estabulo');
        const cap = cur ? COOPS.estabulo.levels[Math.min(cur.level, 3) - 1].cap : 3;
        await ctx.reply(`${(err && err.message) || ''}\n▸ Estábulo atual: nível ${cur ? cur.level : 0} (capacidade ${cap}).`);
      }
    },
  },
];
