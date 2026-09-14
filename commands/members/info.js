/**
 * commands/members/info.js — informações do usuário (!userinfo, !badges).
 */

'use strict';

const users = require('../../database/users');
const economy = require('../../database/economy');
const life = require('../../database/life');
const { formatMoney, formatDate } = require('../../utils/formatter');
const { displayName } = require('../../engine/interactionEngine');
const { ACHIEVEMENTS } = require('../../plugins/life/config');

module.exports = [
  {
    name: 'userinfo',
    commands: ['userinfo', 'ui', 'minhaconta'],
    category: 'members',
    description: 'Informações detalhadas de um usuário.',
    usage: '!userinfo [@usuario]',
    cooldown: 3000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0] || ctx.sender;
      const u = users.get(target);
      const eco = economy.get(target);
      const p = life.getPlayer(target);
      const ach = life.listAchievements(target);

      const lines = [`👤 *${displayName(target)}*`, `▸ ID: \`${target}\``];
      if (u) {
        lines.push(`▸ Nível: ${u.level} (${u.xp}/${users.xpForNextLevel(u.level)} XP)`);
        lines.push(`▸ Reputação: ⭐ ${u.reputation}`);
        lines.push(`▸ Mensagens: ${u.messages}`);
        lines.push(`▸ Desde: ${formatDate(new Date(u.first_seen).getTime())}`);
        if (u.about) lines.push(`▸ Sobre: ${u.about}`);
      } else {
        lines.push('▸ Ainda não interagiu com o bot.');
      }
      if (eco) {
        lines.push(`▸ Carteira: ${formatMoney(eco.wallet)}`);
        lines.push(`▸ Banco: ${formatMoney(eco.bank)}`);
      }
      if (p && p.name) {
        lines.push(`▸ Lua Life: ${p.name} · nível ${p.level} (${p.xp} XP)`);
        lines.push(`▸ Conquistas: 🏆 ${ach.length}/${ACHIEVEMENTS.length}`);
      }
      await ctx.reply(lines.join('\n'));
    },
  },
  {
    name: 'badges',
    commands: ['badges', 'insignias'],
    category: 'members',
    description: 'Mostra suas conquistas (insígnias) do Lua Life.',
    usage: '!badges',
    cooldown: 3000,
    execute: async (ctx) => {
      const p = life.getPlayer(ctx.sender);
      if (!p || !p.name) return ctx.reply('🎮 Você ainda não tem uma vida no Lua Life. Crie com !vida.');
      const unlocked = new Set(life.listAchievements(ctx.sender).map((a) => a.achievement_id));
      const lines = ACHIEVEMENTS.map((a) => `${unlocked.has(a.id) ? '✅' : '🔒'} ${a.emoji || '🏆'} ${a.name}`).join('\n');
      await ctx.reply(`🏆 *Suas conquistas (${unlocked.size}/${ACHIEVEMENTS.length})*\n\n${lines}\n\n_Use !conquistas para detalhes._`);
    },
  },
];
