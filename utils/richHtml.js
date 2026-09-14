/**
 * utils/richHtml.js — envia HTML visual (card de "bot IA") pelo WhatsApp.
 *
 * Replica a estrutura da referência técnica "cobrinha.js":
 *   botForwardedMessage → richResponseMessage → unifiedResponse
 *   → seção GenAIaeacdsnwHtmlPrimitive com o HTML no `payload`.
 *
 * O envio é via socket.relayMessage() (mesmo caminho do cobrinha). Se o
 * cliente do usuário não suportar esse tipo de card, o comando chamador
 * deve tratar o erro e responder por texto (fallback) — este módulo só
 * envia e propaga o erro.
 */

'use strict';

const crypto = require('crypto');

/** Monta o payload "botForwardedMessage" com o HTML. */
function buildHtmlMessage(html, opts = {}) {
  const title = opts.title || 'LUA';
  const botJid = opts.botJid || '867051314767696@bot';
  const trustedSources = opts.trustedSources || ['nixel.dev'];

  return {
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          submessages: [{ messageType: 2, messageText: title }],
          messageType: 1,
          unifiedResponse: {
            data: Buffer.from(
              JSON.stringify({
                response_id: crypto.randomUUID(),
                sections: [
                  {
                    view_model: {
                      primitive: {
                        __typename: 'GenAIaeacdsnwHtmlPrimitive',
                        payload: html,
                        trusted_sources: trustedSources,
                      },
                      __typename: 'GenAISingleLayoutViewModel',
                    },
                  },
                ],
              }),
              'utf8'
            ),
          },
          contextInfo: {
            mentionedJid: [],
            groupMentions: [],
            statusAttributions: [],
            forwardingScore: 1,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid },
            forwardOrigin: 4,
          },
        },
      },
    },
  };
}

/** Envia o HTML via relayMessage. Lança o erro em caso de falha (para fallback).
 *
 * Padrão comprovado (cobrinha.js / ping.html.js do usuário): wrapper
 * `botForwardedMessage` + relayMessage com opções VAZIAS `{}`. Não usar
 * flags extras (AI/additionalNodes) — elas fazem o WhatsApp descartar o card.
 */
async function sendHtml(sock, jid, html, opts = {}) {
  if (!sock || typeof sock.relayMessage !== 'function') {
    throw new Error('relayMessage indisponível no socket');
  }
  return sock.relayMessage(jid, buildHtmlMessage(html, opts), {});
}

module.exports = { buildHtmlMessage, sendHtml };
