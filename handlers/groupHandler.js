/**
 * handlers/groupHandler.js — eventos e filtros de grupo.
 *
 * - boas-vindas / despedida (texto e card visual)
 * - registro X9 (entradas, saídas, promoções, rebaixamentos, nome, descrição)
 * - filtros do AutoBot: antilink, antilink2, antilinkgp, antipix, antispam,
 *   antiflood, antipalavrao, antifake, antibot, anticatalogo, antistatus,
 *   antienquete, anticomunidade, anticanal, antiencaminhamento,
 *   antimencaomassa, antigif, antilive, antilocalizacaotemp, antiarquivo
 *   (apk/zip/exe/pdf), antimídia (geral/imagem/vídeo/áudio/doc/sticker/
 *   contato/localização/view-once) + sistema avançado de ações configuráveis
 *   (ban/warn/mute/delete + purge de histórico)
 * - mute de usuários
 *
 * Nenhum filtro age sobre administradores, dono ou o próprio bot.
 *
 * CORREÇÕES IMPORTANTES:
 *   1. `applyFilters` fazia ~25 consultas ao banco por mensagem (uma por
 *      verificação de anti). Agora lê o cache do grupo UMA vez e roda os
 *      detectores puros (utils/antiDetect).
 *   2. As ações de participante `leave` (saída voluntária) e `modify`
 *      (troca de número) NÃO eram tratadas — quem saía do grupo nunca
 *      recebia despedida. Agora são.
 *   3. `addToHistory` era chamado duas vezes para a mesma mensagem (aqui e no
 *      commandHandler): o purge apagava o mesmo item duas vezes. Agora é
 *      chamado só aqui, com deduplicação por id.
 */

'use strict';

const logger = require('../utils/logger').child('group');
const groups = require('../database/groups');
const cache = require('../utils/cache').cache;
const { detectMediaType, isViewOnce } = require('../utils/messages');
const autobot = require('../utils/autobot');
const antiManager = require('../utils/antiManager');
const antiDetect = require('../utils/antiDetect');
const janitor = require('../utils/janitor');

/* ----------------------- anti-flood / anti-spam ---------------------- */

const spamState = new Map(); // "grupo|usuário" -> { count, windowStart, lastText }
const FLOOD_WINDOW_MS = 8000;
const FLOOD_MAX = 8;
const SPAM_STATE_TTL_MS = 10 * 60 * 1000;
const SPAM_STATE_MAX = 5000;

function spamKey(ctx) {
  // ANTES: chave só pelo usuário — o contador de um grupo vazava para o outro
  // (e a lista crescia para sempre). Agora é por grupo + usuário, com limpeza.
  return `${ctx.remoteJid}|${ctx.sender}`;
}

function checkSpamFlood(ctx, isOn) {
  const isSpamEnabled = isOn('antispam');
  const isFloodEnabled = isOn('antiflood');
  if (!isSpamEnabled && !isFloodEnabled) return null;

  const now = Date.now();
  const key = spamKey(ctx);
  let st = spamState.get(key);
  if (!st || now - st.windowStart > FLOOD_WINDOW_MS) {
    st = { count: 0, windowStart: now, lastText: '', ts: now };
    if (spamState.size >= SPAM_STATE_MAX) {
      spamState.delete(spamState.keys().next().value);
    }
    spamState.set(key, st);
  }
  st.count += 1;
  st.ts = now;

  if (isFloodEnabled && st.count > FLOOD_MAX) {
    st.count = 0;
    st.windowStart = now;
    return 'antiflood';
  }
  if (isSpamEnabled && st.lastText && st.lastText === ctx.text && (ctx.text || '').length > 3) {
    st.lastText = '';
    return 'antispam';
  }
  st.lastText = ctx.text;
  return null;
}

function sweepSpamState() {
  const cutoff = Date.now() - SPAM_STATE_TTL_MS;
  for (const [k, v] of spamState) {
    if (v.ts < cutoff) spamState.delete(k);
  }
}

