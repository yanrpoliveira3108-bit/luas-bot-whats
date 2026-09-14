/**
 * utils/nav.js — motor de navegação hierárquica por LISTA (list message).
 *
 * Telas (screens) com IDs estáveis e previsíveis:
 *   lua_nav_<screen>_<action>  (ações de conteúdo)
 *   lua_nav_back / lua_nav_home / lua_nav_close / lua_nav_next / lua_nav_prev
 *
 * - pilha de navegação por chat (Voltar / Menu / Fechar);
 * - imagem de cabeçalho opcional (utils/menuImage) enviada ANTES da lista;
 * - LISTA interativa (sections/rows) com fallback para texto numerado;
 * - paginação automática (seção de conteúdo + seção de navegação).
 *
 * NÃO usa quick_reply / botões nativos: a navegação é 100% por lista
 * (listResponseMessage). Os comandos digitados continuam funcionando.
 */

'use strict';

const CONFIG = require('../config');
const logger = require('./logger').child('nav');
const buttonHandler = require('../handlers/buttonHandler');
const numberFallback = require('./numberFallback');
const menuImage = require('./menuImage');
const interactive = require('./interactive');

const builders = new Map(); // screenId -> builder(ctx) => screen
const stack = new Map(); // chatId -> [{ id, page }]
const registeredActions = new Set(); // IDs de ação já registrados
const PAGE_SIZE = 9; // linhas de conteúdo por página (seção separada p/ navegação)

const NAV_IDS = {
  back: 'lua_nav_back',
  home: 'lua_nav_home',
  close: 'lua_nav_close',
  next: 'lua_nav_next',
  prev: 'lua_nav_prev',
};

let navRegistered = false;

/* ------------------------------ registro ------------------------------ */

function registerScreen(id, builder) {
  builders.set(String(id), builder);
}

function screenId(screen, action) {
  return `lua_nav_${screen}_${String(action).replace(/[^a-z0-9_]+/gi, '_').slice(0, 24)}`;
}

/**
 * Envia uma lista interativa de opções (uma seção). Retorna false se cair no texto.
 * `buttons` = [{ id, text, description? }].
 */
async function sendButtons(ctx, { title, body, footer, buttons, buttonText }) {
  const rows = (buttons || []).filter(Boolean).map((b) => ({
    id: b.id,
    title: String(b.text || b.title || '').slice(0, 24),
    description: b.description ? String(b.description).slice(0, 60) : undefined,
  }));
  return interactive.sendList(ctx.socket, ctx.remoteJid, {
    title: title || CONFIG.bot.name,
    text: body,
    footer: footer || `${CONFIG.bot.name} v${CONFIG.bot.version}`,
    buttonText: buttonText || '🌙 Abrir',
    sections: [{ title: title || CONFIG.bot.name, rows }],
    quoted: ctx.message,
  });
}

/* ---------------------------- navegação ------------------------------ */

function ensureNavRegistered() {
  if (navRegistered) return;
  navRegistered = true;
  buttonHandler.register(NAV_IDS.back, (ctx) => goBack(ctx));
  buttonHandler.register(NAV_IDS.home, (ctx) => require('./buttons').sendMainMenu(ctx));
  buttonHandler.register(NAV_IDS.close, (ctx) => ctx.reply('✅ Menu fechado.'));
  buttonHandler.register(NAV_IDS.next, (ctx) => nextPage(ctx));
  buttonHandler.register(NAV_IDS.prev, (ctx) => prevPage(ctx));
}

function current(ctx) {
  const s = stack.get(ctx.remoteJid) || [];
  return s.length ? s[s.length - 1] : null;
}

function push(ctx, id, page = 0) {
  const s = stack.get(ctx.remoteJid) || [];
  s.push({ id, page });
  stack.set(ctx.remoteJid, s.slice(-10)); // limita profundidade
}

function pop(ctx) {
  const s = stack.get(ctx.remoteJid) || [];
  s.pop();
  stack.set(ctx.remoteJid, s);
  return s.length ? s[s.length - 1] : null;
}

/** Abre uma tela (empilha e renderiza). */
async function openScreen(ctx, id, page = 0) {
  ensureNavRegistered();
  if (!builders.has(id)) {
    logger.warn({ id }, 'tela não registrada');
    await ctx.reply('⚠️ Menu indisponível.');
    return false;
  }
  // não duplicar a mesma tela no topo
  const cur = current(ctx);
  if (cur && cur.id === id && cur.page === page) {
    await render(ctx, cur);
    return true;
  }
  push(ctx, id, page);
  await render(ctx, { id, page });
  return true;
}

