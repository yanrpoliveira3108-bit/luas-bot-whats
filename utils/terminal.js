/**
 * utils/terminal.js — helpers de terminal (caixas, limpeza, centralização).
 *
 * - clearTerminal() é multiplataforma (ANSI, funciona em Termux/Linux/macOS/
 *   Windows Terminal)
 * - drawBox() desenha caixas com caracteres de caixa (dupla ou arredondada)
 * - center()/width() lidam com emojis (largura 2)
 */

'use strict';

const tty = require('tty');

/**
 * Detecta terminal interativo de forma confiável (incluindo Termux).
 *
 * Em Termux, `process.stdin.isTTY` retorna `undefined` (quirk do Node), o que
 * fazia o modo interativo nunca ativar. `tty.isatty(fd)` retorna o valor real.
 */
function isInteractive() {
  try {
    return tty.isatty(0) && tty.isatty(1);
  } catch (_) {
    return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
  }
}

/** Limpa o terminal de forma portátil. */
function clearTerminal() {
  try {
    // ANSI reset + limpeza + reposiciona cursor (Termux, Linux, macOS, Windows Terminal)
    process.stdout.write('\x1Bc\x1B[2J\x1B[3J\x1B[H');
  } catch (_) {
    /* ignora */
  }
}

/** Largura visual de uma string (emoji contam como 2; bandeiras como 1 glifo de 2). */
function width(s) {
  let w = 0;
  const cps = Array.from(String(s)); // code points
  let i = 0;
  while (i < cps.length) {
    const cp = cps[i].codePointAt(0);
    // par de indicadores regionais (bandeira 🇧🇷) ocupa 2 colunas no total
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
      w += 2;
      i += 2;
      continue;
    }
    w += cp > 0xffff ? 2 : 1;
    i += 1;
  }
  return w;
}

/** Centraliza `s` em uma largura `n`. */
function center(s, n) {
  const diff = n - width(s);
  if (diff <= 0) return String(s);
  const l = Math.floor(diff / 2);
  return ' '.repeat(l) + s + ' '.repeat(diff - l);
}

const DOUBLE = { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║', ml: '╠', mr: '╣' };
const ROUND = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', ml: '├', mr: '┤' };

/**
 * Desenha uma caixa no terminal.
 * @param {string[]} lines linhas de conteúdo
 * @param {object} opts
 *   - style: 'double' | 'round'
 *   - width: largura interna
 *   - title: título centralizado DENTRO da caixa (acima do conteúdo)
 *   - borderTitle: título embutido na borda superior (ex.: ╭─ TÍTULO ─╮)
 *   - centered: centralizar as linhas de conteúdo
 */
function drawBox(lines, opts = {}) {
  const { style = 'double', width: inner = 40, title = '', borderTitle = '', centered = false } = opts;
  const S = style === 'round' ? ROUND : DOUBLE;
  const content = Array.isArray(lines) ? lines.map(String) : [];

  // borda superior
  if (borderTitle) {
    const t = ` ${borderTitle} `;
    const rest = inner - width(t);
    const l = Math.max(0, Math.floor(rest / 2));
    const r = Math.max(0, rest - l);
    console.log(S.tl + S.h.repeat(l) + t + S.h.repeat(r) + S.tr);
  } else {
    console.log(S.tl + S.h.repeat(inner) + S.tr);
    if (title) {
      console.log(S.v + center(title, inner) + S.v);
      console.log(S.v + ' '.repeat(inner) + S.v);
    }
  }

  // conteúdo
  for (const line of content) {
    // padding calculado pela largura VISUAL (emoji = 2 colunas); padEnd() conta
    // unidades UTF-16 e quebraria o alinhamento com emojis
    const pad = Math.max(0, inner - 1 - width(line));
    const text = centered ? center(line, inner) : ' ' + line + ' '.repeat(pad);
    console.log(S.v + text + S.v);
  }

  // borda inferior
  console.log(S.bl + S.h.repeat(inner) + S.br);
}

/** Linha horizontal simples. */
function separator(char = '─', n = 40) {
  console.log(String(char).repeat(n));
}

module.exports = { clearTerminal, drawBox, center, separator, width, isInteractive };
