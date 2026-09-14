'use strict';

const jikan = require('../../anime/providers/jikan');
const errorHandler = require('../../handlers/errorHandler');
const { truncate } = require('../../utils/formatter');

module.exports = [
  {
    name: 'manga',
    commands: ['manga'],
    category: 'anime',
    description: 'Busca informações de um mangá.',
    usage: '!manga <nome>',
    cooldown: 5000,
    execute: async (ctx) => {
      const query = ctx.args.join(' ');
      if (!query) return ctx.reply('⚠️ Envie o nome: !manga <nome>');
      try {
        const results = await jikan.searchManga(query, 3);
        if (!results.length) return ctx.reply('🔎 Nenhum mangá encontrado.');
        const lines = results.map((m, i) => `${i + 1}. *${m.title}*${m.year ? ` (${m.year})` : ''}${m.score ? ` — ⭐ ${m.score}` : ''}\n▸ ${truncate(m.synopsis, 60)}\n▸ ${m.url}`);
        await ctx.reply(`📚 *Mangás*\n${lines.join('\n')}`);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'manga' });
      }
    },
  },
];
