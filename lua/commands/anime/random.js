'use strict';

const jikan = require('../../anime/providers/jikan');
const { downloadToBuffer } = require('../../utils/download');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'waifu',
    commands: ['waifu'],
    category: 'anime',
    description: 'Personagem aleatório (o provedor não informa gênero).',
    usage: '!waifu',
    cooldown: 5000,
    execute: async (ctx) => {
      try {
        const c = await jikan.randomCharacter();
        const text = `💖 *Sua waifu do dia:* ${c.name}`;
        if (c.image) {
          try {
            const buf = await downloadToBuffer(c.image, { maxBytes: 3 * 1024 * 1024 });
            await ctx.sendImage(buf, text);
            return;
          } catch (_) {}
        }
        await ctx.reply(text);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'waifu' });
      }
    },
  },
  {
    name: 'husbando',
    commands: ['husbando'],
    category: 'anime',
    description: 'Personagem aleatório (o provedor não informa gênero).',
    usage: '!husbando',
    cooldown: 5000,
    execute: async (ctx) => {
      try {
        const c = await jikan.randomCharacter();
        const text = `💘 *Seu husbando do dia:* ${c.name}`;
        if (c.image) {
          try {
            const buf = await downloadToBuffer(c.image, { maxBytes: 3 * 1024 * 1024 });
            await ctx.sendImage(buf, text);
            return;
          } catch (_) {}
        }
        await ctx.reply(text);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'husbando' });
      }
    },
  },
  {
    name: 'animerandom',
    commands: ['animerandom', 'randomanime'],
    category: 'anime',
    description: 'Sugere um anime aleatório.',
    usage: '!animerandom',
    cooldown: 5000,
    execute: async (ctx) => {
      try {
        const a = await jikan.randomAnime();
        const text = [
          `🎲 *Anime aleatório:* ${a.title}`,
          a.score ? `▸ Nota: ⭐ ${a.score}` : '',
          a.year ? `▸ Ano: ${a.year}` : '',
          a.url ? `🔗 ${a.url}` : '',
        ].filter(Boolean).join('\n');
        await ctx.reply(text);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'animerandom' });
      }
    },
  },
  {
    name: 'animequiz',
    commands: ['animequiz', 'quizanime'],
    category: 'anime',
    description: 'Quiz com perguntas de anime.',
    usage: '!animequiz',
    cooldown: 3000,
    execute: async (ctx) => {
      const commandHandler = require('../../handlers/commandHandler');
      await commandHandler.runByName(ctx, 'quiz', ['anime']);
    },
  },
];
