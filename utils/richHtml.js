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
  // MODO SEGURO: este card se passa por resposta de "bot IA" da Meta
  // (botForwardedMessage + forwardedAiBotMessageInfo apontando para um @bot
  // falso). É payload que o cliente oficial nunca gera — e um dos gatilhos de
  // "conta restrita". Lançar aqui faz o chamador usar o fallback textual dele
  // (!ping2 e !tigrinho já têm fallback pronto).
  if (require('./safety').blocksRichCards()) {
    const err = new Error(
      'MODO SEGURO: card HTML (payload de bot IA) desativado para não gerar restrição de conta. ' +
        'Para reativar (assumindo o risco): ALLOW_RICH_CARDS=1 ou !freio seguro off.'
    );
    err.code = 'SAFE_MODE_RICH_CARD';
    throw err;
  }
  const payload = buildHtmlMessage(html, opts);
  console.log('[PLAY CARD] relay payload', {
    targetJid: jid,
    payloadType: Object.keys(payload),
    messageType: Object.keys(payload.botForwardedMessage && payload.botForwardedMessage.message || {}),
  });
  console.log('[WA] chamando relayMessage (HTML)', { targetJid: jid });
  const result = await sock.relayMessage(jid, payload, {});
  console.log('[WA] relayMessage resolveu (HTML)', { targetJid: jid, hasResult: Boolean(result), id: result && result.key && result.key.id ? String(result.key.id).slice(0, 32) : undefined });
  return result;
}

module.exports = { buildHtmlMessage, sendHtml };
