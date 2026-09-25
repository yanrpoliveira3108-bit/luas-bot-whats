/**
 * handlers/commandHandler.js — pipeline central de mensagens e comandos.
 *
 * 1. registra usuário/grupo + contadores + XP
 * 2. responde botões/listas
 * 3. sessões de jogos e menus numerados (fallback)
 * 4. resolve comando por prefixo + trigger, aplica permissões e cooldown
 * 5. executa com tratamento de erro (nunca derruba o bot)
 * 6. sugestão inteligente quando comando não existe (fuzzy + botões)
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
const groupMeta = require('../utils/groupMeta');
const autobot = require('../utils/autobot');
const janitor = require('../utils/janitor');
const mediaUtil = require('../utils/media');
const session = require('../utils/session');
const numberFallback = require('../utils/numberFallback');
const interactive = require('../utils/interactive');
const perf = require('../utils/perf');
const antiBan = require('../utils/antiBan');
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

// Limite de comandos por usuário/grupo (recurso "Limitar Comandos").
const cmdRate = new Map(); // "grupo|usuário" -> { n, start }

/**
 * Faxina dos mapas deste handler. Antes eles cresciam para sempre (cada
 * usuário/chat novo ficava na memória até o processo morrer). Agora existe
 * UM único timer para o bot inteiro (utils/janitor).
 */
function sweepMemory() {
  const now = Date.now();
  for (const [k, ts] of lastXp) if (now - ts > 6 * 60 * 60 * 1000) lastXp.delete(k);
  for (const [k, ts] of afkNotified) if (now - ts > 6 * 60 * 60 * 1000) afkNotified.delete(k);
  for (const [k, st] of cmdRate) if (now - st.start > 10 * 60 * 1000) cmdRate.delete(k);
  if (lastXp.size > 20000) lastXp.clear();
  if (afkNotified.size > 20000) afkNotified.clear();
}

janitor.register('commandHandler-memory', sweepMemory, 10 * 60 * 1000);

/**
 * Contador de comandos por usuário (recurso Limitar Comandos).
 * @returns {{limited:boolean, remaining:number}}
 */
function checkCommandLimit(ctx, limit, windowSec) {
  if (!ctx.isGroup) return { limited: false, remaining: 0 };
  if (ctx.isOwner || ctx.isAdmin || ctx.isX9 || ctx.isGold) return { limited: false, remaining: 0 };
  const key = `${ctx.remoteJid}|${ctx.sender}`;
  const now = Date.now();
  let st = cmdRate.get(key);
  if (!st || now - st.start > windowSec * 1000) {
    st = { n: 0, start: now };
    if (cmdRate.size > 20000) cmdRate.delete(cmdRate.keys().next().value);
    cmdRate.set(key, st);
  }
  st.n += 1;
  if (st.n > limit) {
    return { limited: true, remaining: Math.ceil((st.start + windowSec * 1000 - now) / 1000) };
  }
  return { limited: false, remaining: limit - st.n };
}

/** Metadados do grupo (cache compartilhado — ver utils/groupMeta). */
async function getGroupMetadata(sock, jid) {
  return groupMeta.get(sock, jid);
}

function invalidateGroupMeta(jid) {
  groupMeta.invalidate(jid);
}

/**
 * Resolve um LID para o telefone (JID PN) usando o mapa da biblioteca
 * (`signalRepository.lidMapping`). Devolve null quando não há mapa.
 * Prazo curto: identidade não pode travar o processamento do comando.
 */
