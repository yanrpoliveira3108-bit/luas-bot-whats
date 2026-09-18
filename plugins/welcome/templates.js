/**
 * plugins/welcome/templates.js — fundos procedurais (tema roxo/lua/neon).
 *
 * Gera os 8 templates (4 welcome + 4 goodbye) e o avatar padrão UMA VEZ, com
 * Jimp puro (sem sharp, sem rede — funciona no Termux/Android). Os resultados
 * ficam cacheados em assets/welcome/, assets/goodbye/ e
 * assets/welcome/defaults/avatar.png, então a geração só acontece no primeiro
 * uso (ou se o arquivo for apagado).
 *
 * Cada template tem uma variação própria (lua crescente/cheia/holográfica/
 * gigante; minguante/encoberta/céu escuro/lua distante) mantendo a MESMA
 * identidade visual: fundo preto→roxo, estrelas, brilho neon e moldura HUD.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const CONFIG = require('./config');

const { width: W, height: H } = CONFIG.size;
const C = CONFIG.theme.colors;

/* ------------------------------ helpers ------------------------------ */

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const rgb = (hex) => hexToRgb(hex);

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function rgba(rgbArr, a) {
  return Jimp.rgbaToInt(rgbArr[0], rgbArr[1], rgbArr[2], Math.max(0, Math.min(255, Math.round(a))));
}

/** RNG determinístico por template (estrelas fixas por arquivo). */
function seededRandom(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Mistura um pixel (composição "over" com alpha). */
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

/** Disco sólido (fillCircle) com alpha. */
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

/** Glow suave (falloff radial quadrático). */
function glowDisk(img, cx, cy, r, [rr, gg, bb], maxA) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(img.bitmap.width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(img.bitmap.height - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r;
      if (d > 1) continue;
      const a = maxA * (1 - d) * (1 - d);
      if (a <= 0.5) continue;
      blend(img, x, y, rr, gg, bb, a);
    }
  }
}

/** Estrelas (pontos) com densidade e brilho configuráveis. */
function drawStars(img, rng, count, maxAlpha) {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * img.bitmap.width);
    const y = Math.floor(rng() * img.bitmap.height);
    const a = Math.floor(rng() * maxAlpha);
    const s = rng() > 0.9 ? 2 : 1; // algumas estrelas maiores
    blend(img, x, y, 255, 255, 255, a);
    if (s === 2) blend(img, x + 1, y, 255, 255, 255, Math.floor(a * 0.6));
  }
}

/** Nebulosas (manchas translúcidas de cor). */
function drawNebula(img, rng, intensity) {
  const blobs = [
    [W * 0.15, H * 0.25, 260, rgb('#5b2a86')],
    [W * 0.85, H * 0.75, 320, rgb('#3a1a6b')],
    [W * 0.6, H * 0.15, 200, rgb('#7a3bd0')],
    [W * 0.3, H * 0.85, 240, rgb('#2a1150')],
  ];
  for (const [x, y, r, col] of blobs) {
    glowDisk(img, x, y, r, col, 60 * intensity);
  }
}

/** Gradiente vertical de fundo. */
function baseGradient(dark) {
  const img = new Jimp(W, H, 0x000000ff);
  const top = rgb(dark ? C.bgTopDark : C.bgTop);
  const bot = rgb(dark ? C.bgBottomDark : C.bgBottom);
  img.scan(0, 0, W, H, (x, y, idx) => {
    const t = y / H;
    img.bitmap.data[idx] = lerp(top[0], bot[0], t);
    img.bitmap.data[idx + 1] = lerp(top[1], bot[1], t);
    img.bitmap.data[idx + 2] = lerp(top[2], bot[2], t);
    img.bitmap.data[idx + 3] = 255;
  });
  return img;
}

