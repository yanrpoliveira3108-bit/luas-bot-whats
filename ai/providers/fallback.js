/**
 * ai/providers/fallback.js — resposta honesta quando nada mais está disponível.
 *
 * Nunca finge uma resposta de IA; informa o estado real e orienta o usuário.
 */

'use strict';

const CONFIG = require('../../config');

async function handle() {
  return {
    ok: true,
    text:
      '🤖 *IA indisponível no momento.*\n' +
      `▸ O assistente local não soube responder e nenhuma API externa está configurada.\n` +
      `▸ Para conversa livre, configure \`AI_API_URL\` + \`AI_API_KEY\` no .env.\n` +
      `▸ Use \`${CONFIG.bot.prefix}aistatus\` para ver a configuração atual.`,
    provider: 'fallback',
    model: 'nenhum',
  };
}

module.exports = { handle, name: 'fallback', isConfigured: () => true };
