'use strict';

const buttonHandler = require('../../handlers/buttonHandler');
const logger = require('../../utils/logger').child('requests');
const { resolveTarget } = require('../_shared/admin');

function enc(jid) {
  return jid.replace(/@/g, ':').replace(/\./g, '-');
}

async function listPending(ctx) {
  const sock = ctx.socket;
  if (typeof sock.groupRequestParticipantsList !== 'function') {
    return null;
  }
  const res = await sock.groupRequestParticipantsList(ctx.remoteJid);
  return (res && res.participants) || [];
}

async function approveOne(ctx, jid) {
  await ctx.socket.groupRequestParticipantsUpdate(ctx.remoteJid, [jid], 'approve');
}

async function rejectOne(ctx, jid) {
  await ctx.socket.groupRequestParticipantsUpdate(ctx.remoteJid, [jid], 'reject');
}

module.exports = [
  {
    name: 'pedidos',
    commands: ['pedidos', 'solicitacoes'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Mostra pedidos pendentes para entrar no grupo.',
    usage: '!pedidos',
    cooldown: 5000,
    execute: async (ctx) => {
      const pending = await listPending(ctx);
      if (pending === null) {
        return ctx.reply('ℹ️ Este recurso não está disponível nesta versão do WhatsApp/Baileys.');
      }
      if (!pending.length) {
        return ctx.reply('✅ Nenhum pedido pendente.');
      }

      await ctx.reply(`📥 *Pedidos pendentes (${pending.length})*`);

      for (const p of pending) {
        const jid = p.jid;
        const idApprove = `lua:req:approve:${enc(jid)}`;
        const idReject = `lua:req:reject:${enc(jid)}`;
        buttonHandler.register(idApprove, async (c) => {
          await approveOne(c, jid);
          await c.reply(`✅ @${jid.split('@')[0]} aprovado.`, { mentions: [jid] });
        });
        buttonHandler.register(idReject, async (c) => {
          await rejectOne(c, jid);
          await c.reply(`❌ @${jid.split('@')[0]} rejeitado.`, { mentions: [jid] });
        });
        try {
          await ctx.socket.sendMessage(ctx.remoteJid, {
            text: `Solicitação de *@${jid.split('@')[0]}*`,
            footer: 'Escolha uma ação',
            buttons: [
              { buttonId: idApprove, buttonText: { displayText: '✅ APROVAR' }, type: 1 },
              { buttonId: idReject, buttonText: { displayText: '❌ REJEITAR' }, type: 1 },
            ],
            headerType: 1,
          });
        } catch (err) {
          logger.warn({ err: err.message }, 'botões de pedido falharam');
          await ctx.reply(
            `Pedido de @${jid.split('@')[0]} — use ${ctx.prefix}aprovar @${jid.split('@')[0]} ou ${ctx.prefix}rejeitar @${jid.split('@')[0]}`,
            { mentions: [jid] }
          );
        }
      }
    },
  },
  {
    name: 'aprovar',
    commands: ['aprovar', 'aceitar'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Aprova um pedido de entrada.',
    usage: '!aprovar @usuario',
    cooldown: 2000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !aprovar @usuario');
      await approveOne(ctx, target);
      await ctx.reply(`✅ @${target.split('@')[0]} aprovado.`, { mentions: [target] });
    },
  },
  {
    name: 'rejeitar',
    commands: ['rejeitar', 'recusar'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Rejeita um pedido de entrada.',
    usage: '!rejeitar @usuario',
    cooldown: 2000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply('⚠️ Marque o usuário: !rejeitar @usuario');
      await rejectOne(ctx, target);
      await ctx.reply(`❌ @${target.split('@')[0]} rejeitado.`, { mentions: [target] });
    },
  },
  {
    name: 'aprovarall',
    commands: ['aprovarall'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Aprova todos os pedidos pendentes.',
    usage: '!aprovarall',
    cooldown: 5000,
    execute: async (ctx) => {
      const pending = await listPending(ctx);
      if (pending === null) return ctx.reply('ℹ️ Recurso indisponível nesta versão.');
      if (!pending.length) return ctx.reply('✅ Nenhum pedido pendente.');
      const jids = pending.map((p) => p.jid);
      await ctx.socket.groupRequestParticipantsUpdate(ctx.remoteJid, jids, 'approve');
      await ctx.reply(`✅ ${jids.length} pedidos aprovados.`);
    },
  },
  {
    name: 'rejeitarall',
    commands: ['rejeitarall'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Rejeita todos os pedidos pendentes.',
    usage: '!rejeitarall',
    cooldown: 5000,
    execute: async (ctx) => {
      const pending = await listPending(ctx);
      if (pending === null) return ctx.reply('ℹ️ Recurso indisponível nesta versão.');
      if (!pending.length) return ctx.reply('✅ Nenhum pedido pendente.');
      const jids = pending.map((p) => p.jid);
      await ctx.socket.groupRequestParticipantsUpdate(ctx.remoteJid, jids, 'reject');
      await ctx.reply(`❌ ${jids.length} pedidos rejeitados.`);
    },
  },
];
