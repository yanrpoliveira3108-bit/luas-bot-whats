/**
 * handlers/groupHandler.js — eventos e filtros de grupo.
 *
 * - boas-vindas / despedida
 * - registro X9 (entradas, saídas, promoções, rebaixamentos, nome, descrição)
 * - filtros: antilink, antispam, antiflood, antifake, antibot, antiparentese,
 *   antiinvite, antimedia/antiimagem/antivideo/antiaudio/antidocumento/
 *   antisticker/antiviewonce
 * - mute de usuários
 *
 * Nenhum filtro age sobre administradores, dono ou o próprio bot.
 */

'use strict';

const CONFIG = require('../config');
const logger = require('../utils/logger').child('group');
const groups = require('../database/groups');
const { extractText, detectMediaType, getMentionedJids } = require('../utils/messages');
const permissions = require('../utils/permissions');

/* ----------------------- anti-flood / anti-spam ---------------------- */

const spamState = new Map(); // userJid -> { count, windowStart, lastText }
const FLOOD_WINDOW_MS = 8000;
const FLOOD_MAX = 8;

function checkSpamFlood(ctx) {
  const s = groups.getSettings(ctx.remoteJid);
  const f = s.filters || {};
  if (!f.antispam && !f.antiflood) return { action: null };

  const now = Date.now();
  const key = ctx.sender;
  let st = spamState.get(key);
  if (!st || now - st.windowStart > FLOOD_WINDOW_MS) {
    st = { count: 0, windowStart: now, lastText: '' };
    spamState.set(key, st);
  }
  st.count++;

  if (f.antiflood && st.count > FLOOD_MAX) {
    spamState.set(key, { count: 0, windowStart: now, lastText: '' });
    return { action: 'flood' };
  }
  if (f.antispam && st.lastText && st.lastText === ctx.text && ctx.text.length > 3) {
    return { action: 'spam' };
  }
  st.lastText = ctx.text;
  return { action: null };
}

/* --------------------------- detecção de link ------------------------ */

const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

function extractDomains(text) {
  const domains = [];
  for (const m of String(text || '').matchAll(URL_RE)) {
    try {
      const host = m[0].replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0];
      if (host) domains.push(host.toLowerCase());
    } catch (_) {
      /* ignora */
    }
  }
  return domains;
}

function isGroupInviteLink(text) {
  return /(chat\.whatsapp\.com|whatsapp\.com\/(channel|join)|wa\.me)/i.test(String(text || ''));
}

/* --------------------- detecção de pagamento/pix --------------------- */

const PIX_DOMAINS = [
  'pix.gg', 'livepix.gg', 'nubank.com.br', 'picpay.me', 'paypal.me', 'paypal.com',
  'mpago.la', 'mercadopago', 'pagseguro', 'pag.ae', 'doa.re', 'pay.kiwi', 'ko-fi.com',
  'buymeacoffee.com', 'picpay.com', 'iti.itau', 'efi.com.br', 'gerencianet',
];

/** Detecta texto de pagamento: links de pix/cobrança, pix copia-e-cola ou chave pix. */
function isPaymentContent(text) {
  const t = String(text || '');
  if (!t) return false;
  // pix "copia e cola" (EMV) tem o padrão br.gov.bcb.pix
  if (/br\.gov\.bcb\.pix/i.test(t)) return true;
  // chave pix explícita (chave: ... ou chave pix: email/telefone)
  if (/chave[:\s]*pix|pix[:\s]+[a-z0-9._%+-]+@[a-z0-9.-]+/i.test(t)) return true;
  // domínios de pagamento/cobrança
  const lower = t.toLowerCase();
  return PIX_DOMAINS.some((d) => lower.includes(d));
}

/* --------------------------- view once ------------------------------- */

function isViewOnce(ctx) {
  const m = ctx.message && ctx.message.message;
  if (!m) return false;
  const media = m.imageMessage || m.videoMessage || m.audioMessage;
  return !!(media && media.viewOnce);
}

/* ------------------------------ filtros ------------------------------ */

/**
 * Aplica os filtros ativos a uma mensagem de grupo.
 * @returns {Promise<{deleted:boolean, action:string|null}>}
 */