async function render(ctx, entry) {
  const id = entry.id;
  const page = entry.page || 0;
  const builder = builders.get(id);
  let screen;
  try {
    screen = builder(ctx) || {};
  } catch (err) {
    logger.error({ id, err: err.message }, 'erro ao montar tela');
    await ctx.reply('⚠️ Erro ao montar o menu.');
    return;
  }

  const all = Array.isArray(screen.buttons) ? screen.buttons.filter(Boolean) : [];
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const p = Math.min(page, pages - 1);
  const slice = all.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);

  // registra handlers estáveis das ações de conteúdo (uma única vez)
  for (const b of all) {
    const fullId = screenId(id, b.id);
    if (registeredActions.has(fullId)) continue;
    registeredActions.add(fullId);
    if (typeof b.run === 'function') {
      buttonHandler.register(fullId, (ctx2) => Promise.resolve(b.run(ctx2)).catch(() => {}));
    }
  }

  // conteúdo visível (com descrição, para uma lista elegante)
  const content = slice.map((b) => ({
    id: screenId(id, b.id),
    text: b.text,
    description: b.description,
  }));

  // seção de navegação (com run para o fallback numerado)
  const nav = [];
  if (pages > 1) {
    if (p < pages - 1) nav.push({ id: NAV_IDS.next, text: '⏩ Mais opções', description: `Página ${p + 1} de ${pages}`, run: (c) => nextPage(c) });
    if (p > 0) nav.push({ id: NAV_IDS.prev, text: '⏪ Anterior', description: `Página ${p + 1} de ${pages}`, run: (c) => prevPage(c) });
  }
  const hasBack = (stack.get(ctx.remoteJid) || []).length > 1;
  if (hasBack) nav.push({ id: NAV_IDS.back, text: '⬅️ Voltar', description: 'Tela anterior', run: (c) => goBack(c) });
  nav.push({ id: NAV_IDS.home, text: '🏠 Menu', description: 'Menu principal', run: (c) => require('./buttons').sendMainMenu(c) });
  nav.push({ id: NAV_IDS.close, text: '❌ Fechar', description: 'Fechar o menu', run: (c) => c.reply('✅ Menu fechado.') });

  const title = screen.title || CONFIG.bot.name;
  const listTitle = screen.listTitle || title;
  const body = screen.body || '';
  const buttonText = screen.buttonText || '🌙 Abrir';
  const footer = screen.footer || `${CONFIG.bot.name} • ${require('../database/settings').effectivePrefix()}menu para recarregar`;

  const sections = [
    { title: listTitle, rows: content.map((c) => ({ id: c.id, title: c.text, description: c.description })) },
    ...(nav.length ? [{ title: 'Navegação', rows: nav.map((n) => ({ id: n.id, title: n.text, description: n.description })) }] : []),
  ];

  // imagem de cabeçalho (opcional) — resolvida a partir da chave ou caminho
  const img = screen.image
    ? (typeof screen.image === 'string' && screen.image.includes('/') ? screen.image : menuImage.resolve(screen.image))
    : null;

  let ok = false;
  if (img) {
    // 1 mensagem só: lista nativa (single_select) com a imagem como cabeçalho
    ok = await interactive.sendListWithImage(ctx.socket, ctx.remoteJid, {
      title: listTitle,
      text: body,
      footer,
      sections,
      image: img,
      quoted: ctx.message,
    });
    if (!ok) {
      // fallback: imagem separada + lista clássica (nunca derruba o menu)
      try {
        await ctx.sendImage(img, screen.header || screen.title || CONFIG.bot.name);
      } catch (_) {
        /* imagem quebrada não derruba o menu */
      }
      ok = await interactive.sendList(ctx.socket, ctx.remoteJid, {
        title: listTitle,
        text: body,
        footer,
        buttonText,
        sections,
        quoted: ctx.message,
      });
    }
  } else {
    ok = await interactive.sendList(ctx.socket, ctx.remoteJid, {
      title: listTitle,
      text: body,
      footer,
      buttonText,
      sections,
      quoted: ctx.message,
    });
  }
  if (ok) return;

  // fallback textual numerado (mesmas ações, via run)
  const flat = [
    ...slice.map((b) => ({ label: b.text, run: typeof b.run === 'function' ? b.run : null })),
    ...nav.map((n) => ({ label: n.text, run: typeof n.run === 'function' ? n.run : null })),
  ];
  numberFallback.setNumberMenu(
    ctx.remoteJid,
    flat.map((b, i) => ({ num: i + 1, label: b.label, run: b.run }))
  );
  const lines = flat.map((it, i) => `${i + 1}. ${it.label}`).join('\n');
  await ctx.reply(`*${title}*${body ? '\n' + body : ''}\n\n${lines}\n\n_Responda com o número._`);
}

async function nextPage(ctx) {
  const cur = current(ctx);
  if (!cur) return;
  await render(ctx, { id: cur.id, page: cur.page + 1 });
  stack.set(ctx.remoteJid, [...(stack.get(ctx.remoteJid) || []).slice(0, -1), { id: cur.id, page: cur.page + 1 }]);
}

async function prevPage(ctx) {
  const cur = current(ctx);
  if (!cur) return;
  const page = Math.max(0, cur.page - 1);
  await render(ctx, { id: cur.id, page });
  stack.set(ctx.remoteJid, [...(stack.get(ctx.remoteJid) || []).slice(0, -1), { id: cur.id, page }]);
}

async function goBack(ctx) {
  const prev = pop(ctx);
  if (prev) {
    await render(ctx, prev);
  } else {
    await require('./buttons').sendMainMenu(ctx);
  }
}

function clearStack(chatId) {
  stack.delete(chatId);
}

module.exports = {
  registerScreen,
  openScreen,
  render,
  goBack,
  clearStack,
  NAV_IDS,
  screenId,
  sendButtons,
};
