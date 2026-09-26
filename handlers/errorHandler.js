/**
 * handlers/errorHandler.js — tratamento central de erros.
 *
 * O bot nunca deve morrer por erro de comando/mídia/download/etc.
 * Aqui capturamos, logamos e respondemos de forma amigável.
 */

'use strict';

const CONFIG = require('../config');
const logger = require('../utils/logger').child('errors');

/** Mapa de erros conhecidos -> mensagem amigável. */
const FRIENDLY = {
  INSUFFICIENT_FUNDS: '💸 Saldo insuficiente para esta operação.',
  NOT_ENOUGH_ITEMS: '📦 Você não possui esse item em quantidade suficiente.',
  FILE_TOO_BIG: CONFIG.messages.fileTooBig.replace('{limit}', CONFIG.limits.maxDownloadMB),
  FILE_NOT_FOUND: '📁 Arquivo não encontrado.',
  DOWNLOAD_FAILED: CONFIG.messages.downloadError,
  INVALID_URL: '🔗 Link inválido. Envie uma URL válida.',
  NO_RESULT: '🔎 Nenhum resultado encontrado.',
  TIMEOUT: '⏰ A operação demorou demais e foi cancelada.',
  BOT_NOT_ADMIN: CONFIG.messages.botNotAdmin,
  NO_FORMAT: '📥 Formato indisponível para este link (o vídeo pode ser restrito ou muito grande).',
  YOUTUBE_BLOCKED: '📥 O YouTube recusou o download (bloqueio de rede/região ou vídeo restrito).\n▸ Tente outro vídeo, ou use TikTok/Instagram/Pinterest.',
  NETWORK: '🌐 Não consegui alcançar o site.\n▸ Confira a internet do celular, desligue VPN/adblock e tente de novo.',
  BLOCKED: '🚫 O site recusou o acesso a este aparelho/rede (HTTP 4xx ou captcha).\n▸ Troque de rede (Wi-Fi ↔ dados), desligue VPN e tente mais tarde.',
  LOGIN: '🔒 Este conteúdo é privado e exige login — não dá para baixar.',
  CONVERTER_UNAVAILABLE: '🎨 Não consegui converter a mídia.\n▸ No Termux/Android, instale o ffmpeg: `pkg install ffmpeg`\n▸ Depois reinicie o bot.',
};

/** Envolve uma função para nunca lançar erro para fora. */
function safeWrap(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      logger.error({ err: err.message, stack: err.stack }, 'erro capturado (safeWrap)');
      return null;
    }
  };
}

/** Constrói um erro com código amigável. */
function createError(message, code) {
  const e = new Error(message || 'Erro desconhecido');
  e.code = code || 'GENERIC';
  return e;
}

/**
 * Trata um erro ocorrido durante um comando: loga e responde ao usuário.
 */
async function handle(ctx, err, command) {
  const code = (err && err.code) || 'GENERIC';
  const commandName = (command && command.name) || (ctx && ctx.command);
  const commandError = {
    command: commandName,
    name: err && err.name,
    code,
    message: err && err.message,
    stack: err && err.stack,
  };
  logger.error(commandError, '[COMMAND_ERROR]');
  // Mantém uma saída inequívoca mesmo quando o logger estruturado está filtrado.
  console.error('[COMMAND_ERROR]', commandError);

  if (!ctx || typeof ctx.reply !== 'function') return;

  try {
    // Mensagem que já traz o "o que fazer" (linhas com ▸, escritas pelos
    // downloaders) vale mais que o texto genérico do mapa: mostra o conserto.
    const msg = err && typeof err.message === 'string' ? err.message : '';
    const acionavel = msg.includes('▸') || msg.includes('pkg install') || msg.includes('pip install');
    const friendly = FRIENDLY[code];
    if (acionavel) {
      await ctx.reply(msg);
    } else if (friendly) {
      await ctx.reply(friendly);
    } else {
      await ctx.reply(CONFIG.messages.error);
    }
  } catch (_) {
    /* não pode derrubar o bot */
  }
}

module.exports = { safeWrap, createError, handle, FRIENDLY };
