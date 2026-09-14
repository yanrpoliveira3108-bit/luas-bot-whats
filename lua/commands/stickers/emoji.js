/**
 * commands/stickers/emoji.js — sticker a partir de um emoji (!emojisticker).
 *
 * Baixa o glifo do emoji (Twemoji, CDN público) e o converte em sticker.
 * Se o emoji não existir ou o serviço estiver fora, responde amigavelmente.
 */

'use strict';

const CONFIG = require('../../config');
const engine = require('../../utils/stickerEngine');
const { downloadToBuffer } = require('../../utils/download');
const { deleteFile } = require('../../utils/download');
const errorHandler = require('../../handlers/errorHandler');

/** Converte um emoji nos code points hex do Twemoji (sem variação fe0f). */
function toCodePoints(emoji) {
  return [...String(emoji)]
    .map((c) => c.codePointAt(0).toString(16))
    .filter((cp) => cp !== 'fe0f')
    .join('-');
}

function isEmojiChar(ch) {
  const cp = ch.codePointAt(0);
  return (
    (cp >= 0x1f000 && cp <= 0x1faff) || // pictogramas
    (cp >= 0x2600 && cp <= 0x27bf) || // misc symbols
    (cp >= 0x1f1e6 && cp <= 0x1f1ff) // bandeiras
  );
}

async function svgToWebp(svgBuffer) {
  // sharp renderiza SVG (quando disponível)
  try {
    const sharp = require('sharp');
    return await sharp(svgBuffer).resize(512, 512).webp({ quality: 85 }).toBuffer();
  } catch (_) {
    return null;
  }
}

async function pngToWebp(pngBuffer) {
  return engine.imageToWebp(pngBuffer);
}

module.exports = [
  {
    name: 'emojisticker',
    commands: ['emojisticker', 'emojistk', 'figemoji'],
    category: 'stickers',
    description: 'Transforma um emoji em sticker.',
    usage: '!emojisticker <emoji>',
    cooldown: 5000,
    execute: async (ctx) => {
      const emoji = [...(ctx.args.join('') || '')][0];
      if (!emoji || !isEmojiChar(emoji)) {
        return ctx.reply('😀 Envie um emoji: !emojisticker 😂');
      }
      const cp = toCodePoints(emoji);
      const svgUrl = `${CONFIG.external.twemoji}/${cp}.svg`;
      const pngUrl = `${CONFIG.external.twemoji}/${cp}.png`;

      await ctx.reply('⏳ Criando sticker do emoji...');
      try {
        // 1) tenta SVG (alta qualidade, via sharp)
        let webp = null;
        try {
          const svg = await downloadToBuffer(svgUrl, { timeoutMs: 20000, maxBytes: 512 * 1024 });
          webp = await svgToWebp(svg);
        } catch (_) {
          /* SVG indisponível — tenta PNG */
        }
        // 2) fallback PNG (72px) reescalado
        if (!webp) {
          const png = await downloadToBuffer(pngUrl, { timeoutMs: 20000, maxBytes: 512 * 1024 });
          webp = await pngToWebp(png);
        }
        webp = await engine.setStickerMetadata(webp, { packname: CONFIG.bot.name, author: CONFIG.bot.author });
        await ctx.sendSticker(webp);
      } catch (err) {
        if (err && (err.message || '').includes('404')) {
          return ctx.reply('😕 Emoji não encontrado no repositório de ícones. Tente outro emoji.');
        }
        await errorHandler.handle(ctx, err, { name: 'emojisticker' });
      }
    },
  },
];
