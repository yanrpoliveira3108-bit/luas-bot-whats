'use strict';

const mainMenu = require('../../menus/main');
const { registry } = require('../../engine/plugins');
const { commandEmoji } = require('../../utils/commandEmoji');
const { maybeReadMore } = require('../../utils/readmore');

function searchCommands(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  let cmds = [];
  try {
    cmds = registry.all ? registry.all() : [];
  } catch (_) {}
  if (!cmds.length) {
    const byCat = registry.byCategory();
    for (const list of byCat.values()) {
      cmds.push(...list);
    }
  }
  return cmds.filter((c) => {
    const name = (c.name || '').toLowerCase();
    const desc = (c.description || '').toLowerCase();
    const triggers = (c.commands || []).join(' ').toLowerCase();
    const cat = (c.category || '').toLowerCase();
    return name.includes(q) || desc.includes(q) || triggers.includes(q) || cat.includes(q);
  }).slice(0, 30);
}

module.exports = [
  {
    name: 'menu',
    commands: ['menu'],
    aliases: ['menuprincipal'],
    category: 'general',
    description:
      'Abre o menu principal. Use !menu <termo> para buscar e !menu --texto para o formato tradicional.',
    usage: '!menu [termo de busca] | !menu --texto',
    cooldown: 1500,
    execute: async (ctx) => {
      const args = (ctx.args || []).slice();
      // Alternativa TRADICIONAL sempre acessível, mesmo com o modo HTML ligado.
      // A flag `--texto` é inequívoca (não conflita com busca por termo).
      const flagTexto = args.findIndex((a) => /^--(texto|tradicional|antigo)$/i.test(String(a)));
      if (flagTexto >= 0) {
        args.splice(flagTexto, 1);
        ctx.forceTextMenu = true;
      }

      const query = args.join(' ').trim();
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
