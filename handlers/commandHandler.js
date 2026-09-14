/**
 * handlers/commandHandler.js — pipeline central de mensagens e comandos.
 *
 * 1. registra usuário/grupo + contadores + XP
 * 2. responde botões/listas
 * 3. sessões de jogos e menus numerados (fallback)
 * 4. resolve comando por prefixo + trigger, aplica permissões e cooldown
 * 5. executa com tratamento de erro (nunca derruba o bot)
 */

'use strict';

const CONFIG = require('../config');
const logger = require('../utils/logger').child('commands');
const settings = require('../database/settings');
const users = require('../database/users');
const groups = require('../database/groups');
const permissions = require('../utils/permissions');
const cooldown = require('../utils/cooldown');
const errorHandler = require('./errorHandler');
const buttonHandler = require('./buttonHandler');
const groupHandler = require('./groupHandler');
const activity = require('../utils/activity');
const mediaUtil = require('../utils/media');
const { cache } = require('../utils/cache');
const session = require('../utils/session');
const numberFallback = require('../utils/numberFallback');
const interactive = require('../utils/interactive');
const perf = require('../utils/perf');
const {
  extractText,
  getQuoted,
  getQuotedKey,
  getQuotedText,
  getMentionedJids,
  detectMediaType,
  resolveSender,
  splitCommand,
  isGroupJid,
  isStatusJid,
  getInteractivePayload,
} = require('../utils/messages');

const { registry } = require('../engine/plugins');

/* --------------------------- metadados ------------------------------- */

const XP_MIN_INTERVAL = 30 * 1000;
const lastXp = new Map();
const afkNotified = new Map();

async function getGroupMetadata(sock, jid) {
  const cached = cache.get('meta:' + jid);
  if (cached) return cached;
  try {
    const meta = await sock.groupMetadata(jid);
    cache.set('meta:' + jid, meta, 30000);
    return meta;
  } catch (_) {
    return { id: jid, participants: [] };
  }
}

function invalidateGroupMeta(jid) {
  cache.delete('meta:' + jid);
}

/* ----------------------------- contexto ------------------------------ */