janitor.register('group-spam', sweepSpamState, 5 * 60 * 1000);

/* ------------------------------ filtros ------------------------------ */

/**
 * Aplica os filtros ativos a uma mensagem de grupo.
 * @returns {Promise<{deleted:boolean, action:string|null, blocked:boolean}>}
 */
async function applyFilters(sock, ctx) {
  const none = { deleted: false, action: null, blocked: false };
  // Não exigimos ctx.isGroup: a função só é chamada para mensagens de grupo,
  // e chamadas diretas (testes/integrações) podem montar só o necessário.
  if (!ctx || !ctx.message || !ctx.remoteJid) return none;

  // caminho rápido: UMA leitura do cache de settings por mensagem
  const anyOn = antiManager.anyEnabled(ctx.remoteJid);
  if (!anyOn) return none;

  // dono/admin/bot são imunes a TODOS os filtros
  if (ctx.isOwner || ctx.isAdmin || ctx.isBot) return none;

  const isOn = antiManager.enabledChecker(ctx.remoteJid);
  const spamHit = checkSpamFlood(ctx, isOn);

  const opts = {
    limiteCaracteres: autobot.options(ctx.remoteJid, 'limitecaracteres').limite,
    limiteTexto: autobot.options(ctx.remoteJid, 'antitextogigante').limite,
    limiteEmoji: autobot.options(ctx.remoteJid, 'antiemojispam').limite,
    limiteMencao: autobot.options(ctx.remoteJid, 'antimencaomassa').limite,
  };

  const hits = antiDetect.detect(ctx, isOn, opts);
  const antiType = hits.length ? hits[0] : spamHit;
  if (!antiType) return none;

  // OBS: o histórico desta mensagem já foi registrado pelo commandHandler
  // (utils/antiManager.addToHistory) — não duplicar aqui.

  const result = await antiManager.executeAntiAction(sock, ctx, antiType, undefined, {});
  logger.info(
    {
      grupo: ctx.remoteJid,
      usuario: ctx.sender,
      anti: antiType,
      acao: result.action,
      apagada: result.deleted,
      extras: Object.keys(result).filter((k) => !['deleted', 'action', 'reason'].includes(k)),
    },
    'filtro acionado'
  );

  const mention = `@${String(ctx.sender).split('@')[0]}`;
  const notices = {
    antilink: '🚫 Links não são permitidos aqui',
    antilink2: '🚫 Links não são permitidos aqui',
    antilinkgp: '🚫 Links de convite não são permitidos',
    antipix: '💸 Conteúdo de pagamento/PIX não é permitido',
    anticatalogo: '🛍️ Catálogo não é permitido aqui',
    antistatus: '📸 Conteúdo de status não é permitido aqui',
    anticomunidade: '🌐 Conteúdo de comunidade não é permitido aqui',
    anticanal: '📡 Conteúdo de canal não é permitido aqui',
    antienquete: '📊 Enquetes não são permitidas aqui',
    antiencaminhamento: '↪️ Mensagens encaminhadas não são permitidas',
    antimencaomassa: '📣 Menção em massa não é permitida',
    antigif: '🎞️ GIFs não são permitidos aqui',
    antilive: '📅 Convites de evento não são permitidos aqui',
    antilocalizacaotemp: '📍 Localização em tempo real não é permitida',
    antilocalizacao: '📍 Localizações não são permitidas aqui',
    antiapk: '📦 Arquivos APK não são permitidos',
    antizip: '🗜️ Arquivos compactados não são permitidos',
    antiexe: '⚙️ Executáveis não são permitidos',
    antipdf: '📄 PDFs não são permitidos aqui',
    antiimagem: '🖼️ Imagens não são permitidas aqui',
    antivideo: '🎬 Vídeos não são permitidos aqui',
    antiaudio: '🎵 Áudios não são permitidos aqui',
    antidocumento: '📄 Documentos não são permitidos aqui',
    antisticker: '🎨 Figurinhas não são permitidas aqui',
    antiviewonce: '👁️ Mídias de ver-uma-vez não são permitidas',
    antimedia: '🖼️ Mídias não são permitidas aqui',
    anticontato: '👤 Contatos não são permitidos aqui',
    antispam: '📨 Spam não é permitido aqui',
    antiflood: '🌊 Flood não é permitido aqui',
    antiparentese: '🧹 Mensagens com símbolos não são permitidas',
    antipalavrao: '🤬 Palavrões não são permitidos',
    antitoxic: '🤬 Conteúdo tóxico não é permitido',
    limitecaracteres: '📏 Mensagem acima do limite de caracteres',
    antitextogigante: '📏 Texto muito longo não é permitido',
    antiemojispam: '😵 Excesso de emojis não é permitido',
  };

  // aviso no grupo: só quando a mensagem NÃO foi apagada (se foi apagada,
  // o silêncio já é a resposta) e quando o anti pediu notificação
  if (!result.deleted) {
    const label = notices[antiType] || `🚫 Filtro ${antiType} ativo`;
    const hint = ctx.isBotAdmin ? '' : '\n_💡 Para o bot apagar automaticamente, ele precisa ser admin do grupo._';
    await sock
      .sendMessage(
        ctx.remoteJid,
        { text: `${label}, ${mention}.${hint}`, mentions: [ctx.sender] },
        { quoted: ctx.message }
      )
      .catch(() => {});
  }

  // feedback da ação extra (warn/mute/ban/kick)
  if (result.action && result.action !== 'delete') {
    const reason = antiManager.reasonFor(antiType);
    const purged = result.purged ? ` — ${result.purged} msgs apagadas` : '';
    const actionLabels = {
      warn: `⚠️ ${mention} advertido por: ${reason}`,
      mute: `🔇 ${mention} mutado por: ${reason}${purged}`,
      ban: `🚫 ${mention} banido por: ${reason}${purged}`,
      kick: `👢 ${mention} removido por: ${reason}${purged}`,
    };
    const msg = actionLabels[result.action];
    if (msg) await sock.sendMessage(ctx.remoteJid, { text: msg, mentions: [ctx.sender] }).catch(() => {});
  }

  return { deleted: result.deleted, action: antiType, blocked: true };
}

