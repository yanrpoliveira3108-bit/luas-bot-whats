/**
 * plugins/welcome/renderer.js — composição final da card.
 *
 * template (arte real) + foto + nome + número + grupo + membros + fake ID +
 * data + hora = imagem final (JPEG 1280×720).
 *
 * Usa apenas Jimp (bitmap fonts embutidas, sem rede). Sobre a arte são
 * aplicados "scrims" (véus escuros translúcidos) e barras para o texto ficar
 * legível e premium, mantendo a arte visível.
 */

'use strict';

const Jimp = require('jimp');
const templates = require('./templates');
const CONFIG = require('./config');

const { width: W, height: H } = CONFIG.size;
const C = CONFIG.theme.colors;

/** Remove acentos (fontes bitmap do Jimp não têm glifos acentuados). */
function clean(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7EÀ-ÿ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

function rgba(arr, a) {
  return Jimp.rgbaToInt(arr[0], arr[1], arr[2], Math.max(0, Math.min(255, Math.round(a))));
}

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

/** Trunca com "…" até caber em maxWidth (na fonte dada). */
function fit(font, text, maxWidth) {
  let t = text;
  while (t.length > 1 && Jimp.measureText(font, t) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t.length < text.length ? t.slice(0, -1) + '…' : t;
}

async function loadFont(name) {
  return Jimp.loadFont(Jimp[name]);
}

/* ------------------------------ scrims ------------------------------ */

/** Véu uniforme escuro (uniformiza e melhora contraste). */
function scrim(img, alpha) {
  blendRegion(img, 0, 0, W, H, alpha);
}

function blendRegion(img, x0, y0, w, h, alpha, r = 4, g = 3, b = 12) {
  const x1 = Math.min(W, x0 + w);
  const y1 = Math.min(H, y0 + h);
  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let x = Math.max(0, x0); x < x1; x++) {
      blend(img, x, y, r, g, b, alpha);
    }
  }
}

/** Gradiente horizontal (esquerda fraca → direita forte) — coluna de dados. */
function scrimRight(img, x0, maxAlpha) {
  const x1 = Math.min(W, x0 + (W - x0));
  for (let x = x0; x < x1; x++) {
    const t = (x - x0) / (x1 - x0);
    const a = Math.round(maxAlpha * t * t);
    for (let y = 0; y < H; y++) blend(img, x, y, 4, 3, 12, a);
  }
}

/** Véu vertical atrás do bloco de identidade (nome/número/chip). */
function scrimBlock(img, cx, w, y0, y1, maxAlpha) {
  const x0 = Math.max(0, Math.floor(cx - w / 2));
  const x1 = Math.min(W, Math.ceil(cx + w / 2));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = Math.abs(x - cx) / (w / 2);
      const a = Math.round(maxAlpha * (1 - dx * dx));
      if (a > 0) blend(img, x, y, 4, 3, 12, a);
    }
  }
}

/* ------------------------------ HUD ---------------------------------- */

function drawRect(img, x, y, w, h, col, a) {
  const x0 = Math.min(x, x + w);
  const x1 = Math.max(x, x + w);
  const y0 = Math.min(y, y + h);
  const y1 = Math.max(y, y + h);
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) blend(img, xx, yy, col[0], col[1], col[2], a);
  }
}

/** Moldura HUD (bordas neon + colchetes + scanlines). */
function drawHud(img) {
  const [r, g, b] = C.neon;
  // borda externa dupla
  for (let i = 0; i < 2; i++) {
    const o = 22 + i * 3;
    drawRect(img, o, o, 1, H - o * 2, [r, g, b], 150 + i * 60);
    drawRect(img, W - o - 1, o, 1, H - o * 2, [r, g, b], 150 + i * 60);
    drawRect(img, o, o, W - o * 2, 1, [r, g, b], 150 + i * 60);
    drawRect(img, o, H - o - 1, W - o * 2, 1, [r, g, b], 150 + i * 60);
  }
  // colchetes de canto
  const m = 30;
  const L = 84;
  const t = 6;
  for (const [px, py] of [[m, m], [W - m, m], [m, H - m], [W - m, H - m]]) {
    const sx = px > W / 2 ? -1 : 1;
    const sy = py > H / 2 ? -1 : 1;
    drawRect(img, px, py, L * sx, t * sy, [r, g, b], 235);
    drawRect(img, px, py, t * sx, L * sy, [r, g, b], 235);
  }
  // scanlines sutis
  for (let y = 0; y < H; y += 4) {
    for (let x = 0; x < W; x += 4) blend(img, x, y, 0, 0, 0, 12);
  }
}

/* ------------------------------ foto --------------------------------- */

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

