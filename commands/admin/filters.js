/**
 * commands/admin/filters.js — comandos CLÁSSICOS dos antis (compatibilidade).
 *
 * Os nomes públicos (`!antilink`, `!antispam`, `!antiinvite`, `!antifoto`,
 * `!antivv`, ...) foram PRESERVADOS exatamente como eram. O que mudou é o
 * miolo: em vez de cada comando gravar direto em `settings.filters`, todos
 * passam pelo núcleo do AutoBot (utils/autobot.js) — ou seja, o mesmo estado
 * consultado pelo motor de execução, pelo `!anti` avançado, pelos menus e
 * pelo `!statusgrupo`.
 *
 * Resposta padronizada (todos os on/off do projeto):
 *
 *   ✅ Recurso ativado.
 *   🔒 Anti Link • !antilink
 *
 *   ❌ Recurso desativado.
 *   🔒 Anti Link • !antilink
 */

'use strict';

const groups = require('../../database/groups');
const autobot = require('../../utils/autobot');

const ON_WORDS = ['on', 'ligar', 'ativar', 'liga', '1', 'sim', 'true', 'enable'];
const OFF_WORDS = ['off', 'desligar', 'desativar', 'desativa', '0', 'nao', 'não', 'false', 'disable'];

function botAdminHint(ctx) {
  return ctx.isBotAdmin ? '' : '\n_⚠️ Para APAGAR as mensagens, o bot precisa ser admin do grupo (senão ele só avisa)._';
}

function replyState(ctx, def, enabled) {
  const first = enabled ? '✅ Recurso ativado.' : '❌ Recurso desativado.';
  return ctx.reply(`${first}\n${def.label} • !${ctx.command}${botAdminHint(ctx)}`);
}

function replyInfo(ctx, def) {
  const on = autobot.isEnabled(ctx.remoteJid, def.id);
  return ctx.reply(
    `${on ? '✅ Recurso ativado.' : '❌ Recurso desativado.'}\n` +
      `${def.label} • !${def.cmd}\n` +
      `📝 ${def.desc}\n` +
      `💡 Uso: !${ctx.command} on|off`
  );
}

/**
 * Comando clássico de anti (nome público preservado).
 * @param {string} featureId id no registro do AutoBot
 * @param {string} publicName trigger público (ex.: 'antiinvite')
 * @param {string[]} aliases triggers extras
 */
function legacyCommand(featureId, publicName, aliases = [], extra = {}) {
  const def = autobot.resolve(featureId);
  if (!def) throw new Error(`filters.js: recurso desconhecido "${featureId}"`);
  return {
    name: publicName,
    commands: [publicName, ...aliases],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: def.desc,
    usage: `!${publicName} on|off`,
    cooldown: 1500,
    execute: async (ctx) => {
      const arg = (ctx.args[0] || '').toLowerCase();
      if (ON_WORDS.includes(arg)) {
        autobot.setEnabled(ctx.remoteJid, def.id, true);
        return replyState(ctx, def, true);
      }
      if (OFF_WORDS.includes(arg)) {
        autobot.setEnabled(ctx.remoteJid, def.id, false);
        return replyState(ctx, def, false);
      }
      if (extra.onArgs) {
        const handled = await extra.onArgs(ctx, def, arg);
        if (handled) return;
      }
      return replyInfo(ctx, def);
    },
  };
}

/** Whitelist do anti-link (comportamento antigo, intacto). */
async function antilinkArgs(ctx, def) {
  const sub = (ctx.args[0] || '').toLowerCase();
  if (sub !== 'whitelist' && sub !== 'wl') return false;
  const op = (ctx.args[1] || '').toLowerCase();
  const domain = (ctx.args[2] || '').toLowerCase().replace(/^www\./, '');
  const s = groups.getSettings(ctx.remoteJid);
  const wl = Array.isArray(s.antilink_whitelist) ? [...s.antilink_whitelist] : [];

  if ((op === 'add' || op === 'adicionar') && domain) {
    if (!wl.includes(domain)) wl.push(domain);
    groups.setWhitelist(ctx.remoteJid, wl);
    await ctx.reply(`✅ Domínio *${domain}* adicionado à whitelist.`);
    return true;
  }
  if (op === 'remove' || op === 'rm' || op === 'remover') {
    groups.setWhitelist(ctx.remoteJid, wl.filter((d) => d !== domain));
    await ctx.reply(`🗑️ Domínio *${domain}* removido da whitelist.`);
    return true;
  }
  if (op === 'list' || op === 'lista' || !op) {
    await ctx.reply(`📋 *Whitelist do anti-link:*\n${wl.length ? wl.map((d) => '▸ ' + d).join('\n') : '(vazia)'}`);
    return true;
  }
  await ctx.reply(`⚠️ Uso: !${ctx.command} whitelist add|remove|list <domínio>`);
  return true;
}

/* ------------------- catálogo de comandos clássicos -------------------- */

const LEGACY = [
  // [id no AutoBot, nome público, aliases]
  ['antilink', 'antilink', [], { onArgs: antilinkArgs }],
  ['antipix', 'antipix', ['antipagamento', 'antipag']],
  ['antispam', 'antispam', []],
  ['antiflood', 'antiflood', []],
  ['antifake', 'antifake', []],
  ['antibot', 'antibot', []],
  ['antiparentese', 'antiparentese', []],
  ['antilinkgp', 'antiinvite', []], // nome público antigo do "anti link de grupo"
  ['antimedia', 'antimedia', []],
  ['antiimagem', 'antiimagem', ['antifoto']],
  ['antivideo', 'antivideo', []],
  ['antiaudio', 'antiaudio', []],
  ['antidocumento', 'antidocumento', ['antidoc']],
  ['antisticker', 'antisticker', ['antifig', 'antifigurinha']],
  ['antiviewonce', 'antiviewonce', ['antivv']],
  ['antilocalizacao', 'antilocalizacao', ['antiloc', 'antilocal']],
  ['anticontato', 'anticontato', ['antictt']],
];

module.exports = LEGACY.map(([id, name, aliases, extra]) => legacyCommand(id, name, aliases, extra));