async function applyFilters(sock, ctx) {
  const s = groups.getSettings(ctx.remoteJid);
  const f = s.filters || {};
  const active = Object.keys(f).filter((k) => f[k]);
  if (active.length === 0) return { deleted: false, action: null };

  // nunca filtrar admins, dono ou o bot
  if (ctx.isOwner || ctx.isAdmin || ctx.isBot) return { deleted: false, action: null };

  const actions = [];

  // antilink / antiinvite
  if (f.antilink || f.antiinvite) {
    const domains = extractDomains(ctx.text);
    if (f.antilink && domains.length > 0) {
      const whitelist = (s.antilink_whitelist || []).map((d) => String(d).toLowerCase());
      const blocked = domains.filter((d) => !whitelist.some((w) => d === w || d.endsWith('.' + w)));
      if (blocked.length > 0) actions.push('antilink');
    }
    if (f.antiinvite && isGroupInviteLink(ctx.text)) actions.push('antiinvite');
  }

  // antipix (anti-pagamento): cobrança/pix/chave pix
  if (f.antipix && isPaymentContent(ctx.text)) actions.push('antipix');

  // antispam / antiflood
  const spam = checkSpamFlood(ctx);
  if (spam.action) actions.push(spam.action);

  // anti-mídia
  const mediaType = detectMediaType(ctx.message);
  if (f.antimedia || f.antiimagem || f.antivideo || f.antiaudio || f.antidocumento || f.antisticker || f.antiviewonce || f.antilocalizacao || f.anticontato) {
    if (f.antiviewonce && isViewOnce(ctx)) actions.push('antiviewonce');
    if (mediaType === 'image' && (f.antimedia || f.antiimagem)) actions.push('antiimagem');
    if (mediaType === 'video' && (f.antimedia || f.antivideo)) actions.push('antivideo');
    if (mediaType === 'audio' && (f.antimedia || f.antiaudio)) actions.push('antiaudio');
    if (mediaType === 'document' && (f.antimedia || f.antidocumento)) actions.push('antidocumento');
    if (mediaType === 'sticker' && (f.antimedia || f.antisticker)) actions.push('antisticker');
    if (mediaType === 'location' && f.antilocalizacao) actions.push('antilocalizacao');
    if (mediaType === 'contact' && f.anticontato) actions.push('anticontato');
  }

  // antiparentese: mensagem dominada por símbolos (spam de símbolos)
  if (f.antiparentese && ctx.text && ctx.text.length > 2) {
    const symbols = (ctx.text.match(/[^\w\sà-úÀ-Ú]/g) || []).length;
    if (symbols / ctx.text.length > 0.7) actions.push('antiparentese');
  }

  if (actions.length === 0) return { deleted: false, action: null };

  const action = actions[0];
  const deleted = await tryDelete(sock, ctx);
  logger.info({ group: ctx.remoteJid, user: ctx.sender, action, deleted }, 'filtro acionado');

  // se o bot não é admin (não conseguiu apagar), avisa no grupo para o
  // filtro ficar VISÍVEL e o usuário entender que ele está ativo
  if (!deleted) {
    const labels = {
      antilink: '🚫 Links não são permitidos aqui',
      antiinvite: '🚫 Links de convite não são permitidos',
      antipix: '💸 Conteúdo de pagamento/pix não é permitido',
      antiimagem: '🖼️ Imagens não são permitidas aqui',
      antivideo: '🎬 Vídeos não são permitidos aqui',
      antiaudio: '🎵 Áudios não são permitidos aqui',
      antidocumento: '📄 Documentos não são permitidos aqui',
      antisticker: '🎨 Stickers não são permitidos aqui',
      antiviewonce: '👁️ Mídias de ver-uma-vez não são permitidas',
      antilocalizacao: '📍 Localizações não são permitidas aqui',
      anticontato: '👤 Contatos não são permitidos aqui',
      antimedia: '🖼️ Mídias não são permitidas aqui',
      antispam: '📨 Spam não é permitido aqui',
      antiflood: '🌊 Flood não é permitido aqui',
      antiparentese: '🧹 Mensagens com símbolos não são permitidas',
    };
    const label = labels[action] || `🚫 Filtro ${action} ativo`;
    await sock.sendMessage(
      ctx.remoteJid,
      { text: `${label}, @${ctx.sender.split('@')[0]}.\n_💡 Para o bot apagar automaticamente, ele precisa ser admin do grupo._`, mentions: [ctx.sender] },
      { quoted: ctx.message }
    ).catch(() => {});
  }
  return { deleted: true, action };
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

/**
 * Bloqueia mensagens de usuários mutados: apaga (se o bot for admin) e
 * impede que a mensagem prossiga no pipeline (comandos/botões/sessões).
 * Nunca age sobre administradores, dono ou o próprio bot.
 * @returns {Promise<{blocked:boolean, deleted?:boolean}>}
 */
async function enforceMute(sock, ctx) {
  if (!ctx.isGroup) return { blocked: false };
  if (ctx.isOwner || ctx.isAdmin || ctx.isBot) return { blocked: false };
  if (!isMuted(ctx.remoteJid, ctx.sender)) return { blocked: false };
  const deleted = await tryDelete(sock, ctx);
  logger.info({ group: ctx.remoteJid, user: ctx.sender, deleted }, 'mensagem de usuário mutado bloqueada');
  return { blocked: true, deleted };
}

/* ---------------------- eventos de participantes --------------------- */

async function handleGroupParticipants(sock, ev) {
  const { id, author, participants, action } = ev;
  groups.ensure(id, '');
  const who = author || '';

  for (const pid of participants) {
    if (action === 'add') {
      groups.addMember(id, pid);
      groups.logEvent(id, who, 'entrada', pid);
      await welcomeMember(sock, id, pid);
      await maybeAntiFakeAntiBot(sock, id, pid, who);
      await maybeKickBanned(sock, id, pid);
    } else if (action === 'remove') {
      groups.logEvent(id, who, 'saida', pid);
      groups.removeMember(id, pid);
      await goodbyeMember(sock, id, pid);
    } else if (action === 'promote') {
      groups.logEvent(id, who, 'promote', pid);
    } else if (action === 'demote') {
      groups.logEvent(id, who, 'demote', pid);
    }
  }
}

/** Alterações de nome/descrição/configuração (groups.update). */
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
  if (!g || !g.welcome_enabled || !g.welcome_msg) return;
  const text = g.welcome_msg.replace('{user}', `@${userJid.split('@')[0]}`);
  try {
    await sock.sendMessage(jid, { text, mentions: [userJid] });
  } catch (err) {
    logger.warn({ err: err.message }, 'falha ao enviar boas-vindas');
  }
}

