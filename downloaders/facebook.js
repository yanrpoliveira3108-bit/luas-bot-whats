/**
 * downloaders/facebook.js — download de mídia pública do Facebook.
 *
 * Adapter fino sobre social.js (extração Open Graph, sem chave de API).
 */

'use strict';

const social = require('./social');

async function download(url, suggestedName) {
  return social.downloadMedia(url, suggestedName || 'facebook');
}

module.exports = { download };
