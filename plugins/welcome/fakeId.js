/**
 * plugins/welcome/fakeId.js — identificador FICTÍCIO apenas para a card.
 *
 * NÃO é ID real do WhatsApp, NÃO expõe LID, NÃO expõe JID interno. É um
 * rótulo visual no formato LUA-XXXXXX (letras/números), gerado por evento.
 */

'use strict';

// sem caracteres ambíguos (0/O, 1/I/l) para leitura fácil
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateFakeId() {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return `LUA-${out}`;
}

module.exports = { generateFakeId };
