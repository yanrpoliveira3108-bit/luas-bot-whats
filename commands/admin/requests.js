'use strict';

const buttonHandler = require('../../handlers/buttonHandler');
const logger = require('../../utils/logger').child('requests');
const { resolveTarget } = require('../_shared/admin');

function enc(jid) {
  return jid.replace(/@/g, ':').replace(/\./g, '-');
}

/**
 * Lista os pedidos de entrada pendentes.
 *
 * REGRESSÃO CORRIGIDA: o Baileys devolve um ARRAY de attrs
 * (`participants.map(v => v.attrs)` em vendor/.../Socket/groups.js), mas aqui se
 * lia `res.participants` — sempre undefined, então o bot respondia "nenhum
 * pedido pendente" com a fila cheia. Aceitamos as duas formas por segurança.
 */
async function listPending(ctx) {
  const sock = ctx.socket;
  if (typeof sock.groupRequestParticipantsList !== 'function') {
    return null;
  }
  let res;
  try {
    res = await sock.groupRequestParticipantsList(ctx.remoteJid);
  } catch (err) {
    logger.warn({ err: err.message }, 'falha ao consultar pedidos de entrada');
    const e = new Error(
      'Não consegui consultar os pedidos. Verifique se o grupo exige aprovação de membros e se eu sou admin.'
    );
    e.code = 'REQUESTS_QUERY_FAILED';
    e.cause = err;
    throw e;
  }
  const list = Array.isArray(res)
    ? res
    : res && Array.isArray(res.participants)
      ? res.participants
      : [];
  return list
    .filter((p) => p && p.jid)
    .map((p) => ({ jid: String(p.jid), requestTime: p.request_time || p.requestTime || null }));
}

/**
 * Aplica approve/reject e devolve o resultado REAL por participante:
 * o Baileys retorna [{ status, jid }] onde status é '200' ou o código de erro.
 */
async function updateRequests(ctx, jids, action) {
  const res = await ctx.socket.groupRequestParticipantsUpdate(ctx.remoteJid, jids, action);
  const list = Array.isArray(res) ? res : [];
  const okJids = [];
  const failed = [];
  for (const r of list) {
    if (!r || !r.jid) continue;
    if (String(r.status || '200') === '200') okJids.push(String(r.jid));
    else failed.push({ jid: String(r.jid), status: String(r.status) });
  }
  return { ok: okJids, failed, total: jids.length };
}

async function approveOne(ctx, jid) {
  return updateRequests(ctx, [jid], 'approve');
}

async function rejectOne(ctx, jid) {
  return updateRequests(ctx, [jid], 'reject');
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
      const result = await updateRequests(ctx, jids, 'approve');
      const lines = [`✅ ${result.ok.length} de ${result.total} pedidos aprovados.`];
      if (result.failed.length) {
        lines.push(`⚠️ ${result.failed.length} falharam: ${result.failed.map((f) => `${f.jid.split('@')[0]} (${f.status})`).join(', ')}`);
        lines.push('Motivo comum: o pedido já tinha sido respondido ou o grupo mudou a regra de entrada.');
      }
      await ctx.reply(lines.join('\n'));
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
      const result = await updateRequests(ctx, jids, 'reject');
      const lines = [`❌ ${result.ok.length} de ${result.total} pedidos rejeitados.`];
      if (result.failed.length) {
        lines.push(`⚠️ ${result.failed.length} falharam: ${result.failed.map((f) => `${f.jid.split('@')[0]} (${f.status})`).join(', ')}`);
      }
      await ctx.reply(lines.join('\n'));
    },
  },
];
