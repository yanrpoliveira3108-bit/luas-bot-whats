/**
 * utils/pendingCall.js — chamadas de !call aguardando confirmação.
 *
 * REGRA PRINCIPAL: nenhuma chamada sai sem confirmação explícita de quem pediu.
 *
 * A lógica genérica (TTL, palavras aceitas, expiração, interceptação única) vem
 * de utils/confirmFlow.js; aqui ficam só o cartão e o envio da Call Message.
 *
 * Estado isolado por QUEM PEDIU (senderJid), nunca pelo destino: a confirmação
 * de um usuário jamais autoriza a chamada criada por outro.
 */

'use strict';

const confirmFlow = require('./confirmFlow');

/** Nome padrão exibido na mensagem de chamada. */
const DEFAULT_CALL_NAME = 'Hay';

/** 1 = voz, 2 = vídeo (é o callType do protocolo). */
function callTypeLabel(callType) {
  return Number(callType) === 2 ? 'vídeo' : 'voz';
}

/** Número legível a partir do JID. */
function displayTarget(jid) {
  const s = String(jid || '');
  return s.endsWith('@g.us') ? `o grupo ${s.split('@')[0]}` : s.split('@')[0];
}

/** Envia a Call Message de fato: { call: { name, type } } (API real do Baileys). */
async function sendCall(socket, pending) {
  await socket.sendMessage(pending.jid, {
    call: { name: pending.name, type: pending.callType },
  });
}

const flow = confirmFlow.createStore({
  name: 'call',
  preview: (pending) =>
    [
      '⚠️ *CONFIRMAÇÃO*',
      '',
      `Você está prestes a enviar uma chamada de *${callTypeLabel(pending.callType)}* para:`,
      `📱 ${displayTarget(pending.jid)}`,
      `🏷️ Nome: *${pending.name}*`,
    ].join('\n'),
  send: sendCall,
  success: (pending) =>
    `📞 Chamada de *${callTypeLabel(pending.callType)}* enviada para ${displayTarget(pending.jid)}.`,
  expired: (pending) =>
    `⌛ A confirmação da chamada para ${displayTarget(pending.jid)} expirou. Nada foi enviado.\nUse !call novamente se quiser tentar de novo.`,
  failure: () =>
    '⚠️ Não consegui enviar a chamada. O número precisa existir no WhatsApp e eu preciso poder enviar mensagem para ele.',
});

module.exports = {
  /** solicitações pendentes, chaveadas por senderJid */
  pendingCallConfirmations: flow.store,
  CONFIRM_TTL_MS: confirmFlow.CONFIRM_TTL_MS,
  DEFAULT_CALL_NAME,
  set: flow.set,
  get: flow.get,
  has: flow.has,
  clear: flow.clear,
  size: flow.size,
  parseAnswer: confirmFlow.parseAnswer,
  promptText: flow.promptText,
  callTypeLabel,
  displayTarget,
  sendCall,
  handleMessage: flow.handleMessage,
};
