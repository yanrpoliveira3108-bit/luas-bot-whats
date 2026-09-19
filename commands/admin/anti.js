/**
 * commands/admin/anti.js — sistema avançado de antis com ação configurável.
 *
 * Uso:
 * !anti lista — lista todos os antis e o status REAL de cada um
 * !anti <tipo> on|off — liga/desliga (mesmo estado do !<tipo> on/off)
 * !anti <tipo> <acao> — define ação: delete, warn, mute, ban, kick
 * !anti <tipo> on <acao> --purge [limite] — liga com ação e apaga histórico
 * !anti config <tipo> — mostra config detalhada
 * !anti reset — desliga todos
 *
 * Ações:
 * - delete: só apaga a mensagem (padrão)
 * - warn: apaga + advertência
 * - mute: apaga + muta + apaga últimas msgs (ou purge configurado)
 * - ban: apaga + bane (não volta) + purge
 * - kick: apaga + remove do grupo
 *
 * A LISTA DE TIPOS vem do registro do AutoBot (utils/autobot.js): todo anti
 * novo aparece aqui automaticamente, e nomes antigos (ex.: `antiinvite`)
 * continuam aceitos como apelido do id novo (`antilinkgp`).
 */

'use strict';

const autobot = require('../../utils/autobot');
const antiManager = require('../../utils/antiManager');

/** Aceita id canônico OU apelido antigo; devolve sempre o id canônico. */
function resolveType(token) {
  const def = autobot.resolve(token);
  if (!def || !def.anti) return null;
  return def;
}

const TYPE_DESCRIPTIONS = {};
for (const def of autobot.antiFeatures()) {
  TYPE_DESCRIPTIONS[def.id] = def.desc || def.label;
}

const ALL_TYPES = autobot.antiIds();

function formatAntiList(groupJid) {
  const all = antiManager.getAllAntiConfig(groupJid);
  const lines = ['*🛡️ ANTIS DO GRUPO*', ''];
  let on = 0;
  for (const def of autobot.antiFeatures()) {
    const cfg = all[def.id];
    if (!cfg) continue;
    if (cfg.enabled) on++;
    const status = cfg.enabled ? '✅' : '❌';
    const action = cfg.enabled ? ` → ${cfg.action}${cfg.purge ? ` + purge ${cfg.purgeLimit}` : ''}` : '';
    lines.push(`${status} *${def.id}* — ${def.label}${action}`);
  }
  lines.push('', `📊 Ativos: *${on}/${ALL_TYPES.length}*`);
  lines.push('💡 Use: !anti <tipo> on|off [ban|warn|mute|delete] [--purge N]');
  lines.push('Ex: !anti antilink on ban --purge 10');
  lines.push('Ex: !anti antipix on warn');
  return lines.join('\n');
}

function formatAntiConfig(groupJid, type) {
  const def = resolveType(type);
  if (!def) return `❌ Tipo inválido: ${type}\nTipos: ${ALL_TYPES.join(', ')}`;
  const cfg = antiManager.getAntiConfig(groupJid, def.id);
  return (
    `*🛡️ CONFIG: ${def.id}* (${def.label})\n` +
    `📝 ${def.desc}\n` +
    `🔌 Status: ${cfg.enabled ? '✅ Ativado' : '❌ Desativado'}\n` +
    `⚙️ Ação: ${antiManager.ACTION_LABELS[cfg.action] || cfg.action}\n` +
    `🧹 Purge: ${cfg.purge ? `✅ Sim (${cfg.purgeLimit} msgs)` : '❌ Não'}\n` +
    `💬 Motivo warn: ${cfg.warnReason || '(padrão)'}\n\n` +
    `Ações: delete (só apaga), warn (adv), mute (muta+apaga histórico), ban (bane+purge), kick (remove)\n` +
    `Uso: !anti ${def.id} on ${cfg.action} --purge ${cfg.purgeLimit}`
  );
}