async function pnPeloMapaDeLid(sock, lid) {
  try {
    const mapa = sock && sock.signalRepository && sock.signalRepository.lidMapping;
    if (!mapa || typeof mapa.getPNForLID !== 'function') return null;
    let timer = null;
    const prazo = new Promise((r) => {
      timer = setTimeout(() => r(null), 3000);
    });
    try {
      const achado = await Promise.race([mapa.getPNForLID(String(lid)), prazo]);
      if (!achado) return null;
      const s = String(achado);
      if (s.endsWith('@lid')) return null;
      const m = s.match(/^(\d+)(?::\d+)?@/);
      if (m) return m[1] + '@s.whatsapp.net';
      return s.includes('@') ? s : null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (_) {
    return null;
  }
}

/** Primeiro frame do stack (arquivo:linha) — é o que aponta a causa real. */
function frameDoStack(err) {
  const linhas = String((err && err.stack) || '').split('\n');
  for (const l of linhas) {
    const t = l.trim();
    if (t.startsWith('at ') && !t.includes('node:internal') && !t.includes('internal/process')) return t;
  }
  return linhas.length > 1 ? linhas[1].trim() : '';
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
  if (sender.endsWith('@lid')) {
    let pn = participants.length ? permissions.toPn(sender, participants) : sender;
    if (!pn || pn.endsWith('@lid')) {
      // 2ª tentativa: o mapa LID↔PN da PRÓPRIA biblioteca (o mesmo usado para
      // cifrar). Em grupo de comunidade/LID a lista de participantes pode vir
      // sem telefone (mesmo defeito que derrubava o envio — SEGURANCA-ENVIO.md
      // §4.1.4); sem o PN, o dono deixa de ser reconhecido (`!freio` respondia
      // "Apenas o dono do bot") e a identidade da pessoa (carteira/registro)
      // mudaria só por estar num grupo LID.
      pn = await pnPeloMapaDeLid(sock, sender);
    }
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
    isBotAdmin = permissions.isBotAdmin(participants, botLid ? [botJid, botLid] : botJid);
    if (sender === botJid) isAdmin = true;
  }

  const isOwner = permissions.isOwner(sender);
  const user = users.get(sender);
  const isRegistered = !!(user && user.is_registered);

  // O bot foi citado/respondido? (usado por simih2 e por comandos de chat)
  const quotedParticipant = quotedKey && (quotedKey.participant || '');
  const quotedFromBot =
    !!quotedParticipant && (quotedParticipant === botJid || (botLid && quotedParticipant === botLid));
  const botAddressed =
    (isGroup && mentionedJid.some((j) => j === botJid || (botLid && j === botLid))) || quotedFromBot;

  // Cargo X9 e Modo Gold (só consultam o banco quando o recurso está ligado)
  const isX9 = isGroup && autobot.isEnabled(remoteJid, 'cargox9') && groups.inList(remoteJid, 'x9', sender);
  const isGold = isGroup && autobot.isEnabled(remoteJid, 'modogold') && groups.inList(remoteJid, 'gold', sender);

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
    isX9,
    isGold,
    botAddressed,
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

  ctx.reply = async (t, opts = {}) => {
    try {
      await antiBan.simulateTyping(sock, remoteJid, t, 'composing');
      const res = await antiBan.enqueueOutbound(() =>
        sock.sendMessage(
          remoteJid,
          opts.mentions && opts.mentions.length ? { text: String(t), mentions: opts.mentions } : { text: String(t) },
          { quoted: opts.quoted === false ? undefined : msg }
        )
      );
      if (isCommunity || lidGroupMsg) {
        logger.info(
          { chat: remoteJid, hasId: !!(res && res.key && res.key.id), community: !!isCommunity, lid: !!lidGroupMsg },
          '[SEND] resposta para comunidade/LID enviada'
        );
      }
      return res;
    } catch (e) {
      // SEM o stack, um erro de envio no aparelho vira adivinhação: foi o caso do
      // grupo de comunidade/LID em 25/09 (56 respostas perdidas, causa desconhecida)
      logger.warn(
        { chat: remoteJid, err: e && e.message, frame: frameDoStack(e), stack: e && e.stack },
        '[SEND] sendMessage FALHOU'
      );
      throw e;
    }
  };
  ctx.replyWithMentions = async (t, mentions) => {
    await antiBan.simulateTyping(sock, remoteJid, t, 'composing');
    return antiBan.enqueueOutbound(() =>
      sock.sendMessage(remoteJid, { text: String(t), mentions }, { quoted: msg })
    );
  };
  ctx.sendButtons = async (o) => {
    await antiBan.simulateTyping(sock, remoteJid, o && o.text, 'composing');
    return antiBan.enqueueOutbound(() =>
      interactive.sendButtons(sock, remoteJid, Object.assign({ quoted: msg }, o))
    );
  };
  ctx.sendList = async (o) => {
    await antiBan.simulateTyping(sock, remoteJid, o && o.text, 'composing');
    return antiBan.enqueueOutbound(() =>
      interactive.sendList(sock, remoteJid, Object.assign({ quoted: msg }, o))
    );
  };
  ctx.sendImage = async (b, caption = '') => {
    await antiBan.simulateTyping(sock, remoteJid, caption, 'composing');
    return antiBan.enqueueOutbound(() =>
      mediaUtil.sendImage(sock, remoteJid, b, caption, { quoted: msg })
    );
  };
  ctx.sendVideo = async (b, caption = '', opts = {}) => {
    await antiBan.simulateTyping(sock, remoteJid, caption, 'composing');
    return antiBan.enqueueOutbound(() =>
      mediaUtil.sendVideo(sock, remoteJid, b, caption, Object.assign({ quoted: msg }, opts))
    );
  };
  ctx.sendAudio = async (b, opts = {}) => {
    await antiBan.simulateTyping(sock, remoteJid, '', 'recording');
    return antiBan.enqueueOutbound(() =>
      mediaUtil.sendAudio(sock, remoteJid, b, Object.assign({ quoted: msg }, opts))
    );
  };
  ctx.sendSticker = (b, opts = {}) =>
    antiBan.enqueueOutbound(() =>
      mediaUtil.sendSticker(sock, remoteJid, b, Object.assign({ quoted: msg }, opts))
    );
  ctx.sendDocument = (b, opts = {}) =>
    antiBan.enqueueOutbound(() =>
      mediaUtil.sendDocument(sock, remoteJid, b, Object.assign({ quoted: msg }, opts))
    );
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
    // Cargo X9 (quando ligado) dá poderes de moderação aos membros marcados
    const allowed = ctx.isOwner || (ctx.isGroup && (ctx.isAdmin || ctx.isX9));
    if (!allowed) return { ok: false, message: ctx.isGroup ? M.deniedAdmin : M.deniedOwner };
  }
  if (cmd.botAdmin && ctx.isGroup && !ctx.isBotAdmin) return { ok: false, message: M.botNotAdmin };

  // Modo Registro (AutoBot, global) — sobrepõe o modo privado do .env
  if (autobot.isEnabled(null, 'modoregistro') && !ctx.isRegistered && !ctx.isOwner) {
    return { ok: false, message: '🔒 *Modo Registro ativo.*\n▸ Peça a um administrador para te registrar com *!registrar*. ' };
  }
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
  if (autobot.isEnabled(ctx.isGroup ? ctx.remoteJid : null, 'limitarcomandos')) {
    const { limite, janela } = autobot.options(ctx.remoteJid, 'limitarcomandos');
    const lim = checkCommandLimit(ctx, Number(limite) || 10, Number(janela) || 60);
    if (lim.limited) {
      await ctx.reply(`⏳ Calma lá! Você atingiu o limite de *${Number(limite) || 10} comandos* por ${Number(janela) || 60}s.\n▸ Tente de novo em ${lim.remaining}s.`);
      return { ok: false, reason: 'rate-limit' };
    }
  }
  // Modo Gold: membros gold não pegam cooldown (benefício do recurso)
  const cd = ctx.isGold ? { allowed: true, remaining: 0 } : cooldown.check(cmd, ctx);
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
 * @param {object} sock socket Baileys
 * @param {object} msg mensagem
 * @param {string} [type] tipo do upsert ('notify' = tempo real, 'append' = histórico)
 */
async function handleMessage(sock, msg, type) {
  try {
    // Histórico/sincronização não é "mensagem nova": processar 'append'
    // fazia o bot rodar filtros, XP e comandos em mensagens antigas.
    if (type && type !== 'notify' && type !== 'reaction') return;
    if (!shouldProcessMessage(msg)) return;
    if (isStatusJid(msg.key.remoteJid)) return;

    const ctx = await buildContext(sock, msg);
    if (!ctx.sender) return;

    perf.add('messages');

    // Anti-PV (recursos globais): trata o privado antes de qualquer coisa
    if (!ctx.isGroup && (await handlePrivateAntiPv(sock, ctx))) return;

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
    }

    const blocked = require('../database/blocked');
    if (blocked.isBlocked(ctx.sender)) return;

    if (CONFIG.ui.antiFlood && !ctx.isOwner && !ctx.isAdmin) {
      const flood = require('../utils/flood');
      if (flood.hit(ctx.sender)) return;
    }

    if (ctx.isGroup) {
      const muted = await groupHandler.enforceMute(sock, ctx);
      if (muted.blocked) return;
    }

    require('../utils/viewonce').capture(msg);

    users.upsert(ctx.sender, msg.pushName || '');
    if (ctx.isGroup) {
      groups.ensure(ctx.remoteJid, '');
      autobot.ensureGroupDefaults(ctx.remoteJid);
      groups.incMemberMessages(ctx.remoteJid, ctx.sender);
    }
    users.incMessages(ctx.sender);
    grantXp(ctx.sender);

    const u = users.get(ctx.sender);
    if (u && u.afk) {
      users.clearAfk(ctx.sender);
    }

    await notifyAfk(sock, ctx);

    if (await buttonHandler.process(ctx)) return;

    const prefix = settings.effectivePrefix();
    const parsed = splitCommand(ctx.text, prefix);

    if (ctx.isGroup) {
      // UMA vez por mensagem (antes era registrada aqui E dentro do
      // applyFilters — o purge apagava o mesmo item duas vezes)
      try {
        require('../utils/antiManager').addToHistory(ctx.remoteJid, ctx.sender, ctx.message.key);
      } catch (_) {}

      const filtered = await groupHandler.applyFilters(sock, ctx);
      // blocked = um anti foi acionado: a mensagem não segue como comando
      if (filtered.blocked || filtered.deleted) return;
    }

    // Automações do AutoBot (autofigu, autoresposta, simih, simih2,
    // iaaleatory, autobaixar, visu única, modo brincadeira)
    if (ctx.isGroup) {
      const consumed = await require('./autoHandler').process(sock, ctx, { isCommand: !!parsed });
      if (consumed) return;
    }

    if (parsed) {
      const cmd = registry.resolveTrigger(parsed.command);
      if (!cmd) {
        // Anti-ban: não envia sugestões/menus para estranhos no privado se silentPv estiver ligado (evita denúncias)
        if (!ctx.isGroup && !ctx.isOwner && CONFIG.security?.silentPv) {
          logger.info({ user: ctx.sender, cmd: parsed.command }, '[ANTI-BAN] Silent PV: comando inválido ignorado no privado');
          return;
        }
        try {
          const fuzzy = require('../utils/fuzzySearch');
          const allCmds = registry.all();
          const similar = fuzzy.findSimilarCommands(parsed.command, allCmds, 3);

          if (similar.length > 0) {
            const best = similar[0];
            const others = similar.slice(1);

            let msgTxt = `❌ *Comando não existe:* ${prefix}${parsed.command}\n\n`;
            msgTxt += `💡 *Você quis dizer:*\n`;
            msgTxt += `▸ *${prefix}${best.trigger}* — ${best.cmd.description || ''}\n`;
            for (const o of others) {
              msgTxt += `▸ *${prefix}${o.trigger}* — ${o.cmd.description || ''}\n`;
            }
            msgTxt += `\n📌 Use *${prefix}help ${best.cmd.name}* para ver como usar`;

            try {
              const buttons = similar.map((s) => ({
                id: `suggest_${s.cmd.name}`,
                text: `${prefix}${s.trigger}`,
                run: (cc) => runByName(cc, s.cmd.name, parsed.args),
              }));
              buttons.push({
                id: `help_${best.cmd.name}`,
                text: `❓ Ajuda ${best.cmd.name}`,
                run: (cc) => runByName(cc, 'help', [best.cmd.name]),
              });

              for (const b of buttons) {
                buttonHandler.register(`lua:${b.id}`, b.run);
              }

              const sent = await interactive.sendButtons(sock, ctx.remoteJid, {
                text: msgTxt,
                footer: `${CONFIG.bot.name} • ${prefix}menu para todos os comandos`,
                buttons: buttons.slice(0, 4).map((b) => ({ id: `lua:${b.id}`, text: b.text })),
                quoted: ctx.message,
              });

              if (!sent) {
                await ctx.reply(msgTxt);
              }
            } catch (_) {
              await ctx.reply(msgTxt);
            }

            logger.info({ query: parsed.command, suggestion: best.trigger }, 'comando não encontrado — sugestão enviada');
            return;
          } else {
            try {
              buttonHandler.register('lua:open_menu', (cc) => require('../utils/buttons').sendMainMenu(cc));
              await interactive.sendButtons(sock, ctx.remoteJid, {
                text: `❌ Comando *${prefix}${parsed.command}* não existe.\n\n💡 Digite *${prefix}menu* para ver todos os comandos ou *${prefix}menu <termo>* para buscar.\nEx: ${prefix}menu sticker, ${prefix}menu download`,
                footer: `${CONFIG.bot.name} • ${registry.count()} comandos disponíveis`,
                buttons: [
                  { id: 'lua:open_menu', text: '📋 Abrir menu' },
                  { id: 'lua:help_menu', text: '❓ Ajuda' },
                ],
                quoted: ctx.message,
              });
              buttonHandler.register('lua:help_menu', (cc) => cc.reply(`💡 Use *${prefix}help <comando>* para ver detalhes de qualquer comando.\nEx: ${prefix}help play, ${prefix}help sticker, ${prefix}help anti`));
            } catch (_) {
              await ctx.reply(`❌ Comando *${prefix}${parsed.command}* não existe. Digite *${prefix}menu* para ver os comandos.`);
            }
            return;
          }
        } catch (err) {
          logger.warn({ err: err.message }, 'falha ao sugerir comando similar');
          return;
        }
      }
      logger.info(
        // `chat` no log é o que permite responder "por que não falou NESTE chat?":
        // sem ele, o relatório do dispositivo não sabia separar as conversas
        { tag: 'COMMAND', chat: ctx.remoteJid, sender: ctx.sender, fromMe: !!(msg.key && msg.key.fromMe) },
        `[LUA][COMMAND] Comando recebido: ${parsed.raw.split('\n')[0].slice(0, 80)}`
      );
      await executeCommand(ctx, cmd, parsed.args);
      return;
    }

    const bare = (ctx.text || '').trim().toLowerCase();
    if (bare === 'prefixo' || bare === 'prefix') {
      if (!ctx.isGroup && !ctx.isOwner && CONFIG.security?.silentPv) return;
      await ctx.reply(`🔤 Prefixo atual: *${prefix}*\n\n💡 Use *${prefix}menu* para ver os comandos.`);
      return;
    }

    if (bare === 'menu' || bare === 'menuprincipal') {
      if (!ctx.isGroup && !ctx.isOwner && CONFIG.security?.silentPv) return;
      await require('../utils/buttons').sendMainMenu(ctx);
      return;
    }
    if ((bare === '0' || bare === 'voltar') && numberFallback.getNumberMenu(ctx.remoteJid)) {
      await require('../utils/buttons').sendMainMenu(ctx);
      return;
    }

    const gameSession = session.get(ctx.remoteJid, ctx.sender);
    if (gameSession && gameSession.onMessage) {
      try {
        await gameSession.onMessage(ctx);
      } catch (err) {
        await errorHandler.handle(ctx, err, { name: `session:${gameSession.type}` });
      }
      return;
    }

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
    logger.error({ err: err.message, stack: err.stack }, 'erro no processamento de mensagem');
  }
}

/* ------------------------------- anti-PV ------------------------------- */

const pvWarned = new Map(); // jid -> timestamp do último aviso

janitor.register(
  'anti-pv',
  () => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [k, ts] of pvWarned) if (ts < cutoff) pvWarned.delete(k);
  },
  60 * 60 * 1000
);

