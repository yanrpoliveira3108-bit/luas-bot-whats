'use strict';

const youtube = require('../../downloaders/youtube');
const { sendAudioResult } = require('../_shared/downloads');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'ytmp3',
    commands: ['ytmp3', 'ytmp4audio', 'audiourl'],
    category: 'downloads',
    description: 'Baixa o áudio de um link do YouTube.',
    usage: '!ytmp3 <url>',
    cooldown: 10000,
    execute: async (ctx) => {
      const url = (ctx.args[0] || '').trim();
      if (!url) return ctx.reply('⚠️ Envie o link: !ytmp3 <url>');
      if (!youtube.validateUrl(url)) return ctx.reply('🔗 Link do YouTube inválido.');
      await ctx.reply('⏳ Baixando áudio...');
      try {
        const audio = await youtube.downloadAudio(url);
        await ctx.reply(`🎵 *${audio.title}*\n▸ Canal: ${audio.author || '-'}`);
        await sendAudioResult(ctx, audio);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'ytmp3' });
      }
    },
  },
];
