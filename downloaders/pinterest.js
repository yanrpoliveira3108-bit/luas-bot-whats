/**
 * downloaders/pinterest.js — download de imagens públicas do Pinterest.
 *
 * Adapter fino sobre social.js (extração Open Graph, sem chave de API).
 * Pins privados ou bloqueios resultam em erro amigável.
 */

'use strict';

const social = require('./social');

async function download(url, suggestedName) {
  return social.downloadMedia(url, suggestedName || 'pinterest');
}

module.exports = { download };
