/**
 * menus/html/components.js — peças reutilizadas pelos templates HTML.
 *
 * Aqui ficam a escapagem (por contexto), o cartão de comando e o botão "Usar".
 *
 * Sobre segurança (leia antes de mexer):
 *   - `escapeHtml`  → conteúdo de texto/atributo comum;
 *   - `escapeAttr`  → valores dentro de atributo (data-*, href), incluindo URL;
 *   - nada de credenciais/sessão/número de pessoas no HTML: só dados públicos
 *     de comando (nome, descrição, exemplo) e o prefixo.
 *
 * Sobre a AÇÃO do botão "Usar" (o ponto que mudou):
 *
 *   O card roda num WebView sandboxed (origem opaca, sem secure context e sem
 *   rede — ver o cabeçalho de menus/html/actions.js, com a origem de cada
 *   afirmação). O "Usar" antigo era um `<a href="https://wa.me/...">`: no
 *   aparelho do dono o toque não realizava a ação esperada, e não existe canal
 *   comprovado do card para o bot para pedir execução.
 *
 *   Como não existe canal HTML→bot, o botão agora é um `<button>` que abre um
 *   PAINEL no próprio card (JS local, permitido): ele monta o comando real
 *   (campos vindos do `usage` do registro), valida, avisa os requisitos de
 *   contexto (grupo/admin/mídia/resposta/menção) e deixa o comando pronto para
 *   COPIAR e enviar. Quem executa continua sendo o pipeline de comandos, com a
 *   identidade real de quem enviou a mensagem e todas as validações de sempre.
 *   Nada de botão decorativo: todo "Usar" abre o painel e monta algo real.
 */

'use strict';

const actions = require('./actions');

/** Escapa texto para conteúdo/atributo comum. */
function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

/** Escapa valor de atributo (inclui URL) — mantém `:`/`/`/`?`/`=` da URL. */
function escapeAttr(value) {
  return escapeHtml(value);
}

/** Etiquetas de permissão/contexto do comando (as mesmas de antes). */
function etiquetas(cmd) {
  const tags = [];
  if (cmd.ownerOnly) tags.push({ cls: 'dono', texto: 'dono' });
  if (cmd.adminOnly) tags.push({ cls: 'admin', texto: 'admin' });
  if (cmd.groupOnly) tags.push({ cls: 'grupo', texto: 'no grupo' });
  if (cmd.privateOnly) tags.push({ cls: 'pv', texto: 'no privado' });
  if (cmd.botAdmin) tags.push({ cls: 'admin', texto: 'bot admin' });
  return tags;
}

