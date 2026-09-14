'use strict';

/**
 * commands/admin/anti.js — sistema avançado de antis com ação configurável
 *
 * Uso:
 * !anti lista — lista todos antis e status
 * !anti <tipo> on|off — liga/desliga
 * !anti <tipo> <acao> — define ação: delete, warn, mute, ban, kick
 * !anti <tipo> on <acao> --purge [limite] — liga com ação e apaga histórico
 * !anti config <tipo> — mostra config detalhada
 * !anti reset — desliga todos
 *
 * Tipos: antilink, antiinvite, antipix, antispam, antiflood, antiparentese,
 *        antifake, antibot, antimedia, antiimagem, antivideo, antiaudio,
 *        antidocumento, antisticker, antiviewonce, antilocalizacao, anticontato
 *
 * Ações:
 * - delete: só apaga a mensagem (padrão)
 * - warn: apaga + advertência
 * - mute: apaga + muta + apaga últimas 5 msgs (ou purge configurado)
 * - ban: apaga + bane (não volta) + purge
 * - kick: apaga + remove do grupo
 *
 * Purge: apaga histórico recente do usuário (últimas N mensagens)
 * Ex: !anti antilink on ban --purge 10 → bane e apaga 10 últimas msgs
 */

const groups = require('../../database/groups');
const antiManager = require('../../utils/antiManager');

const TYPE_DESCRIPTIONS = {
  antilink: 'Links (http, www)',
  antiinvite: 'Links de convite de grupo',
  antipix: 'Pix, pagamentos, cobranças',
  antispam: 'Mensagens repetidas',
  antiflood: 'Flood (muitas msgs rápidas)',
  antiparentese: 'Spam de símbolos',
  antifake: 'Números estrangeiros',
  antibot: 'Possíveis bots',
  antimedia: 'Qualquer mídia',
  antiimagem: 'Imagens/fotos',
  antivideo: 'Vídeos',
  antiaudio: 'Áudios',
  antidocumento: 'Documentos',
  antisticker: 'Figurinhas',
  antiviewonce: 'Mídia de visualização única',
  antilocalizacao: 'Localizações',
  anticontato: 'Contatos',
};

function formatAntiList(groupJid) {
  const all = antiManager.getAllAntiConfig(groupJid);
  let lines = ['*🛡️ ANTIS DO GRUPO*', ''];
  for (const type of antiManager.ANTI_TYPES) {
    const cfg = all[type];
    const desc = TYPE_DESCRIPTIONS[type] || type;
    const status = cfg.enabled ? '✅' : '❌';
    const action = cfg.enabled ? ` → ${cfg.action}${cfg.purge ? ` + purge ${cfg.purgeLimit}` : ''}` : '';
    lines.push(`${status} *${type}* — ${desc}${action}`);
  }
  lines.push('');
  lines.push('💡 Use: !anti <tipo> on|off [ban|warn|mute|delete] [--purge N]');
  lines.push('Ex: !anti antilink on ban --purge 10');
  lines.push('Ex: !anti antipix on warn');
  lines.push('Ex: !anti antisticker on mute --purge');
  return lines.join('\n');
}

function formatAntiConfig(groupJid, type) {
  const cfg = antiManager.getAntiConfig(groupJid, type);
  if (!cfg) return `❌ Tipo inválido: ${type}\nTipos: ${antiManager.ANTI_TYPES.join(', ')}`;
  const desc = TYPE_DESCRIPTIONS[type] || type;
  return (
    `*🛡️ CONFIG: ${type}*\n` +
    `📝 Descrição: ${desc}\n` +
    `🔌 Status: ${cfg.enabled ? '✅ Ligado' : '❌ Desligado'}\n` +
    `⚙️ Ação: ${cfg.action}\n` +
    `🧹 Purge: ${cfg.purge ? `✅ Sim (${cfg.purgeLimit} msgs)` : '❌ Não'}\n` +
    `💬 Motivo warn: ${cfg.warnReason || '(padrão)'}\n\n` +
    `Ações: delete (só apaga), warn (adv), mute (muta+apaga histórico), ban (bane+purge), kick (remove)\n` +
    `Uso: !anti ${type} on ${cfg.action} --purge ${cfg.purgeLimit}`
  );
}

function parseArgs(args) {
  // args: [tipo, on/off/acao, acao, --purge, N]
  const raw = args.join(' ').toLowerCase();
  const tokens = args.map((a) => String(a).toLowerCase());

  let type = null;
  let enabled = null;
  let action = null;
  let purge = false;
  let purgeLimit = 10;
  let warnReason = '';

  // detecta tipo (primeiro token que é um anti)
  for (const t of tokens) {
    if (antiManager.ANTI_TYPES.includes(t)) {
      type = t;
      break;
    }
  }

  // se primeiro arg é tipo, resto é config
  if (type) {
    const idx = tokens.indexOf(type);
    const rest = tokens.slice(idx + 1);
    for (let i = 0; i < rest.length; i++) {
      const tok = rest[i];
      if (['on', 'ligar', 'ativar', '1', 'enable'].includes(tok)) enabled = true;
      else if (['off', 'desligar', 'desativar', '0', 'disable'].includes(tok)) enabled = false;
      else if (antiManager.normalizeAction(tok)) action = antiManager.normalizeAction(tok);
      else if (tok === '--purge' || tok === 'purge' || tok === '--apagar' || tok === 'apagar') {
        purge = true;
        const next = rest[i + 1];
        if (next && !isNaN(parseInt(next, 10))) {
          purgeLimit = parseInt(next, 10);
          i++;
        }
      }
    }
  }

  // caso especial: !anti lista, !anti config <tipo>, !anti reset
  const first = tokens[0];
  if (['lista', 'list', 'all', 'todos'].includes(first)) {
    return { cmd: 'lista' };
  }
  if (['config', 'cfg', 'info', 'ver'].includes(first)) {
    const t = tokens[1];
    if (antiManager.ANTI_TYPES.includes(t)) return { cmd: 'config', type: t };
    return { cmd: 'config', type: null };
  }
  if (['reset', 'limpar', 'desligar-todos'].includes(first)) {
    return { cmd: 'reset' };
  }

  return { cmd: 'set', type, enabled, action, purge, purgeLimit, warnReason };
}

