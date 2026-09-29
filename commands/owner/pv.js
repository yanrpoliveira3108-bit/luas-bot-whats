'use strict';
const pv = require('../../utils/pvPolicy');
module.exports = [{
  name: 'pv', commands: ['pv'], category: 'owner', ownerOnly: true, cooldown: 1000,
  description: 'Política simples de mensagens privadas automáticas.', usage: '.pv on|off|status',
  execute: async (ctx) => {
    if (!ctx.isOwner) return ctx.reply('🚫 Apenas o dono pode alterar a política de PV.');
    const op = String(ctx.args[0] || 'status').toLowerCase();
    if (op === 'status') {
      const s = pv.status();
      return ctx.reply(['🌙 LUA • PRIVADO', `PV automático: ${s.pvAutoEnabled ? 'ON' : 'OFF'}`, 'Usuários podem iniciar conversa: SIM', 'Owner/Subowner: LIBERADOS'].join('\n'));
    }
    if (!['on', 'off'].includes(op)) return ctx.reply('Use: .pv on|off|status');
    pv.setEnabled(op === 'on');
    return ctx.reply(`✅ PV automático: ${op.toUpperCase()}.`);
  },
}];
