/**
 * commands/downloads/play.js — busca com opções em lista (!play / !ytsearch).
 *
 * Fluxo: busca → lista com opções [🎵 Áudio] [🎬 Vídeo] [🔗 Abrir] por resultado.
 */

'use strict';

const youtube = require('../../downloaders/youtube');
const searchResults = require('../_shared/searchResults');
const nav = require('../../utils/nav');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'play',
    commands: ['play'],
    category: 'downloads',
    description: 'Busca músicas/vídeos no YouTube e mostra opções para baixar.',
    usage: '!play <nome da música>',
    cooldown: 8000,
    execute: async (ctx) => {
      const query = ctx.args.join(' ');
      if (!query) return ctx.reply('⚠️ Envie o nome da música: !play <nome>');

      await ctx.reply('🔎 Pesquisando...');
      try {
        const results = await youtube.search(query, 3);
        if (!results.length) return ctx.reply('🔎 Nenhum resultado encontrado.');
        const built = searchResults.build(ctx, results);
        const ok = await nav.sendButtons(ctx, {
          title: '🔎 RESULTADOS',
          body: built.text + '\n\n_Toque em uma opção:_',
          footer: `${results.length} resultado(s)`,
          buttons: built.buttons,
        });
        if (!ok) {
          // fallback: texto com instrução
          await ctx.reply(built.text + `\n\nUse ${ctx.prefix}ytmp3 <url> ou ${ctx.prefix}ytmp4 <url>`);
        }
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'play' });
      }
    },
  },
];
