/**
 * commands/general/guia.js — Guia Interativo de Primeiros Passos do Lua WhatsApp Bot.
 *
 * Características:
 * - Passos simples para novos usuários (prefixo, menu, busca, ajuda, favoritos, RPG, carteira, feira, expedições)
 * - Comandos e exemplos com prefixo ativo e metadados dinâmicos
 * - Explicação sobre funcionamento dos botões HTML (copiar/enviar comandos no chat)
 * - Card visual em HTML com suporte a modohtml on/off e fallback de texto
 */

'use strict';

const settings = require('../../database/settings');

module.exports = [
  {
    name: 'guia',
    commands: ['guia', 'tutorial', 'comecar', 'iniciar', 'startguide'],
    category: 'general',
    description: 'Guia interativo de primeiros passos e comandos essenciais.',
    usage: '!guia',
    cooldown: 2000,
    execute: async (ctx) => {
      const prefix = ctx.prefix;

      const steps = [
        {
          num: '1',
          emoji: '⚡',
          title: 'Descobrir o Prefixo Ativo',
          desc: `O prefixo do bot neste chat é *${prefix}*. Envie *prefixo* ou mencione o bot a qualquer momento para conferir.`,
        },
        {
          num: '2',
          emoji: '📋',
          title: 'Abrir o Menu Principal',
          desc: `Digite *${prefix}menu* para ver todas as categorias e comandos disponíveis organizados por assunto.`,
        },
        {
          num: '3',
          emoji: '🔍',
          title: 'Pesquisar Comandos',
          desc: `Não sabe o nome exato? Digite *${prefix}buscar <termo>* (ex: *${prefix}buscar foto* ou *${prefix}buscar musica*).`,
        },
        {
          num: '4',
          emoji: '❓',
          title: 'Consultar Ajuda de um Comando',
          desc: `Use *${prefix}ajuda <comando>* para conferir a sintaxe, permissões necessárias e exemplos práticos.`,
        },
        {
          num: '5',
          emoji: '⭐',
          title: 'Salvar Seus Comandos Favoritos',
          desc: `Adicione seus comandos mais usados com *${prefix}favoritos adicionar <cmd>* e consulte com *${prefix}favoritos*.`,
        },
        {
          num: '6',
          emoji: '⚔️',
          title: 'Acessar o RPG e Criar seu Personagem',
          desc: `Digite *${prefix}rpg* para iniciar. Escolha sua profissão com *${prefix}emprego* e trabalhe com *${prefix}trabalhar*.`,
        },
        {
          num: '7',
          emoji: '🎒',
          title: 'Carteira, Inventário e Extrato',
          desc: `Consulte seu saldo com *${prefix}carteira*, veja itens com *${prefix}inventario* e audite transações com *${prefix}extrato*.`,
        },
        {
          num: '8',
          emoji: '🏪',
          title: 'Negociar Itens na Feira',
          desc: `Venda ou compre itens de outros jogadores com *${prefix}feira*, *${prefix}feira vender* e *${prefix}feira comprar*.`,
        },
        {
          num: '9',
          emoji: '🧭',
          title: 'Explorar Expedições e Coleções',
          desc: `Parta em jornadas táticas com *${prefix}expedicao* e complete conjuntos lendários com *${prefix}colecoes*.`,
        },
      ];

      // Se o modo HTML estiver ativo, envia o card visual
      if (settings.menuHtmlEnabled()) {
        try {
          const guiaHtmlView = require('../../utils/guiaHtmlView');
          const richHtml = require('../../utils/richHtml');
          const html = guiaHtmlView.renderGuiaHtml(steps, prefix);
          await richHtml.sendHtml(ctx.socket, ctx.remoteJid, html, { title: 'GUIA DE PRIMEIROS PASSOS' });
          return;
        } catch (_) {}
      }

      // Fallback em texto limpo e bem formatado
      const lines = steps.map((s) => `*Passo ${s.num}:* ${s.emoji} *${s.title}*\n▸ ${s.desc}`).join('\n\n');

      const text = [
        '🌟 *GUIA DE PRIMEIROS PASSOS — LUA BOT*',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        'Bem-vindo(a)! Siga este percurso rápido para aproveitar ao máximo todos os recursos:\n',
        lines,
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '💡 *Dica:* Se você visualiza botões ou menus HTML, eles servem para montar o comando para você enviar no chat!',
        `👉 Experimente começar agora digitando: *${prefix}menu*`,
      ].join('\n');

      return ctx.reply(text);
    },
  },
];