/** Texto usado pela busca do cliente (minúsculo, sem HTML). */
function textoDeBusca(cmd, prefix, categoria) {
  return [cmd.name, cmd.description, cmd.usage, (cmd.commands || []).join(' '), (cmd.aliases || []).join(' '), categoria]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Botão "Usar" — carrega no próprio botão o que o painel precisa:
 *   data-usar → trigger real do registro
 *   data-uso  → padrão de argumentos (só quando o comando tem argumentos)
 *   data-req  → requisitos compactos (grupo/dono/admin/bot admin/pv/resposta/
 *               menção/mídia) — só quando existem
 */
function botaoUsar(cmd, opts = {}) {
  const pref = opts.prefix || '!';
  const spec = actions.specDoComando(cmd, { prefix: pref });
  if (!spec.trigger) return '';
  // Enxuto de propósito: cada byte aqui é multiplicado por centenas de comandos
  // e o payload inteiro viaja cifrado (sem compressão) no stanza. O nome do
  // comando já está no cartão ao lado do botão, então o rótulo visível basta.
  const attrs = ['class="go"', `data-usar="${escapeAttr(spec.trigger)}"`];
  if (spec.args) attrs.push(`data-uso="${escapeAttr(spec.args)}"`);
  if (spec.flags) attrs.push(`data-req="${escapeAttr(spec.flags)}"`);
  return `<button ${attrs.join(' ')}>Usar</button>`;
}

/**
 * Cartão de um comando.
 * @param {object} cmd comando do registry
 * @param {object} opts { prefix, categoria, emoji, compacto }
 */
function cartaoDeComando(cmd, opts = {}) {
  const prefix = opts.prefix || '!';
  const emoji = opts.emoji || '▸';
  const trigger = (cmd.commands && cmd.commands[0]) || cmd.name;
  const linha = `${prefix}${trigger}`;
  const exemplos = String(cmd.usage || '').trim() || linha;
  // No menu PRINCIPAL o cartão é compacto (nome + descrição): ele existe para
  // navegar e buscar, não para explicar cada comando. O detalhe completo
  // (descrição + exemplo de uso) aparece no menu da categoria — assim o
  // payload do card principal cabe tranquilo mesmo com centenas de comandos.
  const compacto = !!opts.compacto;
  const tags = etiquetas(cmd).map(
    (t) => `<span class="tag ${escapeAttr(t.cls)}">${escapeHtml(t.texto)}</span>`
  );

  return (
    `<article class="cmd" data-cat="${escapeAttr(opts.categoria || '')}">` +
    `<div class="ico">${escapeHtml(emoji)}</div>` +
    '<div class="body">' +
    `<div class="top"><code>${escapeHtml(linha)}</code>${tags.join('')}</div>` +
    `<p class="desc">${escapeHtml(cmd.description || 'Sem descrição.')}</p>` +
    (compacto ? '' : `<p class="ex">Ex.: <code>${escapeHtml(exemplos)}</code></p>`) +
    '</div>' +
    botaoUsar(cmd, { prefix }) +
    '</article>'
  );
}

/** Botão de aba de categoria. */
function abaDeCategoria(cat) {
  const id = escapeAttr(cat.id);
  return (
    `<button class="tab" type="button" data-cat="${id}" data-label="${escapeAttr(cat.label)}">` +
    `<span>${escapeHtml(cat.emoji)}</span><span>${escapeHtml(cat.title)}</span>` +
    `<span class="count">${escapeHtml(String(cat.count))}</span>` +
    '</button>'
  );
}

/** Seção de uma categoria com seus comandos. */
function secaoDeCategoria(cat, comandos, opts = {}) {
  // Aviso honesto quando o card foi cortado por tamanho: diz quanto ficou de
  // fora e ensina o comando do menu completo (sem link: link não navega aqui).
  let avisoCorte = '';
  if (opts.avisoCorte) {
    const atalho = opts.avisoCorte.atalho || '';
    avisoCorte =
      `<p class="sec-desc">▸ Mostrando ${escapeHtml(String(opts.avisoCorte.mostrados))} de ` +
      `${escapeHtml(String(opts.avisoCorte.total))} comandos (limite do card). ` +
      (atalho
        ? `Para a lista completa, envie <code>${escapeHtml(opts.prefix + atalho)}</code> no chat.`
        : `Envie <code>${escapeHtml(opts.prefix)}menucompleto</code> no chat para a lista completa.`) +
      '</p>';
  }
  const cartoes = comandos.map((c) =>
    cartaoDeComando(c, {
      prefix: opts.prefix,
      categoria: cat.id,
      emoji: opts.emojiDe ? opts.emojiDe(c) : '▸',
      compacto: opts.compacto,
    })
  );
  const vazio = '<p class="empty">Nenhum comando carregado nesta categoria.</p>';
  return (
    `<section class="sec" data-cat="${escapeAttr(cat.id)}">` +
    `<h2 class="sec-title"><span>${escapeHtml(cat.emoji)}</span><span>${escapeHtml(cat.title)}</span>` +
    `<span class="pill">${escapeHtml(String(comandos.length))} comandos</span></h2>` +
    (cat.description ? `<p class="sec-desc">${escapeHtml(cat.description)}</p>` : '') +
    avisoCorte +
    (cartoes.length ? cartoes.join('') : vazio) +
    '</section>'
  );
}

/** Cabeçalho com identificação do bot, prefixo e categoria ativa. */
function cabecalho(info) {
  return (
    '<header class="head">' +
    `<div class="logo">${escapeHtml(info.emoji || '🌙')}</div>` +
    '<div class="head-txt">' +
    `<div class="bot-name">${escapeHtml(info.botName)} <span class="bot-meta">v${escapeHtml(info.version)}</span></div>` +
    `<div class="bot-meta">Prefixo <b>${escapeHtml(info.prefix)}</b> • ${escapeHtml(String(info.total))} comandos • ` +
    `${escapeHtml(info.escopoTexto || 'preferências do bot')}</div>` +
    `<div class="cat-name" id="lua-cat-label">${escapeHtml(info.categoriaLabel || 'Menu principal')}</div>` +
    '</div>' +
    '</header>'
  );
}

/**
 * Rodapé: como o "Usar" funciona + alternativa tradicional (sempre acessível).
 * O texto tem que ser honesto: este card NÃO envia nada.
 */
function rodape(info) {
  const p = escapeHtml((info && info.prefix) || '!');
  return (
    '<footer class="foot">' +
    '▸ <b>Usar</b> monta o comando e deixa pronto para <b>copiar</b>: este card não tem como ' +
    'enviar mensagens. Cole no chat e mande.<br>' +
    '▸ Permissões (dono/admin), limites e confirmações continuam sendo conferidos pelo bot ' +
    '<b>a cada execução</b>.<br>' +
    `▸ Menu tradicional: <code>${p}menucompleto</code> • card não desenha? <code>${p}modohtml off</code>` +
    '</footer>'
  );
}

module.exports = {
  escapeHtml,
  escapeAttr,
  etiquetas,
  textoDeBusca,
  botaoUsar,
  cartaoDeComando,
  abaDeCategoria,
  secaoDeCategoria,
  cabecalho,
  rodape,
};
