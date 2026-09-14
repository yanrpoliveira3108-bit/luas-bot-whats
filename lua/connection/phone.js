/**
 * connection/phone.js — decisões de alto nível sobre números (sem readline).
 *
 * Usado pela connectionUI para interpretar a entrada do usuário:
 *  - resolveNumberInput(): ok | ambiguous | invalid
 *  - resolveWithCountry(): resolve ambiguidade escolhendo o país
 *  - resolveNational(): país + número nacional (modo manual)
 */

'use strict';

const phoneParser = require('./phoneParser');

/**
 * @param {string} raw entrada original do usuário
 * @param {object} opts { defaultCountry }
 * @returns {{status:'ok',phone}|{status:'ambiguous',candidates,digits}|{status:'invalid'}}
 */
function resolveNumberInput(raw, opts = {}) {
  const res = phoneParser.parsePhoneNumber(raw, opts.defaultCountry || null);
  if (res.valid) return { status: 'ok', phone: res };
  if (res.reason === 'ambiguous') {
    return { status: 'ambiguous', candidates: res.candidates, digits: res.digits };
  }
  return { status: 'invalid' };
}

/**
 * Resolve um número ambíguo após o usuário escolher o país.
 * @param {string} countryCode código ISO escolhido
 * @param {string} rawDigits dígitos originais (com ou sem DDI)
 */
function resolveWithCountry(countryCode, rawDigits) {
  const digits = String(rawDigits || '').replace(/\D/g, '');
  const res = phoneParser.parsePhoneNumber(digits, String(countryCode).toUpperCase());
  if (res.valid) return { status: 'ok', phone: res };
  return { status: 'invalid' };
}

/**
 * Modo manual: país escolhido + número nacional (sem DDI).
 */
function resolveNational(countryCode, nationalInput) {
  const res = phoneParser.parseNational(countryCode, nationalInput);
  if (res.valid) return { status: 'ok', phone: res };
  return { status: 'invalid' };
}

module.exports = { resolveNumberInput, resolveWithCountry, resolveNational };
