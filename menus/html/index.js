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
 *
 * Sobre as AÇÕES do card (mudou nesta versão): o WebView do card é um sandbox
 * de origem opaca, sem rede, e não existe canal HTML→bot (ver o cabeçalho de
 * menus/html/actions.js, com a origem de cada afirmação). Por isso o card não
 * tem mais link `wa.me`: o botão "Usar" monta o comando no aparelho e deixa
 * para copiar/enviar. Também injetamos uma ALTURA FIXA (ver
 * templates.travarAltura) para o host parar de medir o conteúdo e evitar o
 * card "tremendo" ao rolar (comportamento relatado no upstream).
 */

'use strict';

const logger = require('../../utils/logger').child('menuHtml');

// O vendor NÃO comprime o stanza de saída (zlib só existe no decode.js), então
// o tamanho do card é o que vai na rede — e mensagem grande demais é descartada
// em silêncio pelos clientes (relatado nos projetos que usam este formato, que
// trabalham com a ordem de ~1 MB). 120 KB é o teto conservador deste projeto:
// passando disso, cortamos comandos por categoria em passos e dizemos isso no
// próprio card, com o atalho para o menu completo em texto.
const MAX_BYTES_PADRAO = 120000;
// Altura fixa default do card (px) e faixa aceita: vivem em dimensoes.js —
// TODOS os números de tamanho do card ficam naquele arquivo (ver o doc dele).
const { DIM } = require('./dimensoes');
const ALTURA_PADRAO = DIM.altura;
const CAP_PADRAO = 30;
// Fração da área visível deslocada por toque nas setas ↑↓ e ←→.
// O número vive em UM lugar só: menus/html/client.js (PASSO_PADRAO = 0.7),
// que é quem emite o JS do card. Aqui só lemos o valor (e o env pode trocar).
const { PASSO_PADRAO } = require('./client');

/**
 * Altura fixa do card do MENU, em pixels (`MENU_HTML_HEIGHT` sobrescreve) —
 * definida em `./moldura.js`. Os cards dos JOGOS não usam altura declarada
 * (moldura livre: `moldura.cssLivre()`), porque o corte por altura fixa
 * escondia botões no aparelho (ver MENUS-HTML.md §2.4).
 */
const { alturaDoCard } = require('./moldura');

/** Dados do bot/chat usados pelos templates (sem nada sensível). */
/**
 * Passo das setas de rolagem (fração da área visível por toque).
 * `MENU_HTML_STEP` sobrescreve; fora de 0.05–1 volta ao padrão.
 */
function passoDoCard() {
  const bruto = Number(process.env.MENU_HTML_STEP);
  if (Number.isFinite(bruto) && bruto >= 0.05 && bruto <= 1) return bruto;
  return PASSO_PADRAO;
}

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
    botEmoji: emoji,
    altura: alturaDoCard(),
    passo: passoDoCard(),
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
    // Corte ADAPTATIVO: reduz por categoria em passos até caber (o registro
    // cresce com o tempo; um único passo de 30 não garante nada).
    const base = Number(process.env.MENU_HTML_MAX_PER_CAT) || CAP_PADRAO;
    const passos = [...new Set([base, 20, 14, 10, 6, 4])].filter((n) => n <= base);
    for (const cap of passos) {
      info.grupo = limitarCategorias(grupo, cap);
      html =
        kind === 'admin'
          ? templates.menuAdmin(info)
          : kind === 'membros'
            ? templates.menuMembro(info)
            : kind === 'categoria'
              ? templates.menuCategoria(info, grupo.inicial)
              : templates.menuPrincipal(info);
      if (Buffer.byteLength(html, 'utf8') <= teto) break;
    }
    logger.info(
      { bytes: Buffer.byteLength(html, 'utf8'), teto, comandos: info.grupo.total },
      'menu HTML grande — comandos limitados por categoria'
    );
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
    // `trustedSources` fica como está (é a atribuição desenhada sob o card).
    // ATENÇÃO: pelos relatos de quem mediu o WebView, ele NÃO libera rede nem
    // navegação (host dentro e fora da lista: os dois falhavam). Não conte com
    // isso para link nenhum.
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

module.exports = {
  enviar,
  montarDocumento,
  montarInfo,
  alturaDoCard,
  passoDoCard,
  limitarCategorias,
  ALTURA_PADRAO,
  PASSO_PADRAO,
};
