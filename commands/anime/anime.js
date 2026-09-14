'use strict';

const jikan = require('../../anime/providers/jikan');
const { downloadToBuffer } = require('../../utils/download');
const errorHandler = require('../../handlers/errorHandler');
const { truncate } = require('../../utils/formatter');

module.exports = [
  {
    name: 'anime',
    commands: ['anime'],
    category: 'anime',
    description: 'Busca informações de um anime.',
    usage: '!anime <nome>',
    cooldown: 5000,
    execute: async (ctx) => {
      const query = ctx.args.join(' ');
      if (!query) return ctx.reply('⚠️ Envie o nome: !anime <nome>');
      try {
        const results = await jikan.searchAnime(query, 3);
        if (!results.length) return ctx.reply('🔎 Nenhum anime encontrado.');
        const lines = results.map((a, i) => `${i + 1}. *${a.title}*${a.year ? ` (${a.year})` : ''}${a.score ? ` — ⭐ ${a.score}` : ''}\n▸ ${a.url}`);
        await ctx.reply(`🍥 *Resultados*\n${lines.join('\n')}\n\nUse !animeinfo <nome> para detalhes.`);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'anime' });
      }
    },
  },
  {
    name: 'animeinfo',
    commands: ['animeinfo', 'animeinfo2'],
    category: 'anime',
    description: 'Detalhes completos de um anime (com imagem).',
    usage: '!animeinfo <nome>',
    cooldown: 5000,
    execute: async (ctx) => {
      const query = ctx.args.join(' ');
      if (!query) return ctx.reply('⚠️ Envie o nome: !animeinfo <nome>');
      try {
        const results = await jikan.searchAnime(query, 1);
        if (!results.length) return ctx.reply('🔎 Nenhum anime encontrado.');
        const a = results[0];
        const text = [
          `🍥 *${a.title}*`,
          a.titleEn ? `▸ EN: ${a.titleEn}` : '',
          a.score ? `▸ Nota: ⭐ ${a.score}` : '',
          a.year ? `▸ Ano: ${a.year}` : '',
          a.episodes ? `▸ Episódios: ${a.episodes}` : '',
          a.status ? `▸ Status: ${a.status}` : '',
          a.synopsis ? `\n${truncate(a.synopsis, 300)}` : '',
          `\n🔗 ${a.url}`,
        ].filter(Boolean).join('\n');
        if (a.image) {
          try {
            const buf = await downloadToBuffer(a.image, { maxBytes: 3 * 1024 * 1024 });
            await ctx.sendImage(buf, text.slice(0, 1000));
            return;
          } catch (_) {
            /* sem imagem */
          }
        }
        await ctx.reply(text);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'animeinfo' });
      }
    },
  },
];
