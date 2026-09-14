/**
 * commands/downloads/viewonce.js — revela mídia de visualização única.
 *
 * !revelar — responde revelando a mídia de "ver uma vez".
 *
 * Ordem de busca:
 *   1. a própria mensagem (caso o comando venha junto da mídia);
 *   2. a mensagem citada (respondendo a ela);
 *   3. a ÚLTIMA view-once recebida no chat (capturada por utils/viewonce)
 *      — cobre o caso em que o WhatsApp não inclui a mídia na citação.
 *
 * A mídia é baixada e reenviada como mídia NORMAL (deixa de sumir).
 * Nunca derruba o bot em caso de falha.
 */

'use strict';

const mediaUtil = require('../../utils/media');
const viewonce = require('../../utils/viewonce');
const { detectMediaType, isViewOnce, unwrapViewOnce } = require('../../utils/messages');
const errorHandler = require('../../handlers/errorHandler');

/** Conteúdo interno (unwrap) de uma mensagem de visualização única, ou null. */
function innerOf(full) {
  const msg = full && full.message;
  if (!msg || typeof msg !== 'object') return null;
  if (!isViewOnce(full)) return null;
  return unwrapViewOnce(msg);
}

/** Baixa e reenvia a mídia interna como mídia normal. */
async function sendReveal(ctx, inner, type, label) {
  try {
    if (type === 'image') {
      const buf = await mediaUtil.downloadMediaBuffer(ctx.socket, { message: inner }, 'image');
      if (!buf) return ctx.reply('❌ Não consegui baixar a imagem (pode já ter expirado).');
      await ctx.sendImage(buf, label || '👁️ Imagem revelada.');
    } else if (type === 'video') {
      const buf = await mediaUtil.downloadMediaBuffer(ctx.socket, { message: inner }, 'video');
      if (!buf) return ctx.reply('❌ Não consegui baixar o vídeo (pode já ter expirado).');
      await ctx.sendVideo(buf, label || '👁️ Vídeo revelado.', { mimetype: 'video/mp4' });
    } else if (type === 'audio') {
      const buf = await mediaUtil.downloadMediaBuffer(ctx.socket, { message: inner }, 'audio');
      if (!buf) return ctx.reply('❌ Não consegui baixar o áudio (pode já ter expirado).');
      await ctx.sendAudio(buf, { mimetype: 'audio/ogg; codecs=opus', ptt: true });
    } else {
      await ctx.reply('❌ Esse tipo de visualização única ainda não é suportado.');
    }
  } catch (err) {
    await errorHandler.handle(ctx, err, { name: 'revelar' });
  }
}

module.exports = [
  {
    name: 'revelar',
    commands: ['revelar', 'viewonce', 'vv', 'revelarvu'],
    category: 'downloads',
    description: 'Revela a mídia de visualização única do chat.',
    usage: '!revelar (responda à mídia, ou use logo após recebê-la)',
    cooldown: 5000,
    execute: async (ctx) => {
      // 1) a própria mensagem é uma view-once (ex.: comando junto da mídia)
      let inner = innerOf(ctx.message);
      let label = null;

      // 2) mensagem citada
      if (!inner && ctx.quoted) {
        inner = innerOf({ message: ctx.quoted });
        if (inner) label = '👁️ Mídia citada revelada.';
      }

      // 3) última view-once recebida no chat (capturada automaticamente)
      if (!inner) {
        const last = viewonce.last(ctx.remoteJid);
        if (last) {
          inner = innerOf(last);
          if (inner) label = '👁️ Última mídia de visualização única revelada.';
        }
      }

      if (!inner) {
        return ctx.reply(
          '👁️ Não achei mídia de visualização única por aqui.\n' +
            '▸ Envie a foto/vídeo de "ver uma vez" e depois use *!revelar* — não precisa nem responder a ela.'
        );
      }

      const type = detectMediaType({ message: inner });
      await ctx.reply('👁️ Revelando...');
      await sendReveal(ctx, inner, type, label);
    },
  },
];
