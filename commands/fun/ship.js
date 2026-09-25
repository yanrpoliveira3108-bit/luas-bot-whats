'use strict';

const alvoUtil = require('../../utils/alvo');

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
    usage: '!ship @usuario1 @usuario2 | !ship @usuario (ou respondendo) | !ship <nome> <nome>',
    cooldown: 3000,
    execute: async (ctx) => {
      // @a @b → os dois; @a ou RESPONDENDO a mensagem de alguém → você + a
      // pessoa; sem ninguém marcado → dois nomes digitados
      let a, b;
      const r = alvoUtil.alvos(ctx, { incluirAutor: true });
      if (r.origem === 'mencao' && r.jids.length >= 2) {
        a = r.jids[0];
        b = r.jids[1];
      } else if (r.jids.length === 1 && !alvoUtil.ehAutor(ctx, r.jids[0])) {
        a = ctx.sender;
        b = r.jids[0];
      } else if (!r.jids.length && ctx.args.length >= 2) {
        a = ctx.args[0];
        b = ctx.args[1];
      } else {
        return ctx.reply(`💞 Marque duas pessoas (${ctx.prefix}ship @a @b), marque uma, ou responda a mensagem de alguém com ${ctx.prefix}ship.`);
      }
      const nameA = displayName(a);
      const nameB = displayName(b);
      const pct = hashPct(a, b);
      const text = R.ship[Math.floor(Math.random() * R.ship.length)]
        .replace('{a}', nameA)
        .replace('{b}', nameB)
        .replace('{pct}', pct);
      const mentions = [a, b].filter((j) => String(j).includes('@') && text.includes(alvoUtil.marca(j)));
      await ctx.reply(text, { mentions });
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
