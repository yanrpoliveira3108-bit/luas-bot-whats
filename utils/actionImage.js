/**
 * utils/actionImage.js — imagens e animações ilustrativas para comandos de ação.
 *
 * Qualquer comando interativo (beijo, sirrica, bater, gado, abraço, trabalhar…)
 * pode ganhar uma imagem ou GIF a partir do catálogo variado em `assets/actions/media/`
 * ou de `assets/actions/<nome>.jpg|png|webp|gif`.
 *
 * Suporte a múltiplos itens por comando com anti-repetição imediata, envio em loop
 * com `gifPlayback: true` quando for animação, e fallback graceful para texto puro
 * sem nunca derrubar o bot.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const actionCatalog = require('./actionCatalog');

const ACTIONS_DIR = path.join(__dirname, '..', 'assets', 'actions');

/** Caminho da imagem de uma ação, ou null se não existir (mantido para compatibilidade). */
function resolvePath(key) {
  if (!key) return null;
  const base = String(key)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
  if (!base) return null;

  // Primeiro verifica se há item selecionável no catálogo
  const items = actionCatalog.getItems(base);
  if (items && items.length > 0) {
    return items[0].path;
  }

  for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4']) {
    const p = path.join(ACTIONS_DIR, base + ext);
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {
      /* segue */
    }
  }
  return null;
}

/**
 * Envia uma mídia ilustrativa da ação (com legenda e menções), ou só o texto
 * se não houver mídia ou se o envio da mídia falhar.
 * @param {object} ctx Contexto do comando
 * @param {string} key Identificador da ação (ex: 'beijo', 'sirrica', 'bater')
 * @param {string} caption Legenda do envio
 * @param {string[]} mentions JIDs para menção
 * @returns {Promise<boolean>} true se enviou mídia, false se enviou apenas texto
 */
async function send(ctx, key, caption, mentions) {
  const opts = mentions && mentions.length ? { mentions } : {};
  const media = actionCatalog.pickMedia(key);

  if (!media || !media.path) {
    await ctx.reply(caption, opts);
    return false;
  }

  try {
    if (media.type === 'gif' && typeof ctx.sendVideo === 'function') {
      try {
        await ctx.sendVideo(
          media.path,
          caption,
          Object.assign({}, opts, { gifPlayback: true, mimetype: 'video/mp4' })
        );
        return true;
      } catch (_) {
        // Se sendVideo falhar com o arquivo GIF, tenta enviar como imagem antes do fallback para texto
        if (typeof ctx.sendImage === 'function') {
          await ctx.sendImage(media.path, caption, opts);
          return true;
        }
        throw _;
      }
    } else if (typeof ctx.sendImage === 'function') {
      await ctx.sendImage(media.path, caption, opts);
      return true;
    } else {
      await ctx.reply(caption, opts);
      return false;
    }
  } catch (_) {
    try {
      await ctx.reply(caption, opts);
    } catch (_) {
      /* ignora */
    }
    return false;
  }
}

module.exports = {
  resolvePath,
  send,
  catalog: actionCatalog.CATALOG_DEFINITIONS,
  getItems: actionCatalog.getItems,
  pickMedia: actionCatalog.pickMedia,
};
