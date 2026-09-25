/**
 * commands/_shared/admin.js — helpers compartilhados dos comandos de admin.
 */

'use strict';

const groups = require('../../database/groups');
const commandHandler = require('../../handlers/commandHandler');
const alvoUtil = require('../../utils/alvo');

/** Participantes do grupo (com cache). */
async function getParticipants(ctx) {
  const meta = await commandHandler.getGroupMetadata(ctx.socket, ctx.remoteJid);
  return meta.participants || [];
}

/**
 * Resolve o usuário-alvo: menção > RESPOSTA à mensagem da pessoa > número
 * digitado. (utils/alvo.js — o mesmo resolvedor de todos os comandos.)
 */
function resolveTarget(ctx) {
  return alvoUtil.alvo(ctx, { numero: true });
}

/** Entrada do participante (id/lid/phoneNumber) que corresponde ao JID, ou null. */
function acharParticipante(participants, jid) {
  const alvoDig = String(alvoUtil.canonico(jid) || jid || '').split('@')[0].replace(/\D/g, '');
  if (!alvoDig) return null;
  return (
    (participants || []).find((x) =>
      [x.id, x.lid, x.phoneNumber].some((v) => v && String(v).split('@')[0].split(':')[0].replace(/\D/g, '') === alvoDig)
    ) || null
  );
}

/** Participantes SEMPRE atualizados (sem cache): usado antes de mudar cargo. */
async function participantesFrescos(ctx) {
  try {
    commandHandler.invalidateGroupMeta(ctx.remoteJid);
  } catch (_) {
    /* sem cache: segue */
  }
  return getParticipants(ctx);
}

// status devolvidos pelo WhatsApp em groupParticipantsUpdate
const STATUS_TEXTO = {
  401: 'o WhatsApp recusou (a pessoa bloqueou o bot ou não permite)',
  403: 'o WhatsApp não permitiu (sem permissão para esta pessoa)',
  404: 'a pessoa não está no grupo',
  406: 'o WhatsApp não aceitou esta pessoa',
  408: 'a pessoa saiu há pouco e não pode ser adicionada ainda',
  409: 'nada a fazer (a situação já é essa)',
  500: 'erro no servidor do WhatsApp — tente de novo',
};

/** Lê o resultado de groupParticipantsUpdate. null = ok; texto = motivo da falha. */
function falhaDoResultado(res) {
  const r = Array.isArray(res) ? res[0] : null;
  if (!r || r.status === undefined || r.status === null) return null; // versões sem status: sem erro lançado = ok
  const st = parseInt(r.status, 10);
  if (st === 200 || Number.isNaN(st)) return null;
  return STATUS_TEXTO[st] || `o WhatsApp recusou (código ${st})`;
}

/**
 * Promover / rebaixar / remover com as checagens reais:
 * alvo por menção ou resposta, pessoa no grupo, cargo atual, criador do grupo,
 * dono do bot, o próprio bot — e o RESULTADO devolvido pelo WhatsApp.
 * @param {'promote'|'demote'|'remove'|'ban'} acao
 */
