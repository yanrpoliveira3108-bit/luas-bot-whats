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

      // Painel Central Unificado de Configurações
      const htmlTheme = require('../../utils/htmlTheme');
      const groups = require('../../database/groups');
      const country = settings.get('default_country', CONFIG.owner.defaultCountry || 'BR');
      const modoHtml = settings.menuHtmlEnabled();
      const visual = htmlTheme.get();
      const readmorePref = settings.getBool('readmore_enabled', true);
      const buttonsPref = settings.buttonsEnabled();

      const lines = [
        '⚙️ *PAINEL CENTRAL DE CONFIGURAÇÕES*',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '🌐 *Escopo Global (Dono):*',
        `▸ Nome do Bot: ${CONFIG.bot.name} v${CONFIG.bot.version}`,
        `▸ Prefixo Global: ${CONFIG.bot.prefix}`,
        `▸ País Padrão: ${country} (${phoneParser.countryName(country)})`,
        `▸ Modo HTML: ${modoHtml ? '🟢 Ativo' : '⚪ Desativado'} (${ctx.prefix}modohtml on/off)`,
        `▸ Botões: ${buttonsPref ? '🟢 Ativos' : '⚪ Desativados'} (${ctx.prefix}botao on/off)`,
        `▸ Ler Mais (Readmore): ${readmorePref ? '🟢 Ativo' : '⚪ Desativado'} (${ctx.prefix}readmore on/off)`,
        `▸ Tema HTML: ${visual.fonte || 'Padrão'} • Emojis: ${visual.emojis ? '🟢' : '⚪'} (${ctx.prefix}temahtml)`,
        `▸ Comandos Carregados: ${require('../../engine/plugins').registry.count()}`,
      ];

      if (ctx.isGroup) {
        const g = groups.get(ctx.remoteJid) || {};
        const gSettings = g.settings || {};
        const hg = gSettings.horarioGrupo || {};
        lines.push('');
        lines.push('👥 *Escopo do Grupo (Admins):*');
        lines.push(`▸ Prefixo do Grupo: ${gSettings.prefix || ctx.prefix}`);
        lines.push(`▸ Boas-vindas: ${g.welcome_enabled ? '🟢 Ativo' : '⚪ Desativado'}`);
        lines.push(`▸ Despedida: ${g.goodbye_enabled ? '🟢 Ativo' : '⚪ Desativado'}`);
        lines.push(`▸ Horário Automático: ${hg.enabled ? `🟢 Ativo (Abre ${hg.open || '-'} / Fecha ${hg.close || '-'})` : '⚪ Desativado'} (${ctx.prefix}horariogrupo)`);
        lines.push(`▸ Modo Restrito/Mute: ${gSettings.muted ? '🔴 Ativo' : '⚪ Livre'}`);
      }

      lines.push('');
      lines.push('👤 *Escopo Pessoal:*');
      lines.push(`▸ Notificações/Atividade: Padrão do chat`);
      lines.push(`▸ Atalho de Ajuda: ${ctx.prefix}help <comando> | Favoritos: ${ctx.prefix}favoritos`);
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push(`💡 _Para alterar opções globais use os comandos do Dono. Para opções do grupo, use comandos administrativos._`);

      await ctx.reply(lines.join('\n'));
    },
  },
];
