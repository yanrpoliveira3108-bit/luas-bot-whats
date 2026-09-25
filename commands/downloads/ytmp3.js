'use strict';

const youtube = require('../../downloaders/youtube');
const { sendAudioResult } = require('../_shared/downloads');
const { parseArtistAndTitle, formatMediaCard } = require('../../utils/mediaPresentation');
const htmlPlay = require('../../utils/htmlPlay');
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
      if (!url) return ctx.reply(`⚠️ Envie o link: ${ctx.prefix}ytmp3 <url>`);
      if (!youtube.validateUrl(url)) return ctx.reply('🔗 Link do YouTube inválido.');
      await ctx.reply('⏳ Preparando áudio...');
      try {
        const audio = await youtube.downloadAudio(url);
        const parsed = parseArtistAndTitle(audio.title, audio.author);

        const card = formatMediaCard({
          kind: 'audio',
          title: parsed.title || audio.title,
          artist: parsed.artist || null,
          channel: parsed.isChannel ? audio.author : null,
          duration: audio.duration ? `${Math.floor(audio.duration / 60)}:${String(audio.duration % 60).padStart(2, '0')}` : null,
          views: audio.views || null,
          description: audio.description || null,
          url: url,
          prefix: ctx.prefix,
        });

        const htmlSent = await htmlPlay.send(ctx, htmlPlay.normalizeMediaInfo(audio, { ...parsed, url, kind: 'audio', format: audio.mimetype || 'audio' }), ctx.prefix, { audio: 'ytmp3', lyrics: 'letra', search: 'play' }).catch(() => false);
        if (!htmlSent) await ctx.reply(card);
        await sendAudioResult(ctx, audio);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'ytmp3' });
      }
    },
  },
];
