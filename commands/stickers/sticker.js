'use strict';

const CONFIG = require('../../config');
const engine = require('../../utils/stickerEngine');
const stickerMeta = require('../../utils/stickerMeta');
const errorHandler = require('../../handlers/errorHandler');
const logger = require('../../utils/logger').child('sticker');

function parsePackAuthor(args) {
  const joined = args.join(' ');
  if (!joined) return null;
  const [pack, author] = joined.split('|').map((s) => s.trim());
  return { packname: pack || undefined, author: author || undefined };
}

/**
 * Etapa final única de TODO sticker: metadados → tamanho → VALIDAÇÃO → envio.
 * Nunca envia um WebP inválido ("figurinha fantasma").
 * @returns {Promise<boolean>} true se enviou
 */
async function finalizeAndSend(ctx, webp, opts = {}) {
  const animated = !!opts.animated;
  try {
    let meta;
    if (opts.packname || opts.author) {
      meta = stickerMeta.buildStickerMeta(ctx, {
        customPack: opts.packname,
        customAuthor: opts.author,
        emoji: opts.emoji,
      });
    } else {
      meta = stickerMeta.buildStickerMeta(ctx, {
        emoji: opts.emoji,
      });
    }

    webp = await engine.setStickerMetadata(webp, {
      packname: meta.packname,
      author: meta.author,
      emoji: meta.emoji,
    });
    webp = await engine.ensureStickerSize(webp, { animated });
  } catch (err) {
    errorHandler.handle(ctx, err, { name: 'sticker' });
    const reason = ((err && err.message) || 'erro desconhecido').split('\n')[0];
    await ctx.reply('❌ Não consegui gerar uma figurinha válida.\n▸ Motivo: ' + reason);
    return false;
  }

  const check = await engine.validateSticker(webp);
  logger.info(
    {
      output: 'image/webp',
      outputSize: check.bytes,
      width: check.width,
      height: check.height,
      valid: check.ok,
    },
    '[STICKER] ' + (check.ok ? 'Valid: YES' : 'Valid: NO reason=' + check.reason)
  );

  if (!check.ok) {
    logger.error({ stage: 'validation', reason: check.reason }, '[STICKER ERROR] stage=validation');
    await ctx.reply('❌ Não consegui gerar uma figurinha válida.\n▸ Tente enviar outra imagem ou vídeo.');
    return false;
  }

  logger.info({ stickerBytes: check.bytes, mime: 'image/webp' }, '[STICKER] Send');
  try {
    await ctx.sendSticker(webp);
    logger.info({ stickerBytes: check.bytes }, '[STICKER] Sent OK');
    try {
      const profileStats = require('../../database/profileStats');
      const op = opts.opType || (animated ? 'from_video_gif' : 'from_image');
      profileStats.recordStickerOperation(ctx.sender, op, { animated });
    } catch (_) {}
    return true;
  } catch (err) {
    logger.error({ stage: 'send', err: (err && err.message) || String(err) }, '[STICKER ERROR] stage=send');
    throw err;
  }
}

