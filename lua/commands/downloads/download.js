/**
 * commands/downloads/download.js — !download <link> (roteador genérico).
 *
 * Detecta a plataforma, enfileira o download e envia a mídia (vídeo/imagem).
 */

'use strict';

const router = require('../../downloaders/router');
const dqueue = require('../../utils/downloadQueue');
const { sendVideoResult, sendImageResult } = require('../_shared/downloads');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'download',
    commands: ['download', 'baixar'],
    category: 'downloads',
    description: 'Baixa mídia de um link (YouTube, TikTok, Instagram, Facebook, Pinterest, X/Twitter, Reddit).',
    usage: '!download <link>',
    cooldown: 10000,
    execute: async (ctx) => {
      const url = (ctx.args[0] || '').trim();
      if (!url || !/^https?:\/\//i.test(url)) return ctx.reply('🔗 Envie um link válido (http/https).');
      const platform = router.platformOf(url);
      if (!platform) {
        return ctx.reply('❌ Plataforma não suportada.\n▸ Suportadas: YouTube, TikTok, Instagram, Facebook, Pinterest, X/Twitter, Reddit.');
      }
      await ctx.reply(`📥 Enfilei o download (${platform})...`);
      try {
        const result = await dqueue.enqueue(ctx.remoteJid, platform, () => router.download(url));
        if (result.isVideo) await sendVideoResult(ctx, result, (result.title || '').slice(0, 100));
        else await sendImageResult(ctx, result, (result.title || '').slice(0, 200));
      } catch (err) {
        await errorHandler.handle(ctx, { code: err && err.code || 'DOWNLOAD_FAILED', message: err && err.message }, { name: 'download' });
      }
    },
  },
];
