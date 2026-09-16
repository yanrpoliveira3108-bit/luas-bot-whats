'use strict';

const users = require('../../database/users');
const groups = require('../../database/groups');
const rpg = require('../../database/rpg');
const economy = require('../../database/economy');
const { formatDate, formatMoney } = require('../../utils/formatter');
const { displayName } = require('../../engine/interactionEngine');
const cards = require('../../utils/cards');

module.exports = [
  {
    name: 'perfil',
    commands: ['perfil', 'me', 'meuperfil'],
    category: 'members',
    description: 'Mostra seu perfil completo.',
    usage: '!perfil [@usuario]',
    cooldown: 3000,
    execute: async (ctx) => {
      const target = ctx.mentionedJid[0] || ctx.sender;
      const u = users.get(target);
      if (!u) return ctx.reply('ℹ️ Este usuário ainda não interagiu com o bot.');

      const next = users.xpForNextLevel(u.level);
      const rp = rpg.getPlayer(target);
      const eco = economy.get(target);
      const member = ctx.isGroup ? groups.memberStats(ctx.remoteJid, target) : null;

      // Card primeiro (imagem). Se o render falhar, cai no texto abaixo —
      // o comando nunca deixa de responder nem muda o que informa.
      const card = await cards.renderProfileCard({
        sock: ctx.socket,
        jid: target,
        name: displayName(target),
        number: target.split('@')[0],
        level: u.level,
        xp: u.xp,
        xpNext: next,
        reputation: u.reputation,
        messages: u.messages,
        rpg: `nv ${rp.level} (${rp.profession || 'sem profissão'})`,
        wallet: formatMoney(eco.wallet),
        bank: formatMoney(eco.bank),
        about: u.about || undefined,
      });
      if (await cards.sendCard(ctx, card, `👤 *${displayName(target)}*`)) return;

      const lines = [
        `👤 *${displayName(target)}*`,
        `▸ ID: \`${target}\``,
        `▸ Nível: ${u.level}`,
        `▸ XP: ${u.xp}/${next}`,
        `▸ Reputação: ⭐ ${u.reputation}`,
        `▸ Mensagens: ${u.messages}`,
        `▸ Entrou no grupo: ${member && member.joined_at ? formatDate(new Date(member.joined_at).getTime()) : '-'}`,
        `▸ Registrado em: ${formatDate(new Date(u.first_seen).getTime())}`,
        `▸ RPG: nível ${rp.level} (${rp.profession || 'sem profissão'})`,
        `▸ Carteira: ${formatMoney(eco.wallet)} | Banco: ${formatMoney(eco.bank)}`,
        `▸ Sobre: ${u.about || '-'}`,
      ];
      await ctx.reply(lines.join('\n'));
    },
  },
];
