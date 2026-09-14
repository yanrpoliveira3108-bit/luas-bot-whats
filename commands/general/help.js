'use strict';

const CONFIG = require('../../config');
const { registry } = require('../../engine/plugins');

function permissionLabel(cmd) {
  if (cmd.ownerOnly) return '👑 OWNER';
  if (cmd.adminOnly) return '🛡️ ADMIN';
  return '👥 MEMBER';
}

module.exports = [
  {
    name: 'help',
    commands: ['help', 'ajuda', 'cmd', 'comando'],
    category: 'general',
    description: 'Mostra detalhes de um comando.',
    usage: '!help <comando>',
    cooldown: 1000,
    execute: async (ctx) => {
      const name = (ctx.args[0] || '').toLowerCase();
      if (!name) {
        await ctx.reply(
          `💡 Use *${ctx.prefix}help <comando>* para ver detalhes.\n` +
            `Ex.: ${ctx.prefix}help play\n\n` +
            `Digite *${ctx.prefix}menu* para ver todos os comandos.`
        );
        return;
      }
      const cmd = registry.getCommand(name) || registry.resolveTrigger(name);
      if (!cmd) {
        await ctx.reply(`❌ Comando *${name}* não encontrado.`);
        return;
      }
      const aliases = [...cmd.commands, ...(cmd.aliases || [])]
        .filter((t) => t !== cmd.name)
        .map((t) => `${ctx.prefix}${t}`);
      const lines = [
        `📘 *${ctx.prefix}${cmd.name}*`,
        `▸ Descrição: ${cmd.description || '-'}`,
        `▸ Uso: ${cmd.usage || ctx.prefix + cmd.name}`,
        `▸ Aliases: ${aliases.length ? aliases.join(', ') : '-'}`,
        `▸ Permissão: ${permissionLabel(cmd)}`,
        `▸ Categoria: ${cmd.category}`,
        `▸ Cooldown: ${cmd.cooldown ? Math.round(cmd.cooldown / 1000) + 's' : CONFIG.limits.defaultCooldownMs / 1000 + 's (padrão)'}`,
      ];
      const { maybeReadMore } = require('../../utils/readmore');
      await ctx.reply(maybeReadMore(lines.join('\n')));
    },
  },
];
