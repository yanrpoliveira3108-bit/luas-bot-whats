'use strict';

const users = require('../../database/users');
const groups = require('../../database/groups');

module.exports = [
  {
    name: 'reputacao',
    commands: ['reputacao', 'rep'],
    category: 'members',
    description: 'Mostra sua reputação.',
    usage: '!reputacao',
    cooldown: 2000,
    execute: async (ctx) => {
      const u = users.get(ctx.sender);
      await ctx.reply(`⭐ Sua reputação: *${u ? u.reputation : 0}*`);
    },
  },
  {
    name: 'sobre',
    commands: ['sobre', 'sobremim'],
    category: 'members',
    description: 'Define um texto sobre você (aparece no perfil).',
    usage: '!sobre <texto>',
    cooldown: 3000,
    execute: async (ctx) => {
      const text = ctx.args.join(' ').slice(0, 120);
      if (!text) {
        const u = users.get(ctx.sender);
        return ctx.reply(`📝 Seu "sobre" atual: ${u && u.about ? u.about : '(vazio)'}\nUse !sobre <texto> para definir.`);
      }
      users.setAbout(ctx.sender, text);
      await ctx.reply('✅ Texto "sobre" atualizado.');
    },
  },
  {
    name: 'regras',
    commands: ['regras'],
    category: 'members',
    description: 'Mostra as regras do grupo.',
    usage: '!regras [novas regras = admin]',
    groupOnly: true,
    cooldown: 2000,
    execute: async (ctx) => {
      const s = groups.getSettings(ctx.remoteJid);
      const rules = s.rules || '1. Respeite todos os membros.\n2. Sem spam ou flood.\n3. Sem links sem permissão.\n4. Divirta-se! 😄';
      if (ctx.args.length && (ctx.isAdmin || ctx.isOwner)) {
        groups.setSetting(ctx.remoteJid, 'rules', ctx.args.join(' '));
        return ctx.reply('✅ Regras atualizadas.');
      }
      await ctx.reply(`📜 *Regras do grupo*\n${rules}`);
    },
  },
];
