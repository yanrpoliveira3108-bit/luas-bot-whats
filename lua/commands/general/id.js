'use strict';

module.exports = [
  {
    name: 'id',
    commands: ['id'],
    category: 'general',
    description: 'Mostra os IDs do chat e do usuário.',
    usage: '!id',
    cooldown: 2000,
    execute: async (ctx) => {
      const alvo = ctx.mentionedJid[0] || ctx.sender;
      const lines = [
        '🆔 *Identificadores*',
        `▸ Chat: \`${ctx.remoteJid}\``,
        `▸ Você: \`${ctx.sender}\``,
        `▸ Alvo: \`${alvo}\``,
        `▸ Tipo: ${ctx.isGroup ? 'grupo' : 'privado'}`,
      ];
      await ctx.reply(lines.join('\n'));
    },
  },
];
