'use strict';
const captcha = require('../../utils/captchaManager');
module.exports = {
  name: 'senha',
  commands: ['senha'],
  category: 'general',
  description: 'Gera uma senha aleatória de uso livre.',
  usage: '!senha',
  cooldown: 3000,
  execute: async (ctx) => ctx.reply(`🔐 Senha gerada: ${captcha.makeCode()}`),
};
