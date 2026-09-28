'use strict';

const CONFIG = require('../config');

const SUPPORT_NAME = 'Lua • Suporte';

function supportNumber() {
  return String(CONFIG.support && CONFIG.support.number || '').replace(/\D/g, '');
}

function supportVcard() {
  const number = supportNumber();
  if (!number) throw new Error('SUPPORT_NUMBER não configurado');
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${SUPPORT_NAME}`,
    `N:Suporte;Lua;;;`,
    `TEL;TYPE=CELL;waid=${number}:+${number}`,
    'END:VCARD',
  ].join('\n');
}

/** Envia somente o contato nativo; não inicia conversa nem copia dados. */
async function sendSupportContact(sock, jid, options = {}) {
  if (!sock || typeof sock.sendMessage !== 'function') throw new TypeError('socket inválido');
  const number = supportNumber();
  if (!number) throw new Error('SUPPORT_NUMBER não configurado');
  return sock.sendMessage(jid, {
    contacts: {
      displayName: SUPPORT_NAME,
      contacts: [{ vcard: supportVcard() }],
    },
  }, options);
}

module.exports = { SUPPORT_NAME, supportNumber, supportVcard, sendSupportContact };
