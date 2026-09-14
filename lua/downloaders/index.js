/**
 * downloaders/index.js — registro dos provedores de download.
 *
 * Cada provedor é um módulo separado; adicionar um novo downloader é
 * criar um arquivo aqui e usá-lo nos comandos de downloads/.
 */

'use strict';

module.exports = {
  youtube: require('./youtube'),
  tiktok: require('./tiktok'),
  instagram: require('./instagram'),
  facebook: require('./facebook'),
  pinterest: require('./pinterest'),
  twitter: require('./twitter'),
  reddit: require('./reddit'),
  router: require('./router'),
};
