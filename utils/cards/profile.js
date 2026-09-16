/**
 * utils/cards/profile.js — ProfileCard.
 *
 * Só apresentação: recebe dados prontos (o comando busca e valida) e desenha.
 * Campos ausentes simplesmente não são desenhados — nada é inventado.
 */

'use strict';

const base = require('./base');
const kit = require('../imageKit');

/**
 * @param {object} d
 * @param {object} [d.sock]      socket (para buscar a foto, se não vier buffer)
 * @param {string} [d.jid]       jid do usuário
 * @param {Buffer} [d.avatar]    foto já baixada (evita novo download)
 * @param {string} d.name        nome de exibição
 * @param {string} [d.number]    número/identificador curto
 * @param {number} [d.level]     nível
 * @param {number} [d.xp]        XP atual
 * @param {number} [d.xpNext]    XP necessário para o próximo nível
 * @param {number} [d.reputation]
 * @param {number} [d.messages]
 * @param {string} [d.rpg]       ex.: "nv 7 (pescador)"
 * @param {string} [d.wallet]    já formatado pelo comando
 * @param {string} [d.bank]      já formatado pelo comando
 * @param {string} [d.about]     descrição curta
 * @returns {Promise<Buffer|null>} JPEG ou null em falha
 */
async function renderProfileCard(d) {
  const data = d || {};
  const { SIZE, THEME } = base;
  const accent = THEME.accent.profile;

  const [title, body, label] = await Promise.all([
    kit.loadFont('title'),
    kit.loadFont('body'),
    kit.loadFont('label'),
  ]);

  const img = base.createCanvas('profile');

  // avatar
  const avatar = await base.resolveAvatar({ sock: data.sock, jid: data.jid, buffer: data.avatar, size: 168 });
  base.placeAvatar(img, avatar, 140, 168, accent);

  // identidade
  kit.text(img, label, 'PERFIL', 250, 52, { maxWidth: 640 });
  kit.text(img, title, data.name || 'Usuário', 248, 74, { maxWidth: 640 });

  // nível + barra de XP (só se os números existirem)
  let y = 160;
  const hasXp = Number.isFinite(Number(data.xp)) && Number.isFinite(Number(data.xpNext)) && Number(data.xpNext) > 0;
  if (data.level !== undefined && data.level !== null) {
    base.panel(img, 248, y, 196, 46, 175);
    kit.text(img, body, `NIVEL ${data.level}`, 264, y + 8, { maxWidth: 170 });
    y += 62;
  }
  if (hasXp) {
    const pct = Math.max(0, Math.min(100, Math.round((Number(data.xp) / Number(data.xpNext)) * 100)));
    kit.progressBar(img, 248, y, 640, 20, pct, accent);
    kit.text(img, label, `${data.xp} / ${data.xpNext} XP  •  ${pct}%`, 250, y + 26, { maxWidth: 630 });
    y += 56;
  }

  // bloco de estatísticas (só as que existem)
  const stats = [];
  if (data.reputation !== undefined && data.reputation !== null) stats.push(['Reputacao', String(data.reputation)]);
  if (data.messages !== undefined && data.messages !== null) stats.push(['Mensagens', String(data.messages)]);
  if (data.rpg) stats.push(['RPG', String(data.rpg)]);
  if (data.wallet) stats.push(['Carteira', String(data.wallet)]);
  if (data.bank) stats.push(['Banco', String(data.bank)]);
  if (data.about) stats.push(['Sobre', String(data.about)]);

  if (stats.length) {
    const top = Math.max(y, 268);
    base.panel(img, 60, top, 840, 200, 150);
    stats.slice(0, 6).forEach(([k, v], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 96 + col * 420;
      const yy = top + 24 + row * 62;
      kit.drawRect(img, x - 18, yy + 2, 4, 38, accent, 210);
      kit.text(img, label, k.toUpperCase(), x, yy, { maxWidth: 360 });
      kit.text(img, body, v, x, yy + 20, { maxWidth: 360 });
    });
  }

  // rodapé: identificador curto (o jid completo é ruído visual)
  if (data.number) {
    kit.text(img, label, String(data.number), 62, SIZE.h - 34, { maxWidth: 500 });
  }

  return base.encode(img);
}

module.exports = { renderProfileCard };
