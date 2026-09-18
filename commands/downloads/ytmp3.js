/**
 * commands/downloads/ytmp3.js — áudio do YouTube com fluxo em etapas (Lua 2.0).
 *
 * BUSCANDO/ANALISANDO → BAIXANDO → ENVIANDO → CONCLUÍDO, com card de resultado
 * real (título, canal, duração, formato, tamanho) e sem porcentagem inventada.
 */

'use strict';

const youtube = require('../../downloaders/youtube');
const { sendAudioResult } = require('../_shared/downloads');
const { runStaged, resultCard, completeCard } = require('../_shared/downloadFlow');
const ui = require('../../utils/uiKit');
const icons = require('../../utils/icons');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'ytmp3',
    commands: ['ytmp3', 'ytmp4audio', 'audiourl'],
    category: 'downloads',
    description: 'Baixa o áudio de um link do YouTube.',
    usage: '!ytmp3 <url>',
    examples: ['!ytmp3 https://youtu.be/xxxx'],
    cooldown: 10000,
    tags: ['música', 'audio', 'youtube'],
    execute: async (ctx) => {
      const url = (ctx.args[0] || '').trim();
      if (!url) {
        return ctx.reply(`${icons.warning} Envie o link.\n▸ Uso: ${ctx.prefix}ytmp3 <url>`);
      }
      if (!youtube.validateUrl(url)) {
        return ctx.reply(ui.error('Link do YouTube inválido.', { reason: 'URL não reconhecida', hint: `Use ${ctx.prefix}play <nome> para buscar` }));
      }

      try {
        const audio = await runStaged(ctx, {
          title: 'PLAY',
          category: 'music',
          key: `ytmp3:${url}`,
          run: async ({ stage }) => {
            await stage('SEARCHING');
            await stage('FOUND');
            await stage('DOWNLOADING');
            const result = await youtube.downloadAudio(url);
            await stage('UPLOADING');
            await ctx.reply(resultCard(result, { kind: 'audio', quality: 'áudio' }));
            await sendAudioResult(ctx, result);
            return result;
          },
        });
        await ctx.reply(completeCard(audio, { kind: 'audio' }));
      } catch (err) {
        // o fluxo já respondeu com o card de erro; só registra
        if (!err || err.code !== 'TIMEOUT') await errorHandler.handle(ctx, err, { name: 'ytmp3', silent: true });
      }
    },
  },
];
