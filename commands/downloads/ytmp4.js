/**
 * commands/downloads/ytmp4.js — vídeo do YouTube com fluxo em etapas (Lua 2.0).
 */

'use strict';

const youtube = require('../../downloaders/youtube');
const { sendVideoResult } = require('../_shared/downloads');
const { runStaged, resultCard, completeCard } = require('../_shared/downloadFlow');
const ui = require('../../utils/uiKit');
const icons = require('../../utils/icons');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'ytmp4',
    commands: ['ytmp4', 'videourl'],
    category: 'downloads',
    description: 'Baixa o vídeo de um link do YouTube.',
    usage: '!ytmp4 <url>',
    examples: ['!ytmp4 https://youtu.be/xxxx'],
    cooldown: 12000,
    tags: ['vídeo', 'youtube', 'download'],
    execute: async (ctx) => {
      const url = (ctx.args[0] || '').trim();
      if (!url) {
        return ctx.reply(`${icons.warning} Envie o link.\n▸ Uso: ${ctx.prefix}ytmp4 <url>`);
      }
      if (!youtube.validateUrl(url)) {
        return ctx.reply(ui.error('Link do YouTube inválido.', { reason: 'URL não reconhecida', hint: `Use ${ctx.prefix}play <nome> para buscar` }));
      }

      try {
        const video = await runStaged(ctx, {
          title: 'VIDEO',
          category: 'download',
          key: `ytmp4:${url}`,
          run: async ({ stage }) => {
            await stage('SEARCHING');
            await stage('FOUND');
            await stage('DOWNLOADING');
            const result = await youtube.downloadVideo(url);
            await stage('UPLOADING');
            await ctx.reply(resultCard(result, { kind: 'video', quality: 'vídeo' }));
            await sendVideoResult(ctx, result);
            return result;
          },
        });
        await ctx.reply(completeCard(video, { kind: 'video' }));
      } catch (err) {
        if (!err || err.code !== 'TIMEOUT') await errorHandler.handle(ctx, err, { name: 'ytmp4', silent: true });
      }
    },
  },
];
