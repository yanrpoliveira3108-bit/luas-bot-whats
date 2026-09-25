'use strict';

const alvoUtil = require('../../utils/alvo');

const blocked = require('../../database/blocked');

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
      if (!alvoUtil.alvo(ctx, { numero: true }) && !ctx.args[0]) {
        const list = blocked.list();
        if (!list.length) {
          await ctx.reply('🚫 Nenhum usuário bloqueado.');
          return;
        }
        await ctx.reply(`🚫 *Bloqueados (${list.length})*\n${list.map((b) => '▸ ' + b.user_id.split('@')[0]).join('\n')}`);
        return;
      }
      const jid = alvoUtil.alvo(ctx, { numero: true });
      if (!jid) {
        await ctx.reply('⚠️ Informe o usuário: !block @usuario, !block 5511... ou responda a mensagem dele com !block');
        return;
      }
      blocked.block(jid, alvoUtil.resto(ctx, { numero: true }).join(' ') || 'Bloqueado pelo dono');
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
      const jid = alvoUtil.alvo(ctx, { numero: true });
      if (!jid) {
        await ctx.reply('⚠️ Informe o usuário: !unblock @usuario, !unblock 5511... ou responda a mensagem dele');
        return;
      }
      blocked.unblock(jid);
      await ctx.reply(`✅ Usuário ${jid.split('@')[0]} desbloqueado.`);
    },
  },
];
