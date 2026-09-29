'use strict';

const greeting = require('../../plugins/welcome/greetingEngine');
const welcomeSystem = require('../../plugins/welcome');

const VARS_TEXT = [
  'PLACEHOLDERS DISPONÍVEIS',
  '{usuario} usuário/marca',
  '{nome} nome conhecido',
  '{numero} telefone mascarado',
  '{grupo} nome do grupo',
  '{hora} hora do evento',
  '{data} data do evento',
  '{membros} total disponível de membros',
  '{prefix} prefixo atual',
  '{comunidade} comunidade quando já resolvida',
].join('\n');

function make(kind) {
  const welcome = kind === 'welcome';
  const command = welcome ? 'welcometext' : 'goodbyetext';
  const title = welcome ? 'WELCOME' : 'GOODBYE';
  return {
    name: command,
    commands: [command],
    category: 'admin',
    adminOnly: true,
    groupOnly: true,
    description: `Texto editável do card e fallback de ${title}.`,
    usage: `!${command} | !${command} atualizar <texto> | !${command} reset|preview|vars`,
    cooldown: 1500,
    execute: async (ctx) => {
      const sub = String(ctx.args[0] || '').toLowerCase();
      const current = greeting.getGreetingSettings(ctx.remoteJid)[welcome ? 'welcomeText' : 'goodbyeText'];
      if (!sub) {
        return ctx.reply(`🌙 LUA • ${title}\n\nMensagem atual:\n${current}\n\n${VARS_TEXT}\n\nPara atualizar: ${ctx.prefix || ','}${command} atualizar <mensagem>`);
      }
      if (sub === 'vars' || sub === 'variaveis') return ctx.reply(VARS_TEXT);
      if (sub === 'reset' || sub === 'restaurar') {
        const value = greeting.resetGreetingTemplate(ctx.remoteJid, kind);
        return ctx.reply(`✅ Mensagem de ${title} restaurada para o padrão.\n\n${value}`);
      }
      if (sub === 'preview' || sub === 'teste') {
        try {
          await welcomeSystem.preview(ctx.socket, ctx.remoteJid, ctx.sender, kind);
          return null;
        } catch (err) {
          return ctx.reply('⚠️ Não consegui gerar a prévia agora.');
        }
      }
      if (sub !== 'atualizar' && sub !== 'update') {
        return ctx.reply(`Uso: ${ctx.prefix || ','}${command} atualizar <texto> | reset | preview | vars`);
      }
      // Não reconstruir a mensagem com ctx.args.join(' '): splitCommand()
      // tokeniza por whitespace e destruiria todas as quebras de linha.
      let value = greeting.extractTemplateFromCommand(ctx.text, ctx.prefix, command);
      if (!value && ctx.quotedText) value = ctx.quotedText;
      const result = greeting.setGreetingTemplate(ctx.remoteJid, kind, value);
      if (!result.ok) return ctx.reply(`⚠️ ${result.error}`);
      return ctx.reply(`✅ Mensagem de ${title} atualizada.`);
    },
  };
}

module.exports = [make('welcome'), make('goodbye')];
