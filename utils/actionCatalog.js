/**
 * utils/actionCatalog.js — Catálogo de mídias para comandos de interação.
 *
 * Suporta múltiplos itens (GIFs animados e imagens estáticas) por ação,
 * seleção com anti-repetição imediata, metadados de atribuição/origem
 * e fallback para imagens únicas em `assets/actions/<chave>.<ext>`.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ACTIONS_DIR = path.join(__dirname, '..', 'assets', 'actions');
const MEDIA_DIR = path.join(ACTIONS_DIR, 'media');

/**
 * Registro estruturado do catálogo com as mídias selecionadas (expressivas, anime e memes).
 * Cada ação principal possui no mínimo 3 animações e 2 imagens estáticas.
 */
const CATALOG_DEFINITIONS = {
  beijo: [
    { file: 'media/beijo/beijo_01.gif', type: 'gif', source: 'Aniyuki (Anime Romantic Kiss)' },
    { file: 'media/beijo/beijo_02.gif', type: 'gif', source: 'GifDB (Deep Kiss Romantic Love)' },
    { file: 'media/beijo/beijo_03.gif', type: 'gif', source: 'GifDB (Passionate Anime Kiss)' },
    { file: 'media/beijo/beijo_04.jpg', type: 'image', source: 'WallpaperCave (Romantic Passionate Kiss Fanart)' },
    { file: 'media/beijo/beijo_05.jpg', type: 'image', source: 'Backiee (Anime Kiss Wallpaper)' },
  ],
  sirrica: [
    { file: 'media/sirrica/sirrica_01.gif', type: 'gif', source: 'UsaGif (Anime Flustered Blush Reaction)' },
    { file: 'media/sirrica/sirrica_02.gif', type: 'gif', source: 'UsaGif (Anime Blushing Hands on Cheeks)' },
    { file: 'media/sirrica/sirrica_03.gif', type: 'gif', source: 'GifDB (Anime Flustered Meme Reaction)' },
    { file: 'media/sirrica/sirrica_04.jpg', type: 'image', source: 'Reddit Animemebank (Blushing Steam Panel)' },
    { file: 'media/sirrica/sirrica_05.jpg', type: 'image', source: 'Pinterest (Anime Shy Nervous Manga Face)' },
  ],
  siririca: [
    // Alias de sirrica
    { file: 'media/sirrica/sirrica_01.gif', type: 'gif', source: 'UsaGif (Anime Flustered Blush Reaction)' },
    { file: 'media/sirrica/sirrica_02.gif', type: 'gif', source: 'UsaGif (Anime Blushing Hands on Cheeks)' },
    { file: 'media/sirrica/sirrica_03.gif', type: 'gif', source: 'GifDB (Anime Flustered Meme Reaction)' },
    { file: 'media/sirrica/sirrica_04.jpg', type: 'image', source: 'Reddit Animemebank (Blushing Steam Panel)' },
    { file: 'media/sirrica/sirrica_05.jpg', type: 'image', source: 'Pinterest (Anime Shy Nervous Manga Face)' },
  ],
  bater: [
    { file: 'media/bater/bater_01.gif', type: 'gif', source: 'GifDB (Tsukimichi Anime Slap)' },
    { file: 'media/bater/bater_02.gif', type: 'gif', source: 'GifDB (Funny Anime Slap)' },
    { file: 'media/bater/bater_03.gif', type: 'gif', source: 'Tenor (Action Anime Slap Scene)' },
    { file: 'media/bater/bater_04.jpg', type: 'image', source: 'Imgflip (Batman Slapping Robin Meme)' },
    { file: 'media/bater/bater_05.jpg', type: 'image', source: 'Pinterest (Anime Slap Brain Rot Meme)' },
  ],
  tapa: [
    // Alias de bater
    { file: 'media/bater/bater_01.gif', type: 'gif', source: 'GifDB (Tsukimichi Anime Slap)' },
    { file: 'media/bater/bater_02.gif', type: 'gif', source: 'GifDB (Funny Anime Slap)' },
    { file: 'media/bater/bater_03.gif', type: 'gif', source: 'Tenor (Action Anime Slap Scene)' },
    { file: 'media/bater/bater_04.jpg', type: 'image', source: 'Imgflip (Batman Slapping Robin Meme)' },
    { file: 'media/bater/bater_05.jpg', type: 'image', source: 'Pinterest (Anime Slap Brain Rot Meme)' },
  ],
  gado: [
    { file: 'media/gado/gado_01.gif', type: 'gif', source: 'GifDB (Anime Heart Eyes Infatuation)' },
    { file: 'media/gado/gado_02.gif', type: 'gif', source: 'Tenor (Drooling Anime Heart Eyes)' },
    { file: 'media/gado/gado_03.gif', type: 'gif', source: 'GifDB (Pointing Simp Meme)' },
    { file: 'media/gado/gado_04.jpg', type: 'image', source: 'Memedroid (Gado Demais Vaca Meme 1)' },
    { file: 'media/gado/gado_05.jpg', type: 'image', source: 'Memedroid (Gado Demais Vaca Meme 2)' },
  ],
  abraco: [
    { file: 'media/abraco/abraco_01.gif', type: 'gif', source: 'GifDB (Spice and Wolf Anime Hug)' },
    { file: 'media/abraco/abraco_02.gif', type: 'gif', source: 'GifDB (Anime Emotional Tight Hug)' },
    { file: 'media/abraco/abraco_03.gif', type: 'gif', source: 'GifDB (Anime Sad Comfort Hug)' },
    { file: 'media/abraco/abraco_04.jpg', type: 'image', source: 'Wallpapers.com (Dramatic Aesthetic Hug)' },
    { file: 'media/abraco/abraco_05.jpg', type: 'image', source: 'Peakpx (Romantic Anime Embrace Wallpaper)' },
  ],
  tapinha: [
    { file: 'media/tapinha/tapinha_01.gif', type: 'gif', source: 'GifDB (Umaru Head Pat GIF)' },
    { file: 'media/tapinha/tapinha_02.gif', type: 'gif', source: 'GifDB (Edens Zero Anime Rebecca Pat)' },
    { file: 'media/tapinha/tapinha_03.gif', type: 'gif', source: 'GifDB (Cute Anime Emotional Headpat)' },
    { file: 'media/tapinha/tapinha_04.jpg', type: 'image', source: 'Wallpapers.com (Affectionate Head Pat Anime)' },
    { file: 'media/tapinha/tapinha_05.jpg', type: 'image', source: 'Pinterest (Anime Caring Headpat)' },
  ],
  cafune: [
    { file: 'media/cafune/cafune_01.gif', type: 'gif', source: 'GifDB (Umaru Head Pat GIF)' },
    { file: 'media/cafune/cafune_02.gif', type: 'gif', source: 'GifDB (Hitori Bocchi Comfort Pat)' },
    { file: 'media/cafune/cafune_03.gif', type: 'gif', source: 'GifDB (Cute Anime Emotional Headpat)' },
    { file: 'media/cafune/cafune_04.jpg', type: 'image', source: 'Wallpapers.com (Affectionate Head Pat Anime)' },
    { file: 'media/cafune/cafune_05.jpg', type: 'image', source: 'Pinterest (Anime Caring Headpat)' },
  ],
  zoar: [
    { file: 'media/zoar/zoar_01.gif', type: 'gif', source: 'Tenor (Anime Point and Laugh)' },
    { file: 'media/zoar/zoar_02.gif', type: 'gif', source: 'GifDB (Joshiraku Laughing GIF)' },
    { file: 'media/zoar/zoar_03.gif', type: 'gif', source: 'GifDB (Anime Laughing Pointing Meme)' },
    { file: 'media/zoar/zoar_04.jpg', type: 'image', source: 'Pinterest (Smug Laughing Face Anime)' },
    { file: 'media/zoar/zoar_05.jpg', type: 'image', source: 'Reddit (Risada Debochada Meme)' },
  ],
};

