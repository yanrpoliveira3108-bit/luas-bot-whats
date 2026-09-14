'use strict';

const CONFIG = require('../../config');
const settings = require('../../database/settings');

module.exports = [
  {
    name: 'botao',
    commands: ['botao', 'botões', 'botoes', 'buttons'],
    category: 'general',
    description: 'Liga/desliga os botões interativos (alterar = dono).',
    usage: '!botao | !botao on | !botao off',
    cooldown: 1000,
    execute: async (ctx) => {
      const arg = String(ctx.args[0] || '').toLowerCase();
      const ON = ['on', 'ligar', 'ativar', 'ativo', '1'];
      const OFF = ['off', 'desligar', 'desativar', 'inativo', '0'];
      const isOn = ON.includes(arg);
      const isOff = OFF.includes(arg);

      if (arg && !isOn && !isOff) {
        await ctx.reply('⚠️ Use: *!botao on* ou *!botao off*');
        return;
      }

      if (isOn || isOff) {
        if (!ctx.isOwner) {
          await ctx.reply(CONFIG.messages.deniedOwner);
          return;
        }
        settings.setButtonsEnabled(isOn);
        await ctx.reply(`LUA\n\nSistema de botões:\n${isOn ? 'ATIVADO' : 'DESATIVADO'}`);
        return;
      }

      const enabled = settings.buttonsEnabled();
      await ctx.reply(`LUA\n\nBotões: ${enabled ? 'ATIVADOS' : 'DESATIVADOS'}`);
    },
  },
];
