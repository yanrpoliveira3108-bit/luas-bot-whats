/**
 * commands/downloads/image.js — baixa uma imagem de um link (!imagem).
 */

'use strict';

const router = require('../../downloaders/router');
const dqueue = require('../../utils/downloadQueue');
const { downloadToFile } = require('../../utils/download');
const { sendImageResult } = require('../_shared/downloads');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'imagem',
    commands: ['imagem', 'img', 'baixarimagem'],
    category: 'downloads',
    description: 'Baixa e envia uma imagem de um link.',
    usage: '!imagem <link>',
    cooldown: 10000,
    execute: async (ctx) => {
      const url = (ctx.args[0] || '').trim();
      if (!url || !/^https?:\/\//i.test(url)) return ctx.reply('🔗 Envie um link válido (http/https).');
      const platform = router.platformOf(url);

      await ctx.reply('📥 Baixando imagem...');
      try {
        if (platform) {
          const result = await dqueue.enqueue(ctx.remoteJid, platform, () => router.download(url));
          if (result.isVideo) {
            return ctx.reply('🎬 Esse link é um vídeo — use !download ou !video <link>.');
          }
          await sendImageResult(ctx, result, (result.title || '').slice(0, 200));
        } else {
          // link direto de imagem (ex.: i.redd.it, cdn de imagem)
          const file = await downloadToFile(url, { name: 'imagem', ext: 'jpg' });
          await sendImageResult(ctx, { path: file.path, mimetype: file.contentType || 'image/jpeg' });
        }
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'imagem' });
      }
    },
  },
];
