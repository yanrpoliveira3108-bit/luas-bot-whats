/**
 * commands/downloads/play.js — comando !play com reformulação visual e funcional completa.
 *
 * Suporta:
 * - {prefix}play <nome da música>
 * - {prefix}play <link da música>
 * Aliases: !play, !musica, !song, !ouvir
 */

'use strict';

const playFlow = require('../_shared/playFlow');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'play',
    commands: ['play'],
    category: 'downloads',
    description: 'Busca músicas ou processa links com opções de áudio, vídeo e letra.',
    usage: '!play <nome da música | link>',
    cooldown: 5000,
    execute: async (ctx) => {
      try {
        await playFlow.handlePlay(ctx);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'play' });
      }
    },
  },
];
