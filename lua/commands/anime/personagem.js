'use strict';

const jikan = require('../../anime/providers/jikan');
const { downloadToBuffer } = require('../../utils/download');
const errorHandler = require('../../handlers/errorHandler');
const { truncate } = require('../../utils/formatter');

module.exports = [
  {
    name: 'personagem',
    commands: ['personagem', 'char', 'character'],
    category: 'anime',
    description: 'Busca um personagem de anime.',
    usage: '!personagem <nome>',
    cooldown: 5000,
    execute: async (ctx) => {
      const query = ctx.args.join(' ');
      if (!query) return ctx.reply('⚠️ Envie o nome: !personagem <nome>');
      try {
        const results = await jikan.searchCharacter(query, 1);
        if (!results.length) return ctx.reply('🔎 Personagem não encontrado.');
        const c = results[0];
        const text = `🎭 *${c.name}*\n${c.about ? truncate(c.about, 300) : ''}\n🔗 ${c.url}`;
        if (c.image) {
          try {
            const buf = await downloadToBuffer(c.image, { maxBytes: 3 * 1024 * 1024 });
            await ctx.sendImage(buf, text.slice(0, 900));
            return;
          } catch (_) {
            /* sem imagem */
          }
        }
        await ctx.reply(text);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'personagem' });
      }
    },
  },
];
