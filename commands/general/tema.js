/**
 * commands/general/tema.js — !tema · presets visuais do Lua.
 *
 *   !tema            → lista os presets (qualquer usuário)
 *   !tema <preset>   → troca o tema (somente dono; persistido no banco)
 *
 * As cores vivem em config/themes.js; aqui só há navegação/persistência.
 */

'use strict';

const theme = require('../../utils/theme');
const CONFIG = require('../../config');

module.exports = [
  {
    name: 'tema',
    commands: ['tema', 'theme'],
    category: 'general',
    description: 'Lista ou troca o tema visual do bot.',
    usage: '!tema [preset] | !tema titulo [estilo]',
    cooldown: 3000,
    execute: async (ctx) => {
      const arg = (ctx.args[0] || '').trim().toUpperCase();

      // !tema titulo <estilo> → estilo OPCIONAL dos títulos nas mensagens comuns
      // (letras Unicode só em títulos; comandos, prefixos, números e links nunca)
      if (arg === 'TITULO' || arg === 'TÍTULO') {
        const ts = require('../../config/textStyles');
        const pedido = (ctx.args[1] || '').trim();
        const lista = Object.entries(ts.TITLE_STYLES)
          .map(([id, st]) => `▸ \`${id}\` — ${st.label}: ${st.exemplo}`)
          .join('\n');
        if (!pedido) {
          return ctx.reply(
            `🔤 *Estilo dos títulos*: \`${ts.estiloTituloAtivo()}\`\n${lista}\n` +
              `_Troque com: ${ctx.prefix}tema titulo <estilo> (somente dono)._`
          );
        }
        const id = ts.resolverEstiloTitulo(pedido);
        if (!id) return ctx.reply(`⚠️ Estilo \"${pedido.slice(0, 30)}\" não existe.\n${lista}`);
        if (!ctx.isOwner) return ctx.reply('🚫 Apenas o dono do bot pode trocar o estilo dos títulos.');
        try {
          require('../../database/settings').set('text_title_style', id);
        } catch (_) {
          return ctx.reply('❌ Não salvei o estilo (erro no banco). O anterior foi mantido.');
        }
        if (ts.estiloTituloAtivo() !== id) return ctx.reply('❌ O banco não confirmou a gravação. O estilo anterior foi mantido.');
        return ctx.reply(`✅ Estilo dos títulos: *${ts.titulo('Lua Bot', id)}* (\`${id}\`).`);
      }

      // sem argumento → lista os presets
      if (!arg) {
        const active = theme.active();
        const lines = theme.list().map((t) => {
          const mark = t.id === active.id ? ' ✦' : '';
          return `▸ ${t.emoji} *${t.name}* (${t.id})${mark}`;
        });
        await ctx.reply(
          [
            '🌙 *TEMAS DO LUA*',
            '━━━━━━━━━━━━━━━━━━━━',
            lines.join('\n'),
            '━━━━━━━━━━━━━━━━━━━━',
            `Tema atual: ${active.emoji} *${active.name}*`,
            `_Troque com: ${ctx.prefix}tema <preset> (somente dono)_`,
          ].join('\n')
        );
        return;
      }

      // troca de tema → somente dono
      if (!ctx.isOwner) {
        return ctx.reply('🚫 Apenas o dono do bot pode trocar o tema.');
      }
      if (!theme.setActive(arg)) {
        return ctx.reply(`⚠️ Preset "${arg}" não existe. Use ${ctx.prefix}tema para ver a lista.`);
      }
      const t = theme.active();
      await ctx.reply(
        [
          `${t.emoji} *${t.name}* ativado.`,
          '━━━━━━━━━━━━━━━━━━━━',
          `▸ Principal: \`${t.primary}\``,
          `▸ Neon: \`${t.neon}\``,
          `▸ Destaque: \`${t.accent}\``,
          '━━━━━━━━━━━━━━━━━━━━',
          '☾ LUA • ' + t.tagline,
        ].join('\n')
      );
    },
  },
];
