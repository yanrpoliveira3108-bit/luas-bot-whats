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
        let blocked = 0;
        for (const g of targets) {
          try {
            // O FREIO DE ENVIO cuida do espaçamento (não é mais 400ms fixo) e
            // TRAVA a mesma mensagem quando ela já foi para vários grupos:
            // anúncio idêntico em massa é a assinatura nº 1 de spam. O que for
            // barrado volta marcado (guardBlocked) e é contado aqui.
            const res = await c.socket.sendMessage(g.id, { text: `📢 *Anúncio do ${require('../../config').bot.name}*\n\n${text}` });
            if (res && res.guardBlocked) blocked++;
            else ok++;
          } catch (_) {
            /* ignora grupos que falharem */
          }
        }
        const aviso = blocked
          ? `\n⚠️ ${blocked} grupo(s) barrado(s) pelo freio: mensagem IDÊNTICA já foi para outros grupos ` +
            '(anti-spam/anti-restrição). Para avisar todos, personalize o texto por grupo.'
          : '';
        await c.reply(`📢 Anúncio enviado para ${ok}/${targets.length} grupos.${aviso}`);
      });
    },
  },
];
