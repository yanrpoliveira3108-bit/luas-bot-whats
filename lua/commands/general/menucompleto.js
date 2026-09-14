'use strict';

const CONFIG = require('../../config');
const { registry } = require('../../engine/plugins');

module.exports = [
  {
    name: 'menucompleto',
    commands: ['menucompleto'],
    aliases: ['todoscomandos', 'listacomandos'],
    category: 'general',
    description: 'Lista todos os comandos carregados por categoria.',
    usage: '!menucompleto',
    cooldown: 5000,
    execute: async (ctx) => {
      const cats = registry.byCategory();
      const lines = [`🌙 *${CONFIG.bot.name}* v${CONFIG.bot.version} — todos os comandos`, ''];

      const EMOJIS = {
        general: '⚙️',
        owner: '👑',
        admin: '🛡️',
        members: '👥',
        downloads: '📥',
        stickers: '🎨',
        games: '🎮',
        rpg: '⚔️',
        anime: '🍥',
        fun: '😂',
        utility: '🛠️',
        rankings: '📊',
      };

      for (const [cat, cmds] of cats) {
        const emoji = EMOJIS[cat] || '📂';
        lines.push(`${emoji} *${cat.toUpperCase()}*`);
        for (const c of cmds) {
          lines.push(`▸ ${ctx.prefix}${c.name} — ${c.description || ''}`);
        }
        lines.push('');
      }

      lines.push(`_Total: ${registry.count()} comandos. Use ${ctx.prefix}help <comando> para detalhes._`);
      await ctx.reply(lines.join('\n'));
    },
  },
];
