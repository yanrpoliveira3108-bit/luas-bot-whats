'use strict';

const groups = require('../../database/groups');
const captcha = require('../../utils/captchaManager');

function bool(value) { return value === true ? 'ON' : 'OFF'; }
function command(key, label) {
  return {
    name: key,
    commands: [key],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    botAdmin: true,
    description: `Configura ${label} para novos pedidos de entrada.`,
    usage: `!${key} on|off|status`,
    cooldown: 2000,
    execute: async (ctx) => {
      const op = String(ctx.args[0] || 'status').toLowerCase();
      if (!['on', 'off', 'status'].includes(op)) return ctx.reply(`Uso: ${ctx.prefix}${key} on|off|status`);
      const settings = groups.getSettings(ctx.remoteJid) || {};
      if (op === 'status') return ctx.reply(`⚙️ ${label}: *${bool(settings[key])}*\n▸ Afeta apenas novos pedidos.`);
      const value = op === 'on';
      groups.setSetting(ctx.remoteJid, key, value);
      if (key === 'captcha' && !value) {
        const pending = require('../../database/database').prepare('captcha_group_pending', `SELECT participant_jid FROM captcha_challenges WHERE group_jid = ? AND status = 'pending'`).all(ctx.remoteJid);
        await captcha.cancelGroup(ctx.remoteJid, pending.map((p) => p.participant_jid), 'captcha-off');
      }
      return ctx.reply(`✅ ${label} ${value ? 'ativado' : 'desativado'}.\n▸ A alteração vale para novos pedidos.` + (key === 'captcha' && !value ? '\n▸ Desafios pendentes foram cancelados; pedidos ficam para administração manual.' : ''));
    },
  };
}
module.exports = [command('autoaceitar', 'Autoaceitar'), command('captcha', 'CAPTCHA')];
