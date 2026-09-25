'use strict';

const errorHandler = require('../../handlers/errorHandler');
const richHtml = require('../../utils/richHtml');
const { buildCommandCenterHtml } = require('../../utils/commandCenterHtml');

module.exports = [
  {
    name: 'central',
    commands: ['central', 'painel', 'dashboard'],
    category: 'general',
    description: 'Abre a central estratégica do bot dentro do WhatsApp.',
    usage: '!central',
    cooldown: 5000,
    execute: async (ctx) => {
      try {
        const html = buildCommandCenterHtml(ctx);
        try {
          await richHtml.sendHtml(ctx.socket, ctx.remoteJid, html, {
            title: 'LUA COMMAND · CENTRAL ESTRATÉGICA',
            trustedSources: ['nixel.dev'],
          });
        } catch (_) {
          await ctx.reply(
            `*LUA COMMAND · CENTRAL ESTRATÉGICA*\n\n` +
            `◈ Estado: Operacional\n` +
            `♙ População: 18.642\n` +
            `⌁ Atividade hoje: 7.381 comandos\n` +
            `⚠️ Alertas pendentes: 03\n\n` +
            `Use ${ctx.prefix}menu para consultar os comandos.`
          );
        }
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'central' });
      }
    },
  },
];
