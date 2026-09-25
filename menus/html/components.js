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
  // emoji === null → emojis decorativos desligados (!temahtml emojis off): o
  // ícone some na ORIGEM e a coluna dele não ocupa espaço
  const emoji = opts.emoji === null ? null : opts.emoji || '▸';
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
    (emoji ? `<div class="ico">${escapeHtml(emoji)}</div>` : '') +
    '<div class="body">' +
    // "Usar" fica NA MESMA LINHA do nome (empurrado para a direita): assim a
    // descrição ocupa a largura inteira e o cartão fica bem mais baixo — o que
    // aumenta quantos comandos aparecem por tela (ver MENUS-HTML.md §2.2).
    `<div class="top"><code>${escapeHtml(linha)}</code>${tags.join('')}` +
    botaoUsar(cmd, { prefix }) +
    '</div>' +
    `<p class="desc">${escapeHtml(cmd.description || 'Sem descrição.')}</p>` +
    (compacto ? '' : `<p class="ex">Ex.: <code>${escapeHtml(exemplos)}</code></p>`) +
    '</div>' +
    '</article>'
  );
}

/** Botão de aba de categoria. */
function abaDeCategoria(cat, opts = {}) {
  const id = escapeAttr(cat.id);
  const comEmoji = opts.emojis !== false;
  const rotulo = comEmoji ? cat.label : cat.title;
  return (
    `<button class="tab" type="button" data-cat="${id}" data-label="${escapeAttr(rotulo)}">` +
    (comEmoji ? `<span>${escapeHtml(cat.emoji)}</span>` : '') +
    `<span>${escapeHtml(cat.title)}</span>` +
    `<span class="count">${escapeHtml(String(cat.count))}</span>` +
    '</button>'
  );
}

/** Seção de uma categoria com seus comandos. */
function secaoDeCategoria(cat, comandos, opts = {}) {
  // UMA linha de identificação por categoria. Antes esta seção trazia título,
  // descrição e aviso de corte — três blocos que empurravam o primeiro comando
  // ~120px para baixo (num WebView baixo, era o bastante para não aparecer
  // nenhum comando inteiro). O aviso de corte mudou para o rodapé (fim da
  // lista) e continua dizendo a mesma coisa; a categoria também aparece no
  // cabeçalho e na aba ativa.
  const cartoes = comandos.map((c) =>
    cartaoDeComando(c, {
      prefix: opts.prefix,
      categoria: cat.id,
      emoji: opts.emojis === false ? null : opts.emojiDe ? opts.emojiDe(c) : '▸',
      compacto: opts.compacto,
    })
  );
  const vazio = '<p class="empty">Nenhum comando carregado nesta categoria.</p>';
  return (
    `<section class="sec" data-cat="${escapeAttr(cat.id)}">` +
    '<h2 class="sec-title">' +
    (opts.emojis === false ? '' : `<span>${escapeHtml(cat.emoji)}</span>`) +
    `<span>${escapeHtml(cat.title)}</span>` +
    `<span class="pill">${escapeHtml(String(comandos.length))}</span>` +
    (cat.description ? `<span class="sec-desc">${escapeHtml(cat.description)}</span>` : '') +
    '</h2>' +
    (cartoes.length ? cartoes.join('') : vazio) +
    '</section>'
  );
}

/**
 * Painel COMPACTO de identificação (componente único, usado por todos os
 * menus HTML). Dados crus vêm de utils/menuIdentity.js; aqui tudo é escapado.
 * Solicitante ≠ dono do bot ≠ conta conectada — cada um no seu campo, com
 * rótulo explícito. Valores longos: uma linha com reticências (o valor
 * inteiro fica no `title`). Dado não resolvido → texto honesto, nunca um
 * número inventado nem um identificador interno.
 */
