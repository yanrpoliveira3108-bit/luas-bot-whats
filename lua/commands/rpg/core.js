'use strict';

const rpg = require('../../database/rpg');
const economy = require('../../database/economy');
const { formatMoney } = require('../../utils/formatter');
const { displayName } = require('../../engine/interactionEngine');

module.exports = [
  {
    name: 'rpg',
    commands: ['rpg'],
    category: 'rpg',
    description: 'Mostra o painel inicial do RPG.',
    usage: '!rpg',
    cooldown: 3000,
    execute: async (ctx) => {
      const p = rpg.getPlayer(ctx.sender);
      const eco = economy.get(ctx.sender);
      await ctx.reply(
        [
          `⚔️ *RPG do ${displayName(ctx.sender)}*`,
          `▸ Nível: ${p.level} (${p.xp} XP)`,
          `▸ Energia: ${p.energy}/200`,
          `▸ Profissão: ${p.profession || 'nenhuma (use !emprego)'}`,
          `▸ Carteira: ${formatMoney(eco.wallet)}`,
          `▸ Banco: ${formatMoney(eco.bank)}`,
          '',
          '📜 *Comece por aqui:*',
          `▸ ${ctx.prefix}emprego — escolha uma profissão`,
          `▸ ${ctx.prefix}trabalhar — ganhe moedas`,
          `▸ ${ctx.prefix}loja — veja os itens`,
          `▸ ${ctx.prefix}fazenda — plante e crie animais`,
          `▸ ${ctx.prefix}perfilrpg — seu status completo`,
        ].join('\n')
      );
    },
  },
  {
    name: 'perfilrpg',
    commands: ['perfilrpg', 'status'],
    category: 'rpg',
    description: 'Status completo do seu personagem.',
    usage: '!perfilrpg',
    cooldown: 3000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0] || ctx.sender;
      const p = rpg.getPlayer(target);
      const eco = economy.get(target);
      const ach = rpg.getAchievements(target);
      await ctx.reply(
        [
          `🛡️ *${displayName(target)} — RPG*`,
          `▸ Profissão: ${p.profession || '-'}`,
          `▸ Nível: ${p.level} | XP: ${p.xp}`,
          `▸ Energia: ${p.energy}/200`,
          `▸ Reputação RPG: ${p.reputation}`,
          `▸ Carteira: ${formatMoney(eco.wallet)}`,
          `▸ Banco: ${formatMoney(eco.bank)}`,
          `▸ Total ganho: ${formatMoney(eco.total_earned)}`,
          `▸ Conquistas: ${ach.length ? ach.length : 'nenhuma ainda'}`,
        ].join('\n')
      );
    },
  },
];
