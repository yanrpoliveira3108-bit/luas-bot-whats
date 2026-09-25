'use strict';

const CONFIG = require('../../config');
const settings = require('../../database/settings');

const ON = new Set(['on', 'ligar', 'ativar', '1', 'sim']);
const OFF = new Set(['off', 'desligar', 'desativar', '0', 'nao', 'não']);

module.exports = [{
  name: 'htmlplay',
  commands: ['htmlplay'],
  category: 'general',
  description: 'Liga ou desliga o card HTML PLAY para mídias.',
  usage: '!htmlplay [on|off]',
  cooldown: 1500,
  execute: async (ctx) => {
    const arg = String(ctx.args[0] || '').toLowerCase().trim();
    let enabled;
    try { enabled = settings.htmlPlayEnabled(); } catch (_) { enabled = !!CONFIG.htmlPlay?.enabled; }

    if (!arg) {
      return ctx.reply(
        `🎧 *HTML PLAY*\n\n` +
        `Estado: ${enabled ? '✅ LIGADO' : '⚪ DESLIGADO'}\n` +
        `Use ${ctx.prefix}htmlplay on ou ${ctx.prefix}htmlplay off.`
      );
    }
    if (!ON.has(arg) && !OFF.has(arg)) {
      return ctx.reply(`⚠️ Use ${ctx.prefix}htmlplay on ou ${ctx.prefix}htmlplay off.`);
    }
    if (!ctx.isOwner) return ctx.reply(CONFIG.messages.deniedOwner);

    const wanted = ON.has(arg);
    try {
      settings.setHtmlPlayEnabled(wanted);
      const saved = settings.htmlPlayEnabled();
      if (saved !== wanted) return ctx.reply('❌ Não foi possível salvar a configuração do HTML PLAY.');
      return ctx.reply(
        wanted
          ? `✅ *HTML PLAY LIGADO*\nOs comandos de mídia poderão enviar o card HTML opcional.`
          : `✅ *HTML PLAY DESLIGADO*\nO fluxo tradicional de áudio e vídeo foi restaurado.`
      );
    } catch (err) {
      return ctx.reply(`❌ Não foi possível salvar a configuração: ${err.message}`);
    }
  },
}];
