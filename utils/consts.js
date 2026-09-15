/**
 * utils/consts.js — "selo": a citação usada pelos comandos de resposta rica.
 *
 * Os comandos de richResponse precisam preencher contextInfo com stanzaId,
 * participant e quotedMessage. Esta função monta esse envelope.
 *
 * O nome `seloNubank` foi mantido por compatibilidade com os comandos que já
 * usam essa assinatura, mas o conteúdo é da identidade do Lua Bot — não há
 * qualquer menção/imitação de marca de banco aqui.
 *
 * Detalhe técnico: o `stanzaId` usa o id da mensagem REAL que chegou. É isso que
 * permite ao WhatsApp resolver a citação no aparelho de quem recebe; um id
 * inventado faz a citação aparecer como "mensagem não encontrada".
 */

'use strict';

const crypto = require('crypto');
const CONFIG = require('../config');

/** Texto exibido na citação (o "selo"). */
function sealText(botName) {
  return [
    `🌙 *${botName}* • mensagem verificada`,
    `Conteúdo gerado pelo próprio bot.`,
  ].join('\n');
}

/**
 * @param {object} socket   conexão do WhatsApp (ctx.socket)
 * @param {object} msg      mensagem recebida (ctx.message)
 * @param {string} sender   jid de quem enviou
 * @param {string} pushname nome de exibição de quem enviou
 * @param {string} from     jid do chat
 * @returns {Promise<{key:object, message:object}>} envelope de citação
 */
async function seloNubank(socket, msg, sender, pushname, from) {
  const botName = (CONFIG.bot && CONFIG.bot.name) || 'Lua Bot';
  const key = (msg && msg.key) || {};

  // id real da mensagem quando existir; senão um id próprio (nunca undefined)
  const id = key.id || crypto.randomBytes(8).toString('hex').toUpperCase();

  // em grupo o participant vem da mensagem; no privado é o próprio remetente
  const participant = key.participant || (String(from || '').endsWith('@g.us') ? sender : undefined);

  return {
    key: {
      remoteJid: from,
      fromMe: false,
      id,
      ...(participant ? { participant } : {}),
    },
    message: {
      extendedTextMessage: {
        text: sealText(botName),
        contextInfo: {
          ...(pushname ? { forwardingScore: 0, isForwarded: false } : {}),
          stanzaId: id,
          participant: participant || sender,
        },
      },
    },
  };
}

module.exports = { seloNubank, sealText };