/** Desenha a lua conforme a fase/variante. */
function drawMoon(img, v) {
  const cx = v.moonX;
  const cy = v.moonY;
  const r = v.moonSize;

  // brilho neon ao redor
  glowDisk(img, cx, cy, r * 2.1, C.neon, 70 * (v.glow || 0.6));
  glowDisk(img, cx, cy, r * 1.5, C.neonSoft, 50 * (v.glow || 0.6));

  const phase = v.phase;

  if (phase === 'crescent' || phase === 'waning') {
    // lua cheia pálida
    fillCircle(img, cx, cy, r, C.moon, 235);
    // "mordida" para formar o crescente/minguante
    const off = r * 0.72;
    const dir = phase === 'waning' ? -1 : 1;
    biteCircle(img, cx + dir * off, cy - r * 0.25, r, v.darkBg ? C.bgBottomDark : C.bgBottom);
    return;
  }

  if (phase === 'covered') {
    fillCircle(img, cx, cy, r, C.moon, 235);
    // nuvem escura parcialmente cobrindo
    fillCircle(img, cx + r * 0.55, cy - r * 0.5, r * 0.62, rgb('#05010c'), 220);
    fillCircle(img, cx + r * 0.2, cy - r * 0.62, r * 0.45, rgb('#0a0214'), 200);
    return;
  }

  if (phase === 'holographic') {
    fillCircle(img, cx, cy, r, C.moon, 210);
    // anéis holográficos
    ringAt(img, cx, cy, r * 1.18, C.neon, 90);
    ringAt(img, cx, cy, r * 1.42, C.neon, 60);
    // linhas de scan sobre a lua
    for (let y = cy - r; y < cy + r; y += 8) {
      const half = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy)));
      for (let x = cx - half; x < cx + half; x++) blend(img, x, y, 0, 0, 0, 46);
    }
    return;
  }

  if (phase === 'distant') {
    fillCircle(img, cx, cy, r, C.moon, 220);
    glowDisk(img, cx, cy, r * 1.8, C.neon, 40);
    return;
  }

  // default: lua cheia (full / giant)
  fillCircle(img, cx, cy, r, C.moon, 240);
  fillCircle(img, cx - r * 0.3, cy - r * 0.3, r * 0.55, rgb('#d9c9f5'), 90); // relevo suave
}

/** Recorta um círculo "apagando" pixels (para o crescente). */
function biteCircle(img, cx, cy, r, bgHex) {
  const [br, bg, bb] = rgb(bgHex);
  fillCircle(img, cx, cy, r, [br, bg, bb], 255);
}

/** Anel (borda) de círculo. */
function ringAt(img, cx, cy, r, col, a) {
  fillCircle(img, cx, cy, r, col, a);
  fillCircle(img, cx, cy, r - 3, [0, 0, 0], 0); // buraco central vira o fundo
  // refaz o miolo com o fundo real (transparência não existe aqui)
  for (let y = Math.max(0, Math.floor(cy - r + 3)); y < Math.min(H, Math.ceil(cy + r - 3)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r + 3)); x < Math.min(W, Math.ceil(cx + r - 3)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= (r - 3) ** 2) blend(img, x, y, 0, 0, 0, 0); // no-op: mantém
    }
  }
}

/** Silhueta de montanhas/horizonte (welcome-02). */
function drawSilhouette(img, rng) {
  const base = H - 120;
  fillCircle(img, W * 0.2, base + 220, 320, rgb('#0d0316'), 255);
  fillCircle(img, W * 0.55, base + 260, 360, rgb('#0a0210'), 255);
  fillCircle(img, W * 0.9, base + 200, 300, rgb('#0d0316'), 255);
  // linha de horizonte
  for (let x = 0; x < W; x++) {
    const h = Math.floor(Math.sin(x / 240) * 26) + Math.floor(rng() * 4);
    for (let y = base + h; y < H; y++) blend(img, x, y, 6, 1, 12, 255);
  }
}

/** Partículas flutuantes (goodbye-04). */
function drawParticles(img, rng, count, maxA) {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * H);
    const a = Math.floor(rng() * maxA);
    blend(img, x, y, 178, 107, 255, a);
  }
}

/* --------------------------- variantes ------------------------------- */

// cada variante descreve a lua + elementos extras + céu (dark p/ goodbye)
const VARIANTS = {
  'welcome-01': { dark: false, phase: 'crescent', moonSize: 150, moonX: 970, moonY: 165, glow: 0.85, stars: 200, starA: 220, nebula: 0.25, extra: null },
  'welcome-02': { dark: false, phase: 'full', moonSize: 165, moonX: 1010, moonY: 175, glow: 0.9, stars: 130, starA: 200, nebula: 0.3, extra: 'silhouette' },
  'welcome-03': { dark: false, phase: 'holographic', moonSize: 150, moonX: 950, moonY: 170, glow: 0.8, stars: 150, starA: 190, nebula: 0.3, extra: 'hud' },
  'welcome-04': { dark: false, phase: 'giant', moonSize: 300, moonX: 900, moonY: 190, glow: 0.9, stars: 90, starA: 180, nebula: 0.65, extra: 'nebula' },

  'goodbye-01': { dark: true, phase: 'waning', moonSize: 140, moonX: 980, moonY: 170, glow: 0.5, stars: 140, starA: 160, nebula: 0.15, extra: null },
  'goodbye-02': { dark: true, phase: 'covered', moonSize: 160, moonX: 1000, moonY: 180, glow: 0.5, stars: 110, starA: 150, nebula: 0.2, extra: null },
  'goodbye-03': { dark: true, phase: 'full', moonSize: 140, moonX: 990, moonY: 175, glow: 0.35, stars: 60, starA: 120, nebula: 0.1, extra: null },
  'goodbye-04': { dark: true, phase: 'distant', moonSize: 85, moonX: 1120, moonY: 120, glow: 0.45, stars: 80, starA: 140, nebula: 0.18, extra: 'particles' },
};

