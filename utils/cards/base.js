/**
 * utils/cards/base.js — base compartilhada das cards (perfil/rank/level).
 *
 * Responsabilidade: canvas, tema, avatar e limite de concorrência. NENHUMA
 * regra de negócio mora aqui (sem XP, sem economia, sem permissão) — o comando
 * busca e valida os dados, a card só desenha.
 *
 * Decisões de memória/performance (ver relatório):
 *  - o fundo é um gradiente regenerado a cada render (4 ms medidos), portanto
 *    NÃO existe cache de background — nada para vazar;
 *  - o avatar reusa plugins/welcome/profile.getPhoto(), que já tem cache com
 *    TTL de 10 min e poda acima de 300 entradas (não foi criado um segundo);
 *  - a codificação final é JPEG q90 em Buffer: nenhum arquivo temporário;
 *  - renders simultâneos passam por um semáforo pequeno (CPU-bound). A fila de
 *    downloads (utils/downloadQueue) é de rede e tem outra semântica, por isso
 *    não foi reaproveitada aqui.
 */

'use strict';

const Jimp = require('jimp');
const kit = require('../imageKit');
const profile = require('../../plugins/welcome/profile');
const logger = require('../logger');

/** Tamanho único das cards: legível no celular e barato (2,07 MB de bitmap). */
const SIZE = { w: 960, h: 540 };

const THEME = {
  bgTop: [20, 17, 38],
  bgBottom: [38, 29, 68],
  panel: [10, 8, 20],
  dim: [176, 170, 205],
  hairline: [86, 74, 140],
  accent: {
    profile: [139, 92, 246],
    rank: [245, 158, 11],
    level: [16, 185, 129],
  },
};

/* --------------------------- concorrência ---------------------------- */

const MAX_CONCURRENT = 2;
let active = 0;
const waiting = []; // funções resolve() aguardando slot

/** Entrega slots enquanto houver capacidade e gente esperando. */
function pump() {
  while (active < MAX_CONCURRENT && waiting.length) {
    active += 1;
    waiting.shift()();
  }
}

/**
 * Roda `fn` com no máximo MAX_CONCURRENT renders simultâneos.
 * O slot é contabilizado na entrega (pump) e devolvido quando `fn` assenta —
 * assim `active` nunca dessincroniza, nem em erro.
 */
function withRenderSlot(fn) {
  const gate = new Promise((resolve) => waiting.push(resolve));
  pump();
  return gate.then(() => fn()).finally(() => {
    active -= 1;
    pump();
  });
}

/** Quantos renders estão rodando/aguardando (para testes). */
function renderStats() {
  return { active, waiting: waiting.length, max: MAX_CONCURRENT };
}

/* ------------------------------ canvas ------------------------------- */

/**
 * Canvas pronto para receber conteúdo: gradiente + barra de acento + hairline.
 * @param {'profile'|'rank'|'level'} kind escolhe a cor de acento
 */
function createCanvas(kind) {
  const img = new Jimp(SIZE.w, SIZE.h, 0x000000ff);
  kit.verticalGradient(img, THEME.bgTop, THEME.bgBottom);
  const accent = THEME.accent[kind] || THEME.accent.profile;
  // barra de acento à esquerda: identidade da card sem poluir
  kit.drawRect(img, 0, 0, 10, SIZE.h, accent, 255);
  // OBS: sem véu de tela cheia (kit.scrim custa ~26 ms por card) — o fundo já
  // é escuro o bastante e os painéis atrás do texto garantem o contraste.
  return img;
}

/** Painel translúcido (agrupa um bloco de informação). */
function panel(img, x, y, w, h, alpha = 165) {
  kit.labelBar(img, x, y, w, h, alpha);
}

/* ------------------------------ avatar ------------------------------- */

/**
 * Avatar circular pronto para composição.
 *
 * Ordem: buffer já baixado (o chamador pode ter a foto em mãos) → foto do
 * WhatsApp via cache existente → avatar padrão do próprio módulo de welcome.
 * Nunca lança e nunca baixa duas vezes a mesma foto.
 *
 * @param {{sock?:object, jid?:string, buffer?:Buffer|null, size:number}} opts
 */
async function resolveAvatar({ sock, jid, buffer, size }) {
  let buf = buffer && buffer.length ? buffer : null;
  if (!buf && sock && jid) {
    try {
      buf = await profile.getPhoto(sock, jid);
    } catch (err) {
      logger.debug({ err: err && err.message }, 'card: foto indisponível, usando avatar padrão');
      buf = null;
    }
  }
  return kit.circleAvatar(buf, size);
}

/** Compõe o avatar com um anel fino na cor de acento (sem exagero visual). */
function placeAvatar(img, avatar, cx, cy, accent) {
  const r = Math.floor(avatar.bitmap.width / 2);
  const ring = new Jimp(r * 2 + 8, r * 2 + 8, 0x00000000);
  kit.fillCircle(ring, r + 4, r + 4, r + 3, accent, 235);
  kit.punchHole(ring, r + 4, r + 4, r);
  img.composite(ring, cx - r - 4, cy - r - 4);
  img.composite(avatar, cx - r, cy - r);
}

/** Codifica em JPEG (Buffer, sem arquivo temporário). */
async function encode(img) {
  return img.getBufferAsync(Jimp.MIME_JPEG, { quality: 90 });
}

module.exports = {
  SIZE,
  THEME,
  MAX_CONCURRENT,
  withRenderSlot,
  renderStats,
  createCanvas,
  panel,
  resolveAvatar,
  placeAvatar,
  encode,
};
