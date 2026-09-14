'use strict';

const CONFIG = require('../../config');
const engine = require('../../utils/stickerEngine');
const errorHandler = require('../../handlers/errorHandler');

function parsePackAuthor(args) {
  const joined = args.join(' ');
  if (!joined) return null;
  const [pack, author] = joined.split('|').map((s) => s.trim());
  return { packname: pack || undefined, author: author || undefined };
}

module.exports = [
  {
    name: 'sticker',
    commands: ['sticker', 's', 'fig', 'figurinha'],
    category: 'stickers',
    description: 'Transforma imagem/vídeo/GIF em sticker.',
    usage: '!sticker (respondendo a uma mídia)',
    cooldown: 5000,
    execute: async (ctx) => {
      const media = await ctx.downloadMedia();
      if (!media) return ctx.reply('🖼️ Envie ou marque uma imagem/vídeo/GIF com o comando !sticker.');

      if (media.type === 'audio' || media.type === 'document') {
        return ctx.reply('❌ Não consigo transformar áudio/documento em sticker.');
      }

      const maxBytes = CONFIG.limits.stickerMaxMB * 1024 * 1024;
      if (media.buffer.length > maxBytes) {
        return ctx.reply(`📦 Mídia muito grande para sticker (limite ${CONFIG.limits.stickerMaxMB} MB).`);
      }

      const meta = parsePackAuthor(ctx.args);
      await ctx.reply('⏳ Criando sticker...');
      try {
        let webp;
        if (media.type === 'video') {
          webp = await engine.videoToWebp(media.buffer, CONFIG.limits.stickerMaxSeconds);
        } else if (media.type === 'sticker') {
          webp = media.buffer; // já é sticker
        } else {
          webp = await engine.imageToWebp(media.buffer);
        }
        webp = await engine.setStickerMetadata(webp, {
          packname: (meta && meta.packname) || CONFIG.bot.name,
          author: (meta && meta.author) || CONFIG.bot.author,
        });
        await ctx.sendSticker(webp);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'sticker' });
      }
    },
  },
  {
    name: 'stickerimg',
    commands: ['stickerimg', 'stickerimagem'],
    category: 'stickers',
    description: 'Transforma uma imagem em sticker.',
    usage: '!stickerimg (respondendo a uma imagem)',
    cooldown: 5000,
    execute: async (ctx) => {
      const media = await ctx.downloadMedia();
      if (!media || media.type !== 'image') return ctx.reply('🖼️ Marque uma imagem para virar sticker.');
      await ctx.reply('⏳ Criando sticker...');
      try {
        let webp = await engine.imageToWebp(media.buffer);
        webp = await engine.setStickerMetadata(webp, { packname: CONFIG.bot.name, author: CONFIG.bot.author });
        await ctx.sendSticker(webp);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'stickerimg' });
      }
    },
  },
  {
    name: 'stickertext',
    commands: ['stickertext', 'textosticker', 'stext'],
    category: 'stickers',
    description: 'Cria um sticker de texto.',
    usage: '!stickertext <texto>',
    cooldown: 5000,
    execute: async (ctx) => {
      const text = ctx.args.join(' ').slice(0, 200);
      if (!text) return ctx.reply('⚠️ Envie o texto: !stickertext <texto>');
      await ctx.reply('⏳ Criando sticker de texto...');
      try {
        let webp = await engine.textToSticker(text);
        webp = await engine.setStickerMetadata(webp, { packname: CONFIG.bot.name, author: CONFIG.bot.author });
        await ctx.sendSticker(webp);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'stickertext' });
      }
    },
  },
  {
    name: 'toimg',
    commands: ['toimg', 'stickerimg2', 'figparaimg'],
    category: 'stickers',
    description: 'Converte um sticker em imagem.',
    usage: '!toimg (respondendo a um sticker)',
    cooldown: 5000,
    execute: async (ctx) => {
      const media = await ctx.downloadMedia();
      if (!media || media.type !== 'sticker') return ctx.reply('🎨 Marque um sticker para converter em imagem.');
      await ctx.reply('⏳ Convertendo...');
      try {
        const png = await engine.webpToPng(media.buffer);
        await ctx.sendImage(png, '✅ Sticker convertido em imagem.');
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'toimg' });
      }
    },
  },
];