async function buildContext(sock, msg) {
  const remoteJid = msg.key.remoteJid;
  const isGroup = isGroupJid(remoteJid);
  const botJid = (sock.user && sock.user.id) || '';
  const botLid = (sock.user && sock.user.lid) || '';
  const prefix = settings.effectivePrefix();

  // metadados do grupo (necessário p/ resolver LID → PN e admin)
  let meta = null;
  if (isGroup) meta = await getGroupMetadata(sock, remoteJid);
  const participants = (meta && meta.participants) || [];
  // Comunidades usam sempre endereçamento LID; meta traz isCommunity/linkedParent.
  const isCommunity = !!(meta && (meta.isCommunity || meta.linkedParent));
  // Mensagem de grupo endereçada por LID (comunidades caem aqui).
  const lidGroupMsg = isGroup && (
    String(msg.key.participant || '').endsWith('@lid') ||
    String(msg.key.participantAlt || '').endsWith('@lid')
  );

  // remetente: PN preferido; se sobrar LID (participantAlt ausente),
  // resolve pelo metadado do grupo (id=PN, lid=LID)
  let sender = resolveSender(msg) || remoteJid;
  if (sender.endsWith('@lid') && participants.length) {
    const pn = permissions.toPn(sender, participants);
    if (pn && !pn.endsWith('@lid')) sender = pn;
    else logger.warn({ sender, chat: remoteJid }, 'não consegui resolver LID → PN do remetente');
  }

  const text = extractText(msg);
  const quoted = getQuoted(msg);
  let mentionedJid = getMentionedJids(msg);
  if (mentionedJid.length && participants.length) {
    mentionedJid = mentionedJid.map((j) =>
      String(j).endsWith('@lid') ? permissions.toPn(j, participants) : j
    );
  }
  const quotedKey = getQuotedKey(msg);
  if (quotedKey && quotedKey.participant && String(quotedKey.participant).endsWith('@lid') && participants.length) {
    quotedKey.participant = permissions.toPn(quotedKey.participant, participants);
  }

  let isAdmin = false;
  let isBotAdmin = false;
  if (isGroup) {
    isAdmin = permissions.isAdmin(participants, sender);
    // em grupos LID o participant do bot pode vir com `id` = LID; comparamos
    // PN e LID para nunca tratar o bot como "não-admin" erroneamente
    isBotAdmin = permissions.isBotAdmin(participants, botLid ? [botJid, botLid] : botJid);
    if (sender === botJid) isAdmin = true;
  }

  const isOwner = permissions.isOwner(sender);
  const user = users.get(sender);
  const isRegistered = !!(user && user.is_registered);

  const ctx = {
    socket: sock,
    message: msg,
    remoteJid,
    sender,
    isGroup,
    isCommunity,
    isAdmin,
    isOwner,
    isBotAdmin,
    isPrivate: !isGroup,
    isBot: sender === botJid,
    isRegistered,
    args: [],
    command: null,
    prefix,
    text,
    quoted,
    quotedKey,
    quotedText: getQuotedText(msg),
    mentionedJid,
    mediaType: detectMediaType(msg),
  };

  /* ------------------- métodos de envio padronizados ------------------ */
  ctx.reply = async (t, opts = {}) => {
    try {
      const res = await sock.sendMessage(remoteJid, { text: String(t) }, { quoted: opts.quoted === false ? undefined : msg });
      if (isCommunity || lidGroupMsg) {
        logger.info(
          { chat: remoteJid, hasId: !!(res && res.key && res.key.id), community: !!isCommunity, lid: !!lidGroupMsg },
          '[SEND] resposta para comunidade/LID enviada (sendMessage resolveu)'
        );
        activity.terminalLine(
          `[SEND] comunidade/LID: chat=${remoteJid} resolveu=sim id=${res && res.key && res.key.id ? 'ok' : 'sem-id'}`
        );
      }
      return res;
    } catch (e) {
      logger.warn({ chat: remoteJid, err: e && e.message, stack: e && e.stack }, '[SEND] sendMessage FALHOU');
      activity.terminalLine(`[SEND] FALHOU: chat=${remoteJid} erro=${(e && e.message) || 'desconhecido'}`);
      if (e && e.stack) {
        activity.terminalLine(`[SEND] STACK: ${String(e.stack).split('\n').slice(0, 6).join(' ⏎ ')}`);
      }
      throw e;
    }
  };
  ctx.replyWithMentions = (t, mentions) =>
    sock.sendMessage(remoteJid, { text: String(t), mentions }, { quoted: msg });
  ctx.sendButtons = (o) => interactive.sendButtons(sock, remoteJid, Object.assign({ quoted: msg }, o));
  ctx.sendList = (o) => interactive.sendList(sock, remoteJid, Object.assign({ quoted: msg }, o));
  ctx.sendImage = (b, caption = '') => mediaUtil.sendImage(sock, remoteJid, b, caption, { quoted: msg });
  ctx.sendVideo = (b, caption = '', opts = {}) => mediaUtil.sendVideo(sock, remoteJid, b, caption, Object.assign({ quoted: msg }, opts));
  ctx.sendAudio = (b, opts = {}) => mediaUtil.sendAudio(sock, remoteJid, b, Object.assign({ quoted: msg }, opts));
  ctx.sendSticker = (b, opts = {}) => mediaUtil.sendSticker(sock, remoteJid, b, Object.assign({ quoted: msg }, opts));
  ctx.sendDocument = (b, opts = {}) => mediaUtil.sendDocument(sock, remoteJid, b, Object.assign({ quoted: msg }, opts));
  ctx.react = (emoji) => sock.sendMessage(remoteJid, { react: { text: emoji, key: msg.key } }).catch(() => {});
  ctx.deleteMessage = (key) => sock.sendMessage(remoteJid, { delete: key || msg.key }).catch(() => {});
  ctx.presence = (state) => sock.sendPresenceUpdate(state, remoteJid).catch(() => {});
  ctx.downloadMedia = async () => {
    const type = detectMediaType(msg);
    if (type) {
      const buffer = await mediaUtil.downloadMediaBuffer(sock, msg);
      return buffer ? { buffer, type } : null;
    }
    if (quoted) {
      const qt = detectMediaType({ message: quoted });
      if (qt) {
        const buffer = await mediaUtil.downloadMediaBuffer(sock, { message: quoted });
        return buffer ? { buffer, type: qt } : null;
      }
    }
    return null;
  };

  return ctx;
}

/* ----------------------------- gates -------------------------------- */

function checkGate(cmd, ctx) {
  const M = CONFIG.messages;
  if (cmd.ownerOnly && !ctx.isOwner) return { ok: false, message: M.deniedOwner };
  if (cmd.groupOnly && !ctx.isGroup) return { ok: false, message: M.groupOnly };
  if (cmd.privateOnly && ctx.isGroup) return { ok: false, message: M.privateOnly };
  if (cmd.adminOnly) {
    const allowed = ctx.isOwner || (ctx.isGroup && ctx.isAdmin);
    if (!allowed) return { ok: false, message: ctx.isGroup ? M.deniedAdmin : M.deniedOwner };
  }
  if (cmd.botAdmin && ctx.isGroup && !ctx.isBotAdmin) return { ok: false, message: M.botNotAdmin };
  if (CONFIG.mode.private && !ctx.isRegistered && !ctx.isOwner) return { ok: false, message: M.notRegistered };
  return { ok: true, message: '' };
}

