'use strict';

const CONFIG = require('../../config');
const engine = require('../../utils/stickerEngine');
const stickerMeta = require('../../utils/stickerMeta');
const errorHandler = require('../../handlers/errorHandler');

/** Pega um sticker da mensagem/citada. */
async function getSticker(ctx) {
  const media = await ctx.downloadMedia();
  if (!media || media.type !== 'sticker') {
    await ctx.reply('🎨 Marque um sticker para editar.');
    return null;
  }
  return media.buffer;
}

module.exports = [
  {
    name: 'take',
    commands: ['take', 'roubar', 'rg', 'rgtake', 'roubargrande'],
    category: 'stickers',
    description: 'Rouba/reenvia sticker com bio rica: criador, origem (GP/PV), bot, dono, dev. Use !take <pack>|<autor> para custom.',
    usage: '!take [pack|autor] (respondendo a um sticker)',
    cooldown: 3000,
    execute: async (ctx) => {
      const buffer = await getSticker(ctx);
      if (!buffer) return;
      const joined = ctx.args.join(' ').trim();
      let pack, author;
      if (joined) {
        [pack, author] = joined.split('|').map((s) => s.trim());
      }
      try {
        const meta = stickerMeta.buildTakeMeta(ctx, pack, author);
        const webp = await engine.setStickerMetadata(buffer, {
          packname: meta.packname,
          author: meta.author,
          emoji: meta.emoji,
        });
        await ctx.sendSticker(webp);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'take' });
      }
    },
  },
  {
    name: 'pack',
    commands: ['pack', 'rename', 'renomear', 'setpack'],
    category: 'stickers',
    description: 'Altera o pacote/autor de um sticker. Sem args, gera bio rica automática.',
    usage: '!pack [pack|autor] (respondendo a um sticker)',
    cooldown: 3000,
    execute: async (ctx) => {
      const buffer = await getSticker(ctx);
      if (!buffer) return;
      const joined = ctx.args.join(' ').trim();
      let pack, author;
      if (joined) {
        [pack, author] = joined.split('|').map((s) => s.trim());
      }
      // se não passou nada, gera bio rica
      if (!pack && !author) {
        try {
          const meta = stickerMeta.buildStickerMeta(ctx);
          const webp = await engine.setStickerMetadata(buffer, {
            packname: meta.packname,
            author: meta.author,
          });
          await ctx.sendSticker(webp);
          return;
        } catch (err) {
          await errorHandler.handle(ctx, err, { name: 'pack' });
          return;
        }
      }
      if (!pack && !author) return ctx.reply('⚠️ Uso: !pack <nome-do-pacote>|<autor> ou !pack sem args para bio rica');
      try {
        const meta = stickerMeta.buildStickerMeta(ctx, {
          customPack: pack,
          customAuthor: author,
        });
        const webp = await engine.setStickerMetadata(buffer, {
          packname: meta.packname,
          author: meta.author,
        });
        await ctx.sendSticker(webp);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'pack' });
      }
    },
  },
  {
    name: 'emoji',
    commands: ['emoji', 'setemoji'],
    category: 'stickers',
    description: 'Define o emoji associado a um sticker.',
    usage: '!emoji <emoji> (respondendo a um sticker)',
    cooldown: 3000,
    execute: async (ctx) => {
      const buffer = await getSticker(ctx);
      if (!buffer) return;
      const emoji = (ctx.args[0] || '').slice(0, 8);
      if (!emoji) return ctx.reply('⚠️ Envie o emoji: !emoji 😂');
      try {
        const webp = await engine.setStickerMetadata(buffer, { emoji });
        await ctx.sendSticker(webp);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'emoji' });
      }
    },
  },
  {
    name: 'stickerinfo',
    commands: ['stickerinfo', 'infosticker', 'exif', 'rginfo', 'figinfo'],
    category: 'stickers',
    description: 'Mostra informações da figurinha (pack, autor, criador, origem, bio).',
    usage: '!stickerinfo (respondendo a um sticker)',
    cooldown: 3000,
    execute: async (ctx) => {
      const buffer = await getSticker(ctx);
      if (!buffer) return;
      try {
        const { Image } = require('node-webpmux');
        const img = new Image();
        await img.load(buffer);
        const exif = img.exif;

        let info = null;
        if (exif) {
          try {
            // exif tem header TIFF de 22 bytes + JSON
            const jsonStr = exif.slice(22).toString('utf-8');
            info = JSON.parse(jsonStr);
          } catch (_) {
            // tenta parse bruto
            try {
              const raw = exif.toString('utf-8');
              const start = raw.indexOf('{');
              const end = raw.lastIndexOf('}');
              if (start !== -1 && end !== -1) info = JSON.parse(raw.slice(start, end + 1));
            } catch (_) {}
          }
        }

        const creator = stickerMeta.getCreatorName(ctx);
        const groupName = ctx.isGroup ? stickerMeta.getGroupName(ctx) : '';
        const origin = ctx.isGroup ? (groupName ? `Grupo: ${groupName}` : 'Grupo') : 'PV (privado)';

        let msg = `*🎨 INFO DA FIGURINHA*\n\n`;
        if (info) {
          msg += `📦 *Pacote:* ${info['sticker-pack-name'] || '—'}\n`;
          msg += `👤 *Autor/Publisher:* ${info['sticker-pack-publisher'] || '—'}\n`;
          msg += `🆔 *ID:* ${info['sticker-pack-id'] || '—'}\n`;
          if (info.emojis) msg += `😀 *Emoji:* ${info.emojis.join(' ')}\n`;
        } else {
          msg += `⚠️ Sem EXIF (sticker sem bio)\n`;
        }
        msg += `\n*📌 Contexto atual:*\n`;
        msg += `👤 Criador: ${creator}\n`;
        msg += `📍 Origem: ${origin}\n`;
        msg += `🤖 Bot: ${CONFIG.bot.name} v${CONFIG.bot.version}\n`;
        msg += `👑 Dono: ${CONFIG.owner.name}\n`;
        msg += `💻 Dev: ${CONFIG.bot.author}\n`;
        msg += `📅 Data: ${stickerMeta.formatDateBR()}\n`;

        await ctx.reply(msg);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'stickerinfo' });
        await ctx.reply('❌ Não consegui ler as infos do sticker.');
      }
    },
  },
];
