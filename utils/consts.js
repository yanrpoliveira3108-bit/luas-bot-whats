/**
 * utils/consts.js — "selos": citações usadas pelos comandos de resposta rica.
 *
 * Os comandos de richResponse precisam preencher contextInfo com stanzaId,
 * participant e quotedMessage. Esta função monta esse envelope, e o TEXTO do
 * selo é escolhido entre os estilos abaixo (fixo ou aleatório, por !selo).
 *
 * O nome `seloNubank` foi mantido por compatibilidade com os comandos que já
 * usam essa assinatura, mas nenhum selo imita marca de banco: todos são da
 * identidade do Lua Bot.
 *
 * Detalhe técnico: o `stanzaId` usa o id da mensagem REAL que chegou. É isso que
 * permite ao WhatsApp resolver a citação no aparelho de quem recebe; um id
 * inventado faz a citação aparecer como "mensagem não encontrada".
 */

'use strict';

const crypto = require('crypto');
const CONFIG = require('../config');
const creatorProfile = require('./creatorProfile');

function botName() {
  return (CONFIG.bot && CONFIG.bot.name) || 'Lua';
}

/**
 * Selos disponíveis. `lines` recebe {bot, creator, developer} e devolve as linhas
 * da citação. Para criar um selo novo, basta adicionar uma entrada aqui — o
 * comando !selo passa a listá-lo automaticamente.
 */
const SEALS = {
  lua: {
    label: 'Lua (padrão)',
    emoji: '🌙',
    lines: ({ bot }) => [`🌙 *${bot} Bot* • mensagem verificada`, 'Conteúdo gerado pelo próprio bot.'],
  },
  sistema: {
    label: 'Sistema',
    emoji: '⚙️',
    lines: ({ bot }) => [`⚙️ *Sistema ${bot} Bot*`, 'Verificação automática de autenticidade.'],
  },
  seguranca: {
    label: 'Segurança',
    emoji: '🛡️',
    lines: ({ bot }) => [`🛡️ *Central de Segurança*`, `Canal verificado • ${bot} Bot`],
  },
  suporte: {
    label: 'Suporte',
    emoji: '💬',
    lines: ({ bot, creator }) => [`💬 *Suporte oficial ${bot} Bot*`, `Atendimento por ${creator}`],
  },
  premium: {
    label: 'Premium',
    emoji: '💎',
    lines: ({ bot }) => [`💎 *${bot} Bot Premium*`, 'Conta verificada, prioridade no suporte.'],
  },
  anuncio: {
    label: 'Aviso',
    emoji: '📢',
    lines: ({ bot }) => [`📢 *Aviso oficial*`, `Comunicado do ${bot} Bot 🌙`],
  },
  dev: {
    label: 'Desenvolvedor',
    emoji: '👨‍💻',
    lines: ({ bot, developer }) => [`👨‍💻 *Desenvolvedor*`, `${developer} • criou o ${bot} Bot`],
  },
};

function sealNames() {
  return Object.keys(SEALS);
}

function context() {
  return {
    bot: botName(),
    creator: creatorProfile.get('name'),
    developer: creatorProfile.get('developer'),
  };
}

/** Nome do selo que será usado agora (resolve o modo 'random'). */
function pickSealName() {
  const choice = String(creatorProfile.sealChoice() || 'lua').toLowerCase();
  if (choice === 'random' || choice === 'aleatorio' || choice === 'aleatório') {
    const names = sealNames();
    return names[Math.floor(Math.random() * names.length)];
  }
  return Object.prototype.hasOwnProperty.call(SEALS, choice) ? choice : 'lua';
}

/** Texto do selo (para prévia no !selo). */
function sealText(name) {
  const seal = SEALS[name] || SEALS.lua;
  return seal.lines(context()).join('\n');
}

/** Prévia de todos os selos. */
function sealPreview() {
  return sealNames()
    .map((name) => `${SEALS[name].emoji} *${name}* — ${SEALS[name].label}\n${sealText(name)}`)
    .join('\n\n');
}

/**
 * @param {object} socket   conexão do WhatsApp (ctx.socket)
 * @param {object} msg      mensagem recebida (ctx.message)
 * @param {string} sender   jid de quem enviou
 * @param {string} pushname nome de exibição de quem enviou
 * @param {string} from     jid do chat
 * @returns {Promise<{key:object, message:object, seal:string}>} envelope de citação
 */
async function seloNubank(socket, msg, sender, pushname, from) {
  const key = (msg && msg.key) || {};

  // id real da mensagem quando existir; senão um id próprio (nunca undefined)
  const id = key.id || crypto.randomBytes(8).toString('hex').toUpperCase();

  // em grupo o participant vem da mensagem; no privado é o próprio remetente
  const participant = key.participant || (String(from || '').endsWith('@g.us') ? sender : undefined);

  const sealName = pickSealName();

  return {
    seal: sealName,
    key: {
      remoteJid: from,
      fromMe: false,
      id,
      ...(participant ? { participant } : {}),
    },
    message: {
      extendedTextMessage: {
        text: sealText(sealName),
        contextInfo: {
          forwardingScore: 0,
          isForwarded: false,
          stanzaId: id,
          participant: participant || sender,
        },
      },
    },
  };
}

module.exports = { SEALS, seloNubank, sealText, sealPreview, sealNames, pickSealName };
