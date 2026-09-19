/**
 * commands/admin/status.js — status completo dos recursos do grupo.
 *
 * `!statusgrupo` mostra, recurso por recurso, o que está REALMENTE ligado —
 * a lista é gerada a partir do registro do AutoBot (utils/autobot.js), que é
 * a mesma fonte usada pelo motor de execução. Não existe "status decorativo":
 * o que aparece ✅ é o que o bot vai executar.
 *
 * Formato (seções do painel):
 *
 *   ⚙️ STATUS DO GRUPO ⚙️
 *
 *   🔒 PROTEÇÕES
 *   Anti Link ✅ !antilink
 *   ...
 *
 * Obs.: `!status` já é um comando existente (perfil RPG) e foi preservado.
 */

'use strict';

const autobot = require('../../utils/autobot');
const { effectivePrefix } = require('../../database/settings');

module.exports = [
  {
    name: 'statusgrupo',
    commands: ['statusgrupo', 'statusgp', 'statusg', 'grupstatus'],
    category: 'admin',
    groupOnly: true,
    description: 'Mostra o status de todas as proteções e automações do grupo.',
    usage: '!statusgrupo',
    cooldown: 3000,
    execute: async (ctx) => {
      ctx.presence && ctx.presence('composing');
      const jid = ctx.isGroup ? ctx.remoteJid : null;
      const text = autobot.buildStatus(jid);
      if (!jid) {
        return ctx.reply(`${text}\n\n_Use este comando dentro de um grupo para ver os recursos do grupo._`);
      }
      return ctx.reply(text);
    },
  },
  {
    name: 'statusglobal',
    commands: ['statusglobal', 'statusbot'],
    category: 'owner',
    ownerOnly: true,
    description: 'Status dos recursos globais do bot (Anti PV, Aniversário, Modo Registro...).',
    usage: '!statusglobal',
    cooldown: 3000,
    execute: async (ctx) => {
      const prefix = effectivePrefix();
      const lines = ['🌐 *RECURSOS GLOBAIS DO BOT*', '_✅ ativado • ❌ desativado_', ''];
      for (const def of autobot.bySection('global')) {
        const on = autobot.isEnabled(null, def.id);
        lines.push(`${def.label} ${on ? '✅' : '❌'} ${prefix}${def.cmd}`);
      }
      lines.push('', '💡 Estes recursos valem para o bot inteiro (não por grupo).');
      return ctx.reply(lines.join('\n'));
    },
  },
];
