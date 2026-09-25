'use strict';

const groups = require('../../database/groups');
const { getParticipants, resolveTarget, removeBan, mudarParticipante } = require('../_shared/admin');
const alvoUtil = require('../../utils/alvo');

module.exports = [
  {
    name: 'promover',
    commands: ['promover', 'promote'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Promove um membro a administrador.',
    usage: '!promover @usuario (ou responda a mensagem da pessoa)',
    cooldown: 3000,
    execute: async (ctx) => mudarParticipante(ctx, 'promote'),
  },
  {
    name: 'rebaixar',
    commands: ['rebaixar', 'demote'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Remove o cargo de administrador.',
    usage: '!rebaixar @usuario (ou responda a mensagem da pessoa)',
    cooldown: 3000,
    execute: async (ctx) => mudarParticipante(ctx, 'demote'),
  },
  {
    name: 'kick',
    commands: ['kick', 'remover', 'expulsar'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Remove um membro do grupo.',
    usage: '!kick @usuario (ou responda a mensagem da pessoa)',
    cooldown: 3000,
    execute: async (ctx) => mudarParticipante(ctx, 'remove'),
  },
  {
    name: 'ban',
    commands: ['ban', 'banir'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Remove e impede o retorno do usuário.',
    usage: '!ban @usuario (ou responda a mensagem da pessoa)',
    cooldown: 3000,
    execute: async (ctx) => mudarParticipante(ctx, 'ban'),
  },
  {
    name: 'unban',
    commands: ['unban', 'desbanir'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Remove o banimento de um usuário.',
    usage: '!unban @usuario (ou responda a mensagem da pessoa)',
    cooldown: 3000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply(alvoUtil.dica(ctx.prefix, 'unban'));
      removeBan(ctx.remoteJid, target);
      await ctx.reply(`✅ ${alvoUtil.marca(target)} foi desbanido.`, { mentions: [target] });
    },
  },
  {
    name: 'adicionar',
    commands: ['adicionar', 'add'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Adiciona um usuário pelo número.',
    usage: '!adicionar 5511...',
    cooldown: 5000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply('⚠️ Informe o número: !adicionar 5511999999999');
      await ctx.socket.groupParticipantsUpdate(ctx.remoteJid, [target], 'add');
      await ctx.reply(`➕ ${target.split('@')[0]} adicionado.`);
    },
  },
  {
    name: 'marcar',
    commands: ['marcar', 'tagall', 'todos'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Marca todos os membros do grupo.',
    usage: '!marcar <mensagem>',
    cooldown: 5000,
    execute: async (ctx) => {
      const parts = await getParticipants(ctx);
      const mentions = parts.map((p) => p.id).filter((id) => id !== ctx.socket.user.id);
      const msg = ctx.args.join(' ') || '📢 Atenção!';
      const text = `${msg}\n\n` + mentions.map((m) => `@${m.split('@')[0]}`).join(' ');
      await ctx.socket.sendMessage(ctx.remoteJid, { text: text.slice(0, 4000), mentions });
    },
  },
  {
    name: 'hidetag',
    commands: ['hidetag'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Marca todos sem mostrar os nomes.',
    usage: '!hidetag <mensagem>',
    cooldown: 5000,
    execute: async (ctx) => {
      const parts = await getParticipants(ctx);
      const mentions = parts.map((p) => p.id).filter((id) => id !== ctx.socket.user.id);
      const text = ctx.args.join(' ') || '📢';
      await ctx.socket.sendMessage(ctx.remoteJid, { text, mentions });
    },
  },
  {
    name: 'admins',
    commands: ['admins'],
    category: 'admin',
    groupOnly: true,
    description: 'Lista os administradores do grupo.',
    usage: '!admins',
    cooldown: 3000,
    execute: async (ctx) => {
      const parts = await getParticipants(ctx);
      const admins = parts.filter((p) => p.admin === 'admin' || p.admin === 'superadmin');
      const lines = admins.map((a, i) => `${i + 1}. @${a.id.split('@')[0]}`);
      await ctx.reply(`👑 *Administradores (${admins.length})*\n${lines.join('\n')}`, { mentions: admins.map((a) => a.id) });
    },
  },
  {
    name: 'membros',
    commands: ['membros'],
    category: 'admin',
    groupOnly: true,
    description: 'Lista os membros do grupo.',
    usage: '!membros',
    cooldown: 5000,
    execute: async (ctx) => {
      const parts = await getParticipants(ctx);
      const members = parts.slice(0, 50);
      const lines = members.map((m, i) => `${i + 1}. @${m.id.split('@')[0]}${m.admin ? ' 👑' : ''}`);
      await ctx.reply(`👥 *Membros (${parts.length})*\n${lines.join('\n')}${parts.length > 50 ? '\n…' : ''}`, {
        mentions: members.map((m) => m.id),
      });
    },
  },
  {
    name: 'inativos',
    commands: ['inativos'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Membros sem mensagens nas últimas horas.',
    usage: '!inativos [horas]',
    cooldown: 5000,
    execute: async (ctx) => {
      const hours = parseInt(ctx.args[0], 10) || 72;
      const list = groups.inactiveMembers(ctx.remoteJid, hours, 20);
      if (!list.length) {
        await ctx.reply(`✅ Nenhum membro inativo nas últimas ${hours}h.`);
        return;
      }
      const lines = list.map((m, i) => `${i + 1}. @${m.user_id.split('@')[0]} — ${m.message_count} msgs`);
      await ctx.reply(`😴 *Inativos (${hours}h, ${list.length})*\n${lines.join('\n')}`, { mentions: list.map((m) => m.user_id) });
    },
  },
];
