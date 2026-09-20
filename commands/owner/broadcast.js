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
        await c.reply(`📢 Iniciando envio seguro para ${targets.length} grupos... Aguarde (intervalo anti-ban ativo para não derrubar o número).`);

        for (let i = 0; i < targets.length; i++) {
          const g = targets[i];
          try {
            await antiBan.simulateTyping(c.socket, g.id, text, 'composing');
            await c.socket.sendMessage(g.id, { text: `📢 *Anúncio do ${require('../../config').bot.name}*\n\n${text}` });
            ok++;
          } catch (_) {
            /* ignora grupos que falharem */
          }
          // Delay de segurança entre grupos para não disparar alerta de spam na Meta
          if (i < targets.length - 1 && process.env.NODE_ENV !== 'test') {
            const safeDelay = 4000 + Math.floor(Math.random() * 3000); // 4 a 7 segundos
            await antiBan.sleep(safeDelay);
          }
        }
        await c.reply(`✅ Anúncio enviado com sucesso para ${ok}/${targets.length} grupos.`);
      });
    },
  },
];
