/**
 * utils/actionImage.js — imagens ilustrativas para comandos de ação.
 *
 * Qualquer comando interativo (beijo, abraço, trabalhar, minerar, pescar…)
 * pode ganhar uma imagem: basta existir `assets/actions/<nome>.jpg|png|webp`.
 * Se a imagem não existir (ou falhar ao enviar), o comando segue só com texto —
 * imagem quebrada NUNCA derruba o bot.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ACTIONS_DIR = path.join(__dirname, '..', 'assets', 'actions');

/** Caminho da imagem de uma ação, ou null se não existir. */
function resolvePath(key) {
  if (!key) return null;
  const base = String(key)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
  if (!base) return null;
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
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
 * Envia a imagem da ação (com legenda), ou só o texto se não houver imagem.
 * @returns {Promise<boolean>} true se enviou imagem
 */
async function send(ctx, key, caption, mentions) {
  const img = resolvePath(key);
  const opts = mentions && mentions.length ? { mentions } : {};
  if (!img) {
    await ctx.reply(caption, opts);
    return false;
  }
  try {
    await ctx.sendImage(img, caption, opts);
    return true;
  } catch (_) {
    try {
      await ctx.reply(caption, opts);
    } catch (_) {
      /* ignora */
    }
    return false;
  }
}

module.exports = { resolvePath, send };
