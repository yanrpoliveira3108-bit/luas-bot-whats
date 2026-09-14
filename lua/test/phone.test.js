/**
 * test/phone.test.js — testes do parser de números telefônicos.
 *
 * Cobre: normalização, DDI/DDD (sem regras simplistas), ambiguidade,
 * país padrão, formatação, máscara e casos inválidos.
 *
 * Uso: node test/phone.test.js
 */

'use strict';

const phoneParser = require('../connection/phoneParser');
const phone = require('../connection/phone');

let pass = 0;
let fail = 0;
function t(ok, label, extra = '') {
  const mark = ok ? '✅' : '❌';
  console.log(`${mark} ${label}${extra ? ' — ' + extra : ''}`);
  if (ok) pass++;
  else fail++;
}

console.log('\n=== TESTES DE NÚMERO (phoneParser) ===\n');

/* ------------------- normalização (mesmo número) ---------------------- */

{
  const a = phoneParser.normalizePhoneNumber('+1 (742) 369-1883');
  const b = phoneParser.normalizePhoneNumber('+1 742 3691883');
  const c = phoneParser.normalizePhoneNumber('17423691883');
  t(a === '+17423691883', 'normaliza "+1 (742) 369-1883"', a);
  t(b === '+17423691883', 'normaliza "+1 742 3691883"', b);
  t(c === '17423691883', 'normaliza "17423691883"', c);
  t(a.slice(1) === c, 'as três entradas resultam no MESMO número', `${a.slice(1)} == ${c}`);
}

/* ------------------ parse com "+" (país identificado) ----------------- */

const PLUS_CASES = [
  ['+1 (742) 369-1883', 'CA', '17423691883'], // 742 é área canadense (não inventa EUA)
  ['+1 202 555 0148', 'US', '12025550148'],
  ['+55 (19) 99999-9999', 'BR', '5519999999999'],
  ['+55 19 99999-9999', 'BR', '5519999999999'],
  ['+351 912 345 678', 'PT', '351912345678'],
  ['+44 20 7946 0958', 'GB', '442079460958'],
  ['+81 90-1234-5678', 'JP', '819012345678'],
  ['+54 9 11 5555-1234', 'AR', '5491155551234'],
  ['+34 612 345 678', 'ES', '34612345678'],
];
for (const [input, country, digits] of PLUS_CASES) {
  const r = phoneParser.parsePhoneNumber(input);
  t(r.valid && r.country === country && r.digits === digits, `${input} → ${country} ${digits}`, r.valid ? `${r.country}/${r.digits}` : 'inválido');
}

/* -------------------- país padrão (sem DDI explícito) ----------------- */

{
  const r = phoneParser.parsePhoneNumber('19999999999', 'BR');
  t(r.valid && r.digits === '5519999999999', 'local "19999999999" com DEFAULT_COUNTRY=BR', r.valid ? r.digits : 'inválido');
  const r2 = phoneParser.parsePhoneNumber('5519999999999', 'BR');
  t(r2.valid && r2.digits === '5519999999999', '"5519999999999" com DEFAULT_COUNTRY=BR', r2.valid ? r2.digits : 'inválido');
  const r3 = phoneParser.parsePhoneNumber('351912345678', 'PT');
  t(r3.valid && r3.country === 'PT', '"351912345678" com DEFAULT_COUNTRY=PT', r3.valid ? r3.country : 'inválido');
}

/* ------------------------- ambiguidade (sem +) ------------------------ */

{
  const r = phone.resolveNumberInput('17423691883', {});
  t(r.status === 'ambiguous', '"17423691883" sem + é ambíguo', r.status);
  if (r.status === 'ambiguous') {
    t(r.candidates.length > 1, 'mais de um país candidato', `${r.candidates.length} candidatos`);
    t(r.candidates.some((c) => c.country === 'CA'), 'candidatos incluem Canadá (+1)');
    // resolvendo a ambiguidade escolhendo o país
    const r2 = phone.resolveWithCountry('CA', '17423691883');
    t(r2.status === 'ok' && r2.phone.digits === '17423691883', 'resolvido com CA → 17423691883', r2.status === 'ok' ? r2.phone.digits : 'inválido');
  }
}

/* --------------------------- detecção única --------------------------- */

{
  const d = phoneParser.detectCountry('+351912345678');
  t(d && d.country === 'PT', 'detectCountry("+351912345678") = PT', d && d.country);
  const d2 = phoneParser.detectCountry('+5519999999999');
  t(d2 && d2.country === 'BR', 'detectCountry("+5519999999999") = BR', d2 && d2.country);
}

/* ------------------------------ formatação ---------------------------- */

{
  t(phoneParser.formatPhoneNumber('+55 19 99999-9999') === '+5519999999999', 'formatPhoneNumber E.164 BR');
  const intl = phoneParser.formatPhoneNumber('+1 (742) 369-1883', null, 'international');
  t(intl === '+1 742 369 1883', 'formatPhoneNumber international', intl);
}

/* -------------------------------- máscara ----------------------------- */

{
  const m = phoneParser.maskPhoneNumber('+5519999999999');
  t(m.startsWith('+55') && m.includes('9999') && !m.includes('19999999999'), 'máscara não vaza o número BR', m);
  const m2 = phoneParser.maskPhoneNumber('+1 (742) 369-1883');
  t(m2.includes('1883') && !m2.includes('742369'), 'máscara não vaza o número NANP', m2);
}

/* ----------------------------- modo manual ---------------------------- */

{
  const r = phoneParser.parseNational('BR', '19999999999');
  t(r.valid && r.e164 === '+5519999999999', 'manual: BR + 19999999999', r.valid ? r.e164 : 'inválido');
  const r2 = phoneParser.parseNational('PT', '912345678');
  t(r2.valid && r2.e164 === '+351912345678', 'manual: PT + 912345678', r2.valid ? r2.e164 : 'inválido');
}

/* ------------------------------ inválidos ----------------------------- */

{
  for (const input of ['123', '+1', '0', 'abc', '000000000000000']) {
    const r = phoneParser.parsePhoneNumber(input);
    t(!r.valid, `inválido: "${input}"`, r.reason);
  }
  t(!phoneParser.parsePhoneNumber('').valid, 'inválido: vazio');
  t(phoneParser.isSupportedCountry('BR'), 'isSupportedCountry("BR")');
  t(!phoneParser.isSupportedCountry('ZZ'), 'isSupportedCountry("ZZ") = false');
  const pop = phoneParser.popularCountries();
  t(pop.some((c) => c.country === 'BR' && c.ddi === '55'), 'catálogo de países inclui BR +55');
  t(pop.some((c) => c.country === 'US' && c.ddi === '1'), 'catálogo de países inclui US +1');
}

/* ------------------------------ resultado ----------------------------- */

console.log(`\n=== PHONE TEST: ${pass} passou, ${fail} falhou ===\n`);
process.exit(fail > 0 ? 1 : 0);
