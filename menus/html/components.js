/**
 * menus/html/components.js — peças reutilizadas pelos templates HTML.
 *
 * Aqui ficam a escapagem (por contexto), o cartão de comando e a decisão de
 * quando um comando pode virar LINK.
 *
 * Sobre segurança (leia antes de mexer):
 *   - `escapeHtml`  → conteúdo de texto/atributo comum;
 *   - `escapeAttr`  → valores dentro de atributo (href, data-*), incluindo URL;
 *   - nada de credenciais/sessão/número de pessoas no HTML: só dados públicos
 *     de comando (nome, descrição, exemplo) e o prefixo.
 *
 * Sobre as AÇÕES:
 *   O card HTML é renderizado pelo cliente e NÃO conversa de volta com o bot
 *   (o protocolo não expõe callback, e este vendor não trata `botInvokeMessage`
 *   recebido). A única ação confiável é um LINK `wa.me`: abre a conversa com o
 *   comando já escrito. O usuário toca em enviar e o bot processa pelo
 *   pipeline normal — com validação de permissão, cooldown e limites.
 *   Por isso: comando que NÃO funciona no privado (grupo/admin) NÃO ganha link
 *   bonito — ele é mostrado como texto, com a etiqueta do lugar certo. Nada de
 *   botão decorativo.
 */

'use strict';

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

/** Só dígitos — usado no número do bot do link wa.me. */
function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Um comando pode virar link `wa.me`?
 *
 * Só quando ele funciona no privado. `groupOnly`, `adminOnly` e `botAdmin`
 * dependem do contexto do grupo — abriria uma conversa onde o comando falharia
 * ("só funciona em grupos"), o que é pior que não ter botão.
 */
function podeLinkar(cmd) {
  if (!cmd) return false;
  if (cmd.groupOnly) return false;
  if (cmd.adminOnly) return false;
  if (cmd.botAdmin) return false;
  return true;
}

/** Link `wa.me` que abre a conversa do bot com o comando preenchido. */
function linkDoComando(botDigits, prefix, trigger) {
  const d = onlyDigits(botDigits);
  if (!d) return '';
  const texto = `${prefix}${trigger}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

/** Etiquetas de permissão/contexto do comando. */
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
 * Cartão de um comando.
 * @param {object} cmd comando do registry
 * @param {object} opts { prefix, botDigits, categoria, emoji }
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
  const linkavel = podeLinkar(cmd);
  const href = linkavel ? linkDoComando(opts.botDigits, prefix, trigger) : '';
  const acao = href
    ? `<a class="go" href="${escapeAttr(href)}" rel="noopener noreferrer">Usar</a>`
    : '';
  const dica = linkavel
    ? ''
    : '<p class="ex">▸ Este comando precisa do contexto do grupo — digite no grupo.</p>';

  return (
    '<article class="cmd">' +
    `<div class="ico">${escapeHtml(emoji)}</div>` +
    '<div class="body">' +
    `<div class="top"><code>${escapeHtml(linha)}</code>${tags.join('')}</div>` +
    `<p class="desc">${escapeHtml(cmd.description || 'Sem descrição.')}</p>` +
    (compacto ? '' : `<p class="ex">Ex.: <code>${escapeHtml(exemplos)}</code></p>`) +
    dica +
    '</div>' +
    acao +
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
  // fora e oferece um LINK (wa.me) para o menu completo daquela categoria.
  let avisoCorte = '';
  if (opts.avisoCorte) {
    const atalho = opts.avisoCorte.atalho || '';
    const href = atalho ? linkDoComando(opts.botDigits, opts.prefix, atalho) : '';
    avisoCorte =
      `<p class="sec-desc">▸ Mostrando ${escapeHtml(String(opts.avisoCorte.mostrados))} de ` +
      `${escapeHtml(String(opts.avisoCorte.total))} comandos (limite do card).` +
      (href
        ? ` Complete: <a href="${escapeAttr(href)}" rel="noopener noreferrer">${escapeHtml(opts.prefix + atalho)}</a>`
        : ` Digite <code>${escapeHtml(opts.prefix)}menucompleto</code> para a lista completa.`) +
      '</p>';
  }
  const cartoes = comandos.map((c) =>
    cartaoDeComando(c, {
      prefix: opts.prefix,
      botDigits: opts.botDigits,
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

/** Rodapé: como usar + alternativa tradicional (sempre acessível). */
function rodape(info) {
  const tradicional = linkDoComando(info.botDigits, info.prefix, 'menucompleto');
  return (
    '<footer class="foot">' +
    `▸ Toque em <b>Usar</b> para abrir a conversa com o comando já escrito — depois é só enviar.<br>` +
    `▸ As permissões (dono/admin/limites) são conferidas pelo bot <b>a cada execução</b>.<br>` +
    `▸ Menu tradicional a qualquer momento: <code>${escapeHtml(info.prefix)}menucompleto</code>` +
    (tradicional ? ` — <a href="${escapeAttr(tradicional)}" rel="noopener noreferrer">abrir no chat</a>` : '') +
    '<br>▸ Este card precisa de um WhatsApp que renderize HTML. Se ele aparecer vazio/estranho, ' +
    `use <code>${escapeHtml(info.prefix)}modohtml off</code> ou <code>${escapeHtml(info.prefix)}menucompleto</code>.` +
    '</footer>'
  );
}

module.exports = {
  escapeHtml,
  escapeAttr,
  onlyDigits,
  podeLinkar,
  linkDoComando,
  etiquetas,
  textoDeBusca,
  cartaoDeComando,
  abaDeCategoria,
  secaoDeCategoria,
  cabecalho,
  rodape,
};
