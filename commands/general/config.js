'use strict';

const CONFIG = require('../../config');
const settings = require('../../database/settings');
const phoneParser = require('../../connection/phoneParser');

module.exports = [
  {
    name: 'config',
    commands: ['config'],
    category: 'general',
    description: 'Mostra a configuração (alterar país padrão = dono).',
    usage: '!config [country <XX>]',
    cooldown: 2000,
    execute: async (ctx) => {
      const sub = (ctx.args[0] || '').toLowerCase();

      if (sub === 'country') {
        if (!ctx.isOwner) return ctx.reply(CONFIG.messages.deniedOwner);
        const cc = (ctx.args[1] || '').toUpperCase();
        if (!phoneParser.isSupportedCountry(cc)) {
          return ctx.reply('❌ País não suportado. Use o código ISO (ex.: BR, US, PT).');
        }
        settings.set('default_country', cc);
        return ctx.reply(`✅ País padrão alterado para *${cc}* (${phoneParser.countryName(cc)}).`);
      }

      const country = settings.get('default_country', CONFIG.owner.defaultCountry || 'BR');
      const lines = [
        '⚙️ *Configurações do bot*',
        `▸ Nome: ${CONFIG.bot.name} v${CONFIG.bot.version}`,
        `▸ Prefixo: ${ctx.prefix}`,
        `▸ País padrão: ${country} (${phoneParser.countryName(country)})`,
        `▸ Modo privado: ${CONFIG.mode.private ? 'sim' : 'não'}`,
        `▸ Dono: ${CONFIG.owner.name}`,
        `▸ Comandos: ${require('../../engine/plugins').registry.count()}`,
      ];
      await ctx.reply(lines.join('\n'));
    },
  },
];