/** Tenta deletar a mensagem (exige bot admin). */
async function tryDelete(sock, ctx) {
  if (!ctx.isBotAdmin) return false;
  try {
    await sock.sendMessage(ctx.remoteJid, { delete: ctx.message.key });
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, 'não foi possível deletar mensagem');
    return false;
  }
}

/* ----------------------------- mute ---------------------------------- */

function mutedList(jid) {
  const s = groups.getSettings(jid);
  return Array.isArray(s.muted) ? s.muted : [];
}

function muteUser(jid, userJid) {
  const list = mutedList(jid);
  if (!list.includes(userJid)) list.push(userJid);
  return groups.setSetting(jid, 'muted', list);
}

function unmuteUser(jid, userJid) {
  const list = mutedList(jid).filter((x) => x !== userJid);
  return groups.setSetting(jid, 'muted', list);
}

function isMuted(jid, userJid) {
  return mutedList(jid).includes(userJid);
}

async function enforceMute(sock, ctx) {
  if (!ctx.isGroup) return { blocked: false };
  if (ctx.isOwner || ctx.isAdmin || ctx.isBot) return { blocked: false };
  if (!isMuted(ctx.remoteJid, ctx.sender)) return { blocked: false };
  const deleted = await tryDelete(sock, ctx);
  logger.info({ grupo: ctx.remoteJid, usuario: ctx.sender, apagada: deleted }, 'mensagem de usuário mutado bloqueada');
  return { blocked: true, deleted };
}

/* ---------------------- eventos de participantes --------------------- */

