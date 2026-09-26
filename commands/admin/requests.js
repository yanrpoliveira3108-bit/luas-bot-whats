'use strict';

const alvoUtil = require('../../utils/alvo');

const buttonHandler = require('../../handlers/buttonHandler');
const logger = require('../../utils/logger').child('requests');
const { resolveTarget } = require('../_shared/admin');
const { listPending, approveRequests, rejectRequests } = require('../../utils/groupRequests');
const captcha = require('../../utils/captchaManager');

function enc(jid) {
  return jid.replace(/@/g, ':').replace(/\./g, '-');
}

function resumo(acao, result) {
  const verbo = acao === 'approve' ? 'aprovados' : 'rejeitados';
  const falha = acao === 'approve' ? 'não puderam ser aprovados' : 'não puderam ser rejeitados';
  if (!result.success && !result.failed) return 'Nenhum pedido processado.';
  if (!result.failed) return `✅ ${result.success} pedidos ${verbo}.`;
  if (!result.success) return `⚠️ Nenhum pedido foi ${acao === 'approve' ? 'aprovado' : 'rejeitado'}; ${result.failed} falharam.`;
  return `✅ ${result.success} pedidos ${verbo}. ⚠️ ${result.failed} ${falha}.`;
}

async function approveOne(ctx, jid) {
  const result = await approveRequests(ctx.socket, ctx.remoteJid, [{ jid }]);
  if (result.success) await captcha.cancelFor(ctx.remoteJid, jid, 'manual-approve');
  return result;
}

async function rejectOne(ctx, jid) {
  const result = await rejectRequests(ctx.socket, ctx.remoteJid, [{ jid }]);
  if (result.success) await captcha.cancelFor(ctx.remoteJid, jid, 'manual-reject');
  return result;
}

async function cancelSuccessful(ctx, result, reason) {
  for (const item of result.results || []) if (item.ok) await captcha.cancelFor(ctx.remoteJid, item.jid, reason);
}

module.exports = [
  {
    name: 'pedidos',
    commands: ['pedidos', 'solicitacoes'],
    category: 'admin',
    adminOnly: true,
    botAdmin: true,
    groupOnly: true,
    description: 'Mostra pedidos pendentes para entrar no grupo.',
    usage: '!pedidos',
    cooldown: 5000,
    execute: async (ctx) => {
      const pending = await listPending(ctx.socket, ctx.remoteJid);
      if (!pending.length) {
        return ctx.reply('✅ Nenhum pedido pendente.');
      }

      await ctx.reply(`📥 *Pedidos pendentes (${pending.length})*`);

      for (const p of pending) {
        const jid = p.jid;
        const idApprove = `lua:req:approve:${enc(jid)}`;
        const idReject = `lua:req:reject:${enc(jid)}`;
        buttonHandler.register(idApprove, async (c) => {
          const result = await approveOne(c, jid);
          await c.reply(resumo('approve', result), { mentions: [jid] });
        });
        buttonHandler.register(idReject, async (c) => {
          const result = await rejectOne(c, jid);
          await c.reply(resumo('reject', result), { mentions: [jid] });
        });
        try {
          await ctx.sendList({
            title: '🔔 Pedido de entrada',
            text: `Solicitação de *@${jid.split('@')[0]}*\nEscolha uma ação:`,
            footer: 'Grupo • ações de admin',
            buttonText: '👑 Ações',
            sections: [
              {
                title: `@${jid.split('@')[0]}`,
                rows: [
                  { id: idApprove, title: '✅ APROVAR' },
                  { id: idReject, title: '❌ REJEITAR' },
                ],
              },
            ],
          });
        } catch (err) {
          logger.warn({ err: err.message }, 'lista de pedido falhou');
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
    botAdmin: true,
    groupOnly: true,
    description: 'Aprova um pedido de entrada.',
    usage: '!aprovar @usuario',
    cooldown: 2000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply(alvoUtil.dica(ctx.prefix, 'aprovar', ''));
      const result = await approveOne(ctx, target);
      await ctx.reply(resumo('approve', result), { mentions: [target] });
    },
  },
  {
    name: 'rejeitar',
    commands: ['rejeitar', 'recusar'],
    category: 'admin',
    adminOnly: true,
    botAdmin: true,
    groupOnly: true,
    description: 'Rejeita um pedido de entrada.',
    usage: '!rejeitar @usuario',
    cooldown: 2000,
    execute: async (ctx) => {
      const target = resolveTarget(ctx);
      if (!target) return ctx.reply(alvoUtil.dica(ctx.prefix, 'rejeitar', ''));
      const result = await rejectOne(ctx, target);
      await ctx.reply(resumo('reject', result), { mentions: [target] });
    },
  },
  {
    name: 'aprovarall',
    commands: ['aprovarall'],
    category: 'admin',
    adminOnly: true,
    botAdmin: true,
    groupOnly: true,
    description: 'Aprova todos os pedidos pendentes.',
    usage: '!aprovarall',
    cooldown: 5000,
    execute: async (ctx) => {
      const pending = await listPending(ctx.socket, ctx.remoteJid);
      if (!pending.length) return ctx.reply('✅ Nenhum pedido pendente.');
      const result = await approveRequests(ctx.socket, ctx.remoteJid, pending);
      await cancelSuccessful(ctx, result, 'manual-approve-all');
      await ctx.reply(resumo('approve', result));
    },
  },
  {
    name: 'rejeitarall',
    commands: ['rejeitarall'],
    category: 'admin',
    adminOnly: true,
    botAdmin: true,
    groupOnly: true,
    description: 'Rejeita todos os pedidos pendentes.',
    usage: '!rejeitarall',
    cooldown: 5000,
    execute: async (ctx) => {
      const pending = await listPending(ctx.socket, ctx.remoteJid);
      if (!pending.length) return ctx.reply('✅ Nenhum pedido pendente.');
      const result = await rejectRequests(ctx.socket, ctx.remoteJid, pending);
      await cancelSuccessful(ctx, result, 'manual-reject-all');
      await ctx.reply(resumo('reject', result));
    },
  },
];
