'use strict';

const groups = require('../../database/groups');
const { getParticipants, resolveTarget, requireGroupAdmin, addBan, removeBan } = require('../_shared/admin');

module.exports = [
  {
    name: 'promover',
    commands: ['promover', 'promote'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Promove um membro a administrador.',
    usage: '!promover @usuario',
    cooldown: 3000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !promover @usuario');
      await ctx.socket.groupParticipantsUpdate(ctx.remoteJid, [target], 'promote');
      await ctx.reply(`👑 @${target.split('@')[0]} foi promovido a admin.`, { mentions: [target] });
    },
  },
  {
    name: 'rebaixar',
    commands: ['rebaixar', 'demote'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Remove o cargo de administrador.',
    usage: '!rebaixar @usuario',
    cooldown: 3000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !rebaixar @usuario');
      await ctx.socket.groupParticipantsUpdate(ctx.remoteJid, [target], 'demote');
      await ctx.reply(`⬇️ @${target.split('@')[0]} foi rebaixado.`, { mentions: [target] });
    },
  },
  {
    name: 'kick',
    commands: ['kick', 'remover', 'expulsar', 'remove'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Remove um membro do grupo.',
    usage: '!kick @usuario',
    cooldown: 3000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !kick @usuario');
      if (target === ctx.socket.user.id) return ctx.reply('🤨 Não vou me remover.');
      await ctx.socket.groupParticipantsUpdate(ctx.remoteJid, [target], 'remove');
      await ctx.reply(`👢 @${target.split('@')[0]} foi removido.`, { mentions: [target] });
    },
  },
  {
    name: 'ban',
    commands: ['ban', 'banir'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Remove e impede o retorno do usuário.',
    usage: '!ban @usuario',
    cooldown: 3000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !ban @usuario');
      if (target === ctx.socket.user.id) return ctx.reply('🤨 Não posso me banir.');
      addBan(ctx.remoteJid, target);
      await ctx.socket.groupParticipantsUpdate(ctx.remoteJid, [target], 'remove');
      await ctx.reply(`⛔ @${target.split('@')[0]} foi banido do grupo.`, { mentions: [target] });
    },
  },
  {
    name: 'unban',
    commands: ['unban', 'desbanir'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Remove o banimento de um usuário.',
    usage: '!unban @usuario',
    cooldown: 3000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !unban @usuario');
      removeBan(ctx.remoteJid, target);
      await ctx.reply(`✅ @${target.split('@')[0]} foi desbanido.`, { mentions: [target] });
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
    commands: ['marcar', 'tagall', 'todos', 'everyone'],
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
    commands: ['membros', 'members'],
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