/**
 * Eventos do Baileys desta versão: add | remove | leave | promote | demote | modify.
 * `leave` = saída voluntária (antes era ignorada) e `modify` = troca de número.
 */
async function handleGroupParticipants(sock, ev) {
  const { id, author, participants, action } = ev || {};
  if (!id) return;
  groups.ensure(id, '');
  autobot.ensureGroupDefaults(id);
  const who = author || '';
  const list = Array.isArray(participants) ? participants : [];
  const botJid = (sock.user && sock.user.id) || '';
  const botLid = (sock.user && sock.user.lid) || '';

  // metadados UMA vez por evento (antes: 1 chamada de API por participante)
  let meta = null;
  const needsMeta = list.length > 0;
  if (needsMeta) {
    try {
      meta = await sock.groupMetadata(id);
    } catch (_) {
      meta = null;
    }
  }

  for (const pid of list) {
    const isSelf = pid === botJid || (botLid && pid === botLid);
    if (action === 'add') {
      groups.addMember(id, pid);
      groups.logEvent(id, who, 'entrada', pid);
      if (!isSelf) {
        await welcomeMember(sock, id, pid, meta);
        await maybeAntiFakeAntiBot(sock, id, pid, who, meta);
      }
      await maybeKickBanned(sock, id, pid);
    } else if (action === 'remove' || action === 'leave') {
      groups.logEvent(id, who, 'saida', pid);
      groups.removeMember(id, pid);
      if (!isSelf) await goodbyeMember(sock, id, pid, meta, action);
    } else if (action === 'promote') {
      groups.logEvent(id, who, 'promote', pid);
    } else if (action === 'demote') {
      groups.logEvent(id, who, 'demote', pid);
    } else if (action === 'modify') {
      // troca de número (LID/PN) — registra e revalida o membro
      groups.logEvent(id, who, 'config', `número alterado: ${pid}`);
      groups.addMember(id, pid);
    }
  }

  // participantes mudaram: o cache de metadados (admins) está obsoleto
  cache.delete('meta:' + id);
}

async function handleGroupUpdate(sock, ev) {
  for (const u of ev || []) {
    const g = groups.get(u.id);
    if (!g) continue;
    const author = u.author || '';

    if (u.subject !== undefined && u.subject !== g.name) {
      groups.setName(u.id, u.subject);
      groups.logEvent(u.id, author, 'nome', `${g.name} → ${u.subject}`);
    }
    if (u.desc !== undefined && u.desc !== (groups.getSettings(u.id).lastDesc || '')) {
      groups.setSetting(u.id, 'lastDesc', u.desc);
      groups.logEvent(u.id, author, 'descricao', 'descrição alterada');
    }
    if (u.announce !== undefined) {
      groups.logEvent(u.id, author, 'config', u.announce ? 'grupo fechado' : 'grupo aberto');
    }
  }
}

async function maybeWelcome(sock, jid, userJid) {
  const g = groups.get(jid);
  if (!g || !g.welcome_enabled || !g.welcome_msg) return false;
  const text = String(g.welcome_msg).replace(/\{user\}/g, `@${String(userJid).split('@')[0]}`);
  try {
    await sock.sendMessage(jid, { text, mentions: [userJid] });
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, 'falha ao enviar boas-vindas');
    return false;
  }
}

async function maybeGoodbye(sock, jid, userJid) {
  const g = groups.get(jid);
  if (!g || !g.goodbye_enabled || !g.goodbye_msg) return false;
  const text = String(g.goodbye_msg).replace(/\{user\}/g, `@${String(userJid).split('@')[0]}`);
  try {
    await sock.sendMessage(jid, { text, mentions: [userJid] });
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, 'falha ao enviar despedida');
    return false;
  }
}

async function welcomeMember(sock, jid, userJid) {
  let handled = false;
  try {
    const welcomeSystem = require('../plugins/welcome');
    handled = await welcomeSystem.onMemberAdded(sock, jid, userJid);
  } catch (err) {
    logger.warn({ err: err.message }, '[WELCOME] card falhou, usando texto');
  }
  if (!handled) await maybeWelcome(sock, jid, userJid);
}

