/**
 * commands/downloads/letra.js — Busca de letras de músicas por nome, artista ou link.
 *
 * Suporta:
 * !letra <nome da música>
 * !letra <artista> - <nome da música>
 * !letra <link do youtube/spotify/deezer>
 * Alias: !letras
 */

'use strict';

const lyricsEngine = require('../../utils/lyricsEngine');
const youtube = require('../../downloaders/youtube');
const { parseArtistAndTitle } = require('../../utils/mediaPresentation');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'letra',
    commands: ['letra', 'letras', 'lyric', 'lyrics'],
    category: 'downloads',
    description: 'Busca a letra de uma música por nome, artista ou link.',
    usage: '!letra <nome da música | artista - música | link>',
    cooldown: 4000,
    execute: async (ctx) => {
      const rawInput = ctx.args.join(' ').trim();
      if (!rawInput) {
        return ctx.reply(
          `📖 *Como buscar letras:*\n` +
          `▸ Por nome: \`${ctx.prefix}letra Bohemian Rhapsody\`\n` +
          `▸ Por artista e música: \`${ctx.prefix}letra Queen - Bohemian Rhapsody\`\n` +
          `▸ Por link: \`${ctx.prefix}letra https://youtu.be/...\``
        );
      }

      await ctx.reply('🔎 Buscando letra...');

      try {
        let searchTerm = rawInput;

        // Se for um link (URL)
        if (/^https?:\/\//i.test(rawInput)) {
          const resolved = lyricsEngine.resolveUrl(rawInput);
          if (!resolved || !resolved.supported) {
            return ctx.reply(
              `⚠️ Link não suportado para busca de letras.\n` +
              `▸ Plataformas aceitas: YouTube, Spotify e Deezer.\n` +
              `▸ Você também pode pesquisar digitando o nome da música: \`${ctx.prefix}letra <nome>\``
            );
          }

          if (resolved.platform === 'YouTube') {
            // Tenta obter metadados do YouTube
            try {
              if (resolved.id) {
                const searchRes = await youtube.search(resolved.id, 1);
                if (searchRes && searchRes.length > 0) {
                  const item = searchRes[0];
                  const parsed = parseArtistAndTitle(item.title, item.author);
                  searchTerm = parsed.artist ? `${parsed.artist} - ${parsed.title}` : item.title;
                }
              }
            } catch (_) {
              /* segue com o termo original */
            }
          }
        }

        // Realiza a busca no motor de letras
        const lyricResult = await lyricsEngine.searchLyrics(searchTerm);

        if (!lyricResult) {
          return ctx.reply(
            `❌ Não encontrei a letra para "*${rawInput}*".\n` +
            `▸ Dica: Tente buscar no formato \`${ctx.prefix}letra Artista - Nome da Música\`.`
          );
        }

        const formatted = lyricsEngine.formatLyricsResponse(lyricResult);
        await ctx.reply(formatted);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'letra' });
      }
    },
  },
];
