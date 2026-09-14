'use strict';

const engine = require('../../utils/stickerEngine');
const errorHandler = require('../../handlers/errorHandler');

/** Obtém uma imagem (da mensagem ou citada). */
async function getImage(ctx) {
  const media = await ctx.downloadMedia();
  if (!media || media.type !== 'image') {
    await ctx.reply('🖼️ Marque uma imagem para transformar.');
    return null;
  }
  return media.buffer;
}

module.exports = [
  {
    name: 'circle',
    commands: ['circle', 'circular'],
    category: 'stickers',
    description: 'Deixa uma imagem circular.',
    usage: '!circle (respondendo a uma imagem)',
    cooldown: 5000,
    execute: async (ctx) => {
      const buffer = await getImage(ctx);
      if (!buffer) return;
      await ctx.reply('⏳ Aplicando círculo...');
      try {
        const out = await engine.processImage(buffer, 'circle');
        await ctx.sendImage(out, '✅ Imagem circular.');
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'circle' });
      }
    },
  },
  {
    name: 'crop',
    commands: ['crop', 'cortar'],
    category: 'stickers',
    description: 'Recorta a imagem em quadrado (cover).',
    usage: '!crop (respondendo a uma imagem)',
    cooldown: 5000,
    execute: async (ctx) => {
      const buffer = await getImage(ctx);
      if (!buffer) return;
      await ctx.reply('⏳ Recortando...');
      try {
        const out = await engine.processImage(buffer, 'crop', { width: 512, height: 512 });
        await ctx.sendImage(out, '✅ Imagem recortada.');
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'crop' });
      }
    },
  },
  {
    name: 'resize',
    commands: ['resize', 'redimensionar'],
    category: 'stickers',
    description: 'Redimensiona uma imagem.',
    usage: '!resize [largura] [altura] (respondendo a uma imagem)',
    cooldown: 5000,
    execute: async (ctx) => {
      const buffer = await getImage(ctx);
      if (!buffer) return;
      const w = Math.min(1024, parseInt(ctx.args[0], 10) || 512);
      const h = Math.min(1024, parseInt(ctx.args[1], 10) || w);
      await ctx.reply('⏳ Redimensionando...');
      try {
        const out = await engine.processImage(buffer, 'resize', { width: w, height: h });
        await ctx.sendImage(out, `✅ Imagem ${w}x${h}.`);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'resize' });
      }
    },
  },
];
