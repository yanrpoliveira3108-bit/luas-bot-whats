/**
 * commands/general/menumode.js — troca o modo visual dos menus (briefing 12/82/83).
 *
 * O modo vale por grupo (no PV vale global) e é lido pelo utils/menuRenderer,
 * então muda cabeçalho, fonte dos títulos e família de separadores de uma vez.
 * Comandos executáveis continuam em texto puro — só a decoração muda.
 */

'use strict';

const menuRenderer = require('../../utils/menuRenderer');
const icons = require('../../utils/icons');
const divider = require('../../utils/dividers');

module.exports = [
  {
    name: 'menumode',
    commands: ['menumode', 'modomenu', 'menustyle', 'temamenu', 'visualmenu'],
    category: 'general',
    description: 'Mostra ou troca o modo visual dos menus (default/dark/cute/minimal/royal/cyber).',
    usage: '!menumode [modo]',
    examples: ['!menumode', '!menumode dark', '!menumode cute'],
    cooldown: 2000,
    tags: ['menu', 'tema', 'visual', 'layout'],
    execute: async (ctx) => {
      const arg = (ctx.args[0] || '').trim().toLowerCase();

      if (!arg) {
        const current = menuRenderer.currentModeName(ctx.remoteJid);
        const lines = [
          menuRenderer.header({ title: 'MODO DO MENU', jid: ctx.remoteJid }),
          '',
          `${icons.get('eye') || '👁️'} Atual: *${current}* (vale para este ${menuRenderer.modeScope(ctx.remoteJid)})`,
          '',
          menuRenderer.dividerLine(null, ctx.remoteJid),
          '',
        ];
        for (const m of menuRenderer.listModes(ctx.remoteJid)) {
          const mark = m.active ? '✅' : '▸';
          lines.push(`${mark} *${m.id}* — ${m.label} — ${m.hint}`);
          lines.push(`   ${menuRenderer.style('LUA BOT', m.font)} ${divider(m.div)}`);
        }
        lines.push('');
        lines.push(
          menuRenderer.footer({
            jid: ctx.remoteJid,
            hints: [`${ctx.prefix}menumode <modo> para trocar`],
          })
        );
        return ctx.reply(lines.join('\n'));
      }

      if (!menuRenderer.setMode(arg, ctx.remoteJid)) {
        const valid = Object.keys(menuRenderer.MODES).join(', ');
        return ctx.reply(
          `${icons.warning || '⚠️'} Modo *${arg}* não existe.\n▸ Válidos: ${valid}\n▸ Uso: ${ctx.prefix}menumode <modo>`
        );
      }

      const m = menuRenderer.modeFor(ctx.remoteJid);
      return ctx.reply(
        [
          `${icons.done || '✅'} Modo *${menuRenderer.currentModeName(ctx.remoteJid)}* ativado (${menuRenderer.modeScope(ctx.remoteJid)}).`,
          '',
          menuRenderer.header({ title: 'LUA BOT', subtitle: m.label, jid: ctx.remoteJid }),
          '',
          menuRenderer.section({
            title: 'Prévia',
            category: 'music',
            jid: ctx.remoteJid,
            items: [{ text: `${ctx.prefix}menu` }, { text: `${ctx.prefix}help play` }],
          }),
        ].join('\n')
      );
    },
  },
];