/** Gera o fundo de um template. */
function generateBackground(templateId) {
  const v = VARIANTS[templateId] || VARIANTS['welcome-01'];
  const img = baseGradient(v.dark);
  const rng = seededRandom(templateId);

  if (v.nebula > 0) drawNebula(img, rng, v.nebula);
  drawStars(img, rng, v.stars, v.starA);
  drawMoon(img, Object.assign({}, v, { darkBg: v.dark }));

  if (v.extra === 'silhouette') drawSilhouette(img, rng);
  else if (v.extra === 'hud') {
    gridLines(img, C.neon, 20);
    cornerBrackets(img, C.neon);
  } else if (v.extra === 'nebula') {
    drawNebula(img, rng, 0.5);
  } else if (v.extra === 'particles') {
    drawParticles(img, rng, 90, 140);
  }

  // vinheta sutil (cantos mais escuros) para profundidade
  vignette(img);

  return img;
}

/** Linhas de grade (HUD) suaves. */
function gridLines(img, col, a) {
  for (let x = 0; x < W; x += 120) {
    for (let y = 0; y < H; y++) blend(img, x, y, col[0], col[1], col[2], a * 0.25);
  }
  for (let y = 0; y < H; y += 120) {
    for (let x = 0; x < W; x++) blend(img, x, y, col[0], col[1], col[2], a * 0.25);
  }
}

/** Colchetes de HUD nos 4 cantos. */
function cornerBrackets(img, col) {
  const m = 40;
  const L = 70;
  const t = 5;
  const pts = [
    [m, m], [W - m, m], [m, H - m], [W - m, H - m],
  ];
  for (const [px, py] of pts) {
    const sx = px > W / 2 ? -1 : 1;
    const sy = py > H / 2 ? -1 : 1;
    // cantos
    drawRect(img, px, py, L * sx, t * sy, col, 220);
    drawRect(img, px, py, t * sx, L * sy, col, 220);
  }
}

/** Retângulo preenchido (borda de HUD). */
function drawRect(img, x, y, w, h, col, a) {
  const x0 = Math.min(x, x + w);
  const x1 = Math.max(x, x + w);
  const y0 = Math.min(y, y + h);
  const y1 = Math.max(y, y + h);
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) blend(img, xx, yy, col[0], col[1], col[2], a);
  }
}

/** Vinheta radial. */
function vignette(img) {
  const cx = W / 2;
  const cy = H / 2;
  const maxD = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < H; y += 3) {
    for (let x = 0; x < W; x += 3) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxD;
      const a = Math.max(0, (d - 0.55) / 0.45) * 120;
      if (a > 0) blend(img, x, y, 0, 0, 0, a);
    }
  }
}

/* -------------------------- avatar padrão ---------------------------- */

/** Avatar padrão do LUA BOT (lua em disco roxo). */
function generateAvatar() {
  const S = 512;
  const img = new Jimp(S, S, 0x000000ff);
  // fundo roxo degradê
  img.scan(0, 0, S, S, (x, y, idx) => {
    const t = y / S;
    img.bitmap.data[idx] = lerp(10, 26, t);
    img.bitmap.data[idx + 1] = lerp(1, 6, t);
    img.bitmap.data[idx + 2] = lerp(24, 56, t);
    img.bitmap.data[idx + 3] = 255;
  });
  glowDisk(img, S / 2, S / 2, 200, C.neon, 90);
  fillCircle(img, S / 2, S / 2, 130, C.moon, 235);
  // crescente (mordida)
  fillCircle(img, S / 2 + 95, S / 2 - 35, 130, [26, 6, 56], 255);
  // estrelinhas
  const rng = seededRandom('avatar');
  for (let i = 0; i < 40; i++) {
    blend(img, Math.floor(rng() * S), Math.floor(rng() * S), 255, 255, 255, Math.floor(rng() * 200));
  }
  return img;
}

