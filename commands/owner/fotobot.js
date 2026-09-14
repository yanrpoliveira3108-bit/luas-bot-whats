/**
 * commands/owner/fotobot.js — troca a foto de perfil do PRÓPRIO BOT.
 *
 * Diferente de !foto (que muda a foto do grupo): aqui o alvo é o jid do bot
 * (socket.user.id). Só o dono, porque altera a identidade do bot em todos os
 * chats. Nunca expõe token/credencial nos erros.
 */

'use strict';

const icons = require('../../utils/icons');
const ui = require('../../utils/uiKit');

const MAX_BYTES = 5 * 1024 * 1024;

module.exports = [
  {
    name: 'fotobot',
    // 'fotoperfil' não entra: já pertence ao comando !avatar (o loader descarta
    // o comando inteiro quando um trigger duplica)
    commands: ['fotobot', 'setbotpp', 'botpp', 'perfilbot'],
    category: 'owner',
    ownerOnly: true,
    description: 'Define a foto de perfil do bot (marque uma imagem).',
    usage: '!fotobot (respondendo a uma imagem)',
    examples: ['!fotobot'],
    cooldown: 8000,
    tags: ['bot', 'perfil', 'foto'],
    execute: async (ctx) => {
      const botJid = (ctx.socket && ctx.socket.user && ctx.socket.user.id) || '';
      if (!botJid) {
        return ctx.reply(
          ui.error('Não sei qual é o meu número ainda.', {
            reason: 'conexão sem usuário autenticado',
            hint: 'Aguarde conectar e tente de novo',
          })
        );
      }
      if (typeof ctx.socket.updateProfilePicture !== 'function') {
        return ctx.reply(ui.error('Esta versão da conexão não permite trocar a foto do bot.'));
      }

      let media = null;
      try {
        media = await ctx.downloadMedia();
      } catch (err) {
        return ctx.reply(ui.error('Não consegui baixar a imagem.', { reason: err.message }));
      }
      if (!media || media.type !== 'image' || !media.buffer || !media.buffer.length) {
        return ctx.reply(
          `${icons.get('sticker') || '🖼️'} Marque uma *imagem* e use ${ctx.prefix}fotobot.\n▸ Formatos: JPG ou PNG\n▸ Máximo: 5 MB`
        );
      }
      if (media.buffer.length > MAX_BYTES) {
        return ctx.reply(
          ui.error('Imagem grande demais.', {
            reason: `${(media.buffer.length / 1024 / 1024).toFixed(1)} MB`,
            hint: 'Envie uma imagem de até 5 MB',
          })
        );
      }

      await ctx.reply(`${icons.get('loading') || '⏳'} Atualizando a minha foto de perfil...`);
      try {
        await ctx.socket.updateProfilePicture(botJid, media.buffer);
        return ctx.reply(
          [
            `${icons.get('done') || '✅'} Foto do bot atualizada.`,
            `▸ Número: ${String(botJid).split('@')[0]}`,
            `▸ Tamanho: ${(media.buffer.length / 1024).toFixed(0)} KB`,
          ].join('\n')
        );
      } catch (err) {
        // mensagem do WhatsApp sem stack/caminho
        return ctx.reply(
          ui.error('Não consegui atualizar a foto do bot.', {
            reason: String(err && err.message ? err.message : 'falha na API').slice(0, 120),
            hint: 'Tente uma imagem quadrada de até 5 MB',
          })
        );
      }
    },
  },
];
