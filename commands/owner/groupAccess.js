'use strict';

const access = require('../../utils/groupAccess');
module.exports = [
  {
    name: 'entrar', commands: ['entrar'], category: 'owner', ownerOnly: true, cooldown: 5000,
    description: 'Entra em um grupo por convite.', usage: ',entrar https://chat.whatsapp.com/CODIGO',
    execute: async (ctx) => {
      const code = access.extractInviteCode(ctx.args && ctx.args[0]);
      if (!code) return ctx.reply(`❌ Convite inválido. Use: ${ctx.prefix}entrar https://chat.whatsapp.com/CODIGO`);
      return access.withLock(`invite:${code}`, async () => {
        try {
          const result = await access.join(ctx.socket, code);
          if (result.blocked) return ctx.reply('🚫 Este grupo está bloqueado e o bot não pode entrar nele.');
          return ctx.reply('✅ Grupo conectado com sucesso.');
        } catch (err) {
          const codeError = err && err.code;
          ctx.socket && ctx.socket.logger;
          require('../../utils/logger').child('group-access').warn({ code: codeError || err.message }, '[GROUP_ACCESS] join failed');
          if (codeError === 'GROUP_NOT_FOUND' || codeError === 'JOIN_NO_GROUP_JID') return ctx.reply('❌ O convite é inválido ou expirou.');
          return ctx.reply('❌ Não consegui entrar no grupo. O convite pode ser inválido ou expirado.');
        }
      });
    },
  },
  {
    name: 'sair', commands: ['sair'], category: 'owner', ownerOnly: true, cooldown: 5000,
    description: 'Sai e bloqueia o grupo atual.', usage: ',sair',
    execute: async (ctx) => {
      if (!ctx.isGroup || !access.validGroupJid(ctx.remoteJid)) return ctx.reply('⚠️ Este comando só pode ser usado dentro de um grupo.');
      return access.withLock(`group:${ctx.remoteJid}`, async () => {
        try {
          access.block(ctx.remoteJid, ctx.sender, ctx.groupName);
          await ctx.reply('👋 Saindo do grupo.\nEste grupo foi bloqueado para novas entradas.');
          await access.leave(ctx.socket, ctx.remoteJid);
        } catch (err) {
          require('../../utils/logger').child('group-access').error({ groupJid: ctx.remoteJid, code: err.code || err.message }, '[GROUP_ACCESS] leave failed');
          return ctx.reply('❌ Não consegui sair do grupo. O bloqueio foi preservado.');
        }
      });
    },
  },
  {
    name: 'desbloqueargrupo', commands: ['desbloqueargrupo'], category: 'owner', ownerOnly: true, cooldown: 2000,
    description: 'Remove o bloqueio persistente de um grupo.', usage: ',desbloqueargrupo 120363@g.us',
    execute: async (ctx) => {
      const jid = access.validGroupJid(ctx.args && ctx.args[0]);
      if (!jid) return ctx.reply('❌ JID inválido. Use o JID real terminado em @g.us.');
      return ctx.reply(access.unblock(jid) ? '✅ Grupo desbloqueado.' : 'ℹ️ Esse grupo não estava bloqueado.');
    },
  },
  {
    name: 'gruposbloqueados', commands: ['gruposbloqueados'], category: 'owner', ownerOnly: true, cooldown: 2000,
    description: 'Lista grupos bloqueados.', usage: ',gruposbloqueados',
    execute: async (ctx) => {
      const items = access.list();
      if (!items.length) return ctx.reply('✅ Não há grupos bloqueados.');
      const lines = ['🚫 *GRUPOS BLOQUEADOS*'];
      items.forEach((item, i) => lines.push(`${i + 1}. ${item.name || 'Grupo sem nome'}\n   JID: ${item.groupJid}\n   Desde: ${item.blockedAt}\n   Motivo: saída pelo owner`));
      return ctx.reply(lines.join('\n'));
    },
  },
];
