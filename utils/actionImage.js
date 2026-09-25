/**
 * utils/actionImage.js — imagens e animações ilustrativas para comandos de ação.
 *
 * Qualquer comando interativo (beijo, sirrica, bater, gado, abraço, trabalhar…)
 * pode ganhar uma imagem ou GIF a partir do catálogo variado em `assets/actions/media/`
 * ou de `assets/actions/<nome>.jpg|png|webp|gif`.
 *
 * Mecanismo de envio no WhatsApp:
 * 1. Para GIFs animados: envia primariamente com `ctx.sendVideo(path, caption, { gifPlayback: true, mimetype: 'video/mp4' })`.
 *    No WhatsApp, mensagens com flag `gifPlayback: true` são reproduzidas automaticamente
 *    como GIFs animados em loop contínuo.
 * 2. Caso a biblioteca rejeite ou falhe, faz fallback para `ctx.sendImage(path, caption, { mimetype: 'image/gif' })`.
 * 3. Se ainda assim houver indisponibilidade ou falha, faz fallback seguro para a legenda em texto puro via `ctx.reply`.
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
    if (media.type === 'gif') {
      // 1ª tentativa: Enviar como vídeo com gifPlayback (padrão oficial do WhatsApp para GIFs animados)
      if (typeof ctx.sendVideo === 'function') {
        try {
          await ctx.sendVideo(
            media.path,
            caption,
            Object.assign({}, opts, { gifPlayback: true, mimetype: 'video/mp4' })
          );
          return true;
        } catch (_) {
          // Se falhar o envio como vídeo com gifPlayback, tenta como imagem gif
        }
      }

      // 2ª tentativa: Enviar como imagem com mimetype image/gif
      if (typeof ctx.sendImage === 'function') {
        try {
          await ctx.sendImage(
            media.path,
            caption,
            Object.assign({}, opts, { mimetype: 'image/gif' })
          );
          return true;
        } catch (_) {
          // Se falhar, tenta sem mimetype forçado
        }
      }

      // 3ª tentativa: Envio padrão como imagem
      if (typeof ctx.sendImage === 'function') {
        await ctx.sendImage(media.path, caption, opts);
        return true;
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