/**
 * Trata mensagens no privado (recursos globais Anti PV / PV2 / PV3).
 * - antipv  → avisa uma vez por dia e ignora
 * - antipv2 → ignora em silêncio
 * - antipv3 → bloqueia o número e avisa o dono (o mais forte vence)
 * @returns {Promise<boolean>} true se a mensagem foi tratada (deve parar)
 */
async function handlePrivateAntiPv(sock, ctx) {
  if (ctx.isOwner) return false; // dono fala com o bot no PV sempre
  const pv3 = autobot.isEnabled(null, 'antipv3');
  const pv2 = autobot.isEnabled(null, 'antipv2');
  const pv1 = autobot.isEnabled(null, 'antipv');
  if (!pv1 && !pv2 && !pv3) return false;

  const sender = ctx.sender;

  if (pv3) {
    try {
      if (typeof sock.updateBlockStatus === 'function') {
        await sock.updateBlockStatus(sender, 'block');
      }
    } catch (err) {
      logger.warn({ err: err.message, usuario: sender }, 'anti pv3: falha ao bloquear');
    }
    for (const owner of CONFIG.owner.numbers) {
      sock
        .sendMessage(`${owner}@s.whatsapp.net`, {
          text: `🚫 *Anti PV3*\n▸ Bloqueei @${String(sender).split('@')[0]} que chamou o bot no privado.`,
          mentions: [sender],
        })
        .catch(() => {});
    }
    logger.info({ usuario: sender }, 'anti pv3: usuário bloqueado');
    return true;
  }

  if (pv2) {
    logger.info({ usuario: sender }, 'anti pv2: mensagem ignorada');
    return true;
  }

  // pv1 — um aviso por dia
  if (pv1) {
    const last = pvWarned.get(sender) || 0;
    if (Date.now() - last > 24 * 60 * 60 * 1000) {
      pvWarned.set(sender, Date.now());
      await ctx
        .reply('🔒 *Anti PV ativo*\n▸ Não atendo no privado. Use os comandos dentro do grupo.')
        .catch(() => {});
    }
    return true;
  }

  // Silent PV seguro (Anti-Ban): se nenhum anti-pv explícito estiver ligado,
  // ignora conversas casuais de estranhos no privado para evitar denúncias (report spam).
  if (CONFIG.security?.silentPv) {
    const prefix = settings.effectivePrefix();
    const isCmd = (ctx.text || '').trim().startsWith(prefix);
    if (!isCmd) {
      logger.info({ usuario: sender }, '[ANTI-BAN] Silent PV: mensagem casual de estranho ignorada no privado');
      return true;
    }
  }

  return false;
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
    if (Date.now() - last < 60 * 1000) continue;
    afkNotified.set(lastKey, Date.now());
    const reason = u.afk_reason ? `\n📝 Motivo: ${u.afk_reason}` : '';
    await sock.sendMessage(ctx.remoteJid, { text: `💤 ${u.name || jid.split('@')[0]} está AFK.${reason}` }, { quoted: ctx.message });
  }
}

module.exports = {
  handleMessage,
  handlePrivateAntiPv,
  checkCommandLimit,
  buildContext,
  executeCommand,
  runByName,
  checkGate,
  getGroupMetadata,
  invalidateGroupMeta,
  shouldProcessMessage,
};
