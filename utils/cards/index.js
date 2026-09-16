/**
 * utils/cards/index.js — API pública das cards.
 *
 * Uso (o comando cuida da regra de negócio, a card só desenha):
 *
 *   const cards = require('../../utils/cards');
 *   const buf = await cards.renderProfileCard({ sock, jid, name, level, xp, xpNext });
 *   if (buf) await ctx.socket.sendMessage(ctx.remoteJid, { image: buf, caption: '...' });
 *
 * Contrato:
 *  - devolve Buffer JPEG ou **null**; nunca lança (um problema visual não pode
 *    derrubar o comando nem o bot — quem chama decide o fallback em texto);
 *  - passa pelo semáforo de render (utils/cards/base.js);
 *  - nenhum arquivo temporário: tudo em Buffer;
 *  - log sem buffer e sem dado sensível (só o nome da card e a mensagem).
 */

'use strict';

const base = require('./base');
const logger = require('../logger');
const { renderProfileCard } = require('./profile');
const { renderRankCard } = require('./rank');
const { renderLevelCard } = require('./level');

/** Roda o render no slot de concorrência e converte erro em null. */
async function guarded(label, fn) {
  try {
    const buf = await base.withRenderSlot(fn);
    if (!Buffer.isBuffer(buf) || !buf.length) {
      logger.warn({ card: label }, 'card: render devolveu buffer vazio');
      return null;
    }
    return buf;
  } catch (err) {
    // sem stack gigante, sem buffer: só o suficiente para diagnosticar
    logger.warn({ card: label, err: (err && err.message) || String(err) }, 'card: falha no render');
    return null;
  }
}

/**
 * Envia o buffer como imagem. Devolve true se enviou, false se não havia
 * imagem — o comando então manda o fallback em texto (nunca há silêncio).
 */
async function sendCard(ctx, buffer, caption) {
  if (!buffer || !Buffer.isBuffer(buffer)) return false;
  try {
    await ctx.socket.sendMessage(ctx.remoteJid, { image: buffer, caption });
    return true;
  } catch (err) {
    logger.warn({ err: (err && err.message) || String(err) }, 'card: falha ao enviar imagem');
    return false;
  }
}

module.exports = {
  sendCard,
  /** @returns {Promise<Buffer|null>} */
  renderProfileCard: (data) => guarded('profile', () => renderProfileCard(data)),
  renderRankCard: (data) => guarded('rank', () => renderRankCard(data)),
  renderLevelCard: (data) => guarded('level', () => renderLevelCard(data)),
  /** estado do semáforo/cache de fontes (testes e diagnóstico) */
  stats: () => Object.assign({ fonts: require('../imageKit').fontCacheSize() }, base.renderStats()),
  SIZE: base.SIZE,
};
