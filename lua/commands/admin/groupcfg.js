'use strict';

const groups = require('../../database/groups');
const { getParticipants } = require('../_shared/admin');
const commandHandler = require('../../handlers/commandHandler');

module.exports = [
  {
    name: 'grupo',
    commands: ['grupo', 'grupoinfo'],
    category: 'admin',
    groupOnly: true,
    description: 'Informações do grupo.',
    usage: '!grupo',
    cooldown: 3000,
    execute: async (ctx) => {
      const meta = await commandHandler.getGroupMetadata(ctx.socket, ctx.remoteJid);
      const g = groups.get(ctx.remoteJid);
      const filters = (g && groups.getSettings(ctx.remoteJid).filters) || {};
      const active = Object.values(filters).filter(Boolean).length;
      await ctx.reply(
        [
          `👥 *${meta.subject || 'Grupo'}*`,
          `▸ ID: \`${ctx.remoteJid}\``,
          `▸ Descrição: ${meta.desc ? meta.desc.slice(0, 120) : '-'}`,
          `▸ Membros: ${meta.participants.length}`,
          `▸ Filtros ativos: ${active}`,
          `▸ Anúncios: ${meta.announce ? 'somente admins' : 'todos'}`,
        ].join('\n')
      );
    },
  },
  {
    name: 'abrirgrupo',
    commands: ['abrirgrupo', 'abrir'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Abre o grupo para todos enviarem mensagens.',
    usage: '!abrirgrupo',
    cooldown: 3000,
    execute: async (ctx) => {
      await ctx.socket.groupSettingUpdate(ctx.remoteJid, 'not_announcement');
      await ctx.reply('🔓 Grupo aberto: todos podem enviar mensagens.');
    },
  },
  {
    name: 'fechargrupo',
    commands: ['fechargrupo', 'fechar'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Fecha o grupo (apenas admins enviam).',
    usage: '!fechargrupo',
    cooldown: 3000,
    execute: async (ctx) => {
      await ctx.socket.groupSettingUpdate(ctx.remoteJid, 'announcement');
      await ctx.reply('🔒 Grupo fechado: apenas administradores podem enviar mensagens.');
    },
  },
  {
    name: 'nomegrupo',
    commands: ['nomegrupo', 'nome'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Altera o nome do grupo.',
    usage: '!nomegrupo <novo nome>',
    cooldown: 3000,
    execute: async (ctx) => {
      const name = ctx.args.join(' ');
      if (!name) return ctx.reply('⚠️ Envie o novo nome: !nomegrupo <nome>');
      await ctx.socket.groupUpdateSubject(ctx.remoteJid, name.slice(0, 100));
      await ctx.reply(`✅ Nome alterado para: *${name.slice(0, 100)}*`);
    },
  },
  {
    name: 'descgrupo',
    commands: ['descgrupo', 'descricao'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Altera a descrição do grupo.',
    usage: '!descgrupo <descrição>',
    cooldown: 3000,
    execute: async (ctx) => {
      const desc = ctx.args.join(' ');
      if (!desc) return ctx.reply('⚠️ Envie a nova descrição: !descgrupo <texto>');
      await ctx.socket.groupUpdateDescription(ctx.remoteJid, desc.slice(0, 500));
      await ctx.reply('✅ Descrição atualizada.');
    },
  },
  {
    name: 'linkgrupo',
    commands: ['linkgrupo', 'link'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Obtém o link de convite do grupo.',
    usage: '!linkgrupo',
    cooldown: 5000,
    execute: async (ctx) => {
      const code = await ctx.socket.groupInviteCode(ctx.remoteJid);
      await ctx.reply(`🔗 Link do grupo:\nhttps://chat.whatsapp.com/${code}`);
    },
  },
  {
    name: 'revogarlink',
    commands: ['revogarlink', 'resetarlink'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: 'Revoga o link de convite atual.',
    usage: '!revogarlink',
    cooldown: 5000,
    execute: async (ctx) => {
      await ctx.socket.groupRevokeInvite(ctx.remoteJid);
      await ctx.reply('♻️ Link de convite revogado.');
    },
  },
];
