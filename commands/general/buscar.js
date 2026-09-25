/**
 * commands/general/buscar.js — Busca inteligente e leve de comandos.
 *
 * Pesquisa por:
 * - Nome e aliases
 * - Categoria
 * - Finalidade / descrição dos metadados
 * - Palavras-chave funcionais (ex: "baixar música", "figura", "banir", "jogar")
 */

'use strict';

const { registry } = require('../../engine/plugins');
const { commandEmoji } = require('../../utils/commandEmoji');
const { maybeReadMore } = require('../../utils/readmore');

// Sinônimos comuns para busca funcional leve sem IA pesada
const SYNONYMS = {
  musica: ['play', 'ytmp3', 'letra', 'audio'],
  música: ['play', 'ytmp3', 'letra', 'audio'],
  baixar: ['download', 'play', 'ytmp3', 'ytmp4', 'tiktok', 'instagram', 'facebook', 'pinterest'],
  video: ['ytmp4', 'video', 'tiktok', 'instagram'],
  vídeo: ['ytmp4', 'video', 'tiktok', 'instagram'],
  figura: ['sticker', 'figurinha', 's'],
  figurinha: ['sticker', 'figurinha', 's'],
  sticker: ['sticker', 'figurinha', 's'],
  banir: ['ban', 'kick', 'remover'],
  expulsar: ['ban', 'kick', 'remover'],
  jogar: ['tigrinho', 'cacatesouro', 'quiz', 'batalha', 'luck', 'jokenpo'],
  jogo: ['tigrinho', 'cacatesouro', 'quiz', 'batalha', 'luck', 'jokenpo'],
  grana: ['carteira', 'saldo', 'banco', 'pix', 'trabalhar', 'daily', 'extrato'],
  dinheiro: ['carteira', 'saldo', 'banco', 'pix', 'trabalhar', 'daily', 'extrato'],
};

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function searchCommands(query, limit = 15) {
  const q = normalizeText(query);
  if (!q) return [];

  const qTokens = q.split(/\s+/).filter(Boolean);
  const all = registry.all();
  const scored = [];

  for (const cmd of all) {
    let score = 0;
    const normName = normalizeText(cmd.name);
    const normDesc = normalizeText(cmd.description || '');
    const normCat = normalizeText(cmd.category || '');
    const normTriggers = [...(cmd.commands || []), ...(cmd.aliases || [])].map(normalizeText);

    // 1. Match exato de nome ou alias
    if (normTriggers.includes(q)) score += 100;
    else if (normTriggers.some((t) => t.startsWith(q))) score += 50;

    // 2. Tokens no nome / triggers
    for (const token of qTokens) {
      if (normTriggers.some((t) => t.includes(token))) score += 30;
      if (normCat.includes(token)) score += 20;
      if (normDesc.includes(token)) score += 15;
    }

    // 3. Sinônimos funcionais
    for (const [synWord, targets] of Object.entries(SYNONYMS)) {
      if (qTokens.includes(normalizeText(synWord)) && (targets.includes(cmd.name) || normTriggers.some((t) => targets.includes(t)))) {
        score += 40;
      }
    }

    if (score > 0) {
      scored.push({ cmd, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.cmd.name.localeCompare(b.cmd.name));
  return scored.slice(0, limit).map((s) => s.cmd);
}

module.exports = [
  {
    name: 'buscar',
    commands: ['buscar', 'procurar', 'search', 'find'],
    category: 'general',
    description: 'Busca comandos por nome, categoria ou finalidade funcional.',
    usage: '!buscar <termo>',
    cooldown: 2000,
    execute: async (ctx) => {
      const term = ctx.args.join(' ').trim();
      if (!term) {
        return ctx.reply(
          `💡 Digite o que procura. Exemplo:\n` +
          `▸ *${ctx.prefix}buscar musica*\n` +
          `▸ *${ctx.prefix}buscar baixar video*\n` +
          `▸ *${ctx.prefix}buscar figurinha*`
        );
      }

      const results = searchCommands(term, 10);
      if (!results.length) {
        return ctx.reply(`❌ Nenhum comando encontrado para *"${term}"*.\nTente palavras mais simples ou use *${ctx.prefix}menu*.`);
      }

      const lines = [
        `🔍 *RESULTADOS DA BUSCA: "${term}"* (${results.length})`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ];

      for (const cmd of results) {
        const emoji = commandEmoji(cmd);
        lines.push(`${emoji} *${ctx.prefix}${cmd.name}* — ${cmd.description || '-'}`);
        lines.push(`   └ _Uso:_ \`${cmd.usage ? cmd.usage.replace(/^[!/.]/, ctx.prefix) : ctx.prefix + cmd.name}\``);
      }

      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push(`💡 Detalhes de um comando: *${ctx.prefix}help <comando>*`);

      await ctx.reply(maybeReadMore(lines.join('\n')));
    },
  },
];
