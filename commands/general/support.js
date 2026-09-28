'use strict';

const { sendSupportContact } = require('../../utils/supportContact');

module.exports = [
  {
    name: 'support',
    commands: ['suporte', 'support'],
    category: 'general',
    description: 'Envia o contato nativo do suporte Lua.',
    usage: ',suporte',
    cooldown: 3000,
    execute: async (ctx) => {
      await sendSupportContact(ctx.socket, ctx.remoteJid, { quoted: ctx.message });
    },
  },
];