async function mudarParticipante(ctx, acao) {
  const CONFIG = require('../../config');
  const nomeCmd = { promote: 'promover', demote: 'rebaixar', remove: 'kick', ban: 'ban' }[acao];
  const target = resolveTarget(ctx);
  if (!target) {
    const citouBot = ctx.quotedKey && alvoUtil.ehBot(ctx, ctx.quotedKey.participant);
    const mencionouBot = (ctx.mentionedJid || []).some((j) => alvoUtil.ehBot(ctx, j));
    if (citouBot || mencionouBot) return ctx.reply('🤖 Esse sou eu — não faço isso comigo mesmo.');
    return ctx.reply(alvoUtil.dica(ctx.prefix, nomeCmd));
  }
  const m = alvoUtil.marca(target);
  const opts = { mentions: [target] };

  if ((acao === 'remove' || acao === 'ban') && alvoUtil.ehAutor(ctx, target)) {
    return ctx.reply('🤨 Você não pode se remover por aqui. Para sair, saia do grupo pelo WhatsApp.');
  }
  // dono do bot é protegido contra quem não é o dono
  const ehDonoDoBot = (() => {
    try {
      return !!CONFIG.helpers.isOwnerNumber(target);
    } catch (_) {
      return false;
    }
  })();
  if (ehDonoDoBot && acao !== 'promote' && !ctx.isOwner) {
    return ctx.reply(`🛡️ ${m} é o dono do bot — só ele mesmo pode fazer isso.`, opts);
  }

  let participants;
  try {
    participants = await participantesFrescos(ctx);
  } catch (err) {
    return ctx.reply('⚠️ Não consegui ler os participantes do grupo agora. Tente de novo em instantes.');
  }
  const p = acharParticipante(participants, target);

  if (acao !== 'ban' && !p) return ctx.reply(`ℹ️ ${m} não está neste grupo.`, opts);
  if (p) {
    const cargo = p.admin || null;
    if (acao === 'promote' && cargo) {
      return ctx.reply(`ℹ️ ${m} já é ${cargo === 'superadmin' ? 'o criador do grupo' : 'admin'}.`, opts);
    }
    if (acao === 'demote' && !cargo) return ctx.reply(`ℹ️ ${m} não é admin.`, opts);
    if ((acao === 'demote' || acao === 'remove' || acao === 'ban') && cargo === 'superadmin') {
      return ctx.reply(`🚫 ${m} é o *criador do grupo* — o WhatsApp não deixa rebaixar nem remover.`, opts);
    }
  }

  if (acao === 'ban') addBan(ctx.remoteJid, alvoUtil.canonico(target));
  if (acao === 'ban' && !p) {
    return ctx.reply(`⛔ ${m} foi banido: não está no grupo agora, mas será removido se entrar.`, opts);
  }

  // usa o id EXATO da lista do grupo (PN ou LID, conforme o grupo endereça)
  const idNoGrupo = p.id;
  const op = acao === 'ban' ? 'remove' : acao;
  let res;
  try {
    res = await ctx.socket.groupParticipantsUpdate(ctx.remoteJid, [idNoGrupo], op);
  } catch (err) {
    if (acao === 'ban') removeBan(ctx.remoteJid, alvoUtil.canonico(target));
    const msg = String((err && err.message) || err || '');
    const motivo = /not-authorized|forbidden|403/i.test(msg)
      ? 'preciso ser admin do grupo'
      : /timed? ?out/i.test(msg)
        ? 'o WhatsApp não respondeu a tempo — confira o grupo antes de repetir'
        : 'erro ao falar com o WhatsApp';
    return ctx.reply(`❌ Não consegui: ${motivo}.`);
  }
  const falha = falhaDoResultado(res);
  if (falha) {
    if (acao === 'ban') removeBan(ctx.remoteJid, alvoUtil.canonico(target));
    return ctx.reply(`❌ Não consegui com ${m}: ${falha}.`, opts);
  }
  const OK = {
    promote: `👑 ${m} agora é *admin*.`,
    demote: `⬇️ ${m} não é mais admin.`,
    remove: `👢 ${m} foi removido do grupo.`,
    ban: `⛔ ${m} foi banido (removido e será removido de novo se voltar).`,
  };
  return ctx.reply(OK[acao], opts);
}

/** Valida: grupo + admin + bot admin. Retorna mensagem de erro ou null. */
async function requireGroupAdmin(ctx) {
  if (!ctx.isGroup) return '👥 Este comando só funciona em grupos.';
  if (!ctx.isAdmin && !ctx.isOwner) return '🛡️ Apenas administradores podem usar este comando.';
  if (!ctx.isBotAdmin) return '⚠️ Eu preciso ser administrador do grupo.';
  return null;
}

/** Lista de banidos do grupo. */
function bannedList(jid) {
  const s = groups.getSettings(jid);
  return Array.isArray(s.banned) ? s.banned : [];
}

function addBan(jid, userJid) {
  const list = bannedList(jid);
  if (!list.includes(userJid)) list.push(userJid);
  return groups.setSetting(jid, 'banned', list);
}

function removeBan(jid, userJid) {
  return groups.setSetting(jid, 'banned', bannedList(jid).filter((x) => x !== userJid));
}

function isBanned(jid, userJid) {
  return bannedList(jid).includes(userJid);
}

module.exports = {
  getParticipants,
  resolveTarget,
  acharParticipante,
  participantesFrescos,
  falhaDoResultado,
  mudarParticipante,
  requireGroupAdmin,
  bannedList,
  addBan,
  removeBan,
  isBanned,
};
