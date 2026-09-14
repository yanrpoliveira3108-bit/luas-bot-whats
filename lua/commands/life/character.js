/**
 * commands/life/character.js — criação de personagem, perfil e vitais.
 */

'use strict';

const CONFIG = require('../../config');
const life = require('../../database/life');
const users = require('../../database/users');
const engine = require('../../plugins/life/engine');
const { formatMoney, formatDuration } = require('../../utils/formatter');
const { displayName } = require('../../engine/interactionEngine');

function profileLines(ctx, target) {
  const c = engine.getContext(target);
  const p = c.player;
  const bar = (v) => '█'.repeat(Math.max(0, Math.floor(v / 10))) + '░'.repeat(10 - Math.max(0, Math.floor(v / 10)));
  return [
    `🎮 *${p.name || displayName(target)}* — Lua Life`,
    `▸ 🏅 Nível ${p.level} · ${c.title}${c.nextTitle ? ` (próx.: ${c.nextTitle.title} no nível ${c.nextTitle.level})` : ' (máximo)'}`,
    `▸ ⭐ XP: ${p.xp}/${life.xpForNextLevel(p.level)}`,
    `▸ 💼 Profissão: ${c.rpg.profession ? `${c.job ? c.job.emoji : ''} ${c.rpg.profession} — ${c.careerTitle}` : 'nenhuma (!empregos)'}`,
    `▸ 🎂 Idade: ${p.age} · 🏙️ Cidade: ${p.city || '-'}`,
    '',
    `⚡ Energia ${bar(p.energy / 2)} ${p.energy}/200`,
    `❤️ Saúde ${bar(p.health)} ${p.health}/100`,
    `🍖 Fome ${bar(p.hunger)} ${p.hunger}/100`,
    `😊 Felicidade ${bar(p.happiness)} ${p.happiness}/100`,
    '',
    `🧠 Conhecimento: ${p.knowledge} · 💪 Eficiência: ${p.efficiency} · 🍀 Sorte: ${p.luck} · 🤝 Reputação: ${p.reputation}`,
    `💰 Carteira: ${formatMoney(c.eco.wallet)} · 🏦 Banco: ${formatMoney(c.eco.bank)}`,
    `📊 Patrimônio: ${formatMoney(c.networth.total)}`,
  ];
}

module.exports = [
  {
    name: 'vida',
    commands: ['vida', 'luavida', 'perfilvida'],
    category: 'life',
    description: 'Cria/seu personagem e mostra o perfil do Lua Life.',
    usage: '!vida [nome] [idade] [cidade]',
    cooldown: 2000,
    execute: async (ctx) => {
      const p = life.getPlayer(ctx.sender);
      if (!p.name) {
        // primeira utilização → criação
        const name = (ctx.args[0] || (users.get(ctx.sender) && users.get(ctx.sender).name) || '').slice(0, 24);
        const age = Math.min(99, Math.max(8, parseInt(ctx.args[1], 10) || 18));
        const city = ctx.args.length >= 3 ? ctx.args.slice(2).join(' ').slice(0, 24) : 'Sumaré';
        life.createCharacter(ctx.sender, { name, age, city, money: CONFIG.life.start.money });
        await ctx.reply(
          [
            '🌎 *BEM-VINDO AO LUA LIFE*',
            'Você está começando uma nova vida.',
            `▸ Nome: ${name}`,
            `▸ Idade: ${age}`,
            `▸ Cidade: ${city}`,
            `▸ Dinheiro inicial: ${formatMoney(CONFIG.life.start.money)}`,
            '',
            `Comece com ${ctx.prefix}trabalho (profissões), ${ctx.prefix}minerar, ${ctx.prefix}pescar ou ${ctx.prefix}loja!`,
          ].join('\n')
        );
        return;
      }
      await ctx.reply(profileLines(ctx, ctx.sender).join('\n'));
    },
  },
  {
    name: 'atributos',
    commands: ['atributos'],
    category: 'life',
    description: 'Mostra seus atributos do Lua Life.',
    usage: '!atributos',
    cooldown: 2000,
    execute: async (ctx) => {
      const p = engine.getContext(ctx.sender).player;
      await ctx.reply(
        [
          '🧬 *Seus atributos*',
          `▸ ⚡ Energia: ${p.energy}/200 (recupera descansando)`,
          `▸ 🧠 Conhecimento: ${p.knowledge} (+XP por atividade)`,
          `▸ 💪 Eficiência: ${p.efficiency} (+salário)`,
          `▸ 🍀 Sorte: ${p.luck} (+itens raros)`,
          `▸ 🤝 Reputação: ${p.reputation}`,
          `▸ 💼 XP de carreira: ${p.career_xp} (cargo nível ${p.career_level})`,
        ].join('\n')
      );
    },
  },
  {
    name: 'descansar',
    commands: ['descansar', 'dormir'],
    category: 'life',
    description: 'Descansa e recupera energia.',
    usage: '!descansar',
    cooldown: 3000,
    execute: async (ctx) => {
      try {
        const energy = await engine.rest(ctx.sender);
        await ctx.reply(`😴 Você descansou!\n▸ Energia: ${energy}/200\n▸ Felicidade: +10`);
      } catch (err) {
        if (err && err.code === 'COOLDOWN') {
          const remaining = life.getCooldownRemaining ? 0 : 0;
          return ctx.reply(`⏳ Você acabou de descansar. Aguarde ${formatDuration(remaining || 3600000)}.`);
        }
        await ctx.reply((err && err.message) || '😕 Não foi possível descansar.');
      }
    },
  },
  {
    name: 'comer',
    commands: ['comer'],
    category: 'life',
    description: 'Come e recupera fome.',
    usage: '!comer',
    cooldown: 2000,
    execute: async (ctx) => {
      try {
        const r = await engine.eat(ctx.sender);
        await ctx.reply(`🍎 Você comeu!\n▸ Fome: ${r.hunger}/100\n▸ Saúde: +5`);
      } catch (err) {
        await ctx.reply((err && err.message) || '🍎 Você não tem comida. Compre com !comprar comida.');
      }
    },
  },
];