async function goodbyeMember(sock, jid, userJid) {
  let handled = false;
  try {
    const welcomeSystem = require('../plugins/welcome');
    handled = await welcomeSystem.onMemberRemoved(sock, jid, userJid);
  } catch (err) {
    logger.warn({ err: err.message }, '[GOODBYE] card falhou, usando texto');
  }
  if (!handled) await maybeGoodbye(sock, jid, userJid);
}

/**
 * Anti fake / anti bot na ENTRADA.
 * Usa os metadados já obtidos pelo evento (sem chamada extra de API).
 */
async function maybeAntiFakeAntiBot(sock, jid, userJid, author, meta) {
  const isFakeEnabled = antiManager.isAntiEnabled(jid, 'antifake');
  const isBotEnabled = antiManager.isAntiEnabled(jid, 'antibot');
  if (!isFakeEnabled && !isBotEnabled) return;

  const number = String(userJid).split('@')[0];
  const isBR = number.startsWith('55');
  const flags = [];
  if (isFakeEnabled && !isBR) flags.push('número estrangeiro (antifake)');
  if (isBotEnabled) {
    const participants = (meta && meta.participants) || [];
    const p = participants.find((x) => x.id === userJid || x.lid === userJid);
    const name = (p && (p.notify || p.name || p.id)) || userJid;
    if (/bot|robo|robô|spam/i.test(String(name))) flags.push('possível bot (antibot)');
  }
  if (!flags.length) return;

  const s = groups.getSettings(jid);
  groups.logEvent(jid, author, 'config', `${userJid} marcado: ${flags.join(', ')}`);

  const autoRemove = s.autoaction_antifake || s.autoaction_antibot;
  if (autoRemove) {
    try {
      await sock.groupParticipantsUpdate(jid, [userJid], 'remove');
      logger.info({ grupo: jid, usuario: userJid, motivos: flags }, 'membro suspeito removido');
    } catch (err) {
      logger.warn({ err: err.message }, 'falha ao remover membro suspeito');
    }
  } else {
    logger.info({ grupo: jid, usuario: userJid, motivos: flags }, 'membro suspeito marcado');
  }
}

async function maybeKickBanned(sock, jid, userJid) {
  try {
    const s = groups.getSettings(jid);
    const banned = Array.isArray(s.banned) ? s.banned : [];
    if (banned.includes(userJid)) {
      await sock.groupParticipantsUpdate(jid, [userJid], 'remove');
      logger.info({ grupo: jid, usuario: userJid }, 'membro banido removido ao tentar entrar');
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'falha ao remover membro banido');
  }
}

async function applyWarningFlow(sock, groupJid, userJid, reason, adminId) {
  groups.addWarning(groupJid, userJid, reason, adminId);
  const count = groups.countWarnings(groupJid, userJid);

  const s = groups.getSettings(groupJid);
  const thresholds = s.warning_thresholds || { 1: 'aviso', 2: 'aviso', 3: 'aviso' };
  const action = thresholds[Math.min(count, 3)] || 'aviso';

  if (action === 'kick') {
    try {
      await sock.groupParticipantsUpdate(groupJid, [userJid], 'remove');
    } catch (err) {
      logger.warn({ err: err.message }, 'falha ao remover usuário advertido');
    }
  }

  return { count, action };
}

module.exports = {
  applyFilters,
  handleGroupParticipants,
  handleGroupUpdate,
  tryDelete,
  muteUser,
  unmuteUser,
  isMuted,
  mutedList,
  enforceMute,
  applyWarningFlow,
  welcomeMember,
  goodbyeMember,
  maybeAntiFakeAntiBot,
  maybeKickBanned,
  checkSpamFlood,
  // reexport de compatibilidade (alguns módulos importavam daqui)
  detectMediaType,
  isViewOnce,
};
