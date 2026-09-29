'use strict';
const connection = require('../../connection/connect');
module.exports = [{
  name: 'session', commands: ['session'], category: 'owner', ownerOnly: true, cooldown: 1000,
  description: 'Status sanitizado do ciclo de vida do socket.', usage: '.session status',
  execute: async (ctx) => {
    if (!ctx.isOwner) return ctx.reply('🚫 Apenas o dono pode consultar a sessão.');
    const s = connection.getStatus();
    return ctx.reply([
      '🌙 LUA • SESSION', `Estado: ${s.connected ? 'ONLINE' : 'OFFLINE'}`,
      `Socket generation: ${s.socketGeneration || 0}`, `Reconnect em andamento: ${s.reconnectInProgress ? 'SIM' : 'NÃO'}`,
      `Reconnects últimos 5m: ${s.reconnectsLast5m || 0}`, `Última queda: ${s.lastReason || '—'}`,
      `Auth: ${s.jid ? 'CARREGADO' : 'não exposto'}`,
    ].join('\n'));
  },
}];
