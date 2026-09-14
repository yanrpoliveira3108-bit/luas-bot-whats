'use strict';

const { runInteraction, displayName } = require('../../engine/interactionEngine');
const R = require('./_responses');

function hashPct(a, b) {
  const s = (a + b).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const pct = s % 101;
  return pct === 0 ? 7 : pct;
}

module.exports = [
  {
    name: 'ship',
    commands: ['ship', 'shippar'],
    category: 'fun',
    description: 'Calcula a compatibilidade entre duas pessoas.',
    usage: '!ship @usuario1 @usuario2 | !ship <nome> <nome>',
    cooldown: 3000,
    execute: async (ctx) => {
      let a, b;
      if (ctx.mentionedJid.length >= 2) {
        a = ctx.mentionedJid[0];
        b = ctx.mentionedJid[1];
      } else if (ctx.args.length >= 2) {
        a = ctx.args[0];
        b = ctx.args[1];
      } else if (ctx.mentionedJid.length === 1) {
        a = ctx.sender;
        b = ctx.mentionedJid[0];
      } else {
        return ctx.reply('💞 Marque duas pessoas: !ship @a @b');
      }
      const nameA = displayName(a);
      const nameB = displayName(b);
      const pct = hashPct(a, b);
      const text = R.ship[Math.floor(Math.random() * R.ship.length)]
        .replace('{a}', nameA)
        .replace('{b}', nameB)
        .replace('{pct}', pct);
      await ctx.reply(text);
    },
  },
  {
    name: 'casal',
    commands: ['casal', 'casadoperfeito'],
    category: 'fun',
    description: 'Acha o "casal perfeito" do grupo.',
    usage: '!casal',
    groupOnly: true,
    cooldown: 3000,
    execute: async (ctx) => {
      const commandHandler = require('../../handlers/commandHandler');
      const meta = await commandHandler.getGroupMetadata(ctx.socket, ctx.remoteJid);
      const members = (meta.participants || []).map((p) => p.id).filter((id) => id !== ctx.socket.user.id);
      if (members.length < 2) return ctx.reply('💞 O grupo precisa de pelo menos 2 membros.');
      const a = members[Math.floor(Math.random() * members.length)];
      let b = members[Math.floor(Math.random() * members.length)];
      let guard = 0;
      while (b === a && guard++ < 10) b = members[Math.floor(Math.random() * members.length)];
      const pct = hashPct(a, b);
      await ctx.reply(
        `💘 *Casal do dia:*\n@${a.split('@')[0]} ❤️ @${b.split('@')[0]}\n▸ Compatibilidade: *${pct}%*`,
        { mentions: [a, b] }
      );
    },
  },
];
