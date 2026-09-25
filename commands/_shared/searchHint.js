/**
 * commands/_shared/searchHint.js — mensagem quando a busca volta vazia.
 *
 * "Nenhum resultado encontrado" é verdade às vezes (nome digitado errado), mas
 * também é o que aparece quando o YouTube bloqueia a busca do bot. Sem o motor
 * alternativo (yt-dlp) o bot fica sem plano B — então a dica diz o que fazer.
 */

'use strict';

function dicaBuscaVazia() {
  let temYtdlp = false;
  try {
    temYtdlp = require('../../downloaders/youtube').ytdlpAvailable();
  } catch (_) {
    temYtdlp = false;
  }
  if (temYtdlp) {
    return '🔎 Nenhum resultado encontrado.\n▸ Confira o nome digitado (ou cole o link direto com !ytmp3/!ytmp4).';
  }
  return (
    '🔎 Nenhum resultado encontrado.\n' +
    '▸ Se o nome está certo, o YouTube pode estar bloqueando a busca do bot.\n' +
    '▸ Instale o motor alternativo: `pkg install python && pip install -U yt-dlp` e reinicie.\n' +
    '▸ Você também pode colar o link direto: !ytmp3 <link> ou !ytmp4 <link>'
  );
}

module.exports = { dicaBuscaVazia };
