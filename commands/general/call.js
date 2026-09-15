/**
 * commands/general/call.js — Call Message (mensagem de chamada).
 *
 * Envia o conteúdo `{ call: { name, type } }`, que o Baileys deste projeto
 * converte em `scheduledCallCreationMessage`
 * (vendor/boruto-vk7-baileys/lib/Utils/messages.js:541-547):
 *   type 1 → chamada de voz      type 2 → chamada de vídeo
 *   name   → título que aparece no cartão da chamada
 *
 * NUNCA envia direto: cria uma pendência em utils/pendingCall e só dispara
 * depois que o mesmo usuário responde 1/sim/confirmar (30s para responder).
 */

'use strict';

const pendingCall = require('../../utils/pendingCall');
const { toJid, isStatusJid } = require('../../utils/messages');
const { sanitize } = require('../../utils/formatter');

const NAME_MAX = 32;

/** Palavras aceitas para o tipo. 1 = voz, 2 = vídeo. */
const TYPE_WORDS = {
  voz: 1,
  audio: 1,
  'áudio': 1,
  voice: 1,
  '1': 1,
  video: 2,
  'vídeo': 2,
  videocall: 2,
  '2': 2,
};

function parseType(word) {
  if (word == null) return null;
  const t = String(word).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TYPE_WORDS, t) ? TYPE_WORDS[t] : null;
}

function usage(ctx) {
  const p = ctx.prefix || '!';
  return [
    '📞 *Call Message* — envia uma mensagem de chamada (sempre com confirmação).',
    '',
    `▸ *${p}call <número|@menção>*  → chamada de voz`,
    `▸ *${p}call <número> video*  → chamada de vídeo`,
    `▸ *${p}call <número> video <nome>*  → com nome personalizado (padrão: ${pendingCall.DEFAULT_CALL_NAME})`,
    '',
    `Ex: ${p}call 5511999999999`,
    `Ex: ${p}call 5511999999999 video`,
    `Ex: ${p}call 5511999999999 video Reunião`,
    '',
    'Depois do comando o bot pede confirmação: responda *1* para enviar ou *2* para cancelar (30s).',
  ].join('\n');
}

/** JID válido: usuário ou grupo, nunca status/broadcast. */
function resolveJid(raw) {
  const jid = toJid(raw);
  if (!jid) return null;
  if (isStatusJid(jid)) return null;
  if (!/@(s\.whatsapp\.net|g\.us)$/.test(jid)) return null;
  return jid;
}

module.exports = [
  {
    name: 'call',
    commands: ['call', 'ligar', 'chamada', 'callmsg', 'callmessage'],
    category: 'general',
    description:
      'Envia uma mensagem de chamada (voz ou vídeo) para um número ou grupo, sempre pedindo confirmação antes.',
    usage: '!call <numero|@mencao> [voz|video] [nome]',
    examples: ['!call 5511999999999', '!call 5511999999999 video', '!call @pessoa video Hay'],
    cooldown: 15000,
    execute: async (ctx) => {
      // 1) já existe uma confirmação esperando este usuário
      const existing = pendingCall.get(ctx.sender);
      if (existing) {
        const left = Math.max(0, Math.ceil((existing.expiresAt - Date.now()) / 1000));
        return ctx.reply(
          [
            `⏳ Você já tem uma chamada aguardando confirmação para ${pendingCall.displayTarget(existing.jid)}.`,
            `Responda *1* para enviar ou *2* para cancelar (restam ${left}s).`,
          ].join('\n')
        );
      }

      const mention = (ctx.mentionedJid || []).filter((j) => j !== ctx.socket.user.id)[0] || null;
      let rest = (ctx.args || []).slice();

      // tolera a ordem invertida: "!call video 5511999999999"
      if (
        !mention &&
        rest.length >= 2 &&
        parseType(rest[0]) !== null &&
        parseType(rest[1]) === null &&
        /^[\d+][\d\s+()-]{5,}$/.test(rest[1])
      ) {
        rest = [rest[1], rest[0], ...rest.slice(2)];
      }

      // 2) destino (menção tem prioridade sobre número digitado)
      const rawTarget = mention || rest[0];
      if (!rawTarget) return ctx.reply(usage(ctx));

      const jid = resolveJid(rawTarget);
      if (!jid) {
        return ctx.reply(
          `⚠️ Destino inválido: *${sanitize(String(rawTarget)).slice(0, 30)}*\n\n${usage(ctx)}`
        );
      }

      // 3) tipo da chamada (1 = voz, 2 = vídeo)
      const after = mention ? rest : rest.slice(1);
      let callType = 1;
      let nameArgs = [];
      if (after.length) {
        const parsedType = parseType(after[0]);
        if (parsedType === null) {
          return ctx.reply(
            `⚠️ Tipo inválido: *${sanitize(String(after[0])).slice(0, 20)}* — use *voz* ou *video*.\n\n${usage(ctx)}`
          );
        }
        callType = parsedType;
        nameArgs = after.slice(1);
      }

      // 4) nome do cartão (configurável, padrão "Hay")
      const rawName = nameArgs.join(' ').trim();
      const name = rawName
        ? sanitize(rawName).slice(0, NAME_MAX).trim() || pendingCall.DEFAULT_CALL_NAME
        : pendingCall.DEFAULT_CALL_NAME;

      // 5) guarda a pendência e pede confirmação — nada é enviado aqui
      const pending = pendingCall.set(ctx.sender, {
        jid,
        callType,
        name,
        remoteJid: ctx.remoteJid,
        socket: ctx.socket,
      });

      return ctx.reply(pendingCall.promptText(pending));
    },
  },
];
