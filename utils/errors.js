/**
 * utils/errors.js — classificação HONESTA de falhas de rede/download.
 *
 * Motivo de existir: todos os downloaders transformavam QUALQUER falha
 * (rede, bloqueio, página de captcha) em `NO_RESULT`, que vira a mensagem
 * "🔎 Nenhum resultado encontrado". O dono via essa mensagem em YouTube,
 * Instagram, Twitter, TikTok... e não tinha como saber o que estava errado.
 *
 * Agora cada falha vira um código que diz o que fazer:
 *   NETWORK   — não deu para alcançar o site (rede/operadora/VPN/DNS)
 *   BLOCKED   — o site recusou (403/429/captcha/challenge)
 *   LOGIN     — o conteúdo exige login (post privado)
 *   NO_RESULT — o site respondeu, mas não tem mídia ali (só aqui é verdade)
 */

'use strict';

/** Marcas de página de bloqueio/captcha (Cloudflare, hCaptcha, consent). */
const MARCAS_BLOQUEIO = [
  /just a moment/i,
  /attention required/i,
  /cf-error|cf_chl|challenge-platform|cdn-cgi\/challenge/i,
  /enable javascript and cookies to continue/i,
  /checking your browser/i,
  /unusual traffic/i,
  /access denied/i,
  /captcha/i,
  /please verify you are a human/i,
];

/** Marcas de parede de login. */
const MARCAS_LOGIN = [/log in to instagram/i, /please log in/i, /entrar no instagram/i, /"loginrequired"/i, /accounts\/login/i];

function temMarca(txt, lista) {
  const s = String(txt || '');
  return lista.some((re) => re.test(s));
}

/**
 * Traduz um erro de fetch (DNS, TLS, timeout, conexão) para um erro claro.
 * @param {any} err erro original
 * @param {string} plataforma nome legível ("YouTube", "TikTok"...)
 * @returns {Error} erro com `.code`
 */
function erroDeRede(err, plataforma) {
  const m = String((err && err.message) || err || '');
  const nome = plataforma || 'o site';
  let detalhe = 'não deu para alcançar';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) {
    detalhe = 'não consegui resolver o endereço (DNS)';
  } else if (/ECONNREFUSED/i.test(m)) {
    detalhe = 'a conexão foi recusada';
  } else if (/ETIMEDOUT|timeout|abort/i.test(m)) {
    detalhe = 'a conexão estourou o tempo';
  } else if (/CERT|SSL|TLS|self-signed|UNABLE_TO_VERIFY/i.test(m)) {
    detalhe = 'o certificado/HTTPS falhou';
  } else if (/ENETUNREACH|EHOSTUNREACH/i.test(m)) {
    detalhe = 'a rede está inacessível';
  }

  const e = new Error(
    `🌐 ${nome}: ${detalhe}.\n` +
      '▸ Confira a internet do celular (Wi-Fi/dados), desligue VPN/adblock e tente de novo.\n' +
      '▸ Se só este site falha, ele pode estar bloqueado na sua rede.'
  );
  e.code = 'NETWORK';
  e.causa = m.slice(0, 200);
  return e;
}

/**
 * Erro para resposta HTTP que não é 2xx.
 * @param {number} status
 * @param {string} plataforma
 * @param {string} [corpo] primeiros bytes do corpo (para achar captcha)
 */
function erroHttp(status, plataforma, corpo) {
  const nome = plataforma || 'o site';
  if (temMarca(corpo, MARCAS_BLOQUEIO)) {
    const e = new Error(
      `🚧 ${nome} pediu verificação anti-robô (captcha/challenge) e recusou o bot.\n` +
        '▸ Costuma ser a REDE: troque de Wi-Fi/dados, desligue VPN ou tente mais tarde.\n' +
        '▸ Para o YouTube, instale o yt-dlp: pkg install python && pip install -U yt-dlp'
    );
    e.code = 'BLOCKED';
    return e;
  }
  if (status === 401 || status === 403) {
    const e = new Error(
      `🚫 ${nome} recusou o acesso (HTTP ${status}).\n` +
        '▸ O conteúdo pode ser privado ou o site bloqueou este aparelho/rede.\n' +
        '▸ Desligue VPN, troque de rede e tente de novo.'
    );
    e.code = 'BLOCKED';
    return e;
  }
  if (status === 404) {
    const e = new Error(`🔎 ${nome}: link não encontrado (HTTP 404). O post pode ter sido apagado.`);
    e.code = 'NO_RESULT';
    return e;
  }
  if (status === 429) {
    const e = new Error(
      `⏳ ${nome} pediu para esperar (HTTP 429 — muitas requisições).\n▸ Tente de novo em alguns minutos.`
    );
    e.code = 'BLOCKED';
    return e;
  }
  const e = new Error(
    `⚠️ ${nome} respondeu HTTP ${status}.\n▸ Tente de novo; se persistir, teste em outra rede.`
  );
  e.code = 'NETWORK';
  return e;
}

/** Erro de "encontrei a página, mas ela não tem mídia" (aqui NO_RESULT é verdade). */
function erroSemMidia(plataforma, corpo) {
  if (temMarca(corpo, MARCAS_BLOQUEIO)) return erroHttp(403, plataforma, corpo);
  if (temMarca(corpo, MARCAS_LOGIN)) {
    const e = new Error(
      `🔒 ${plataforma}: este conteúdo exige login (post privado ou de conta restrita).\n▸ Conteúdo privado não pode ser baixado — não é falha do bot.`
    );
    e.code = 'LOGIN';
    return e;
  }
  const e = new Error(
    `🔎 ${plataforma}: o link é válido, mas não encontrei mídia (imagem/vídeo) nele.\n▸ Confira se o post é público e tem vídeo/foto.`
  );
  e.code = 'NO_RESULT';
  return e;
}

module.exports = { erroDeRede, erroHttp, erroSemMidia, temMarca, MARCAS_BLOQUEIO, MARCAS_LOGIN };
