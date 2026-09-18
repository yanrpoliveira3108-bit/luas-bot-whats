/**
 * utils/cards/level.js — LevelCard (nível + barra de progresso).
 *
 * A barra é calculada com os números reais recebidos (xp / xpNext). Se xpNext
 * não existir ou for zero, a barra não é desenhada — sem valor fictício.
 */

'use strict';

const base = require('./base');
const kit = require('../imageKit');

/**
 * @param {object} d
 * @param {object} [d.sock]
 * @param {string} [d.jid]
 * @param {Buffer} [d.avatar]
 * @param {string} d.name
 * @param {number} [d.level]
 * @param {number} [d.xp]
 * @param {number} [d.xpNext]   XP necessário para o próximo nível
 * @returns {Promise<Buffer|null>}
 */
async function renderLevelCard(d) {
  const data = d || {};
  const { THEME } = base;
  const accent = THEME.accent.level;

  const [big, title, body, label] = await Promise.all([
    kit.loadFont('big'),
    kit.loadFont('title'),
    kit.loadFont('body'),
    kit.loadFont('label'),
  ]);

  const img = base.createCanvas('level');

  const avatar = await base.resolveAvatar({ sock: data.sock, jid: data.jid, buffer: data.avatar, size: 150 });
  base.placeAvatar(img, avatar, 125, 170, accent);

  kit.text(img, label, 'PROGRESSO DE NIVEL', 232, 54, { maxWidth: 640 });
  if (data.level !== undefined && data.level !== null) {
    kit.text(img, big, String(data.level), 226, 76, { maxWidth: 400 });
  }
  kit.text(img, title, data.name || 'Usuário', 230, 246, { maxWidth: 660 });

  const xp = Number(data.xp);
  const xpNext = Number(data.xpNext);
  const temBarra = Number.isFinite(xp) && Number.isFinite(xpNext) && xpNext > 0;
  if (temBarra) {
    const pct = Math.max(0, Math.min(100, Math.round((xp / xpNext) * 100)));
    kit.progressBar(img, 230, 344, 640, 22, pct, accent);
    kit.text(img, body, `${data.xp} / ${data.xpNext} XP`, 232, 384, { maxWidth: 400 });
    kit.text(img, label, `${pct}% para o proximo nivel`, 232, 424, { maxWidth: 500 });
  } else if (Number.isFinite(xp)) {
    kit.text(img, body, `${data.xp} XP`, 232, 350, { maxWidth: 400 });
  }

  return base.encode(img);
}

module.exports = { renderLevelCard };
