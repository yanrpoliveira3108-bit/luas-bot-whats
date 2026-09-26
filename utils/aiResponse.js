'use strict';

// Limite técnico conservador do texto de uma mensagem WhatsApp; nunca descarta conteúdo.
const DEFAULT_CHUNK_SIZE = 4000;

function bestCut(text, max) {
  const window = text.slice(0, max + 1);
  const candidates = [window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf(' ')]
    .filter((n) => n > Math.floor(max * 0.55));
  return candidates.length ? Math.max(...candidates) + 1 : max;
}

function splitLongMessage(value, max = DEFAULT_CHUNK_SIZE) {
  const text = String(value == null ? '' : value);
  if (!text) return [''];
  const chunks = [];
  let rest = text;
  let insideCode = false;
  while (rest.length > max) {
    const cut = bestCut(rest, max);
    let part = rest.slice(0, cut);
    const fenceCount = (part.match(/```/g) || []).length - (insideCode ? 1 : 0);
    const endsInsideCode = insideCode !== (fenceCount % 2 === 1);
    if (endsInsideCode) part += '\n```';
    chunks.push(part);
    rest = rest.slice(cut);
    insideCode = endsInsideCode;
    if (insideCode) rest = '```\n' + rest.replace(/^\n/, '');
  }
  chunks.push(rest);
  return chunks;
}

async function sendLongMessage(ctx, text, options) {
  const chunks = splitLongMessage(text);
  for (let i = 0; i < chunks.length; i += 1) {
    try {
      await ctx.reply(chunks[i], options);
    } catch (err) {
      ctx.logger && ctx.logger.warn({ chunkIndex: i, totalChunks: chunks.length, code: err && err.code }, '[AI_RESPONSE] chunk-error');
      throw err;
    }
  }
  return chunks.length;
}

module.exports = { DEFAULT_CHUNK_SIZE, splitLongMessage, sendLongMessage };
