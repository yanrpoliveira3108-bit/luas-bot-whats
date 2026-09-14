/**
 * connection/pairing.js — geração e controle do pairing code (sem QR Code).
 *
 * Recebe um número já normalizado/validado (somente dígitos) e usa o método
 * requestPairingCode do Baileys. NUNCA imprime o número completo em logs.
 */

'use strict';

const logger = require('../utils/logger').child('pairing');
const phoneParser = require('./phoneParser');

/**
 * Gera o pairing code para um número normalizado.
 * @param {object} sock socket Baileys
 * @param {string} normalizedDigits somente dígitos (ex.: '5519999999999')
 * @returns {Promise<string>} código de pareamento
 */
async function requestPairingCode(sock, normalizedDigits) {
  const digits = String(normalizedDigits || '').replace(/\D/g, '');
  const check = phoneParser.parsePhoneNumber('+' + digits);
  if (!check.valid) {
    const err = new Error('Número inválido para pairing code.');
    err.code = 'INVALID_PHONE';
    throw err;
  }

  logger.info({ numero: phoneParser.maskPhoneNumber(check.e164) }, 'solicitando pairing code');
  const code = await sock.requestPairingCode(check.digits);
  return code;
}

module.exports = { requestPairingCode };
