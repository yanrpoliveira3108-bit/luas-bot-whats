'use strict';

const youtube = require('../../downloaders/youtube');
const { sendAudioResult } = require('../_shared/downloads');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'audio',
    commands: ['audio', 'musica', 'song'],
    category: 'downloads',
    description: 'Baixa o áudio de uma música (busca no YouTube).',
    usage: '!audio <nome>',
    cooldown: 10000,
    execute: async (ctx) => {
      const query = ctx.args.join(' ');
      if (!query) return ctx.reply('⚠️ Envie o nome da música: !audio <nome>');
      const results = await youtube.search(query, 1);
      if (!results.length) return ctx.reply('🔎 Nenhum resultado encontrado.');
      await ctx.reply('⏳ Baixando áudio...');
      try {
        const audio = await youtube.downloadAudio(results[0].url, results[0].title);
        await ctx.reply(`🎵 *${audio.title}*\n▸ Canal: ${audio.author || '-'}`);
        await sendAudioResult(ctx, audio);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'audio' });
      }
    },
  },
];
