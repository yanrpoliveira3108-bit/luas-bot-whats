/**
 * utils/selective.js — EXPERIMENTAL: transporte seletivo de recipients em grupo.
 *
 * Investigação "SELECTIVE PAYMENT / SELECTIVE TEXT" (LUA + SYZYGY, fork BK7).
 *
 * HIPÓTESE TESTADA (transporte-only, SEM tocar em criptografia):
 *
 *   participants (groupMetadata)
 *        ↓ resolveSelectiveRecipients()  → subconjunto (admins|members|custom)
 *        ↓ getUSyncDevices(subconjunto)  → devices só do subconjunto
 *        ↓ senderKeyRecipients           → SKDM só para eles
 *        ↓ <enc skmsg>                   → ciphertext só para eles
 *
 * A mudança real fica em vendor/.../Socket/messages-send.js: a opção
 * `selectiveParticipants` do relayMessage substitui
 * `groupData.participants.map(p => p.id)` — SOMENTE isso. Nenhuma função de
 * criptografia foi alterada.
 *
 * LIMITAÇÃO DOCUMENTADA (ver relatório): a Sender Key de grupo é UMA por
 * (grupo, remetente) e é reutilizada. Restringir a distribuição isola apenas
 * as mensagens enviadas enquanto o excluído NÃO possui a chave; qualquer envio
 * posterior (normal, retry, novo device, histórico) entrega a chave atual e
 * passa a permitir a descriptografia dali em diante.
 *
 * SEGURANÇA: nada de chaves/sessões/ciphertext em log. Só JIDs, contagens e ids.
 */

'use strict';

const logger = require('./logger').child('selective');

/* ------------------------- resolução de recipients ------------------- */

const VALID_MODES = ['admins', 'members', 'custom', 'normal'];

/**
 * Normaliza um JID (PN, LID ou device) para "usuário puro" (sem device).
 * Aceita: 5511999999999@s.whatsapp.net, 5511999999999:12@s.whatsapp.net,
 * 123456@lid, 123456:7@lid.
 */
function normalizeUserJid(jid) {
  if (typeof jid !== 'string') return null;
  const j = jid.trim();
  if (!j) return null;
  const at = j.indexOf('@');
  if (at <= 0) return null;
  let user = j.slice(0, at);
  const server = j.slice(at + 1);
  const colon = user.indexOf(':');
  if (colon !== -1) user = user.slice(0, colon);
  return `${user}@${server}`;
}

function isAdmin(p) {
  return !!(p && (p.admin || p.isAdmin));
}

/**
 * Resolve os recipients selecionados a partir do metadata REAL do grupo.
 * Retorna SEMPRE os ids canônicos presentes em `groupMeta.participants`
 * (nunca JIDs arbitrários de fora do grupo).
 *
 * @param {{participants: Array<{id:string, admin?:boolean}>}} groupMeta
 * @param {{mode:string, recipients?:string[]}} options
 * @returns {string[]}
 */
