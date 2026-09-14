'use strict';

const blocked = require('../../database/blocked');
const { toJid } = require('../../utils/messages');

module.exports = [
  {
    name: 'block',
    commands: ['block', 'bloquear'],
    category: 'owner',
    ownerOnly: true,
    description: 'Bloqueia um usuário de usar o bot.',
    usage: '!block @usuario | !block (sem args = lista)',
    cooldown: 2000,
    execute: async (ctx) => {
      if (!ctx.args[0] && !ctx.mentionedJid.length) {
        const list = blocked.list();
        if (!list.length) {
          await ctx.reply('🚫 Nenhum usuário bloqueado.');
          return;
        }
        await ctx.reply(`🚫 *Bloqueados (${list.length})*\n${list.map((b) => '▸ ' + b.user_id.split('@')[0]).join('\n')}`);
        return;
      }
      const jid = toJid(ctx.args[0]) || ctx.mentionedJid[0];
      if (!jid) {
        await ctx.reply('⚠️ Informe o usuário: !block @usuario ou !block 5511...');
        return;
      }
      blocked.block(jid, ctx.args.slice(1).join(' ') || 'Bloqueado pelo dono');
      await ctx.reply(`🚫 Usuário ${jid.split('@')[0]} bloqueado.`);
    },
  },
  {
    name: 'unblock',
    commands: ['unblock', 'desbloquear'],
    category: 'owner',
    ownerOnly: true,
    description: 'Desbloqueia um usuário.',
    usage: '!unblock @usuario',
    cooldown: 2000,
    execute: async (ctx) => {
      const jid = toJid(ctx.args[0]) || ctx.mentionedJid[0];
      if (!jid) {
        await ctx.reply('⚠️ Informe o usuário: !unblock @usuario');
        return;
      }
      blocked.unblock(jid);
      await ctx.reply(`✅ Usuário ${jid.split('@')[0]} desbloqueado.`);
    },
  },
];
