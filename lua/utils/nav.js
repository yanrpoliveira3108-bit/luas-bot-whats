/**
 * utils/nav.js — motor de navegação hierárquica por botões.
 *
 * Telas (screens) com IDs estáveis e previsíveis:
 *   lua_nav_<screen>_<action>  (ações de conteúdo)
 *   lua_nav_back / lua_nav_home / lua_nav_close / lua_nav_next / lua_nav_prev
 *
 * - pilha de navegação por chat (Voltar / Menu / Fechar);
 * - imagem de cabeçalho opcional (utils/menuImage);
 * - botões nativos (native flow) com fallback para texto numerado;
 * - paginação automática (até 6 opções por tela + navegação).
 */

'use strict';

const CONFIG = require('../config');
const settings = require('../database/settings');
const logger = require('./logger').child('nav');
const buttonHandler = require('../handlers/buttonHandler');
const numberFallback = require('./numberFallback');
const menuImage = require('./menuImage');

const builders = new Map(); // screenId -> builder(ctx) => screen
const stack = new Map(); // chatId -> [{ id, page }]
const registeredActions = new Set(); // IDs de ação já registrados
const PAGE_SIZE = 6;

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

/** Envia mensagem com botões nativos; retorna false se cair no texto. */
async function sendButtons(ctx, { title, body, footer, buttons }) {
  try {
    await ctx.socket.sendMessage(
      ctx.remoteJid,
      {
        text: body,
        footer: footer || `${CONFIG.bot.name} v${CONFIG.bot.version}`,
        title,
        interactiveButtons: buttons.map((b) => ({ id: b.id, text: b.text })),
      },
      { quoted: ctx.message }
    );
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, 'botões nativos falharam — fallback textual');
    return false;
  }
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
    buttonHandler.register(fullId, (ctx2) => Promise.resolve(b.run(ctx2)).catch(() => {}));
  }

  // monta lista de botões visíveis
  const vis = slice.map((b) => ({ id: screenId(id, b.id), text: b.text, run: b.run }));

  // paginação
  if (pages > 1) {
    if (p < pages - 1) vis.push({ id: NAV_IDS.next, text: '⏩ Mais', run: (c) => nextPage(c) });
    if (p > 0) vis.push({ id: NAV_IDS.prev, text: '⏪ Anterior', run: (c) => prevPage(c) });
  }

  // navegação fixa
  const hasBack = (stack.get(ctx.remoteJid) || []).length > 1;
  if (hasBack) vis.push({ id: NAV_IDS.back, text: '⬅️ Voltar', run: (c) => goBack(c) });
  vis.push({ id: NAV_IDS.home, text: '🏠 Menu', run: (c) => require('./buttons').sendMainMenu(c) });
  vis.push({ id: NAV_IDS.close, text: '❌ Fechar', run: (c) => c.reply('✅ Menu fechado.') });

  // imagem de cabeçalho (opcional)
  if (screen.image) {
    const img = typeof screen.image === 'string' && screen.image.includes('/') ? screen.image : menuImage.resolve(screen.image);
    if (img) {
      try {
        await ctx.sendImage(img, screen.title || CONFIG.bot.name);
      } catch (_) {
        /* imagem quebrada não derruba o menu */
      }
    }
  }

  const title = screen.title || CONFIG.bot.name;
  const body = screen.body || '';

  const ok = await sendButtons(ctx, { title, body, footer: screen.footer, buttons: vis });
  if (ok) return;

  // fallback textual numerado
  const items = vis.map((b, i) => ({ num: i + 1, label: b.text, run: b.run }));
  numberFallback.setNumberMenu(ctx.remoteJid, items);
  const lines = items.map((it) => `${it.num}. ${it.label}`).join('\n');
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
