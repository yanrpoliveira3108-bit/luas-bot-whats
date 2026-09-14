'use strict';

const groups = require('../../database/groups');

module.exports = [
  {
    name: 'setwelcome',
    commands: ['setwelcome'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Configura a mensagem de boas-vindas.',
    usage: '!setwelcome on|off | !setwelcome <mensagem>',
    cooldown: 2000,
    execute: async (ctx) => {
      const arg = (ctx.args[0] || '').toLowerCase();
      const g = groups.get(ctx.remoteJid);
      if (arg === 'on' || arg === 'ligar') {
        groups.setWelcome(ctx.remoteJid, true, g.welcome_msg);
        return ctx.reply('✅ Boas-vindas ativadas.');
      }
      if (arg === 'off' || arg === 'desligar') {
        groups.setWelcome(ctx.remoteJid, false, g.welcome_msg);
        return ctx.reply('❌ Boas-vindas desativadas.');
      }
      const msg = ctx.args.join(' ');
      if (!msg) {
        return ctx.reply(
          `👋 *Boas-vindas*: ${g.welcome_enabled ? '✅ ativas' : '❌ desativadas'}\n` +
            `Mensagem: ${g.welcome_msg || '(padrão)'}\n\nUso: !setwelcome on|off ou !setwelcome <texto> (use {user})`
        );
      }
      groups.setWelcome(ctx.remoteJid, true, msg);
      await ctx.reply(`✅ Mensagem de boas-vindas definida:\n${msg}`);
    },
  },
  {
    name: 'setgoodbye',
    commands: ['setgoodbye'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Configura a mensagem de despedida.',
    usage: '!setgoodbye on|off | !setgoodbye <mensagem>',
    cooldown: 2000,
    execute: async (ctx) => {
      const arg = (ctx.args[0] || '').toLowerCase();
      const g = groups.get(ctx.remoteJid);
      if (arg === 'on' || arg === 'ligar') {
        groups.setGoodbye(ctx.remoteJid, true, g.goodbye_msg);
        return ctx.reply('✅ Despedidas ativadas.');
      }
      if (arg === 'off' || arg === 'desligar') {
        groups.setGoodbye(ctx.remoteJid, false, g.goodbye_msg);
        return ctx.reply('❌ Despedidas desativadas.');
      }
      const msg = ctx.args.join(' ');
      if (!msg) {
        return ctx.reply(
          `👋 *Despedida*: ${g.goodbye_enabled ? '✅ ativa' : '❌ desativada'}\n` +
            `Mensagem: ${g.goodbye_msg || '(padrão)'}\n\nUso: !setgoodbye on|off ou !setgoodbye <texto> (use {user})`
        );
      }
      groups.setGoodbye(ctx.remoteJid, true, msg);
      await ctx.reply(`✅ Mensagem de despedida definida:\n${msg}`);
    },
  },
  {
    name: 'welcome',
    commands: ['welcome', 'testewelcome'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Mostra/pré-visualiza a mensagem de boas-vindas.',
    usage: '!welcome',
    cooldown: 2000,
    execute: async (ctx) => {
      const g = groups.get(ctx.remoteJid);
      const msg = (g.welcome_msg || 'Bem-vindo(a), {user}! 🎉').replace('{user}', `@${ctx.sender.split('@')[0]}`);
      await ctx.reply(`👋 *Pré-visualização:*\n${msg}`, { mentions: [ctx.sender] });
    },
  },
];
