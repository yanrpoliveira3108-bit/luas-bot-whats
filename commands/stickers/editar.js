'use strict';

const CONFIG = require('../../config');
const engine = require('../../utils/stickerEngine');
const errorHandler = require('../../handlers/errorHandler');

/** Pega um sticker da mensagem/citada. */
async function getSticker(ctx) {
  const media = await ctx.downloadMedia();
  if (!media || media.type !== 'sticker') {
    await ctx.reply('🎨 Marque um sticker para editar.');
    return null;
  }
  return media.buffer;
}

module.exports = [
  {
    name: 'take',
    commands: ['take', 'roubar'],
    category: 'stickers',
    description: 'Reenvia um sticker com novo pacote/autor.',
    usage: '!take <pack>|<autor>',
    cooldown: 5000,
    execute: async (ctx) => {
      const buffer = await getSticker(ctx);
      if (!buffer) return;
      const [pack, author] = ctx.args.join(' ').split('|').map((s) => s.trim());
      try {
        const webp = await engine.setStickerMetadata(buffer, {
          packname: pack || CONFIG.bot.name,
          author: author || CONFIG.bot.author,
        });
        await ctx.sendSticker(webp);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'take' });
      }
    },
  },
  {
    name: 'pack',
    commands: ['pack', 'rename', 'renomear'],
    category: 'stickers',
    description: 'Altera o pacote/autor de um sticker.',
    usage: '!pack <pack>|<autor>',
    cooldown: 5000,
    execute: async (ctx) => {
      const buffer = await getSticker(ctx);
      if (!buffer) return;
      const [pack, author] = ctx.args.join(' ').split('|').map((s) => s.trim());
      if (!pack && !author) return ctx.reply('⚠️ Uso: !pack <nome-do-pacote>|<autor>');
      try {
        const webp = await engine.setStickerMetadata(buffer, { packname: pack, author: author });
        await ctx.sendSticker(webp);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'pack' });
      }
    },
  },
  {
    name: 'emoji',
    commands: ['emoji'],
    category: 'stickers',
    description: 'Define o emoji associado a um sticker.',
    usage: '!emoji <emoji> (respondendo a um sticker)',
    cooldown: 5000,
    execute: async (ctx) => {
      const buffer = await getSticker(ctx);
      if (!buffer) return;
      const emoji = (ctx.args[0] || '').slice(0, 8);
      if (!emoji) return ctx.reply('⚠️ Envie o emoji: !emoji 😂');
      try {
        const webp = await engine.setStickerMetadata(buffer, { emoji });
        await ctx.sendSticker(webp);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'emoji' });
      }
    },
  },
];