function resolveSelectiveRecipients(groupMeta, options = {}) {
  const participants =
    groupMeta && Array.isArray(groupMeta.participants) ? groupMeta.participants : [];
  const mode = String(options.mode || 'normal').toLowerCase();

  if (!VALID_MODES.includes(mode)) {
    const err = new Error(`Modo seletivo inválido: "${options.mode}"`);
    err.code = 'SELECTIVE_BAD_MODE';
    throw err;
  }

  if (mode === 'normal') return participants.map((p) => p.id);

  const byId = new Map(participants.map((p) => [String(p.id), p]));
  const byNormalized = new Map();
  for (const p of participants) {
    const n = normalizeUserJid(p.id);
    if (n && !byNormalized.has(n)) byNormalized.set(n, String(p.id));
    // grupos LID trazem `lid`; mapeia lid → id canônico p/ aceitar custom por LID
    const l = normalizeUserJid(p.lid);
    if (l && !byNormalized.has(l)) byNormalized.set(l, String(p.id));
  }

  if (mode === 'admins') {
    return participants.filter(isAdmin).map((p) => p.id);
  }
  if (mode === 'members') {
    return participants.filter((p) => !isAdmin(p)).map((p) => p.id);
  }

  // custom: valida que TODOS pertencem ao grupo
  const requested = Array.isArray(options.recipients)
    ? options.recipients
    : options.recipients
      ? [options.recipients]
      : [];
  if (!requested.length) {
    const err = new Error('Modo custom exige `recipients`.');
    err.code = 'SELECTIVE_NO_RECIPIENTS';
    throw err;
  }

  const out = [];
  const seen = new Set();
  for (const r of requested) {
    const canonical = byId.has(String(r)) ? String(r) : byNormalized.get(normalizeUserJid(r));
    if (!canonical) {
      const err = new Error(`Recipient não pertence ao grupo: ${String(r)}`);
      err.code = 'SELECTIVE_NOT_MEMBER';
      throw err;
    }
    if (!seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  return out;
}

/* --------------------------- carregamento ---------------------------- */

function loadBaileys() {
  try {
    return require('@lucasmod/boruto-vk7-baileys');
  } catch (_) {
    return require('../vendor/boruto-vk7-baileys');
  }
}

/* --------------------------- envio seletivo -------------------------- */

/**
 * Envia QUALQUER conteúdo (texto ou payment) como uma ÚNICA mensagem de grupo,
 * mas com o transporte criptográfico restrito ao subconjunto selecionado.
 *
 * @param {object} sock socket Baileys (com relayMessage + groupMetadata)
 * @param {string} groupJid ex.: 120363...@g.us
 * @param {object} content conteúdo no formato sendMessage ({ text } | { payment })
 * @param {{mode:string, recipients?:string[]}} options
 * @param {'text'|'payment'} kind (só para o log de debug)
 * @returns {Promise<object>} resumo do debug (sem material criptográfico)
 */
async function sendSelective(sock, groupJid, content, options = {}, kind = 'text') {
  if (!sock || typeof sock.relayMessage !== 'function') {
    throw new Error('socket.relayMessage indisponível');
  }
  if (!groupJid || !String(groupJid).endsWith('@g.us')) {
    const err = new Error('Envio seletivo só vale para grupos (@g.us).');
    err.code = 'SELECTIVE_GROUP_ONLY';
    throw err;
  }

  let meta = null;
  try {
    meta =
      typeof sock.groupMetadata === 'function'
        ? await sock.groupMetadata(groupJid)
        : null;
  } catch (_) {
    meta = null;
  }
  if (!meta || !Array.isArray(meta.participants)) {
    const err = new Error('Não foi possível obter os participantes do grupo.');
    err.code = 'SELECTIVE_NO_META';
    throw err;
  }

  const selected = resolveSelectiveRecipients(meta, options);
  if (!selected.length) {
    const err = new Error('Nenhum participante selecionado para o envio.');
    err.code = 'SELECTIVE_EMPTY';
    throw err;
  }

  // Mesmo caminho real do sendMessage (geração da mensagem), SEM alterar conteúdo.
  const { generateWAMessage } = loadBaileys();
  const fullMsg = await generateWAMessage(groupJid, content, {
    userJid: (sock.user && sock.user.id) || undefined,
    timestamp: new Date(),
  });

  // Ponto experimental: `selectiveParticipants` restringe a resolução de devices.
  let transportDebug = {};
  await sock.relayMessage(groupJid, fullMsg.message, {
    messageId: fullMsg.key && fullMsg.key.id,
    useCachedGroupMetadata: true,
    selectiveParticipants: selected,
    onSelectiveDebug: (d) => {
      transportDebug = d || {};
    },
  });

  const summary = {
    group: groupJid,
    selective: true,
    kind,
    mode: options.mode || 'normal',
    requestedRecipients: options.mode === 'custom' ? (options.recipients || []).map(String) : [],
    originalParticipants: (meta.participants || []).length,
    selectedParticipants: selected,
    resolvedDevices: transportDebug.resolvedDevices,
    senderKeyRecipients: transportDebug.senderKeyRecipients,
    messageId: fullMsg.key && fullMsg.key.id,
  };
  // Log de debug SEM chaves/sessões/ciphertext/credenciais.
  logger.info(summary, 'SELECTIVE PAYMENT DEBUG');
  return summary;
}

async function sendSelectivePaymentMessage(sock, groupJid, payment, options = {}) {
  return sendSelective(sock, groupJid, { payment }, options, 'payment');
}

async function sendSelectiveTextMessage(sock, groupJid, text, options = {}) {
  return sendSelective(sock, groupJid, { text: String(text) }, options, 'text');
}

/**
 * Anexa a API experimental ao socket sem substituí-lo:
 *   sock.sendSelectivePaymentMessage(groupJid, payment, options)
 *   sock.sendSelectiveTextMessage(groupJid, text, options)
 */
function attachToSocket(sock) {
  if (!sock) return sock;
  if (typeof sock.sendSelectivePaymentMessage !== 'function') {
    sock.sendSelectivePaymentMessage = (jid, payment, options) =>
      sendSelectivePaymentMessage(sock, jid, payment, options || {});
  }
  if (typeof sock.sendSelectiveTextMessage !== 'function') {
    sock.sendSelectiveTextMessage = (jid, text, options) =>
      sendSelectiveTextMessage(sock, jid, text, options || {});
  }
  return sock;
}

module.exports = {
  VALID_MODES,
  normalizeUserJid,
  isAdmin,
  resolveSelectiveRecipients,
  sendSelective,
  sendSelectivePaymentMessage,
  sendSelectiveTextMessage,
  attachToSocket,
  loadBaileys,
};
