'use strict';

const groups = require('../../database/groups');
const antiBan = require('../../utils/antiBan');
const { confirmAction } = require('../_shared/confirm');

module.exports = [
  {
    name: 'broadcast',
    commands: ['broadcast', 'anuncio'],
    category: 'owner',
    ownerOnly: true,
    description: 'Envia um anúncio para todos os grupos registrados com espaçamento seguro anti-ban.',
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
      await confirmAction(ctx, `enviar anúncio para ${targets.length} grupos com proteção anti-ban`, async (c) => {
        let ok = 0;
        let blocked = 0;
        await c.reply(
          `📢 Iniciando envio para ${targets.length} grupos.\n` +
            '_O freio de envio espaça as mensagens automaticamente._'
        );
        for (const g of targets) {
          try {
            // "digitando..." antes de cada grupo (ritmo humano) e depois o
            // envio pelo freio — que espaça, respeita o teto por minuto e,
            // se SEND_DUP_MAX_CHATS estiver ligado, barra o texto idêntico
            // repetido (o que for barrado volta marcado com guardBlocked).
            await antiBan.simulateTyping(c.socket, g.id, text, 'composing');
            const res = await c.socket.sendMessage(g.id, {
              text: `📢 *Anúncio do ${require('../../config').bot.name}*\n\n${text}`,
            });
            if (res && res.guardBlocked) blocked++;
            else ok++;
          } catch (_) {
            /* ignora grupos que falharem */
          }
        }
        const aviso = blocked
          ? `\n⚠️ ${blocked} grupo(s) barrado(s) (SEND_DUP_MAX_CHATS): texto IDÊNTICO já foi para outros grupos.`
          : '';
        await c.reply(`✅ Anúncio enviado para ${ok}/${targets.length} grupos.${aviso}`);
      });
    },
  },
];