async function maybeGoodbye(sock, jid, userJid) {
  const g = groups.get(jid);
  if (!g || !g.goodbye_enabled || !g.goodbye_msg) return;
  const text = g.goodbye_msg.replace('{user}', `@${userJid.split('@')[0]}`);
  try {
    await sock.sendMessage(jid, { text, mentions: [userJid] });
  } catch (err) {
    logger.warn({ err: err.message }, 'falha ao enviar despedida');
  }
}

/**
 * Welcome na entrada: tenta a CARD VISUAL (novo sistema); se não estiver
 * ativada (ou falhar), mantém o fallback textual antigo. Nunca deixa o
 * grupo sem mensagem nem derruba o bot.
 */
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

/** Despedida na saída: card visual (novo) com fallback textual antigo. */
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

/** Heurísticas de antifake/antibot na entrada de novos membros. */
async function maybeAntiFakeAntiBot(sock, jid, userJid, author) {
  const s = groups.getSettings(jid);
  const f = s.filters || {};
  if (!f.antifake && !f.antibot) return;

  const number = String(userJid).split('@')[0];
  const isBR = number.startsWith('55');
  const flags = [];
  if (f.antifake && !isBR) flags.push('número estrangeiro (antifake)');
  if (f.antibot) {
    try {
      const m = await sock.groupMetadata(jid);
      const p = (m.participants || []).find((x) => x.id === userJid);
      const name = (p && (p.notify || p.name || p.id)) || userJid;
      if (/bot|robo|robô|spam/i.test(name)) flags.push('possível bot (antibot)');
    } catch (_) {
      /* ignora */
    }
  }

  if (flags.length === 0) return;

  groups.logEvent(jid, author, 'config', `${userJid} marcado: ${flags.join(', ')}`);
  // Sem ação automática sem configuração explícita.
  if (s.autoaction_antifake || s.autoaction_antibot) {
    try {
      await sock.groupParticipantsUpdate(jid, [userJid], 'remove');
    } catch (err) {
      logger.warn({ err: err.message }, 'falha ao remover membro suspeito');
    }
  }
}

/** Remove automaticamente membros banidos que tentarem voltar. */
async function maybeKickBanned(sock, jid, userJid) {
  try {
    const s = groups.getSettings(jid);
    const banned = Array.isArray(s.banned) ? s.banned : [];
    if (banned.includes(userJid)) {
      await sock.groupParticipantsUpdate(jid, [userJid], 'remove');
      logger.info({ group: jid, user: userJid }, 'membro banido removido ao tentar entrar');
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'falha ao remover membro banido');
  }
}

/* ------------------------------ avisos ------------------------------- */

/** Aplica a lógica de advertências (1 aviso, 2, 3...). Sem punição automática. */
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
};