module.exports = [
  {
    name: 'anti',
    commands: ['anti', 'antis', 'antifiltro'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Sistema avançado de antis com ação configurável (ban/warn/mute/delete + purge de histórico).',
    usage: '!anti lista | !anti <tipo> on|off [ban|warn|mute|delete] [--purge N] | !anti config <tipo>',
    cooldown: 1000,
    execute: async (ctx) => {
      const args = ctx.args || [];
      if (!args.length) {
        return ctx.reply(formatAntiList(ctx.remoteJid) + '\n\n📋 *Tipos:* ' + antiManager.ANTI_TYPES.join(', '));
      }

      const parsed = parseArgs(args);

      if (parsed.cmd === 'lista') {
        return ctx.reply(formatAntiList(ctx.remoteJid));
      }

      if (parsed.cmd === 'config') {
        if (!parsed.type) {
          return ctx.reply('⚠️ Uso: !anti config <tipo>\nEx: !anti config antilink\nTipos: ' + antiManager.ANTI_TYPES.join(', '));
        }
        return ctx.reply(formatAntiConfig(ctx.remoteJid, parsed.type));
      }

      if (parsed.cmd === 'reset') {
        for (const t of antiManager.ANTI_TYPES) {
          antiManager.disableAnti(ctx.remoteJid, t);
        }
        return ctx.reply('✅ Todos os antis foram desligados.');
      }

      // set
      if (!parsed.type) {
        return ctx.reply(
          '⚠️ Tipo inválido. Use:\n' +
            '!anti lista — ver todos\n' +
            '!anti antilink on — liga só apagando\n' +
            '!anti antilink on ban --purge 10 — bane e apaga 10 msgs\n' +
            '!anti antipix on warn — só advertência\n' +
            '!anti antisticker on mute --purge — muta e apaga histórico\n\n' +
            'Tipos: ' +
            antiManager.ANTI_TYPES.join(', ')
        );
      }

      const type = parsed.type;
      let enabled = parsed.enabled;
      let action = parsed.action || 'delete';

      // se usuário mandou só "!anti antilink ban", entende como on + ban
      if (enabled === null && action) {
        enabled = true;
      }
      // se mandou só "!anti antilink on", mantém ação atual ou delete
      if (enabled === true && !parsed.action) {
        const cur = antiManager.getAntiConfig(ctx.remoteJid, type);
        action = cur.action || 'delete';
      }
      // se mandou "!anti antilink off", desliga
      if (enabled === false) {
        antiManager.disableAnti(ctx.remoteJid, type);
        return ctx.reply(`❌ *${type}* desligado.`);
      }

      if (enabled === null) {
        // sem on/off, mostra config atual
        return ctx.reply(formatAntiConfig(ctx.remoteJid, type));
      }

      antiManager.enableAnti(ctx.remoteJid, type, action, {
        purge: parsed.purge,
        purgeLimit: parsed.purgeLimit,
      });

      const purgeTxt = parsed.purge ? ` + purge ${parsed.purgeLimit} msgs` : '';
      const actionEmojis = {
        delete: '🗑️ só apagar',
        warn: '⚠️ advertência',
        mute: '🔇 mutar',
        ban: '🚫 banir',
        kick: '👢 expulsar',
      };
      const label = actionEmojis[action] || action;

      const botAdminHint = ctx.isBotAdmin ? '' : '\n_⚠️ Bot precisa ser admin para apagar/banir/mutar._';

      return ctx.reply(`✅ *${type}* ligado!\n⚙️ Ação: ${label}${purgeTxt}\n📝 ${TYPE_DESCRIPTIONS[type] || ''}${botAdminHint}`);
    },
  },
  {
    name: 'anticonfig',
    commands: ['anticonfig', 'anti-config'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Mostra configuração detalhada de um anti.',
    usage: '!anticonfig <tipo>',
    cooldown: 1000,
    execute: async (ctx) => {
      const type = (ctx.args[0] || '').toLowerCase();
      if (!type || !antiManager.ANTI_TYPES.includes(type)) {
        return ctx.reply('⚠️ Uso: !anticonfig <tipo>\nTipos: ' + antiManager.ANTI_TYPES.join(', '));
      }
      return ctx.reply(formatAntiConfig(ctx.remoteJid, type));
    },
  },
];