/* --------------------------- execução -------------------------------- */

async function executeCommand(ctx, cmd, args) {
  const t0 = Date.now();
  const gate = checkGate(cmd, ctx);
  if (!gate.ok) {
    await ctx.reply(gate.message);
    return { ok: false, reason: 'gate' };
  }
  const cd = cooldown.check(cmd, ctx);
  if (!cd.allowed) {
    await ctx.reply(cooldown.message(cd.remaining));
    return { ok: false, reason: 'cooldown' };
  }
  ctx.command = cmd.name;
  ctx.args = args;
  logger.info(
    { tag: 'COMMAND', user: ctx.sender, chat: ctx.remoteJid, cmd: cmd.name, fromMe: !!(ctx.message && ctx.message.key && ctx.message.key.fromMe), args: args.slice(0, 6) },
    `[LUA][COMMAND] Executando: ${cmd.name}`
  );
  perf.add('commands');
  try {
    // registro organizado (terminal + !logs)
    const u = users.get(ctx.sender);
    activity.log({
      jid: ctx.sender,
      chat: ctx.remoteJid,
      isGroup: ctx.isGroup,
      command: cmd.name,
      args,
      prefix: ctx.prefix,
      name: (u && u.name) || null,
    });
  } catch (_) {
    /* o log de atividade nunca pode derrubar o comando */
  }
  try {
    await cmd.execute(ctx);
    perf.timing('command', Date.now() - t0);
    return { ok: true };
  } catch (err) {
    perf.add('errors');
    await errorHandler.handle(ctx, err, cmd);
    return { ok: false, reason: 'error' };
  }
}

/** Executa um comando pelo nome (usado por menus/botões). */
async function runByName(ctx, name, args = []) {
  const cmd = registry.getCommand(name);
  if (!cmd) return false;
  return executeCommand(ctx, cmd, args);
}

/* --------------------------- mensagens ------------------------------- */

/**
 * Política central: esta mensagem deve ser processada pelo bot?
 *
 * - Mensagem de TERCEIROS: SIM.
 * - Mensagem `fromMe` (enviada pelo próprio número do bot):
 *   - eco do próprio bot (IDs "3EB0...") → NÃO (evita loop infinito);
 *   - de quem NÃO é o dono → NÃO;
 *   - do DONO → apenas comandos (com prefixo) e respostas interativas
 *     (cliques em botões) — respostas em texto geradas pelo bot não reprocessam.
 */
function shouldProcessMessage(msg) {
  if (!msg || !msg.message) return false;
  if (!msg.key || !msg.key.fromMe) return true;
  const isBotEcho = typeof msg.key.id === 'string' && msg.key.id.startsWith('3EB0');
  if (isBotEcho) return false;
  const senderJid = resolveSender(msg) || msg.key.remoteJid;
  if (!permissions.isOwner(senderJid)) return false;
  const text = extractText(msg);
  if ((text || '').trim().startsWith(settings.effectivePrefix())) return true;
  if (getInteractivePayload(msg)) return true;
  return false;
}

