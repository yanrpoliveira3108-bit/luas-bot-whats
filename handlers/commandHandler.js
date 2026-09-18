/**
 * handlers/commandHandler.js — contexto, gates e execução de comandos.
 *
 * A CADEIA de processamento (ordem das etapas) está em engine/pipeline.js;
 * este arquivo fornece as peças que a cadeia usa:
 *   • buildContext — ctx único da mensagem (chat, usuário, permissões, mídia)
 *   • checkGate    — permissões do comando (owner/admin/grupo/privado/registro)
 *   • executeCommand — gate + cooldown + atividade + execução + erro
 *   • runByName    — dispatch por nome (usado pelos botões de sugestão)
 *   • shouldProcessMessage — eco do bot/status
 *   • getGroupMetadata/invalidateGroupMeta — metadata com cache TTL
 * Nada aqui mudou de comportamento na Fase 3: só saiu de dentro do handleMessage.
 */

'use strict';

const CONFIG = require('../config');
const logger = require('../utils/logger').child('commands');
const settings = require('../database/settings');
const users = require('../database/users');
const groups = require('../database/groups');
const permissions = require('../utils/permissions');
const cooldown = require('../utils/cooldown');
const rpgService = require('../services/rpgService');
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
const { commandEmoji } = require('../utils/commandEmoji');
const {
  extractText,
  getQuoted,
  getQuotedKey,
  getQuotedSender,
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
const { createPipeline } = require('../engine/pipeline');

/* --------------------------- metadados ------------------------------- */

/**
 * Última notificação de AFK por (chat|usuário). Sem limite isto crescia para
 * sempre — um par por usuário mencionado em qualquer grupo, nunca removido.
 * A poda segue o mesmo padrão da Fase 2 (C2 — pruneSpamState): só acima do
 * teto, removendo entradas vencidas (a janela de supressão é de 60 s, então
 * remover o que tem mais de 5 min não muda nenhum comportamento).
 */
const afkNotified = new Map();
const AFK_NOTIFIED_MAX = 1000;
const AFK_NOTIFIED_STALE_MS = 5 * 60 * 1000;

function pruneAfkNotified(now) {
  if (afkNotified.size <= AFK_NOTIFIED_MAX) return 0;
  let removed = 0;
  for (const [key, at] of afkNotified) {
    if (now - at > AFK_NOTIFIED_STALE_MS) {
      afkNotified.delete(key);
      removed += 1;
    }
  }
  // Uma rajada de entradas NOVAS não é removida pelo critério de validade —
  // sem isto o teto não valeria nada. O Map preserva a ordem de inserção,
  // então descartamos as mais antigas até voltar ao limite.
  while (afkNotified.size > AFK_NOTIFIED_MAX) {
    afkNotified.delete(afkNotified.keys().next().value);
    removed += 1;
  }
  return removed;
}

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

  let meta = null;
  if (isGroup) meta = await getGroupMetadata(sock, remoteJid);
  const participants = (meta && meta.participants) || [];
  const isCommunity = !!(meta && (meta.isCommunity || meta.linkedParent));
  const lidGroupMsg = isGroup && (
    String(msg.key.participant || '').endsWith('@lid') ||
    String(msg.key.participantAlt || '').endsWith('@lid')
  );

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

  // Autor da mensagem respondida, canonizado p/ PN (igual a sender/mentionedJid):
  // em grupos LID o citado chega como @lid e o bot é chaveado por PN.
  let quotedSender = getQuotedSender(msg);
  if (quotedSender.endsWith('@lid') && participants.length) {
    const pn = permissions.toPn(quotedSender, participants);
    if (pn && !pn.endsWith('@lid')) quotedSender = pn;
    else logger.warn({ quotedSender, chat: remoteJid }, 'não consegui resolver LID → PN do autor citado');
  }

  let isAdmin = false;
  let isBotAdmin = false;
  if (isGroup) {
    isAdmin = permissions.isAdmin(participants, sender);
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
    quotedSender,
    quotedText: getQuotedText(msg),
    mentionedJid,
    mediaType: detectMediaType(msg),
  };

  ctx.reply = async (t, opts = {}) => {
    try {
      const res = await sock.sendMessage(remoteJid, { text: String(t) }, { quoted: opts.quoted === false ? undefined : msg });
      if (isCommunity || lidGroupMsg) {
        logger.info(
          { chat: remoteJid, hasId: !!(res && res.key && res.key.id), community: !!isCommunity, lid: !!lidGroupMsg },
          '[SEND] resposta para comunidade/LID enviada'
        );
      }
      return res;
    } catch (e) {
      logger.warn({ chat: remoteJid, err: e && e.message }, '[SEND] sendMessage FALHOU');
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
  } catch (_) {}
  // Reage à mensagem do comando com o emoji temático (diverso por comando/
  // categoria). Fire-and-forget: não atrasa o comando e falha em silêncio.
  if (CONFIG.ui.commandReactions && typeof ctx.react === 'function') {
    const emoji = commandEmoji(cmd);
    ctx.react(emoji && emoji !== '▸' ? emoji : '✅');
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

async function runByName(ctx, name, args = []) {
  const cmd = registry.getCommand(name);
  if (!cmd) return false;
  return executeCommand(ctx, cmd, args);
}

/* --------------------------- mensagens ------------------------------- */

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

/**
 * Ponto de entrada das mensagens.
 *
 * A cadeia em si (accept → normalize → gateUser → register → interactive →
 * moderation → dispatch → shortcuts → confirmation → sessionFlow) mora em
 * engine/pipeline.js desde a Fase 3. Aqui fica só o adaptador: as etapas
 * continuam recebendo exatamente as mesmas dependências e a ordem é a mesma de
 * antes — flood continua antes do parse e as confirmações continuam valendo
 * apenas para mensagens que NÃO são comando.
 */
async function handleMessage(sock, msg) {
  return pipeline.run(sock, msg);
}

/**
 * XP por mensagem. A REGRA (intervalo mínimo + quantidade) está em
 * services/rpgService.js desde a Fase 5; aqui fica só a chamada.
 */
function grantXp(sender) {
  rpgService.grantMessageXp(sender);
}

async function notifyAfk(sock, ctx) {
  if (!ctx.mentionedJid.length) return;
  for (const jid of ctx.mentionedJid) {
    const u = users.get(jid);
    if (!u || !u.afk) continue;
    const lastKey = `${ctx.remoteJid}|${jid}`;
    const last = afkNotified.get(lastKey) || 0;
    if (Date.now() - last < 60 * 1000) continue;
    const now = Date.now();
    afkNotified.set(lastKey, now);
    pruneAfkNotified(now);
    const reason = u.afk_reason ? `\n📝 Motivo: ${u.afk_reason}` : '';
    await sock.sendMessage(ctx.remoteJid, { text: `💤 ${u.name || jid.split('@')[0]} está AFK.${reason}` }, { quoted: ctx.message });
  }
}

/* --------------------------- pipeline (Fase 3) -------------------------- */

const pipeline = createPipeline({
  CONFIG,
  logger,
  perf,
  settings,
  users,
  groups,
  session,
  numberFallback,
  interactive,
  registry,
  buttonHandler,
  groupHandler,
  errorHandler,
  isStatusJid,
  splitCommand,
  shouldProcessMessage,
  buildContext,
  executeCommand,
  runByName,
  grantXp,
  notifyAfk,
});

module.exports = {
  pipeline,
  notifyAfk,
  /** tamanho da tabela de AFK notificado (teste de vazamento). */
  afkNotifiedSize: () => afkNotified.size,
  handleMessage,
  buildContext,
  executeCommand,
  runByName,
  checkGate,
  getGroupMetadata,
  invalidateGroupMeta,
  shouldProcessMessage,
};
