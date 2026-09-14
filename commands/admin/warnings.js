'use strict';

const groups = require('../../database/groups');
const groupHandler = require('../../handlers/groupHandler');
const { resolveTarget, requireGroupAdmin } = require('../_shared/admin');
const { formatDate } = require('../../utils/formatter');

module.exports = [
  {
    name: 'advertir',
    commands: ['advertir', 'adv', 'warn'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Aplica uma advertência a um usuário.',
    usage: '!advertir @usuario [motivo]',
    cooldown: 2000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !advertir @usuario [motivo]');
      const reason = ctx.args.slice(1).join(' ') || 'Sem motivo informado';
      const { count, action } = await groupHandler.applyWarningFlow(ctx.socket, ctx.remoteJid, target, reason, ctx.sender);

      const ACTION_LABEL = { aviso: '📢 aviso enviado', kick: '👢 usuário removido' };
      await ctx.reply(
        `⚠️ *Advertência aplicada*\n▸ Usuário: @${target.split('@')[0]}\n▸ Total: ${count}\n▸ Ação: ${ACTION_LABEL[action] || action}`,
        { mentions: [target] }
      );
    },
  },
  {
    name: 'rmadv',
    commands: ['rmadv', 'removeradv', 'unwarn'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Remove a última advertência do usuário.',
    usage: '!rmadv @usuario',
    cooldown: 2000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !rmadv @usuario');
      const removed = groups.removeLastWarning(ctx.remoteJid, target);
      if (!removed) return ctx.reply('ℹ️ Este usuário não possui advertências.');
      await ctx.reply(`✅ Última advertência de @${target.split('@')[0]} removida.`, { mentions: [target] });
    },
  },
  {
    name: 'warnings',
    commands: ['warnings', 'advertencias', 'advs'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Lista as advertências de um usuário.',
    usage: '!warnings @usuario',
    cooldown: 2000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !warnings @usuario');
      const list = groups.getWarnings(ctx.remoteJid, target);
      if (!list.length) return ctx.reply(`✅ @${target.split('@')[0]} não tem advertências.`, { mentions: [target] });
      const lines = list.map((w, i) => `${i + 1}. ${w.reason} — ${formatDate(new Date(w.created_at).getTime())}`);
      await ctx.reply(`⚠️ *Advertências de @${target.split('@')[0]} (${list.length})*\n${lines.join('\n')}`, { mentions: [target] });
    },
  },
  {
    name: 'resetadv',
    commands: ['resetadv', 'limparadv'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Zera as advertências de um usuário.',
    usage: '!resetadv @usuario',
    cooldown: 2000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !resetadv @usuario');
      groups.clearWarnings(ctx.remoteJid, target);
      await ctx.reply(`✅ Advertências de @${target.split('@')[0]} zeradas.`, { mentions: [target] });
    },
  },
];
