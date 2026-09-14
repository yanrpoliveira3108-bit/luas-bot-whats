/**
 * anime/providers/jikan.js — adaptador da API pública Jikan (MyAnimeList).
 *
 * - API pública e gratuita, sem chave
 * - limite de requisições respeitado (~3/s)
 * - erros tratados como NO_RESULT
 *
 * Trocar o provedor futuramente = criar outro arquivo em anime/providers/
 * com a MESMA interface e apontar os comandos para ele.
 */

'use strict';

const CONFIG = require('../../config');
const logger = require('../../utils/logger').child('jikan');

const BASE = CONFIG.external.jikan;
let lastRequestAt = 0;

async function request(path) {
  // respeita o rate limit (~3 req/s)
  const wait = lastRequestAt + 400 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(BASE + path, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (res.status === 404) {
      const e = new Error('Não encontrado');
      e.code = 'NO_RESULT';
      throw e;
    }
    if (res.status === 429) {
      const e = new Error('Limite de requisições da API atingido. Tente novamente em instantes.');
      e.code = 'NO_RESULT';
      throw e;
    }
    if (!res.ok) {
      const e = new Error('API indisponível (HTTP ' + res.status + ')');
      e.code = 'NO_RESULT';
      throw e;
    }
    return await res.json();
  } catch (err) {
    if (err.code === 'NO_RESULT') throw err;
    const e = new Error('Falha ao consultar a API de animes.');
    e.code = 'NO_RESULT';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function mapAnime(a) {
  return {
    id: a.mal_id,
    title: a.title || a.title_english || '',
    titleEn: a.title_english || '',
    score: a.score,
    year: a.year,
    episodes: a.episodes,
    status: a.status,
    synopsis: a.synopsis || '',
    image: (a.images && a.images.jpg && a.images.jpg.image_url) || '',
    url: a.url || '',
  };
}

function mapCharacter(c) {
  return {
    id: c.mal_id,
    name: c.name || '',
    about: c.about || '',
    image: (c.images && c.images.jpg && c.images.jpg.image_url) || '',
    url: c.url || '',
  };
}

async function searchAnime(q, limit = 5) {
  const json = await request(`/anime?q=${encodeURIComponent(q)}&limit=${limit}&sfw=true`);
  return ((json && json.data) || []).map(mapAnime);
}

async function searchManga(q, limit = 5) {
  const json = await request(`/manga?q=${encodeURIComponent(q)}&limit=${limit}&sfw=true`);
  return ((json && json.data) || []).map((a) => mapAnime(a));
}

async function searchCharacter(q, limit = 5) {
  const json = await request(`/characters?q=${encodeURIComponent(q)}&limit=${limit}&sfw=true`);
  return ((json && json.data) || []).map(mapCharacter);
}

async function getAnimeById(id) {
  const json = await request(`/anime/${encodeURIComponent(id)}`);
  return mapAnime(json && json.data);
}

async function randomAnime() {
  const json = await request('/random/anime');
  return mapAnime(json && json.data);
}

/** Personagem aleatório (Jikan não expõe gênero — documentado). */
async function randomCharacter(attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const json = await request('/random/characters');
    const c = json && json.data;
    if (c && c.name && c.images) return mapCharacter(c);
  }
  const e = new Error('Nenhum personagem encontrado.');
  e.code = 'NO_RESULT';
  throw e;
}

module.exports = {
  searchAnime,
  searchManga,
  searchCharacter,
  getAnimeById,
  randomAnime,
  randomCharacter,
};