// Histórico de última mídia enviada por ação para anti-repetição imediata
const lastPickedMap = new Map();

function normalizeKey(key) {
  if (!key) return '';
  return String(key)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
}

/**
 * Retorna todos os itens disponíveis para uma ação.
 * Valida a existência física no disco.
 */
function getItems(actionKey) {
  const norm = normalizeKey(actionKey);
  const defs = CATALOG_DEFINITIONS[norm];
  const items = [];

  if (Array.isArray(defs)) {
    for (const d of defs) {
      const full = path.join(ACTIONS_DIR, d.file);
      if (fs.existsSync(full)) {
        items.push({
          path: full,
          type: d.type,
          source: d.source,
        });
      }
    }
  }

  // Fallback: se não tiver ou estiver vazio, checa se tem assets/actions/<norm>.<ext>
  if (items.length === 0) {
    for (const ext of ['.gif', '.jpg', '.jpeg', '.png', '.webp', '.mp4']) {
      const p = path.join(ACTIONS_DIR, norm + ext);
      if (fs.existsSync(p)) {
        const type = ext === '.gif' || ext === '.mp4' ? 'gif' : 'image';
        items.push({
          path: p,
          type,
          source: 'Default single asset',
        });
        break;
      }
    }
  }

  return items;
}

/**
 * Sorteia uma mídia para a ação dada garantindo anti-repetição imediata
 * (quando houver mais de 1 opção disponível).
 */
function pickMedia(actionKey) {
  const norm = normalizeKey(actionKey);
  const items = getItems(norm);
  if (!items || items.length === 0) return null;
  if (items.length === 1) return items[0];

  const lastPath = lastPickedMap.get(norm);
  const pool = items.filter((it) => it.path !== lastPath);
  const chosen = pool[Math.floor(Math.random() * pool.length)] || items[0];
  lastPickedMap.set(norm, chosen.path);
  return chosen;
}

module.exports = {
  CATALOG_DEFINITIONS,
  getItems,
  pickMedia,
  normalizeKey,
};
