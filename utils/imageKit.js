/**
 * utils/imageKit.js — primitivos de desenho compartilhados (Jimp 0.16).
 *
 * Estas funções NASCERAM em plugins/welcome/renderer.js e foram movidas para cá
 * para que as cards de perfil/rank/level usem exatamente o mesmo código, em vez
 * de cada comando ter o seu próprio Jimp/resize/máscara/texto. O renderer de
 * welcome/goodbye continua com a composição própria (HUD, anel neon) e importa
 * daqui o que é genérico — uma única fonte de verdade, sem duplicação.
 *
 * Regras que este módulo respeita:
 *  - só Jimp (obrigatório no projeto) — sharp continua opcional e não é usado;
 *  - nenhuma fonte/arquivo baixado em runtime (fontes bitmap embutidas);
 *  - nenhuma função lança por causa de imagem ruim (fallback interno);
 *  - nada aqui guarda cache próprio: quem faz cache é o chamador (ver
 *    utils/cards/base.js), para não aparecer um segundo cache sem teto.
 */

'use strict';

const Jimp = require('jimp');

/** Fontes bitmap embutidas no Jimp (sem acentos — ver `clean`). */
const FONTS = {
  title: 'FONT_SANS_64_WHITE',
  subtitle: 'FONT_SANS_32_WHITE',
  body: 'FONT_SANS_32_WHITE',
  label: 'FONT_SANS_16_WHITE',
  small: 'FONT_SANS_16_WHITE',
  big: 'FONT_SANS_128_WHITE',
};

/**
 * Remove acentos e o que a fonte bitmap não desenha.
 * Sem isto o Jimp aborta ou desenha lixo em "Nível", "Reputação" etc.
 */
function clean(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7EÀ-ÿ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

/** Trunca com "…" até caber em maxWidth (na fonte dada). */
function fit(font, text, maxWidth) {
  const original = String(text == null ? '' : text);
  let t = original;
  while (t.length > 1 && Jimp.measureText(font, t) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t.length < original.length ? `${t.slice(0, -1)}…` : t;
}

/**
 * Cache de fontes. Medido: `Jimp.loadFont` custa 43-58 ms (parse do .fnt +
 * decodificação do atlas), e o renderer de welcome pedia até 7 fontes por
 * card — ou seja, centenas de ms por imagem só relendo o mesmo arquivo.
 *
 * O teto é o número de fontes que o kit conhece (6) com folga: é um conjunto
 * FINITO e imutável, carregado sob demanda (lazy), nunca por tamanho de dados.
 * Guarda-se a Promise para que chamadas simultâneas não carreguem duas vezes.
 */
const fontCache = new Map();
const MAX_FONTS = 8;

/** Carrega uma fonte bitmap embutida (aceita o nome curto ou o nome do Jimp). */
function loadFont(name) {
  const key = FONTS[name] || name;
  const hit = fontCache.get(key);
  if (hit) {
    // reordena: o menos usado vai para o fim (LRU)
    fontCache.delete(key);
    fontCache.set(key, hit);
    return hit;
  }
  const promise = Jimp.loadFont(Jimp[key] || Jimp.FONT_SANS_32_WHITE);
  fontCache.set(key, promise);
  while (fontCache.size > MAX_FONTS) fontCache.delete(fontCache.keys().next().value);
  return promise;
}

/** Entradas no cache de fontes (para testes de memória). */
function fontCacheSize() {
  return fontCache.size;
}

/* ------------------------------- pixels ------------------------------- */

function rgba(arr, a) {
  return Jimp.rgbaToInt(arr[0], arr[1], arr[2], Math.max(0, Math.min(255, Math.round(a))));
}

/** Mistura uma cor num pixel (alpha 0-255). Ignora coordenadas fora da imagem. */
function blend(img, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= img.bitmap.width || y >= img.bitmap.height) return;
  const idx = img.getPixelIndex(x, y);
  const d = img.bitmap.data;
  const sa = a / 255;
  d[idx] = Math.round(d[idx] * (1 - sa) + r * sa);
  d[idx + 1] = Math.round(d[idx + 1] * (1 - sa) + g * sa);
  d[idx + 2] = Math.round(d[idx + 2] * (1 - sa) + b * sa);
  d[idx + 3] = Math.min(255, d[idx + 3] + a);
}

/** Retângulo preenchido com cor+alpha. Limites vêm da própria imagem. */
function blendRegion(img, x0, y0, w, h, alpha, r = 4, g = 3, b = 12) {
  const x1 = Math.min(img.bitmap.width, x0 + w);
  const y1 = Math.min(img.bitmap.height, y0 + h);
  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let x = Math.max(0, x0); x < x1; x++) {
      blend(img, x, y, r, g, b, alpha);
    }
  }
}

/** Véu uniforme escuro (uniformiza o fundo e melhora o contraste do texto). */
function scrim(img, alpha) {
  blendRegion(img, 0, 0, img.bitmap.width, img.bitmap.height, alpha);
}

/** Gradiente horizontal (esquerda fraca → direita forte). */
function scrimRight(img, x0, maxAlpha) {
  const W = img.bitmap.width;
  const H = img.bitmap.height;
  const x1 = Math.min(W, x0 + (W - x0));
  for (let x = x0; x < x1; x++) {
    const t = (x - x0) / (x1 - x0);
    const a = Math.round(maxAlpha * t * t);
    for (let y = 0; y < H; y++) blend(img, x, y, 4, 3, 12, a);
  }
}

