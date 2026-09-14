/**
 * commands/stickers/text.js — sticker de texto com cor (!txtsticker).
 *
 * Uso: !txtsticker <texto> [cor]  (ex.: !txtsticker Olá azul)
 */

'use strict';

const CONFIG = require('../../config');
const engine = require('../../utils/stickerEngine');
const errorHandler = require('../../handlers/errorHandler');

const COLORS = ['vermelho', 'azul', 'verde', 'amarelo', 'rosa', 'roxo', 'laranja', 'preto', 'branco', 'cinza'];

module.exports = [
  {
    name: 'txtsticker',
    commands: ['txtsticker', 'textsticker'],
    category: 'stickers',
    description: 'Cria um sticker de texto com cor de fundo.',
    usage: '!txtsticker <texto> [cor]',
    cooldown: 5000,
    execute: async (ctx) => {
      let args = ctx.args.slice();
      let bg = null;
      // última palavra pode ser uma cor
      const last = String(args[args.length - 1] || '').toLowerCase();
      if (COLORS.includes(last)) {
        bg = last;
        args = args.slice(0, -1);
      }
      const text = args.join(' ').slice(0, 200);
      if (!text) return ctx.reply(`⚠️ Envie o texto: !txtsticker <texto> [cor]\nCores: ${COLORS.join(', ')}`);
      await ctx.reply('⏳ Criando sticker de texto...');
      try {
        let webp = await engine.textToSticker(text, { bg });
        webp = await engine.setStickerMetadata(webp, { packname: CONFIG.bot.name, author: CONFIG.bot.author });
        await ctx.sendSticker(webp);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'txtsticker' });
      }
    },
  },
];
