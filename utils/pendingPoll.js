/**
 * utils/pendingPoll.js — enquetes de !poll / !pollresult aguardando confirmação.
 *
 * Mesmas regras do !call (utils/confirmFlow.js): nada é enviado sem confirmação
 * explícita, estado isolado por senderJid, 30s para responder.
 *
 * Conteúdos enviados (API real do Baileys vendored, lib/Utils/messages.js):
 *   { poll: {name, values, selectableCount, toAnnouncementGroup} }
 *        → pollCreationMessage / V3 (selectableCount>0) / V2 (announcement)
 *   { pollResult: {name, values: [[opcao, votos]]} }
 *        → pollResultSnapshotMessage.pollVotes
 */

'use strict';

const confirmFlow = require('./confirmFlow');
const poll = require('./poll');

function typeLabel(type) {
  return type === 'pollResult' ? 'um resultado de enquete' : 'uma enquete';
}

/** Caixa da enquete (título alinhado com as opções, 40 colunas). */
function pollBox(entry) {
  if (entry.type === 'pollResult') {
    return poll.renderBox({
      title: entry.data.name,
      items: entry.data.values.map((v) => v[0]),
      suffix: (i) => ` → ${entry.data.values[i][1]} votos`,
    });
  }
  return poll.renderBox({ title: entry.data.name, items: entry.data.values });
}

async function sendPoll(socket, entry) {
  if (entry.type === 'pollResult') {
    await socket.sendMessage(entry.jid, { pollResult: entry.data });
    return;
  }
  await socket.sendMessage(entry.jid, { poll: entry.data });
}

const flow = confirmFlow.createStore({
  name: 'poll',
  preview: (entry) => {
    const lines = ['⚠️ *CONFIRMAÇÃO*', '', `Você está prestes a enviar ${typeLabel(entry.type)}.`, '', pollBox(entry), ''];
    if (entry.type === 'poll') {
      lines.push(`▸ Selecionáveis: ${entry.data.selectableCount} de ${entry.data.values.length} opções`);
      lines.push(`▸ Grupo de anúncio: ${entry.data.toAnnouncementGroup ? 'sim' : 'não'}`);
    } else if (entry.announcement) {
      lines.push(
        'ℹ️ --announcement não tem efeito em resultados: a biblioteca não possui variante de anúncio para pollResult, então o valor será ignorado.'
      );
    }
    return lines.join('\n');
  },
  send: sendPoll,
  success: (entry) =>
    entry.type === 'pollResult'
      ? `📈 Resultado da enquete *${entry.data.name}* enviado.`
      : `📊 Enquete *${entry.data.name}* enviada.`,
  failure: (entry) =>
    entry.type === 'pollResult'
      ? '⚠️ Não consegui enviar o resultado da enquete. Verifique se posso enviar mensagem neste chat.'
      : '⚠️ Não consegui criar a enquete. Verifique se posso enviar mensagem neste chat.',
  expired: (entry) =>
    `⌛ A confirmação ${typeLabel(entry.type)} expirou. Nada foi enviado.\nUse ${
      entry.type === 'pollResult' ? '!pollresult' : '!poll'
    } novamente se quiser tentar de novo.`,
});

module.exports = {
  /** solicitações pendentes de enquete, chaveadas por senderJid */
  pendingPollConfirmations: flow.store,
  CONFIRM_TTL_MS: confirmFlow.CONFIRM_TTL_MS,
  set: flow.set,
  get: flow.get,
  has: flow.has,
  clear: flow.clear,
  size: flow.size,
  parseAnswer: confirmFlow.parseAnswer,
  promptText: flow.promptText,
  pollBox,
  sendPoll,
  handleMessage: flow.handleMessage,
};
