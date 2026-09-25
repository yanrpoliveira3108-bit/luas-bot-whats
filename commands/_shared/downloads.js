/**
 * commands/_shared/downloads.js — envio de mídia baixada + limpeza.
 *
 * Regressão que este arquivo resolve: quando o freio de envio barrava um
 * arquivo, o resultado era descartado, o arquivo era apagado no `finally` e o
 * usuário ficava sem NADA — só com o aviso "Baixando..." e silêncio depois.
 * Parecia "download quebrado". Agora todo envio barrado é REPORTADO, com o
 * motivo, e o arquivo em cache NUNCA é apagado (apagar destruía o cache).
 */

'use strict';

const path = require('path');
const { deleteFile } = require('../../utils/download');

/** Motivo (código do freio) → explicação + o que fazer. */
const MOTIVO = {
  pv_frio: {
    texto: 'o freio não inicia conversa no privado com quem nunca falou com o bot',
    acao: 'Peça para a pessoa mandar um "oi" primeiro, ou use o comando em um grupo.',
  },
  fila_cheia: {
    texto: 'havia muitos envios na fila desta conversa',
    acao: 'Espere alguns segundos e rode o comando de novo.',
  },
  broadcast_identico: {
    texto: 'o mesmo texto já foi para vários chats (bloqueio de broadcast)',
    acao: 'Personalize a mensagem ou espere a janela do freio abrir.',
  },
  interativo_safe_mode: {
    texto: 'o modo seguro está bloqueando menus/botões',
    acao: 'Desligue com `!freio seguro off`.',
  },
};

function avisoBloqueio(kind, reason) {
  const m = MOTIVO[reason] || { texto: reason || 'limite de envio', acao: 'Tente de novo em instantes.' };
  return (
    `⚠️ O ${kind} ficou pronto, mas o *freio de envio* barrou a saída.\n` +
    `▸ Motivo: ${m.texto}.\n` +
    `▸ ${m.acao}`
  );
}

/**
 * Aplica o freio + limpeza com aviso ao usuário.
 * @param {object} ctx contexto do comando
 * @param {'áudio'|'vídeo'|'imagem'} kind
 * @param {string} filePath arquivo baixado
 * @param {() => Promise<any>} send envio real
 */
async function enviarArquivo(ctx, kind, filePath, send) {
  let res;
  try {
    console.log('[MEDIA 9] enviando para WhatsApp', { kind });
    res = await send();
    console.log('[MEDIA 10] envio concluído', { kind, hasResult: Boolean(res), id: res && res.key && res.key.id ? String(res.key.id).slice(0, 32) : undefined });
  } finally {
    // o arquivo dentro do cache de mídia é o próprio cache — não pode ser
    // apagado, senão o próximo pedido baixa tudo de novo.
    if (!estaNoCache(filePath)) deleteFile(filePath);
  }
  if (res && res.guardBlocked) {
    try {
      await ctx.reply(avisoBloqueio(kind, res.guardReason));
    } catch (_) {
      /* nunca deixa o erro de aviso derrubar o comando */
    }
    return { entregue: false, motivo: res.guardReason };
  }
  return { entregue: true };
}

function estaNoCache(filePath) {
  try {
    const mediaCache = require('../../utils/mediaCache');
    const dir = path.resolve(mediaCache.CACHE_DIR);
    return path.resolve(String(filePath)).startsWith(dir + path.sep);
  } catch (_) {
    return false;
  }
}

async function sendAudioResult(ctx, result) {
  return enviarArquivo(ctx, 'áudio', result.path, () =>
    ctx.sendAudio(result.path, { mimetype: result.mimetype || 'audio/mp4', ptt: false })
  );
}

async function sendVideoResult(ctx, result, caption = '') {
  return enviarArquivo(ctx, 'vídeo', result.path, () =>
    ctx.sendVideo(result.path, caption, { mimetype: result.mimetype || 'video/mp4' })
  );
}

async function sendImageResult(ctx, result, caption = '') {
  return enviarArquivo(ctx, 'imagem', result.path, () =>
    ctx.sendImage(result.path, caption)
  );
}

module.exports = { sendAudioResult, sendVideoResult, sendImageResult, enviarArquivo, estaNoCache };