module.exports = [
  {
    name: 'sticker',
    commands: ['sticker', 's', 'fig', 'figurinha'],
    category: 'stickers',
    description: 'Transforma imagem/vídeo/GIF em sticker com bio rica (criador, origem, bot, dono).',
    usage: '!sticker [pack|autor] (respondendo a uma mídia) ou !sticker <link>',
    cooldown: 5000,
    execute: async (ctx) => {
      const urlMatch = String(ctx.args[0] || '').match(/^https?:\/\/\S+/i);
      if (urlMatch) {
        const { downloadToBuffer } = require('../../utils/download');
        try {
          const buf = await downloadToBuffer(urlMatch[0], {
            maxBytes: CONFIG.limits.stickerMaxMB * 1024 * 1024,
          });
          if (!buf) return ctx.reply('❌ Não consegui baixar esse link.');
          await ctx.reply('⏳ Criando sticker...');
          const gif = engine.isGif(buf);
          logger.info({ input: gif ? 'image/gif' : 'link', inputSize: buf.length }, '[STICKER] Input');
          const webp = gif
            ? engine.hasFfmpeg()
              ? await engine.videoToWebp(buf, CONFIG.limits.stickerMaxSeconds)
              : await engine.gifToWebp(buf)
            : await engine.imageToWebp(buf);
          await finalizeAndSend(ctx, webp, { animated: gif });
          return;
        } catch (err) {
          await errorHandler.handle(ctx, err, { name: 'sticker' });
          const reason = ((err && err.message) || 'erro desconhecido').split('\n')[0];
          return ctx.reply('❌ Não consegui criar o sticker.\n▸ Motivo: ' + reason);
        }
      }

      const media = await ctx.downloadMedia();
      if (!media) return ctx.reply('🖼️ Envie ou marque uma imagem/vídeo/GIF com o comando !sticker (ou use !sticker <link>).');

      if (media.type === 'audio') {
        return ctx.reply('❌ Não consigo transformar áudio em sticker.');
      }

      const isGif = engine.isGif(media.buffer);
      if (media.type === 'document' && !isGif) {
        return ctx.reply('❌ Não consigo transformar documento em sticker (só imagem/vídeo/GIF).');
      }

      const maxBytes = CONFIG.limits.stickerMaxMB * 1024 * 1024;
      if (media.buffer.length > maxBytes) {
        return ctx.reply(`📦 Mídia muito grande para sticker (limite ${CONFIG.limits.stickerMaxMB} MB).`);
      }

      const meta = parsePackAuthor(ctx.args);
      await ctx.reply('⏳ Criando sticker...');
      logger.info({ input: 'image/' + media.type, inputSize: media.buffer.length }, '[STICKER] Input');
      try {
        let webp;
        if (media.type === 'video' || isGif) {
          webp = engine.hasFfmpeg()
            ? await engine.videoToWebp(media.buffer, CONFIG.limits.stickerMaxSeconds)
            : isGif
              ? await engine.gifToWebp(media.buffer)
              : await engine.videoToWebp(media.buffer, CONFIG.limits.stickerMaxSeconds);
        } else if (media.type === 'sticker') {
          webp = media.buffer;
        } else {
          webp = await engine.imageToWebp(media.buffer);
        }
        await finalizeAndSend(ctx, webp, {
          animated: media.type === 'video' || isGif,
          packname: (meta && meta.packname) || undefined,
          author: (meta && meta.author) || undefined,
        });
      } catch (err) {
        errorHandler.handle(ctx, err, { name: 'sticker' });
        const reason = ((err && err.message) || 'erro desconhecido').split('\n')[0];
        await ctx.reply('❌ Não consegui criar o sticker.\n▸ Motivo: ' + reason);
      }
    },
  },
  {
    name: 'stickerimg',
    commands: ['stickerimg', 'stickerimagem'],
    category: 'stickers',
    description: 'Transforma uma imagem em sticker com bio rica.',
    usage: '!stickerimg (respondendo a uma imagem)',
    cooldown: 5000,
    execute: async (ctx) => {
      const media = await ctx.downloadMedia();
      if (!media || media.type !== 'image') return ctx.reply('🖼️ Marque uma imagem para virar sticker.');
      await ctx.reply('⏳ Criando sticker...');
      logger.info({ input: 'image', inputSize: media.buffer.length }, '[STICKER] Input');
      try {
        const webp = await engine.imageToWebp(media.buffer);
        await finalizeAndSend(ctx, webp);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'stickerimg' });
      }
    },
  },
  {
    name: 'stickertext',
    commands: ['stickertext', 'textosticker', 'stext'],
    category: 'stickers',
    description: 'Cria um sticker de texto com bio rica.',
    usage: '!stickertext <texto>',
    cooldown: 5000,
    execute: async (ctx) => {
      const text = ctx.args.join(' ').slice(0, 200);
      if (!text) return ctx.reply('⚠️ Envie o texto: !stickertext <texto>');
      await ctx.reply('⏳ Criando sticker de texto...');
      logger.info({ input: 'text', inputSize: Buffer.byteLength(text) }, '[STICKER] Input');
      try {
        const webp = await engine.textToSticker(text);
        await finalizeAndSend(ctx, webp, { opType: 'text' });
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'stickertext' });
      }
    },
  },
  {
    name: 'toimg',
    commands: ['toimg', 'stickerimg2', 'figparaimg', 'stickerfoto', 'stickerimage'],
    category: 'stickers',
    description: 'Converte um sticker em imagem.',
    usage: '!toimg (respondendo a um sticker)',
    cooldown: 5000,
    execute: async (ctx) => {
      const media = await ctx.downloadMedia();
      if (!media || media.type !== 'sticker') return ctx.reply('🎨 Marque um sticker para converter em imagem.');
      await ctx.reply('⏳ Convertendo...');
      try {
        const png = await engine.webpToPng(media.buffer);
        await ctx.sendImage(png, '🖼️ Sticker convertido para imagem.');
        try {
          const profileStats = require('../../database/profileStats');
          profileStats.recordStickerOperation(ctx.sender, 'to_media');
        } catch (_) {}
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'toimg' });
      }
    },
  },
  {
    name: 'tovideo',
    commands: ['tovideo', 'sticker2video', 'stickervideo'],
    category: 'stickers',
    description: 'Converte um sticker animado em vídeo (MP4).',
    usage: '!tovideo (respondendo a um sticker animado)',
    cooldown: 6000,
    execute: async (ctx) => {
      const media = await ctx.downloadMedia();
      if (!media || media.type !== 'sticker') return ctx.reply('🎨 Marque um sticker para converter em vídeo.');
      await ctx.reply('⏳ Convertendo para vídeo...');
      try {
        const mp4 = await engine.stickerToVideo(media.buffer);
        await ctx.sendVideo(mp4, '🎥 Sticker convertido para vídeo.', { mimetype: 'video/mp4' });
      } catch (err) {
        const reason = ((err && err.message) || 'erro desconhecido').split('\n')[0];
        await errorHandler.handle(ctx, err, { name: 'tovideo' });
        await ctx.reply('❌ Não consegui converter o sticker para vídeo.\n▸ Motivo: ' + reason);
      }
    },
  },
  {
    name: 'togif',
    commands: ['togif', 'sticker2gif', 'stickergif'],
    category: 'stickers',
    description: 'Converte um sticker animado em GIF.',
    usage: '!togif (respondendo a um sticker animado)',
    cooldown: 6000,
    execute: async (ctx) => {
      const media = await ctx.downloadMedia();
      if (!media || media.type !== 'sticker') return ctx.reply('🎨 Marque um sticker para converter em GIF.');
      await ctx.reply('⏳ Convertendo para GIF...');
      try {
        const gif = await engine.stickerToGif(media.buffer);
        await ctx.sendDocument(gif, {
          mimetype: 'image/gif',
          fileName: 'sticker.gif',
          caption: '🎞️ Sticker convertido para GIF.',
        });
      } catch (err) {
        const reason = ((err && err.message) || 'erro desconhecido').split('\n')[0];
        await errorHandler.handle(ctx, err, { name: 'togif' });
        await ctx.reply('❌ Não consegui converter o sticker para GIF.\n▸ Motivo: ' + reason);
      }
    },
  },
];
