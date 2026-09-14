/**
 * commands/downloads/youtube.js — busca no YouTube com opções em lista (!youtube / !ytsearch).
 */

'use strict';

const youtube = require('../../downloaders/youtube');
const searchResults = require('../_shared/searchResults');
const nav = require('../../utils/nav');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'youtube',
    commands: ['youtube', 'ytbusca', 'ytsearch'],
    category: 'downloads',
    description: 'Busca vídeos no YouTube (com opções de download).',
    usage: '!youtube <busca>',
    cooldown: 8000,
    execute: async (ctx) => {
      const query = ctx.args.join(' ');
      if (!query) return ctx.reply('⚠️ Envie o que deseja buscar: !youtube <busca>');
      await ctx.reply('🔎 Pesquisando no YouTube...');
      try {
        const results = await youtube.search(query, 3);
        if (!results.length) return ctx.reply('🔎 Nenhum resultado encontrado.');
        const built = searchResults.build(ctx, results);
        const ok = await nav.sendButtons(ctx, {
          title: '🎬 YOUTUBE',
          body: built.text + '\n\n_Toque em uma opção:_',
          footer: `${results.length} resultado(s)`,
          buttons: built.buttons,
        });
        if (!ok) {
          await ctx.reply(built.text + `\n\nUse ${ctx.prefix}ytmp3 <url> ou ${ctx.prefix}ytmp4 <url>`);
        }
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'youtube' });
      }
    },
  },
];
