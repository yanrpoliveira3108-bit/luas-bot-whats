/**
 * commands/downloads/play.js — !play com experiência em etapas (Lua 2.0).
 *
 * Fluxo real (sem porcentagem inventada):
 *   BUSCANDO → ENCONTRADO → (usuário escolhe) → BAIXANDO → CONVERTENDO →
 *   ENVIANDO → CONCLUÍDO
 *
 * A busca mostra cabeçalho temático + card do primeiro resultado + lista com
 * botões funcionais (áudio/vídeo/abrir). O download em si segue pelo mesmo
 * fluxo em etapas via commands/_shared/downloadFlow.
 */

'use strict';

const youtube = require('../../downloaders/youtube');
const searchResults = require('../_shared/searchResults');
const { runStaged, resultCard } = require('../_shared/downloadFlow');
const nav = require('../../utils/nav');
const ui = require('../../utils/uiKit');
const icons = require('../../utils/icons');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'play',
    commands: ['play'],
    category: 'downloads',
    description: 'Busca músicas/vídeos no YouTube e mostra opções para baixar.',
    usage: '!play <nome da música>',
    examples: ['!play imagine dragons - believer', '!song legiao urbana - tempo perdido'],
    cooldown: 8000,
    tags: ['música', 'audio', 'youtube', 'download'],
    execute: async (ctx) => {
      const query = ctx.args.join(' ').trim();
      if (!query) {
        return ctx.reply(
          `${icons.warning} Envie o nome da música.\n▸ Uso: ${ctx.prefix}play <nome>\n▸ Ex: ${ctx.prefix}play imagine dragons - believer`
        );
      }

      let results = [];
      try {
        results = await runStaged(ctx, {
          title: 'PLAY',
          category: 'music',
          key: `play:search:${ctx.remoteJid}`,
          run: async ({ stage }) => {
            await stage('SEARCHING');
            const found = await youtube.search(query, 3);
            if (!found.length) {
              await stage('ERROR');
              return [];
            }
            await stage('FOUND', { query, count: found.length });
            return found;
          },
        });
      } catch (err) {
        // runStaged já respondeu com o card de erro
        if (!err || err.code !== 'TIMEOUT') logger_noop(err);
        return;
      }

      if (!results.length) {
        return ctx.reply(ui.notFound(query, ['outro termo', `${ctx.prefix}ytmp3 <url>`], { prefix: '' }));
      }

      const built = searchResults.build(ctx, results);
      const first = results[0];
      // a busca devolve duração como timestamp ("3:45"), não segundos
      const card = resultCard(
        { title: first.title, author: first.author || first.channel, durationText: first.duration, views: first.views },
        { kind: 'audio', format: 'MP3 / MP4' }
      );
      const body = `${built.text}\n\n${card}\n\n_Toque em uma opção:_`;

      const ok = await nav.sendButtons(ctx, {
        title: `${icons.music} RESULTADOS`,
        body,
        footer: `${results.length} resultado(s) • ${ctx.prefix}ytmp3 <url> para link direto`,
        buttons: built.buttons,
      });

      if (!ok) {
        await ctx.reply(body + `\n\nUse ${ctx.prefix}ytmp3 <url> ou ${ctx.prefix}ytmp4 <url>`);
      }
    },
  },
];

/** Erros já tratados pelo fluxo em etapas não precisam de tratamento extra. */
function logger_noop() {}
