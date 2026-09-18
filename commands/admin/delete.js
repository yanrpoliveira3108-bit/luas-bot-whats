'use strict';

/**
 * commands/admin/delete.js — apagar UMA mensagem respondida.
 *
 * !d / !delete  (respondendo à mensagem que quer apagar)
 *   • Admin/dono  → apaga QUALQUER mensagem (inclusive a de outro admin).
 *   • Não-admin   → apaga apenas a PRÓPRIA mensagem (não apaga a de outros
 *                   membros nem a de admins).
 *   • Exige que o BOT seja admin do grupo (regra do WhatsApp para apagar
 *     mensagens de terceiros).
 *
 * Obs.: o !apagar (purge de histórico, últimas N de um usuário) é OUTRO
 * comando — este apaga somente a mensagem respondida.
 */

module.exports = [
  {
    name: 'delete',
    commands: ['d', 'delete'],
    category: 'admin',
    adminOnly: false,
    groupOnly: true,
    description: 'Apaga a mensagem respondida. Admin apaga qualquer uma; não-admin apaga só a própria.',
    usage: '!d (respondendo à mensagem) | !delete (respondendo à mensagem)',
    cooldown: 1000,
    execute: async (ctx) => {
      if (!ctx.quotedKey) {
        return ctx.reply('↩️ Responda à mensagem que você quer apagar.');
      }
      if (!ctx.isBotAdmin) {
        return ctx.reply('⚠️ Preciso ser admin do grupo para apagar mensagens.');
      }

      // Admin/dono apaga qualquer uma. Não-admin só a própria mensagem.
      const privileged = ctx.isAdmin || ctx.isOwner || ctx.isBot;
      if (!privileged) {
        const author = ctx.quotedSender || ctx.quotedKey.participant || '';
        if (!author || author !== ctx.sender) {
          return ctx.reply('🚫 Você só pode apagar a sua própria mensagem.\n_👑 Admins podem apagar qualquer mensagem._');
        }
      }

      try {
        await ctx.socket.sendMessage(ctx.remoteJid, { delete: ctx.quotedKey });
      } catch (e) {
        return ctx.reply('❌ Não consegui apagar essa mensagem.');
      }
    },
  },
];
