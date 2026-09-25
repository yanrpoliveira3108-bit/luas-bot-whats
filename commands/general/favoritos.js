/**
 * commands/general/favoritos.js — Gerenciamento de comandos favoritos do usuário.
 *
 * Comandos:
 * - !favoritos — Lista os favoritos salvos
 * - !favorito adicionar <comando> — Salva um comando
 * - !favorito remover <comando> — Remove dos favoritos
 */

'use strict';

const favorites = require('../../database/favorites');
const { commandEmoji } = require('../../utils/commandEmoji');
const { maybeReadMore } = require('../../utils/readmore');

module.exports = [
  {
    name: 'favoritos',
    commands: ['favoritos', 'favs', 'meusfavoritos'],
    category: 'general',
    description: 'Lista seus comandos favoritos salvos.',
    usage: '!favoritos',
    cooldown: 2000,
    execute: async (ctx) => {
      const list = favorites.listFavorites(ctx.sender);
      if (!list.length) {
        return ctx.reply(
          `⭐ *Seus Favoritos*\n\n` +
          `Você ainda não tem nenhum comando salvo.\n` +
          `Para adicionar um comando aos favoritos, use:\n` +
          `▸ *${ctx.prefix}favorito adicionar <comando>*\n\n` +
          `Exemplo: *${ctx.prefix}favorito adicionar play*`
        );
      }

      const lines = [
        `⭐ *MEUS COMANDOS FAVORITOS* (${list.length})`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ];

      for (const item of list) {
        const emoji = commandEmoji(item.cmd);
        const dynamicUsage = item.cmd.usage
          ? item.cmd.usage.replace(/^[!/.]/, ctx.prefix)
          : `${ctx.prefix}${item.name}`;
        lines.push(`${emoji} *${ctx.prefix}${item.name}* — ${item.cmd.description || '-'}`);
        lines.push(`   └ \`${dynamicUsage}\``);
      }

      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push(`💡 Adicionar: *${ctx.prefix}favorito add <cmd>* • Remover: *${ctx.prefix}favorito rm <cmd>*`);

      await ctx.reply(maybeReadMore(lines.join('\n')));
    },
  },
  {
    name: 'favorito',
    commands: ['favorito', 'fav'],
    category: 'general',
    description: 'Adiciona ou remove comandos dos seus favoritos.',
    usage: '!favorito adicionar <comando> | !favorito remover <comando>',
    cooldown: 2000,
    execute: async (ctx) => {
      const sub = (ctx.args[0] || '').toLowerCase();
      const targetCmd = (ctx.args[1] || '').toLowerCase().trim();

      if (['adicionar', 'add', 'salvar', '+'].includes(sub)) {
        if (!targetCmd) return ctx.reply(`⚠️ Informe qual comando deseja favoritar. Ex: *${ctx.prefix}favorito adicionar play*`);
        const res = favorites.addFavorite(ctx.sender, targetCmd);
        if (!res.ok) {
          return ctx.reply(`❌ Não foi possível favoritar: comando *${targetCmd}* não encontrado.`);
        }
        return ctx.reply(`⭐ Comando *${ctx.prefix}${res.command.name}* adicionado aos seus favoritos!\nUse *${ctx.prefix}favoritos* para ver sua lista.`);
      }

      if (['remover', 'rm', 'del', 'delete', '-'].includes(sub)) {
        if (!targetCmd) return ctx.reply(`⚠️ Informe qual comando deseja remover. Ex: *${ctx.prefix}favorito remover play*`);
        const res = favorites.removeFavorite(ctx.sender, targetCmd);
        if (!res.ok) {
          return ctx.reply(`⚠️ O comando *${targetCmd}* não estava na sua lista de favoritos.`);
        }
        return ctx.reply(`🗑️ Comando *${ctx.prefix}${res.commandName}* removido dos seus favoritos.`);
      }

      return ctx.reply(
        `💡 *Como usar o favoritos:*\n` +
        `▸ *${ctx.prefix}favorito adicionar <comando>* — Adiciona à lista\n` +
        `▸ *${ctx.prefix}favorito remover <comando>* — Remove da lista\n` +
        `▸ *${ctx.prefix}favoritos* — Mostra todos os seus salvos`
      );
    },
  },
];
