/**
 * utils/cards/rank.js — RankCard (posição no ranking).
 *
 * Apresentação apenas: posição, total, nome, XP e nível vêm prontos do comando.
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
 * @param {number} d.position   posição (1-based)
 * @param {number} [d.total]    total de usuários no ranking
 * @param {number|string} [d.xp]
 * @param {number} [d.level]
 * @param {string} [d.title]    nome do ranking (ex.: "RANK DE XP")
 * @returns {Promise<Buffer|null>}
 */
async function renderRankCard(d) {
  const data = d || {};
  const { THEME } = base;
  const accent = THEME.accent.rank;

  const [big, title, body, label] = await Promise.all([
    kit.loadFont('big'),
    kit.loadFont('title'),
    kit.loadFont('body'),
    kit.loadFont('label'),
  ]);

  const img = base.createCanvas('rank');

  const avatar = await base.resolveAvatar({ sock: data.sock, jid: data.jid, buffer: data.avatar, size: 168 });
  base.placeAvatar(img, avatar, 140, 190, accent);

  // bloco da posição (o dado mais importante da card).
  // Sem "º": a fonte bitmap do Jimp não tem esse glifo e `clean` o apagaria,
  // então o rótulo carrega o significado e o número fica grande.
  kit.text(img, label, data.title || 'RANK DE XP', 250, 54, { maxWidth: 640 });
  kit.text(img, label, 'SUA POSICAO', 252, 78, { maxWidth: 400 });
  const pos = Number.isFinite(Number(data.position)) ? String(Number(data.position)) : '-';
  kit.text(img, big, pos, 246, 98, { maxWidth: 400 });
  if (Number.isFinite(Number(data.total))) {
    kit.text(img, label, `de ${data.total} usuarios`, 252, 238, { maxWidth: 400 });
  }

  // quem é
  base.panel(img, 248, 268, 650, 190, 150);
  kit.text(img, title, data.name || 'Usuário', 272, 292, { maxWidth: 600 });

  const linha = [];
  if (data.level !== undefined && data.level !== null) linha.push(`Nivel ${data.level}`);
  if (data.xp !== undefined && data.xp !== null) linha.push(`${data.xp} XP`);
  if (linha.length) kit.text(img, body, linha.join('   •   '), 272, 380, { maxWidth: 600 });

  return base.encode(img);
}

module.exports = { renderRankCard };
