/**
 * commands/_shared/searchResults.js — opções (lista) funcionais para resultados de busca.
 *
 * Guarda os resultados em cache por chat (10 min) e registra linhas
 * [🎵 Áudio] / [🎬 Vídeo] / [📖 Letra] / [🔗 Abrir] que executam a ação real.
 * Nenhuma linha é decorativa.
 */

'use strict';

const buttonHandler = require('../../handlers/buttonHandler');
const commandHandler = require('../../handlers/commandHandler');
const nav = require('../../utils/nav');
const { formatNumber } = require('../../utils/formatter');

const TTL = 10 * 60 * 1000;
const cache = new Map(); // chatId -> { results, expires }

function prune() {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expires < now) cache.delete(k);
  }
}

async function runDownload(ctx, kind, i) {
  const entry = cache.get(ctx.remoteJid);
  if (!entry || entry.expires < Date.now()) {
    await ctx.reply('⏳ Os resultados expiraram. Faça a busca novamente.');
    return;
  }
  const r = entry.results[i];
  if (!r || !r.url) {
    await ctx.reply('❌ Resultado indisponível.');
    return;
  }
  if (kind === 'audio') {
    await commandHandler.runByName(ctx, 'ytmp3', [r.url]);
  } else if (kind === 'video') {
    await commandHandler.runByName(ctx, 'ytmp4', [r.url]);
  } else if (kind === 'letra') {
    await commandHandler.runByName(ctx, 'letra', [r.url]);
  }
}

/**
 * Registra botões para os resultados e retorna { buttons, lines }.
 * @param {object} ctx contexto do comando
 * @param {Array<{title,url,author,duration,views}>} results
 */
function build(ctx, results) {
  prune();
  const key = 'sr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  cache.set(ctx.remoteJid, { results, expires: Date.now() + TTL });

  const buttons = [];
  const lines = results.slice(0, 3).map((r, i) => {
    const aid = `lua_${key}_a${i}`;
    const vid = `lua_${key}_v${i}`;
    const lid = `lua_${key}_l${i}`;
    const oid = `lua_${key}_o${i}`;
    // registra apenas se ainda não existir (IDs únicos por busca)
    if (!buttonHandler.has(aid)) buttonHandler.register(aid, (c) => runDownload(c, 'audio', i));
    if (!buttonHandler.has(vid)) buttonHandler.register(vid, (c) => runDownload(c, 'video', i));
    if (!buttonHandler.has(lid)) buttonHandler.register(lid, (c) => runDownload(c, 'letra', i));
    if (!buttonHandler.has(oid)) buttonHandler.register(oid, (c) => c.reply(`🔗 ${results[i].url}`));

    buttons.push(
      { id: aid, text: `🎵 Áudio ${i + 1}` },
      { id: vid, text: `🎬 Vídeo ${i + 1}` },
      { id: lid, text: `📖 Letra ${i + 1}` },
      { id: oid, text: `🔗 Abrir ${i + 1}` }
    );

    const viewsStr = r.views ? ` • 👁️ ${formatNumber(r.views)}` : '';
    const durStr = r.duration ? ` • ⏱️ ${r.duration}` : '';
    return `*${i + 1}.* ${String(r.title).slice(0, 55)}\n▸ ${r.author || ''}${durStr}${viewsStr}\n▸ _Buscar letra:_ \`${ctx.prefix}letra ${r.url}\``;
  });

  return { buttons, lines, text: `🎵 *Resultados*${lines.length ? '\n\n' + lines.join('\n\n') : ''}` };
}

module.exports = { build, runDownload };