function painelIdentidade(ident, extra = {}) {
  const id = ident || {};
  const celula = (rotulo, valorHtml, titulo, extraClass = '') =>
    `<span class="idp-c${extraClass ? ' ' + extraClass : ''}" title="${escapeAttr(titulo)}">${rotulo} ${valorHtml}</span>`;
  const sol = id.solicitante && id.solicitante.texto;
  const dono = id.dono && id.dono.texto;
  const botNum = id.bot && id.bot.numero;
  const botNome = id.bot && id.bot.nome;
  const prefixo = id.prefixo || extra.prefix || '';
  const total = extra.total !== undefined ? ` • ${escapeHtml(String(extra.total))} cmds` : '';
  const botHtml = botNum
    ? `<b>${escapeHtml(botNum)}</b>${botNome ? ' · ' + escapeHtml(botNome) : ''}`
    : botNome
      ? `<b>${escapeHtml(botNome)}</b> · <i>número indisponível</i>`
      : '<i>indisponível</i>';
  return (
    '<div class="idp" role="group" aria-label="Identificação deste menu">' +
    // grade 2x2: [pedido por | prefixo] / [dono | bot].
    // Mantém `Prefixo <b>${escapeHtml(prefixo)}</b>` para compatibilidade estrita com testes e contratos.
    celula('Pedido por', sol ? `<b>${escapeHtml(sol)}</b>` : '<i>não identificado</i>', `Solicitado por: ${sol || 'não identificado'}`, 'idp-user') +
    celula('Prefixo', `<b>${escapeHtml(prefixo)}</b>${total}`, `Prefixo deste chat: ${prefixo}`, 'idp-prefix') +
    celula('Dono', dono ? `<b>${escapeHtml(dono)}</b>` : '<i>não configurado</i>', `Dono do bot: ${dono || 'não configurado'}`, 'idp-sec') +
    celula('Bot', botHtml, `Conta conectada: ${[botNum, botNome].filter(Boolean).join(' · ') || 'indisponível'}`, 'idp-sec') +
    '</div>'
  );
}

/** Cabeçalho com identificação do bot, prefixo e categoria ativa. */
function cabecalho(info) {
  const comEmoji = info.emojis !== false;
  return (
    `<header class="head${comEmoji ? '' : ' sem-emoji'}">` +
    (comEmoji ? `<div class="logo">${escapeHtml(info.emoji || '🌙')}</div>` : '') +
    '<div class="head-txt">' +
    // duas linhas (nome + categoria na mesma; prefixo/comandos embaixo): cada
    // linha a mais aqui é um pedaço de comando a menos na tela.
    '<div class="head-line">' +
    `<span class="bot-name">${escapeHtml(info.botName)} <span class="bot-meta">v${escapeHtml(info.version)}</span></span>` +
    `<span class="cat-name" id="lua-cat-label">${escapeHtml(info.categoriaLabel || 'Menu principal')}</span>` +
    '</div>' +
    '</div>' +
    // o painel de identificação SUBSTITUI a antiga linha de meta (prefixo +
    // total) e ocupa a largura INTEIRA do cabeçalho (abaixo do logo), para os
    // números caberem sem corte em telas de celular
    painelIdentidade(info.ident || { prefixo: info.prefix }, { prefix: info.prefix, total: info.total }) +
    '</header>'
  );
}

/**
 * Rodapé: aviso limpo e discreto apenas quando há corte por tamanho.
 * Não polui o final da lista com avisos redundantes ou medições visíveis.
 */
function rodape(info) {
  const p = escapeHtml((info && info.prefix) || '!');
  const corte = info && info.avisoCorte;
  const linhaCorte = corte
    ? '<span class="foot-corte">▸ Mostrando ' +
      `${escapeHtml(String(corte.mostrados))} de ${escapeHtml(String(corte.total))}: ` +
      `<code>${escapeHtml(p + (corte.atalho || 'menucompleto'))}</code> traz a lista completa.</span>`
    : '';
  return (
    '<footer class="foot">' +
    linhaCorte +
    '<span class="foot-medida" id="lua-medida" hidden></span>' +
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
  painelIdentidade,
  rodape,
};