/* ------------------------- cache / API pública ----------------------- */

function fileFor(templateId) {
  const dir = templateId.startsWith('goodbye') ? CONFIG.paths.goodbyeDir : CONFIG.paths.welcomeDir;
  return path.join(dir, `${templateId}.png`);
}

function avatarFile() {
  return path.join(CONFIG.paths.defaultsDir, 'avatar.png');
}

function ensureDirs() {
  for (const d of [CONFIG.paths.welcomeDir, CONFIG.paths.goodbyeDir, CONFIG.paths.defaultsDir]) {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch (_) {
      /* ignora */
    }
  }
}

/**
 * Cache das artes-base decodificadas.
 *
 * Cada bitmap 1280x720 RGBA ocupa 3,52 MB em RAM (medido), e os templates
 * rotacionam/aleatorizam (database/welcome.nextTemplate) — ou seja, sem limite
 * o processo acaba retendo os 8 templates + avatar = ~29 MB de bitmaps
 * (o RSS medido subiu 78 MB -> 170 MB ao carregar todos). Por isso o cache e
 * LRU com teto pequeno: o caso comum (o grupo repete o mesmo template) continua
 * servido em ~0,7 ms, e o pior caso fica em BASE_CACHE_MAX artes.
 */
const BASE_CACHE_MAX = 2;
const baseCache = new Map(); // templateId -> Jimp (LRU: mais recente no fim)

/** Avatar tem slot proprio: e um unico asset e nao pode ser expulso pelos templates. */
let avatarBase = null;

function cacheBase(templateId, img) {
  if (baseCache.has(templateId)) baseCache.delete(templateId);
  baseCache.set(templateId, img);
  while (baseCache.size > BASE_CACHE_MAX) {
    baseCache.delete(baseCache.keys().next().value); // remove o mais antigo
  }
  return img;
}

/** Redimensiona com "cover" (preenche 1280×720, cortando o excesso). */
function cover(img, w, h) {
  const iw = img.bitmap.width;
  const ih = img.bitmap.height;
  const scale = Math.max(w / iw, h / ih);
  const nw = Math.round(iw * scale);
  const nh = Math.round(ih * scale);
  return img
    .resize(nw, nh)
    .crop(Math.floor((nw - w) / 2), Math.floor((nh - h) / 2), w, h);
}

/** Garante que o template existe no disco e retorna uma cópia (Jimp). */
async function load(templateId) {
  ensureDirs();
  let img = baseCache.get(templateId);
  if (!img) {
    const file = fileFor(templateId);
    try {
      // arte real (gerada no estilo da referência) — cover-crop para 1280×720
      const art = await Jimp.read(file);
      img = cover(art, W, H);
    } catch (_) {
      // fallback procedural SOMENTE se o asset não existir (Termux sem o zip)
      img = generateBackground(templateId);
      await img.writeAsync(file);
    }
    cacheBase(templateId, img);
  }
  return img.clone();
}

/** Avatar padrão (Buffer PNG), gerado/cacheado no disco. */
async function ensureAvatar() {
  ensureDirs();
  const file = avatarFile();
  let img = avatarBase;
  if (!img) {
    try {
      img = await Jimp.read(file);
    } catch (_) {
      img = generateAvatar();
      await img.writeAsync(file);
    }
    avatarBase = img;
  }
  return img.getBufferAsync(Jimp.MIME_PNG);
}

/** Pré-gera todos os templates (para enviar os assets prontos no zip). */
async function pregenerateAll() {
  ensureDirs();
  const ids = [...CONFIG.templates.welcome, ...CONFIG.templates.goodbye];
  for (const id of ids) {
    const file = fileFor(id);
    if (!fs.existsSync(file)) {
      await generateBackground(id).writeAsync(file);
    }
  }
  if (!fs.existsSync(avatarFile())) {
    await generateAvatar().writeAsync(avatarFile());
  }
}

/** Tamanho do cache de bases e do teto (para testes de memoria). */
function baseCacheSize() {
  return baseCache.size;
}

module.exports = {
  load,
  ensureAvatar,
  pregenerateAll,
  generateBackground,
  generateAvatar,
  baseCacheSize,
  BASE_CACHE_MAX,
};
