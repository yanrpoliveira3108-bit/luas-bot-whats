/**
 * menus/html/index.js — integração dos menus HTML (envio).
 *
 * Responsabilidade ÚNICA: montar o documento do menu pedido e entregá-lo ao
 * `utils/richHtml.js` (o mesmo caminho comprovado do `!ping2` e do `!tigrinho`,
 * que já usam `botForwardedMessage → richResponseMessage → unifiedResponse`).
 *
 * Este módulo só é carregado quando o modo HTML está ATIVO e permitido — o
 * `utils/menuFormat.js` é quem decide e faz o `require` preguiçoso. Assim, com
 * o modo desligado, nada aqui é processado (exigência do pedido).
 *
 * Nunca lança para o chamador: devolve `true` (enviado) ou `false` (não deu).
 * Quem chama faz o fallback tradicional.
 */

'use strict';

const logger = require('../../utils/logger').child('menuHtml');

// O vendor NÃO comprime o stanza de saída (zlib só existe no decode.js), então
// o tamanho do card é o que vai na rede. 100 KB é o teto conservador deste
// projeto; passando disso, cortamos comandos por categoria e dizemos isso no
// próprio card, com link para o menu completo da categoria.
const MAX_BYTES_PADRAO = 100000;
const CAP_PADRAO = 30;

/** Só dígitos do número do BOT (destino dos links `wa.me`). */
function numeroDoBot(ctx) {
  try {
    const user = ctx && ctx.socket && ctx.socket.user;
    const id = user && user.id;
    if (!id) return '';
    return String(id).split('@')[0].split(':')[0].replace(/\D/g, '');
  } catch (_) {
    return '';
  }
}

/** Dados do bot/chat usados pelos templates (sem nada sensível). */
function montarInfo(ctx) {
  const CONFIG = require('../../config');
  const settings = require('../../database/settings');
  let emoji = '🌙';
  try {
    emoji = require('../../utils/theme').active().emoji || '🌙';
  } catch (_) {
    /* tema indisponível: segue com o padrão */
  }
  return {
    prefix: settings.effectivePrefix() || CONFIG.bot.prefix,
    botName: CONFIG.bot.name,
    version: CONFIG.bot.version,
    botDigits: numeroDoBot(ctx),
    botEmoji: emoji,
    escopoTexto: ctx && ctx.isGroup ? 'neste grupo' : 'no privado',
  };
}

/**
 * Reduz o payload quando ele passa do teto: mantém as primeiras N linhas de
 * cada categoria e avisa na própria seção (nada de sumir com comando em
 * silêncio).
 */
function limitarCategorias(grupo, cap) {
  const data = require('./data');
  const categorias = (grupo.categorias || []).map((c) => {
      if (c.comandos.length <= cap) return c;
      return {
        ...c,
        comandos: c.comandos.slice(0, cap),
        avisoCorte: { mostrados: cap, total: c.count, atalho: data.menuCommandOf(c.id) },
      };
    });
  return {
    ...grupo,
    categorias,
    limitado: true,
    cap,
    // total = o que o card REALMENTE mostra (não confundir quem lê o log)
    total: categorias.reduce((n, c) => n + c.comandos.length, 0),
  };
}

/**
 * Monta o documento do menu pedido.
 * @param {object} ctx contexto do comando
 * @param {object} opts { kind, categoria, foco }
 * @returns {{ html: string, grupo: object, info: object }}
 */
function montarDocumento(ctx, opts = {}) {
  const data = require('./data');
  const templates = require('./templates');
  const info = montarInfo(ctx);
  const kind = String(opts.kind || 'main');
  const grupo = data.grupoDoMenu(kind === 'categoria' ? 'categoria' : kind, opts.categoria);
  if (opts.foco) grupo.inicial = String(opts.foco);

  info.grupo = grupo;

  let html =
    kind === 'admin'
      ? templates.menuAdmin(info)
      : kind === 'membros'
        ? templates.menuMembro(info)
        : kind === 'categoria'
          ? templates.menuCategoria(info, grupo.inicial)
          : templates.menuPrincipal(info);

  const teto = Number(process.env.MENU_HTML_MAX_BYTES) || MAX_BYTES_PADRAO;
  if (Buffer.byteLength(html, 'utf8') > teto) {
    const cap = Number(process.env.MENU_HTML_MAX_PER_CAT) || CAP_PADRAO;
    logger.info(
      { bytes: Buffer.byteLength(html, 'utf8'), teto, cap },
      'menu HTML grande — limitando comandos por categoria'
    );
    info.grupo = limitarCategorias(grupo, cap);
    html =
      kind === 'admin'
        ? templates.menuAdmin(info)
        : kind === 'membros'
          ? templates.menuMembro(info)
          : kind === 'categoria'
            ? templates.menuCategoria(info, grupo.inicial)
            : templates.menuPrincipal(info);
  }

  return { html, grupo: info.grupo, info };
}

/**
 * Envia o menu em HTML.
 * @returns {Promise<boolean>} true se o card foi entregue ao socket
 */
async function enviar(ctx, opts = {}) {
  try {
    const { html, grupo } = montarDocumento(ctx, opts);
    if (!html || html.length < 64) return false;

    // richHtml aplica o modo seguro (card é payload de "bot IA"): se estiver
    // bloqueado, ele lança e nós caímos no menu tradicional.
    const richHtml = require('../../utils/richHtml');
    await richHtml.sendHtml(ctx.socket, ctx.remoteJid, html, {
      title: `🌙 ${grupo.titulo}`,
      trustedSources: ['nixel.dev'],
    });
    // ATENÇÃO: entregar ao socket NÃO prova que o aparelho renderizou o card
    // (ver MENUS-HTML.md). Por isso o menu tradicional continua a um comando
    // de distância: !menucompleto e !menu --texto.
    return true;
  } catch (err) {
    // Só o essencial: sem jid, sem payload, sem dados do usuário.
    logger.warn({ err: err && err.message, kind: opts.kind }, 'menu HTML não pôde ser enviado — usando o tradicional');
    return false;
  }
}

module.exports = { enviar, montarDocumento, montarInfo, numeroDoBot, limitarCategorias };
