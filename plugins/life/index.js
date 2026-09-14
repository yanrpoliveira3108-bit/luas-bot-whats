/**
 * plugins/life/index.js — API pública do Lua Life.
 *
 * Os comandos (commands/life/*) e os menus importam daqui — nunca chamam o
 * banco diretamente. Mantém a separação: database/life.js (persistência),
 * plugins/life/* (regras de negócio), commands/life/* (interface WhatsApp).
 */

'use strict';

const config = require('./config');
const leveling = require('./leveling');
const market = require('./market');
const weather = require('./weather');
const networth = require('./networth');
const engine = require('./engine');
const life = require('../../database/life');

module.exports = {
  config,
  leveling,
  market,
  weather,
  networth,
  engine,
  db: life,
};
