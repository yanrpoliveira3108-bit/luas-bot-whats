/**
 * commands/utility/visual.js — vitrine da identidade visual (Lua 2.0).
 *
 * `!fontes` mostra os estilos Unicode disponíveis e aplica no texto enviado;
 * `!dividers` lista as categorias de separadores. Os dois usam os módulos
 * centrais (utils/fonts, utils/dividers, utils/uiKit) — não há template
 * duplicado aqui.
 *
 * Regra mantida: o texto do usuário é estilizado, mas comandos/URLs dentro dele
 * ficam copiáveis (fonts.safe).
 */

'use strict';

const fonts = require('../../utils/fonts');
const divider = require('../../utils/dividers');
const ui = require('../../utils/uiKit');
const icons = require('../../utils/icons');

module.exports = [
  {
    name: 'fontes',
    commands: ['fontes', 'fonts', 'letras'],
    category: 'utility',
    description: 'Mostra as fontes Unicode do bot ou aplica uma no seu texto.',
    usage: '!fontes [estilo] <texto>',
    examples: ['!fontes', '!fontes boldScript LUA BOT', '!fontes mono https://lua.bot'],
    cooldown: 4000,
    tags: ['visual', 'unicode', 'estilo'],
    execute: async (ctx) => {
      const styles = fonts.styles();
      const [maybeStyle, ...rest] = ctx.args;
      const hasStyle = maybeStyle && fonts.has(String(maybeStyle).toLowerCase());
      const text = (hasStyle ? rest : ctx.args).join(' ').trim();

      if (!text) {
        const demo = 'Lua Bot';
        const lines = styles.map((s) => `${icons.get('spark')} *${s}* — ${fonts.apply(demo, s)}`);
        return ctx.reply(
          [
            ui.header('FONTES', 'system'),
            '',
            `${lines.length} estilos disponíveis (texto de exemplo: "${demo}")`,
            '',
            ...lines,
            '',
            `${icons.get('info')} Uso: ${ctx.prefix}fontes <estilo> <texto>`,
            `${icons.get('info')} Ex: ${ctx.prefix}fontes boldScript meu texto`,
            `${icons.warning} Comandos, links e IDs nunca são estilizados.`,
          ].join('\n')
        );
      }

      const style = hasStyle ? String(maybeStyle).toLowerCase() : 'boldScript';
      return ctx.reply(
        [
          divider.random('minimal'),
          `${icons.get('spark')} *${style}*`,
          fonts.safe(text, style),
          divider.random('minimal'),
          `${icons.get('info')} ${ctx.prefix}fontes para ver todos os estilos`,
        ].join('\n')
      );
    },
  },
  {
    name: 'dividers',
    commands: ['dividers', 'separadores'],
    category: 'utility',
    description: 'Mostra os separadores decorativos por categoria.',
    usage: '!dividers [categoria]',
    examples: ['!dividers', '!dividers music', '!dividers royal'],
    cooldown: 4000,
    tags: ['visual', 'separador'],
    execute: async (ctx) => {
      const categories = divider.categories();
      const wanted = String(ctx.args[0] || '').toLowerCase().trim();
      const list = wanted && categories.includes(wanted) ? [wanted] : categories;

      const lines = [];
      for (const cat of list) {
        lines.push(`${icons.forCategory(cat)} *${cat}*`);
        for (const style of divider.of(cat)) lines.push(`   ${style}`);
      }

      return ctx.reply(
        ui.truncate(
          [
            ui.header('SEPARADORES', 'system'),
            '',
            `${divider.count()} estilos em ${categories.length} categorias`,
            '',
            ...lines,
            '',
            `${icons.get('info')} Uso: ${ctx.prefix}dividers <categoria> (ex: ${ctx.prefix}dividers music)`,
          ].join('\n'),
          3800
        )
      );
    },
  },
];
