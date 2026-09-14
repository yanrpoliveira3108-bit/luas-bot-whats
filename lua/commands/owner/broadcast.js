'use strict';

const groups = require('../../database/groups');
const users = require('../../database/users');
const { confirmAction } = require('../_shared/confirm');

module.exports = [
  {
    name: 'broadcast',
    commands: ['broadcast', 'anuncio'],
    category: 'owner',
    ownerOnly: true,
    description: 'Envia um anúncio para todos os grupos registrados.',
    usage: '!broadcast <mensagem>',
    cooldown: 30000,
    execute: async (ctx) => {
      const text = ctx.args.join(' ');
      if (!text) {
        await ctx.reply('⚠️ Envie a mensagem: !broadcast <texto>');
        return;
      }
      const targets = groups
        .all()
        .filter((g) => g.active);
      if (!targets.length) {
        await ctx.reply('📭 Nenhum grupo registrado para receber o anúncio.');
        return;
      }
      await confirmAction(ctx, `enviar anúncio para ${targets.length} grupos`, async (c) => {
        let ok = 0;
        for (const g of targets) {
          try {
            await c.socket.sendMessage(g.id, { text: `📢 *Anúncio do ${require('../../config').bot.name}*\n\n${text}` });
            ok++;
          } catch (_) {
            /* ignora grupos que falharem */
          }
          await new Promise((r) => setTimeout(r, 400));
        }
        await c.reply(`📢 Anúncio enviado para ${ok}/${targets.length} grupos.`);
      });
    },
  },
];