async function handleMessage(sock, msg) {
  try {
    if (!shouldProcessMessage(msg)) return;
    if (isStatusJid(msg.key.remoteJid)) return;

    const ctx = await buildContext(sock, msg);
    if (!ctx.sender) return;

    // métrica: mensagens processadas
    perf.add('messages');

    // Diagnóstico de comunidades/LID (baixo ruído: só dispara nesses casos).
    const lidAddressed = ctx.isGroup && (
      String(msg.key.participant || '').endsWith('@lid') ||
      String(msg.key.participantAlt || '').endsWith('@lid')
    );
    if (ctx.isCommunity || lidAddressed) {
      logger.info(
        {
          chat: ctx.remoteJid,
          sender: ctx.sender,
          participant: msg.key.participant,
          participantAlt: msg.key.participantAlt,
          community: !!ctx.isCommunity,
          lid: !!lidAddressed,
        },
        '[COMMUNITY] mensagem recebida de comunidade/grupo LID'
      );
      activity.terminalLine(
        `[COMMUNITY] recebida: chat=${ctx.remoteJid} community=${ctx.isCommunity ? 'sim' : 'nao'} lid=${lidAddressed ? 'sim' : 'nao'} sender=${activity.maskJid(ctx.sender)}`
      );
    }

    // usuário bloqueado → ignora silenciosamente
    const blocked = require('../database/blocked');
    if (blocked.isBlocked(ctx.sender)) return;

    // proteção global contra flood (nunca atinge dono/admins; limiar generoso)
    if (CONFIG.ui.antiFlood && !ctx.isOwner && !ctx.isAdmin) {
      const flood = require('../utils/flood');
      if (flood.hit(ctx.sender)) return;
    }

    // mute: mensagens de usuários silenciados são apagadas (bot admin) ou
    // ignoradas antes de qualquer processamento (comandos/botões/sessões)
    if (ctx.isGroup) {
      const muted = await groupHandler.enforceMute(sock, ctx);
      if (muted.blocked) return;
    }

    // captura mídias de visualização única (para o comando !revelar)
    require('../utils/viewonce').capture(msg);

    // registro de usuário/grupo + contadores + XP
    users.upsert(ctx.sender, msg.pushName || '');
    if (ctx.isGroup) {
      groups.ensure(ctx.remoteJid, '');
      groups.incMemberMessages(ctx.remoteJid, ctx.sender);
    }
    users.incMessages(ctx.sender);
    grantXp(ctx.sender);

    // remove AFK silenciosamente quando o usuário volta a falar
    const u = users.get(ctx.sender);
    if (u && u.afk) {
      users.clearAfk(ctx.sender);
    }

    // AFK: avisar quem mencionou um usuário ausente
    await notifyAfk(sock, ctx);

    // respostas interativas (botões/lista) têm prioridade
    if (await buttonHandler.process(ctx)) return;

    // filtros de grupo
    if (ctx.isGroup) {
      const filtered = await groupHandler.applyFilters(sock, ctx);
      if (filtered.deleted) return;
    }

    const prefix = settings.effectivePrefix();
    const parsed = splitCommand(ctx.text, prefix);

    if (parsed) {
      const cmd = registry.resolveTrigger(parsed.command);
      if (!cmd) return; // comando desconhecido: ignora (sem spam)
      logger.info(
        { tag: 'COMMAND', sender: ctx.sender, fromMe: !!(msg.key && msg.key.fromMe) },
        `[LUA][COMMAND] Comando recebido: ${parsed.raw.split('\n')[0].slice(0, 80)}`
      );
      await executeCommand(ctx, cmd, parsed.args);
      return;
    }

    // \"prefixo\" (sem o símbolo) → mostra o prefixo atual (ajuda novos usuários)
    const bare = (ctx.text || '').trim().toLowerCase();
    if (bare === 'prefixo' || bare === 'prefix') {
      await ctx.reply(`🔤 Prefixo atual: *${prefix}*\n\n💡 Use *${prefix}menu* para ver os comandos.`);
      return;
    }

    // navegação por texto: "menu" abre o menu principal; "0"/"voltar" voltam
    // quando existe um menu numerado ativo para o chat
    if (bare === 'menu' || bare === 'menuprincipal') {
      await require('../utils/buttons').sendMainMenu(ctx);
      return;
    }
    if ((bare === '0' || bare === 'voltar') && numberFallback.getNumberMenu(ctx.remoteJid)) {
      await require('../utils/buttons').sendMainMenu(ctx);
      return;
    }

    // sem prefixo → sessão de jogo ativa?
    const gameSession = session.get(ctx.remoteJid, ctx.sender);
    if (gameSession && gameSession.onMessage) {
      try {
        await gameSession.onMessage(ctx);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: `session:${gameSession.type}` });
      }
      return;
    }

    // fallback de menu numerado
    const item = numberFallback.match(ctx.remoteJid, ctx.text);
    if (item && typeof item.run === 'function') {
      try {
        await item.run(ctx);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: 'menu-fallback' });
      }
      return;
    }
  } catch (err) {
    // nunca deixar uma mensagem derrubar o bot
    logger.error({ err: err.message, stack: err.stack }, 'erro no processamento de mensagem');
  }
}

function grantXp(sender) {
  const now = Date.now();
  const last = lastXp.get(sender) || 0;
  if (now - last < XP_MIN_INTERVAL) return;
  lastXp.set(sender, now);
  users.addXp(sender, 1 + Math.floor(Math.random() * 3));
}

async function notifyAfk(sock, ctx) {
  if (!ctx.mentionedJid.length) return;
  for (const jid of ctx.mentionedJid) {
    const u = users.get(jid);
    if (!u || !u.afk) continue;
    const lastKey = `${ctx.remoteJid}|${jid}`;
    const last = afkNotified.get(lastKey) || 0;
    if (Date.now() - last < 60 * 1000) continue; // avisa no máx. 1x/min
    afkNotified.set(lastKey, Date.now());
    const reason = u.afk_reason ? `\n📝 Motivo: ${u.afk_reason}` : '';
    await sock.sendMessage(ctx.remoteJid, { text: `💤 ${u.name || jid.split('@')[0]} está AFK.${reason}` }, { quoted: ctx.message });
  }
}

module.exports = {
  handleMessage,
  buildContext,
  executeCommand,
  runByName,
  checkGate,
  getGroupMetadata,
  invalidateGroupMeta,
  shouldProcessMessage,
};