/** Foto: crop central quadrado → círculo, anel neon duplo + glow + sombra. */
async function compositePhoto(card, photoBuffer) {
  let src;
  try {
    src = await Jimp.read(photoBuffer);
  } catch (_) {
    src = new Jimp(CONFIG.photo.size, CONFIG.photo.size, 0x1a0638ff);
  }

  const s = Math.min(src.bitmap.width, src.bitmap.height);
  src = src
    .crop(Math.floor((src.bitmap.width - s) / 2), Math.floor((src.bitmap.height - s) / 2), s, s)
    .resize(CONFIG.photo.size, CONFIG.photo.size);

  const px = CONFIG.photo.x;
  const py = CONFIG.photo.y;
  const ring = CONFIG.photo.ring;
  const half = ring / 2;

  // sombra atrás da foto
  const shadow = new Jimp(ring + 20, ring + 20, 0x00000000);
  fillCircle(shadow, (ring + 20) / 2 + 4, (ring + 20) / 2 + 6, half - 2, [0, 0, 0], 150);
  card.composite(shadow, px - (ring + 20) / 2, py - (ring + 20) / 2);

  // glow neon externo
  const glow = new Jimp(ring + 70, ring + 70, 0x00000000);
  fillCircle(glow, (ring + 70) / 2, (ring + 70) / 2, (ring + 70) / 2 - 6, C.neon, 46);
  card.composite(glow, px - (ring + 70) / 2, py - (ring + 70) / 2);

  // anel externo (grosso) + anel interno (fino)
  const ringImg = new Jimp(ring, ring, 0x00000000);
  fillCircle(ringImg, half, half, half - 2, C.neon, 235);
  punchHole(ringImg, half, half, half - 8);
  fillCircle(ringImg, half, half, half - 14, C.neonSoft, 190);
  punchHole(ringImg, half, half, half - 16);
  card.composite(ringImg, px - half, py - half);

  // foto circular
  src.circle();
  card.composite(src, px - CONFIG.photo.size / 2, py - CONFIG.photo.size / 2);
}

/* ------------------------------ textos ------------------------------- */

/** Faixa translúcida (label bar). */
function labelBar(img, x, y, w, h, a = 150) {
  blendRegion(img, x, y, w, h, a, 9, 5, 22);
}

async function drawInfo(card, data) {
  const [fTitle, fSub, fName, fValue, fLabel, fBrand, fSmall] = await Promise.all([
    loadFont(CONFIG.fonts.title),
    loadFont(CONFIG.fonts.subtitle),
    loadFont(CONFIG.fonts.name),
    loadFont(CONFIG.fonts.value),
    loadFont(CONFIG.fonts.label),
    loadFont(CONFIG.fonts.brand),
    loadFont(CONFIG.fonts.small),
  ]);

  const label = CONFIG.labels[data.kind] || CONFIG.labels.welcome;

  /* ---- coluna esquerda (foto + identidade) ---- */
  const cx = CONFIG.photo.x;
  const nameTop = CONFIG.photo.y + CONFIG.photo.size / 2 + 26;
  let y = nameTop;

  // véu atrás do bloco de identidade
  scrimBlock(card, cx, 470, nameTop - 14, nameTop + 190, 110);

  // nome
  const name = fit(fName, clean(data.name || 'Membro').toUpperCase(), 430);
  card.print(fName, cx - Jimp.measureText(fName, name) / 2, y, name);
  y += 78;

  // sublinha neon fina
  drawRect(card, cx - 70, y - 8, 140, 2, C.neon, 200);
  y += 16;

  // número (PN — dígitos)
  const number = clean(data.number || '');
  if (number) {
    card.print(fValue, cx - Jimp.measureText(fValue, number) / 2, y, number);
    y += 48;
  }

  // chip do fake ID
  const chip = clean(data.fakeId || 'LUA-000000');
  const chipW = Jimp.measureText(fValue, chip) + 44;
  labelBar(card, cx - chipW / 2, y, chipW, 46, 175);
  card.print(fValue, cx - Jimp.measureText(fValue, chip) / 2, y + 8, chip);
  y += 64;

  // data + hora pequenas
  const dh = clean(`${data.date}  ·  ${data.time}`);
  card.print(fSmall, cx - Jimp.measureText(fSmall, dh) / 2, y, dh);

  /* ---- coluna direita (evento + dados) ---- */
  const rx = 560;

  // título
  labelBar(card, rx - 20, 62, 560, 92, 185);
  card.print(fTitle, rx, 78, label.title);
  // traço neon sob o título
  drawRect(card, rx, 154, 210, 2, C.neon, 220);

  // subtítulo
  labelBar(card, rx - 20, 172, 350, 54, 165);
  card.print(fSub, rx, 184, label.subtitle);

  // linhas de dados
  const rows = [
    ['MEMBROS', clean(String(data.members || '—'))],
    ['GRUPO', fit(fValue, clean(data.group || '—'), 620)],
    ['DATA', clean(data.date)],
    ['HORA', clean(data.time)],
  ];
  let ry = 272;
  for (const [lab, val] of rows) {
    labelBar(card, rx - 20, ry, 640, 76, 160);
    card.print(fLabel, rx, ry + 9, lab);
    card.print(fValue, rx, ry + 33, val);
    ry += 92;
  }

  /* ---- rodapé: marca ---- */
  labelBar(card, 40, H - 80, W - 80, 46, 185);
  const brand = `${CONFIG.theme.botName}  •  ${clean(data.fakeId || '')}`;
  card.print(fSmall, 62, H - 68, fit(fSmall, brand.toUpperCase(), W - 150));
}

/** Renderiza a card completa e devolve o Buffer JPEG. */
async function renderCard(data) {
  const img = await templates.load(data.templateId);
  // véus para unificar e dar contraste (arte permanece visível)
  scrim(img, 16);
  scrimRight(img, 470, 74);
  drawHud(img);
  await compositePhoto(img, data.photoBuffer);
  await drawInfo(img, data);
  return img.getBufferAsync(Jimp.MIME_JPEG, { quality: 92 });
}

module.exports = { renderCard, clean };
