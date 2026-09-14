'use strict';

const mainMenu = require('../../menus/main');
const { registry } = require('../../engine/plugins');
const { commandEmoji } = require('../../utils/commandEmoji');
const { maybeReadMore } = require('../../utils/readmore');

const commandCache = require('../../utils/commandCache');
const ui = require('../../utils/uiKit');

/**
 * Busca por nome, alias, categoria, descrição e keywords usando o índice
 * invertido do commandCache (O(tokens) em vez de varrer os 318 comandos).
 */
function searchCommands(query, limit = 30) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  try {
    const results = commandCache.search(q, limit);
    if (results.length) return results;
  } catch (_) {
    /* cache indisponível: cai no caminho antigo */
  }
  let cmds = registry.all ? registry.all() : [];
  return cmds
    .filter((c) => {
      const hay = `${c.name} ${(c.commands || []).join(' ')} ${c.category} ${c.description || ''}`.toLowerCase();
      return hay.includes(q);
    })
    .slice(0, limit);
}

module.exports = [
  {
    name: 'menu',
    commands: ['menu'],
    aliases: ['menuprincipal'],
    category: 'general',
    description: 'Abre o menu principal interativo. Use !menu <termo> para buscar comandos.',
    usage: '!menu [termo de busca]',
    cooldown: 1500,
    execute: async (ctx) => {
      const query = ctx.args.join(' ').trim();
      if (!query) {
        await mainMenu(ctx);
        return;
      }

      // busca
      const results = searchCommands(query);
      if (!results.length) {
        await ctx.reply(`🔍 Nenhum comando encontrado para *${query}*.\n\n💡 Tente: !menu sticker, !menu download, !menu anti, !menu grupo`);
        return;
      }

      const lines = [
        ui.divider('minimal'),
        `🔍 *Busca: ${query}* — ${results.length} resultado(s)`,
        '',
        ...results.map((c) => {
          const emoji = commandEmoji(c);
          const trig = (c.commands && c.commands[0]) || c.name;
          return `${emoji} *${ctx.prefix}${trig}* — ${c.description || ''} [${c.category}]`;
        }),
        '',
        `💡 Use ${ctx.prefix}help <comando> para detalhes. Ex: ${ctx.prefix}help ${results[0].name}`,
        `📋 ${ctx.prefix}menu para voltar ao menu principal`,
      ];

      await ctx.reply(maybeReadMore(lines.join('\n')));
    },
  },
];
