'use strict';

// Compatibilidade para módulos antigos. Não aplica fila, PPM, pacing ou delay.
// Preserva somente a API de passagem e a configuração de browser da conexão.
function enqueueOutbound(fn) { return Promise.resolve().then(fn); }
function simulateTyping() { return Promise.resolve(); }
function encerrarPresenca(sock, jid) {
  try { return sock && sock.sendPresenceUpdate ? Promise.resolve(sock.sendPresenceUpdate('paused', jid)).catch(() => {}) : Promise.resolve(); } catch (_) { return Promise.resolve(); }
}
function getBrowserConfig(Browsers) {
  if (!Browsers) return ['Windows', 'Chrome', '10.0.22631'];
  return Browsers.windows ? Browsers.windows('Chrome') : ['Windows', 'Chrome', '10.0.22631'];
}
function getStatus() { return { humanDelays: false, outboundInterval: 'none', pacing: false }; }
function isEnabled() { return false; }
module.exports = { enqueueOutbound, simulateTyping, encerrarPresenca, calculateTypingDelay: () => 0, getBrowserConfig, getStatus, isEnabled };
