/**
 * utils/playPresentation.js — Apresentação visual limpa, hierárquica e elegante do LUA • PLAY.
 *
 * Referência de composição exata:
 *
 * LUA • PLAY
 *
 * ━━━━━━━━━━━━━━
 *
 * 01  Nome da primeira música
 * Duração · 03:42
 *
 * ━━━━━━━━━━━━━━
 *
 * 02  Nome da segunda música
 * Duração · 04:10
 *
 * ━━━━━━━━━━━━━━
 *
 * 03  Nome da terceira música
 * Duração · 02:58
 *
 * ━━━━━━━━━━━━━━
 *
 * Escolha uma opção abaixo.
 */

'use strict';

const DIVIDER = '━━━━━━━━━━━━━━';

/**
 * Sanitiza texto preservando palavras, acentos e quebras sem injeção acidental de menção
 */
function sanitizeTitle(str) {
  if (!str) return 'Sem título';
  return String(str)
    .replace(/@([0-9]{5,})/g, '@\u200B$1')
    .replace(/[\r\n\t]+/g, ' ')
    // External titles must not alter WhatsApp's visual hierarchy.
    .replace(/([*_~`\\])/g, '\\$1')
    .trim();
}

/**
 * Formata duração em mm:ss ou hh:mm:ss. Se não disponível, retorna 'Não informada'.
 */
function formatPlayDuration(dur) {
  if (!dur) return 'Não informada';
  if (typeof dur === 'string') {
    const trimmed = dur.trim();
    if (!trimmed || trimmed === '0' || trimmed === '00:00' || trimmed === '0:00') {
      return 'Não informada';
    }
    // Se já estiver no formato mm:ss ou hh:mm:ss
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      const parts = trimmed.split(':');
      return parts.map((p) => p.padStart(2, '0')).join(':');
    }
    const n = Number(trimmed);
    if (!isNaN(n) && n > 0) return formatPlayDuration(n);
    return trimmed;
  }

  if (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
    const totalSec = Math.floor(dur);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  return 'Não informada';
}

/**
 * Monta a mensagem inicial do comando Play
 * @param {Array<{title: string, duration?: string|number}>} results
 * @returns {string} Mensagem formatada
 */
function formatInitialPlayMessage(results = []) {
  const blocks = ['*LUA • PLAY*', DIVIDER];

  results.forEach((item, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    const title = sanitizeTitle(item.title);
    const duration = formatPlayDuration(item.duration);

    blocks.push(`*${num}*  *${title}*\nDuração · ${duration}`);
    blocks.push(DIVIDER);
  });

  blocks.push('_Escolha uma opção abaixo._');
  return blocks.join('\n\n');
}

/**
 * Monta a mensagem complementar após envio com sucesso da mídia (ou se pedir somente link):
 *
 * Nome da música
 *
 * Link: "<URL original da música>"
 *
 * Letra: "{prefix}letra <URL original da música>"
 */
function formatComplementaryMessage(title, url, prefix = '!') {
  const cleanTitle = sanitizeTitle(title);
  const safeUrl = String(url || '').trim();
  const safePrefix = String(prefix || '!').trim();

  return (
    `*${cleanTitle}*\n\n` +
    `Link: "${safeUrl}"\n\n` +
    `Letra: "${safePrefix}letra ${safeUrl}"`
  );
}

module.exports = {
  DIVIDER,
  sanitizeTitle,
  formatPlayDuration,
  formatInitialPlayMessage,
  formatComplementaryMessage,
};
