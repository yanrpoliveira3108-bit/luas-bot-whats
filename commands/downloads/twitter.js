/**
 * commands/downloads/twitter.js — baixa mídia de um tweet (X/Twitter).
 *
 * Backend real: downloaders/twitter.js (já existia no repositório). Usa o mesmo
 * fluxo em etapas dos outros downloads (BUSCANDO → BAIXANDO → ENVIANDO →
 * CONCLUÍDO) com card de resultado, sem porcentagem inventada e sem expor
 * token/caminho.
 */

'use strict';

const twitter = require('../../downloaders/twitter');
const { sendVideoResult, sendImageResult } = require('../_shared/downloads');
const { runStaged, resultCard, completeCard } = require('../_shared/downloadFlow');
const ui = require('../../utils/uiKit');
const icons = require('../../utils/icons');
const errorHandler = require('../../handlers/errorHandler');

module.exports = [
  {
    name: 'twitter',
    commands: ['twitter', 'tw', 'x', 'twitterdl', 'baixartwitter'],
    category: 'downloads',
    description: 'Baixa o vídeo ou a foto de um tweet (X/Twitter).',
    usage: '!twitter <url do tweet>',
    examples: ['!twitter https://x.com/usuario/status/1234567890'],
    cooldown: 10000,
    tags: ['twitter', 'x', 'vídeo', 'download', 'social'],
    execute: async (ctx) => {
      const url = (ctx.args[0] || '').trim();
      if (!url) {
        return ctx.reply(
          `${icons.warning || '⚠️'} Envie o link do tweet.\n▸ Uso: ${ctx.prefix}twitter <url>\n▸ Ex.: ${ctx.prefix}twitter https://x.com/user/status/123`
        );
      }
      let valid = false;
      try {
        valid = twitter.canHandle(url);
      } catch (_) {
        valid = false;
      }
      if (!valid) {
        return ctx.reply(
          ui.error('Link do Twitter/X inválido.', {
            reason: 'URL não reconhecida',
            hint: `Use ${ctx.prefix}twitter https://x.com/user/status/123`,
          })
        );
      }

      try {
        const media = await runStaged(ctx, {
          title: 'TWITTER',
          category: 'download',
          key: `twitter:${url}`,
          run: async ({ stage }) => {
            await stage('SEARCHING');
            let info = null;
            try {
              info = await twitter.fetchData(url);
            } catch (_) {
              info = null; // o download abaixo tenta de novo e reporta o erro real
            }
            if (info && Array.isArray(info.media) && info.media.length === 0) {
              throw Object.assign(new Error('Esse tweet não tem mídia anexada.'), { code: 'NO_MEDIA' });
            }
            await stage('FOUND');
            await stage('DOWNLOADING');
            const result = await twitter.download(url);
            await stage('UPLOADING');
            const caption = `${result.title ? ui.truncate(String(result.title), 80) : 'Twitter/X'}\n▸ ${result.author || '-'}`;
            await ctx.reply(resultCard(result, { kind: result.isVideo ? 'video' : 'image' }));
            if (result.isVideo) await sendVideoResult(ctx, result, caption);
            else await sendImageResult(ctx, result, caption);
            return result;
          },
        });
        await ctx.reply(completeCard(media, { kind: media && media.isVideo ? 'video' : 'image' }));
      } catch (err) {
        if (!err || err.code !== 'TIMEOUT') {
          await errorHandler.handle(ctx, err, { name: 'twitter', silent: true });
        }
      }
    },
  },
];