function parseArgs(args) {
  const tokens = args.map((a) => String(a).toLowerCase());
  const first = tokens[0];

  if (['lista', 'list', 'all', 'todos'].includes(first)) return { cmd: 'lista' };
  if (['config', 'cfg', 'info', 'ver'].includes(first)) {
    return { cmd: 'config', type: resolveType(tokens[1]) ? resolveType(tokens[1]).id : null };
  }
  if (['reset', 'limpar', 'desligar-todos'].includes(first)) return { cmd: 'reset' };

  let type = null;
  for (const t of tokens) {
    const def = resolveType(t);
    if (def) {
      type = def.id;
      break;
    }
  }
  if (!type) return { cmd: 'set', type: null };

  const idx = tokens.indexOf(type);
  const rest = tokens.slice(idx + 1);
  // aceita apelido antigo digitado (ex.: antiinvite) além do id novo
  const typedIdx = rest.findIndex((t) => resolveType(t));

  let enabled = null;
  let action = null;
  let purge = false;
  let purgeLimit = 10;

  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (i === typedIdx && tok !== type) continue; // ignora repetição do tipo
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

  return { cmd: 'set', type, enabled, action, purge, purgeLimit };
}

/** Resposta padronizada de ligar/desligar. */
function replyState(ctx, def, enabled, extra = '') {
  const first = enabled ? '✅ Recurso ativado.' : '❌ Recurso desativado.';
  return ctx.reply(`${first}\n${def.label} • !${def.cmd}${extra}`);
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
        return ctx.reply(`${formatAntiList(ctx.remoteJid)}\n\n📋 *Tipos:* ${ALL_TYPES.join(', ')}`);
      }

      const parsed = parseArgs(args);

      if (parsed.cmd === 'lista') return ctx.reply(formatAntiList(ctx.remoteJid));
      if (parsed.cmd === 'config') {
        if (!parsed.type) {
          return ctx.reply('⚠️ Uso: !anti config <tipo>\nEx: !anti config antilink\nTipos: ' + ALL_TYPES.join(', '));
        }
        return ctx.reply(formatAntiConfig(ctx.remoteJid, parsed.type));
      }
      if (parsed.cmd === 'reset') {
        let n = 0;
        for (const id of ALL_TYPES) {
          if (antiManager.isAntiEnabled(ctx.remoteJid, id)) n++;
          antiManager.disableAnti(ctx.remoteJid, id);
        }
        return ctx.reply(`❌ Recurso desativado.\n♻️ ${n} anti(s) desligado(s).`);
      }

      if (!parsed.type) {
        return ctx.reply(
          '⚠️ Tipo inválido. Use:\n' +
            '!anti lista — ver todos\n' +
            '!anti antilink on — liga só apagando\n' +
            '!anti antilink on ban --purge 10 — bane e apaga 10 msgs\n' +
            '!anti antipix on warn — só advertência\n' +
            '!anti antisticker on mute --purge — muta e apaga histórico\n\n' +
            'Tipos: ' +
            ALL_TYPES.join(', ')
        );
      }

      const def = autobot.resolve(parsed.type);
      let enabled = parsed.enabled;
      let action = parsed.action || 'delete';

      if (enabled === null && parsed.action) enabled = true; // "!anti antilink ban" = liga + ban
      if (enabled === true && !parsed.action) {
        const cur = antiManager.getAntiConfig(ctx.remoteJid, def.id);
        action = (cur && cur.action) || 'delete';
      }
      if (enabled === false) {
        antiManager.disableAnti(ctx.remoteJid, def.id);
        return replyState(ctx, def, false);
      }
      if (enabled === null) return ctx.reply(formatAntiConfig(ctx.remoteJid, def.id));

      antiManager.enableAnti(ctx.remoteJid, def.id, action, {
        purge: parsed.purge,
        purgeLimit: parsed.purgeLimit,
      });

      const purgeTxt = parsed.purge ? ` + purge ${parsed.purgeLimit} msgs` : '';
      const label = antiManager.ACTION_LABELS[action] || action;
      const hint = ctx.isBotAdmin ? '' : '\n_⚠️ Bot precisa ser admin para apagar/banir/mutar._';
      return replyState(ctx, def, true, `\n⚙️ Ação: ${label}${purgeTxt}${hint}`);
    },
  },
  {
    name: 'anticonfig',
    commands: ['anticonfig', 'anti-config'],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: 'Mostra a configuração detalhada de um anti.',
    usage: '!anticonfig <tipo>',
    cooldown: 1000,
    execute: async (ctx) => {
      const type = (ctx.args[0] || '').toLowerCase();
      if (!type || !resolveType(type)) {
        return ctx.reply('⚠️ Uso: !anticonfig <tipo>\nTipos: ' + ALL_TYPES.join(', '));
      }
      return ctx.reply(formatAntiConfig(ctx.remoteJid, type));
    },
  },
];
