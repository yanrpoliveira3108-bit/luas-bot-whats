/**
 * commands/general/poll.js — enquetes com confirmação obrigatória.
 *
 *   !poll       → { poll: {name, values, selectableCount, toAnnouncementGroup} }
 *   !pollresult → { pollResult: {name, values: [[opcao, votos]]} }
 *
 * Nenhum dos dois envia direto: criam uma pendência em utils/pendingPoll.js
 * (pendingPollConfirmations, chaveada por senderJid) e só disparam depois que o
 * mesmo usuário responde 1/sim/confirmar. 30 segundos para responder.
 *
 * Parâmetros opcionais usam sempre --chave=valor e podem vir em qualquer
 * posição; nunca viram parte da pergunta nem das opções.
 */

'use strict';

const poll = require('../../utils/poll');
const pendingPoll = require('../../utils/pendingPoll');

function usagePoll(ctx) {
  const p = ctx.prefix || '!';
  return [
    '📊 *Enquete* — cria uma enquete no chat (sempre com confirmação).',
    '',
    `▸ *${p}poll <pergunta> | <opção 1> | <opção 2> | ...*`,
    '',
    'Parâmetros opcionais (em qualquer posição):',
    '▸ *--selectableCount=N*  quantas opções dá para marcar (inteiro, 1 até o nº de opções; padrão 1)',
    '▸ *--announcement=true|false*  enquete para grupo de anúncio (padrão false)',
    '',
    `Ex: ${p}poll Qual linguagem você prefere? | Lua | JavaScript | Python`,
    `Ex: ${p}poll Qual linguagem você prefere? | Lua | JavaScript | Python --selectableCount=2 --announcement=false`,
  ].join('\n');
}

function usagePollResult(ctx) {
  const p = ctx.prefix || '!';
  return [
    '📈 *Resultado de enquete* — envia o placar de uma enquete (sempre com confirmação).',
    '',
    `▸ *${p}pollresult <nome> | <opção>:<votos> | <opção>:<votos> | ...*`,
    '',
    'Parâmetros opcionais (em qualquer posição):',
    '▸ *--announcement=true|false*  (padrão false)',
    '',
    `Ex: ${p}pollresult Minha enquete | Lua:1000 | JavaScript:2000 | Python:500`,
  ].join('\n');
}

/** Mensagem quando já existe uma confirmação de enquete aguardando. */
function alreadyPending(ctx) {
  const pending = pendingPoll.get(ctx.sender);
  if (!pending) return null;
  const left = Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000));
  const what = pending.type === 'pollResult' ? 'resultado de enquete' : 'enquete';
  return [
    `⏳ Você já tem uma confirmação de ${what} aguardando resposta.`,
    `Responda *1* para enviar ou *2* para cancelar (restam ${left}s).`,
  ].join('\n');
}

module.exports = [
  {
    name: 'poll',
    commands: ['poll', 'enquete'],
    category: 'general',
    description:
      'Cria e envia uma enquete no chat, com pergunta e opções separadas por "|". Pede confirmação antes de enviar.',
    usage: '!poll <pergunta> | <opção 1> | <opção 2> [--selectableCount=N] [--announcement=true|false]',
    examples: [
      '!poll Qual linguagem você prefere? | Lua | JavaScript | Python',
      '!poll Qual linguagem você prefere? | Lua | JavaScript --selectableCount=2',
    ],
    cooldown: 10000,
    execute: async (ctx) => {
      const waiting = alreadyPending(ctx);
      if (waiting) return ctx.reply(waiting);

      const raw = (ctx.args || []).join(' ').trim();
      if (!raw) return ctx.reply(usagePoll(ctx));

      const parsed = poll.parsePoll(raw);
      if (!parsed.ok) return ctx.reply(`${parsed.error}\n\n${usagePoll(ctx)}`);

      const pending = pendingPoll.set(ctx.sender, {
        type: 'poll',
        jid: ctx.remoteJid,
        data: parsed.poll,
        remoteJid: ctx.remoteJid,
        socket: ctx.socket,
      });
      return ctx.reply(pendingPoll.promptText(pending));
    },
  },
  {
    name: 'pollresult',
    commands: ['pollresult', 'resultadoenquete'],
    category: 'general',
    description:
      'Envia o resultado (placar de votos) de uma enquete no formato opção:votos. Pede confirmação antes de enviar.',
    usage: '!pollresult <nome> | <opção>:<votos> | <opção>:<votos> [--announcement=true|false]',
    examples: ['!pollresult Minha enquete | Lua:1000 | JavaScript:2000 | Python:500'],
    cooldown: 10000,
    execute: async (ctx) => {
      const waiting = alreadyPending(ctx);
      if (waiting) return ctx.reply(waiting);

      const raw = (ctx.args || []).join(' ').trim();
      if (!raw) return ctx.reply(usagePollResult(ctx));

      const parsed = poll.parsePollResult(raw);
      if (!parsed.ok) return ctx.reply(`${parsed.error}\n\n${usagePollResult(ctx)}`);

      const pending = pendingPoll.set(ctx.sender, {
        type: 'pollResult',
        jid: ctx.remoteJid,
        data: parsed.pollResult,
        announcement: parsed.announcement,
        remoteJid: ctx.remoteJid,
        socket: ctx.socket,
      });
      return ctx.reply(pendingPoll.promptText(pending));
    },
  },
];
