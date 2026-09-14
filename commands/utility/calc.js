'use strict';

/**
 * Avaliador aritmético seguro (sem eval).
 * Suporta: + - * / ( ) % e números decimais.
 */
function safeCalc(src) {
  const s = String(src).replace(/\s+/g, '');
  if (!s || !/^[\d+\-*/().%]+$/.test(s)) throw new Error('INVALID_EXPR');
  let i = 0;

  function expr() {
    let v = term();
    while (i < s.length && (s[i] === '+' || s[i] === '-')) {
      const op = s[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = factor();
    while (i < s.length && (s[i] === '*' || s[i] === '/')) {
      const op = s[i++];
      const r = factor();
      if (op === '/') {
        if (r === 0) throw new Error('DIV_BY_ZERO');
        v = v / r;
      } else {
        v = v * r;
      }
    }
    return v;
  }
  function factor() {
    if (s[i] === '(') {
      i++;
      const v = expr();
      if (s[i] === ')') i++;
      return v;
    }
    const start = i;
    while (i < s.length && /[\d.]/.test(s[i])) i++;
    if (i === start) throw new Error('INVALID_EXPR');
    let num = parseFloat(s.slice(start, i));
    if (!Number.isFinite(num)) throw new Error('INVALID_EXPR');
    if (s[i] === '%') {
      i++;
      num = num / 100;
    }
    return num;
  }

  const result = expr();
  if (i < s.length) throw new Error('INVALID_EXPR');
  return result;
}

module.exports = [
  {
    name: 'calc',
    commands: ['calc', 'calcular', 'conta'],
    category: 'utility',
    description: 'Calcula uma expressão matemática.',
    usage: '!calc 2 + 2 * 3',
    cooldown: 2000,
    execute: async (ctx) => {
      const expr = ctx.args.join(' ');
      if (!expr) return ctx.reply('⚠️ Envie a conta: !calc 2 + 2 * 3');
      try {
        const r = safeCalc(expr);
        const out = Number.isInteger(r) ? r : parseFloat(r.toFixed(6));
        await ctx.reply(`🧮 *${expr}* = *${out}*`);
      } catch (err) {
        await ctx.reply('❌ Expressão inválida. Use números e os operadores + - * / ( ) %.');
      }
    },
  },
];
