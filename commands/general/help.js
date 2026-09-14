'use strict';

const CONFIG = require('../../config');
const { registry } = require('../../engine/plugins');
const fuzzy = require('../../utils/fuzzySearch');
const { commandEmoji } = require('../../utils/commandEmoji');

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
    description: 'Mostra detalhes de qualquer comando. Se não existir, sugere similares.',
    usage: '!help <comando>',
    cooldown: 1000,
    execute: async (ctx) => {
      const name = (ctx.args[0] || '').toLowerCase().trim();
      if (!name) {
        await ctx.reply(
          `💡 Use *${ctx.prefix}help <comando>* para ver detalhes.\n` +
            `Ex.: ${ctx.prefix}help play, ${ctx.prefix}help sticker, ${ctx.prefix}help anti\n\n` +
            `Digite *${ctx.prefix}menu* para ver todos os comandos ou *${ctx.prefix}menu <termo>* para buscar.\n` +
            `Total: ${registry.count()} comandos`
        );
        return;
      }
      const cmd = registry.getCommand(name) || registry.resolveTrigger(name);
      if (!cmd) {
        // sugere similares
        const all = registry.all();
        const similar = fuzzy.findSimilarCommands(name, all, 3);
        if (similar.length) {
          let msg = `❌ Comando *${name}* não encontrado.\n\n💡 *Você quis dizer:*\n`;
          for (const s of similar) {
            msg += `▸ ${commandEmoji(s.cmd)} *${ctx.prefix}${s.trigger}* — ${s.cmd.description || ''}\n`;
          }
          msg += `\n📌 Use *${ctx.prefix}help <comando>* com o nome correto`;

          try {
            const buttonHandler = require('../../handlers/buttonHandler');
            const interactive = require('../../utils/interactive');
            const commandHandler = require('../../handlers/commandHandler');

            const buttons = similar.map((s) => ({
              id: `help_suggest_${s.cmd.name}`,
              text: `${ctx.prefix}${s.trigger}`,
              run: (c) => commandHandler.runByName(c, 'help', [s.cmd.name]),
            }));

            for (const b of buttons) {
              // registra uma única vez; cliques depois de restart caem no
              // dispatch dinâmico do buttonHandler (lua:help_suggest_<cmd>)
              buttonHandler.registerOnce(`lua:${b.id}`, b.run);
            }

            const sent = await interactive.sendButtons(ctx.socket, ctx.remoteJid, {
              text: msg,
              footer: `${CONFIG.bot.name} • ${ctx.prefix}menu para todos`,
              buttons: buttons.slice(0, 3).map((b) => ({ id: `lua:${b.id}`, text: b.text })),
              quoted: ctx.message,
            });

            if (!sent) await ctx.reply(msg);
          } catch (_) {
            await ctx.reply(msg);
          }
          return;
        }

        await ctx.reply(`❌ Comando *${name}* não encontrado.\n\n💡 Tente *${ctx.prefix}menu ${name}* para buscar ou *${ctx.prefix}menu* para ver todos.`);
        return;
      }

      const aliases = [...cmd.commands, ...(cmd.aliases || [])]
        .filter((t) => t !== cmd.name)
        .map((t) => `${ctx.prefix}${t}`);

      const emoji = commandEmoji(cmd);
      const lines = [
        `${emoji} *${ctx.prefix}${cmd.name}* — ${cmd.category}`,
        `▸ Descrição: ${cmd.description || '-'}`,
        `▸ Uso: ${cmd.usage || ctx.prefix + cmd.name}`,
        `▸ Aliases: ${aliases.length ? aliases.join(', ') : '-'}`,
        `▸ Permissão: ${permissionLabel(cmd)}`,
        `▸ Cooldown: ${cmd.cooldown ? Math.round(cmd.cooldown / 1000) + 's' : CONFIG.limits.defaultCooldownMs / 1000 + 's (padrão)'}`,
        '',
        `💡 Digite *${ctx.prefix}${cmd.name}* para usar agora`,
        `📋 ${ctx.prefix}menu ${cmd.category} para ver mais da categoria`,
      ];

      const { maybeReadMore } = require('../../utils/readmore');

      try {
        const buttonHandler = require('../../handlers/buttonHandler');
        const interactive = require('../../utils/interactive');
        const commandHandler = require('../../handlers/commandHandler');

        const btnId = `use_${cmd.name}`;
        buttonHandler.registerOnce(`lua:${btnId}`, (c) => commandHandler.runByName(c, cmd.name, []));

        const helpId = `menu_${cmd.category}`;
        buttonHandler.registerOnce(`lua:${helpId}`, (c) => c.reply(`${ctx.prefix}menu ${cmd.category}`));

        const sent = await interactive.sendButtons(ctx.socket, ctx.remoteJid, {
          text: maybeReadMore(lines.join('\n')),
          footer: `${CONFIG.bot.name} • ${cmd.category}`,
          buttons: [
            { id: `lua:${btnId}`, text: `🚀 Usar ${cmd.name}` },
            { id: `lua:${helpId}`, text: `📋 Ver ${cmd.category}` },
          ],
          quoted: ctx.message,
        });

        if (!sent) await ctx.reply(maybeReadMore(lines.join('\n')));
      } catch (_) {
        await ctx.reply(maybeReadMore(lines.join('\n')));
      }
    },
  },
];
