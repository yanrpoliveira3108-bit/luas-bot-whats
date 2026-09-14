'use strict';

const session = require('../../utils/session');
const games = require('../../database/games');

module.exports = [
  {
    name: 'batalha',
    commands: ['batalha', 'lutar', 'duelo'],
    category: 'games',
    description: 'Batalha em turnos contra o bot.',
    usage: '!batalha (depois: atacar|defender|curar)',
    cooldown: 5000,
    execute: async (ctx) => {
      const state = { userHp: 100, botHp: 100, round: 1 };
      session.set(ctx.remoteJid, ctx.sender, {
        type: 'batalha',
        onMessage: async (c) => {
          const cmd = c.text.trim().toLowerCase();
          if (cmd.startsWith('!cancelar')) {
            session.clear(c.remoteJid, c.sender);
            await c.reply('❌ Batalha cancelada.');
            return;
          }
          let log = [];
          if (cmd === 'atacar' || cmd === 'ataque') {
            const dmg = 10 + Math.floor(Math.random() * 15);
            state.botHp -= dmg;
            log.push(`🗡️ Você atacou: -${dmg} HP no bot.`);
          } else if (cmd === 'defender') {
            log.push('🛡️ Você se defendeu (dano do bot reduzido).');
          } else if (cmd === 'curar') {
            const heal = 10 + Math.floor(Math.random() * 15);
            state.userHp = Math.min(100, state.userHp + heal);
            log.push(`💚 Você curou +${heal} HP.`);
          } else {
            await c.reply('⚔️ Use: *atacar*, *defender* ou *curar*.');
            return;
          }
          // turno do bot
          if (state.botHp > 0) {
            const dmg = cmd === 'defender' ? Math.floor((8 + Math.random() * 10) / 2) : 8 + Math.floor(Math.random() * 14);
            state.userHp -= dmg;
            log.push(`🤖 O bot atacou: -${dmg} HP em você.`);
          }

          if (state.botHp <= 0) {
            session.clear(c.remoteJid, c.sender);
            games.recordGame(c.sender, 'batalha', 'win');
            await c.reply(`${log.join('\n')}\n\n🏆 *Você venceu a batalha!*`);
            return;
          }
          if (state.userHp <= 0) {
            session.clear(c.remoteJid, c.sender);
            games.recordGame(c.sender, 'batalha', 'loss');
            await c.reply(`${log.join('\n')}\n\n💀 Você foi derrotado...`);
            return;
          }
          state.round++;
          await c.reply(`${log.join('\n')}\n\n▸ Você: ${Math.max(0, state.userHp)} HP\n▸ Bot: ${Math.max(0, state.botHp)} HP\n*Rodada ${state.round}* — atacar, defender ou curar?`);
        },
      });
      await ctx.reply('⚔️ *Batalha iniciada!*\n▸ Você: 100 HP\n▸ Bot: 100 HP\nEscolha: *atacar*, *defender* ou *curar*.');
    },
  },
];
