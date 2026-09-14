/**
 * menus/index.js — definição ordenada dos menus do Lua.
 *
 * O menu principal é gerado dinamicamente a partir desta lista.
 * Cada entrada aponta para uma função `run` real.
 */

'use strict';

module.exports = [
  { id: 'general', title: 'Geral', emoji: '⚙️', description: 'Comandos básicos e utilitários do bot.', run: (ctx) => require('./general')(ctx) },
  { id: 'owner', title: 'Dono', emoji: '👑', description: 'Controle total do bot (apenas dono).', run: (ctx) => require('./owner')(ctx) },
  { id: 'admin', title: 'Administração', emoji: '🛡️', description: 'Moderação e administração do grupo.', run: (ctx) => require('./admin')(ctx) },
  { id: 'members', title: 'Membros', emoji: '👥', description: 'Perfil, rank, XP e interações.', run: (ctx) => require('./members')(ctx) },
  { id: 'downloads', title: 'Downloads', emoji: '📥', description: 'Baixar músicas e vídeos.', run: (ctx) => require('./downloads')(ctx) },
  { id: 'stickers', title: 'Stickers', emoji: '🎨', description: 'Criar e editar figurinhas.', run: (ctx) => require('./stickers')(ctx) },
  { id: 'games', title: 'Games', emoji: '🎮', description: 'Jogos dentro do WhatsApp.', run: (ctx) => require('./games')(ctx) },
  { id: 'rpg', title: 'RPG', emoji: '⚔️', description: 'Economia, fazenda e empregos.', run: (ctx) => require('./rpg')(ctx) },
  { id: 'life', title: 'Lua Life', emoji: '🎮', description: 'Vida virtual: trabalho, pesca, mineração, fazenda e economia.', run: (ctx) => require('./life')(ctx) },
  { id: 'anime', title: 'Anime', emoji: '🍥', description: 'Busca de animes, mangás e personagens.', run: (ctx) => require('./anime')(ctx) },
  { id: 'ai', title: 'IA', emoji: '🤖', description: 'Chat, código, tradução e resumo com IA.', run: (ctx) => require('./ai')(ctx) },
  { id: 'fun', title: 'Zueira', emoji: '😂', description: 'Diversão e interações.', run: (ctx) => require('./fun')(ctx) },
  { id: 'utility', title: 'Utilidades', emoji: '🛠️', description: 'Ferramentas úteis (CEP, CNPJ, cálculo).', run: (ctx) => require('./utility')(ctx) },
  { id: 'settings', title: 'Configurações', emoji: '⚙️', description: 'Configurações do grupo e filtros.', run: (ctx) => require('./settings')(ctx) },
  { id: 'rankings', title: 'Rankings', emoji: '📊', description: 'Top usuários do bot.', run: (ctx) => require('./rankings')(ctx) },
];
