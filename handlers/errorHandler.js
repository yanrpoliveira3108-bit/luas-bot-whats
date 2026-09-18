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
  logger.error(
    {
      user: ctx && ctx.sender,
      chat: ctx && ctx.remoteJid,
      command: (command && command.name) || (ctx && ctx.command),
      code,
      err: err && err.message,
    },
    'erro em comando'
  );

  if (!ctx || typeof ctx.reply !== 'function') return;
  // silent: o caller já respondeu (ex.: fluxo em etapas com card de erro) —
  // aqui só registramos o detalhe completo no log.
  if (command && command.silent) return;

  try {
    const friendly = FRIENDLY[code];
    if (friendly) {
      await ctx.reply(friendly);
    } else if (code === 'GENERIC') {
      await ctx.reply(CONFIG.messages.error);
    } else {
      await ctx.reply(CONFIG.messages.error);
    }
  } catch (_) {
    /* não pode derrubar o bot */
  }
}

module.exports = { safeWrap, createError, handle, FRIENDLY };