/** Véu vertical centrado em cx (usado atrás de blocos de texto). */
function scrimBlock(img, cx, w, y0, y1, maxAlpha) {
  const x0 = Math.max(0, Math.floor(cx - w / 2));
  const x1 = Math.min(img.bitmap.width, Math.ceil(cx + w / 2));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = Math.abs(x - cx) / (w / 2);
      const a = Math.round(maxAlpha * (1 - dx * dx));
      if (a > 0) blend(img, x, y, 4, 3, 12, a);
    }
  }
}

/** Retângulo de borda (aceita w/h negativos, como o HUD do welcome usa). */
function drawRect(img, x, y, w, h, col, a) {
  const x0 = Math.min(x, x + w);
  const x1 = Math.max(x, x + w);
  const y0 = Math.min(y, y + h);
  const y1 = Math.max(y, y + h);
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) blend(img, xx, yy, col[0], col[1], col[2], a);
  }
}

function fillCircle(img, cx, cy, r, [rr, gg, bb], a) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(img.bitmap.width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(img.bitmap.height - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) blend(img, x, y, rr, gg, bb, a);
    }
  }
}

/** Recorta o miolo (alpha 0) de um círculo — faz um anel. */
function punchHole(img, cx, cy, r) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(img.bitmap.width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(img.bitmap.height - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        const idx = img.getPixelIndex(x, y);
        img.bitmap.data[idx + 3] = 0;
      }
    }
  }
}

/** Faixa translúcida (label bar). */
function labelBar(img, x, y, w, h, a = 150) {
  blendRegion(img, x, y, w, h, a, 9, 5, 22);
}

/* ------------------------- peças de card (novas) ---------------------- */

/**
 * Avatar circular pronto para composição.
 *
 * Aceita Buffer (ou null). Faz crop central quadrado → resize → círculo.
 * Em qualquer falha devolve um círculo de cor sólida: o card nunca quebra
 * por foto inválida. NÃO faz cache — quem chama decide (ver cards/base.js).
 *
 * @param {Buffer|null} buffer foto já baixada
 * @param {number} size diâmetro final
 * @returns {Promise<object>} imagem Jimp size×size
 */
async function circleAvatar(buffer, size) {
  const s = Math.max(8, Math.floor(size || 128));
  let src = null;
  if (buffer && buffer.length) {
    try {
      src = await Jimp.read(buffer);
    } catch (_) {
      src = null;
    }
  }
  if (!src || !src.bitmap) {
    const placeholder = new Jimp(s, s, 0x2a1a4aff);
    return placeholder;
  }
  const side = Math.min(src.bitmap.width, src.bitmap.height);
  return src
    .crop(Math.floor((src.bitmap.width - side) / 2), Math.floor((src.bitmap.height - side) / 2), side, side)
    .resize(s, s)
    .circle();
}

/**
 * Barra de progresso desenhada a partir de dados reais (0..100).
 * Trilho escuro + preenchimento na cor do tema. Sem gradiente, sem textura:
 * precisa ser legível em tela de celular.
 */
function progressBar(img, x, y, w, h, pct, color = [124, 92, 255]) {
  const ratio = Math.max(0, Math.min(100, Number(pct) || 0)) / 100;
  labelBar(img, x, y, w, h, 190);
  const fillW = Math.round((w - 4) * ratio);
  if (fillW > 0) drawRect(img, x + 2, y + 2, fillW, h - 4, color, 235);
}

/**
 * Imprime texto já normalizado (acentos removidos) e truncado se preciso.
 *
 * Não há "sombra" aqui de propósito: as fontes bitmap do Jimp têm cor fixa
 * (branca), então uma sombra só sairia branca também. O contraste vem do
 * painel translúcido (labelBar/scrim) que o chamador desenha atrás.
 *
 * @returns {string} o texto que foi de fato desenhado (útil em testes)
 */
function text(img, font, str, x, y, { maxWidth = 0 } = {}) {
  const raw = clean(str);
  const final = maxWidth > 0 ? fit(font, raw, maxWidth) : raw;
  if (final) img.print(font, x, y, final);
  return final;
}

/**
 * Gradiente vertical escrito direto no buffer de pixels.
 *
 * De propósito NÃO passa por `blend()` (uma chamada por pixel): com 960x540
 * isso custaria ~500 mil chamadas. Escrever os bytes em linha torna o fundo
 * barato o suficiente para ser regenerado a cada render — ou seja, não
 * precisa de cache de background (e portanto não vaza memória).
 */
function verticalGradient(img, top, bottom) {
  const { width: w, height: h, data } = img.bitmap;
  for (let y = 0; y < h; y++) {
    const t = h === 1 ? 0 : y / (h - 1);
    const r = Math.round(top[0] + (bottom[0] - top[0]) * t);
    const g = Math.round(top[1] + (bottom[1] - top[1]) * t);
    const b = Math.round(top[2] + (bottom[2] - top[2]) * t);
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
}

module.exports = {
  FONTS,
  clean,
  fit,
  loadFont,
  fontCacheSize,
  MAX_FONTS,
  rgba,
  blend,
  blendRegion,
  scrim,
  scrimRight,
  scrimBlock,
  drawRect,
  fillCircle,
  punchHole,
  labelBar,
  circleAvatar,
  progressBar,
  text,
  verticalGradient,
};
