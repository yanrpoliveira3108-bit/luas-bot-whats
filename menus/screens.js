/**
 * menus/screens.js — telas do sistema de navegação por LISTA.
 *
 * Registra cada tela (screen) no motor utils/nav.js. Ações das linhas chamam
 * handlers de COMANDO (commandHandler.runByName) — lista e comandos
 * compartilham a MESMA lógica (nada duplicado).
 */

'use strict';

const CONFIG = require('../config');
const settings = require('../database/settings');
const nav = require('../utils/nav');
const commandHandler = require('../handlers/commandHandler');
const { registry } = require('../engine/plugins');
const { displayName } = require('../engine/interactionEngine');
const { commandEmoji } = require('../utils/commandEmoji');

const run = (name, args = []) => (c) => commandHandler.runByName(c, name, args);
const screen = (id) => nav.openScreen;

/* --------------------------- helpers -------------------------------- */

/** Tela que lista comandos de uma categoria (gerada do registry). */
function categoryScreen(id, title, emoji, category) {
  nav.registerScreen(id, (ctx) => {
    const cmds = (registry.byCategory().get(category) || []).filter((c) => !c.hidden);
    return {
      id,
      title,
      body: `${emoji} *${title}* — ${cmds.length} comandos.`,
      image: 'main',
      buttons: cmds.map((c) => ({
        id: `cmd_${c.name}`,
        text: `${commandEmoji(c)} ${ctx.prefix}${c.name}`,
        run: run(c.name),
      })),
    };
  });
}

/* ------------------------- menu principal --------------------------- */

nav.registerScreen('lua_main', (ctx) => ({
  id: 'lua_main',
  title: '🌙 LUA BOT',
  header:
    `╭━━━〔 🌙 LUA BOT 〕━━━╮\n` +
    `┃\n` +
    `┃  🌙 Bem-vindo ao Lua\n` +
    `┃  ⚡ Sistema multifuncional\n` +
    `┃\n` +
    `┃  👤 Usuário: ${displayName(ctx.sender)}\n` +
    `┃  ⚙️ Prefixo: ${settings.effectivePrefix()}\n` +
    `┃\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯`,
  body: '📋 MENU PRINCIPAL\nEscolha uma categoria abaixo:',
  listTitle: '🌙 LUA BOT',
  buttonText: '🌙 Abrir',
  image: 'main',
  buttons: [
    { id: 'menu_admin', text: '👑 Administração', description: 'Gerenciar membros e configurações', run: (c) => nav.openScreen(c, 'lua_admin_menu') },
    { id: 'menu_diversao', text: '🎮 Diversão', description: 'Jogos e comandos de entretenimento', run: (c) => nav.openScreen(c, 'lua_diversao') },
    { id: 'menu_ia', text: '🤖 IA', description: 'Ferramentas de inteligência artificial', run: (c) => nav.openScreen(c, 'lua_ia_menu') },
    { id: 'menu_downloads', text: '📥 Downloads', description: 'Músicas, vídeos e arquivos', run: (c) => nav.openScreen(c, 'lua_downloads') },
    { id: 'menu_sticker', text: '🖼️ Stickers', description: 'Criar e converter stickers', run: (c) => nav.openScreen(c, 'lua_sticker_menu') },
    { id: 'menu_grupo', text: '👥 Grupo', description: 'Ferramentas para grupos', run: (c) => nav.openScreen(c, 'lua_grupo') },
    { id: 'menu_utilidades', text: '🛠️ Utilidades', description: 'Ferramentas gerais', run: (c) => nav.openScreen(c, 'lua_utility') },
    { id: 'menu_dono', text: '👤 Dono', description: 'Comandos exclusivos do proprietário', run: (c) => nav.openScreen(c, 'lua_owner') },
  ],
}));

/* ---------------- DIVERSÃO (submenu que agrupa lazer) --------------- */

nav.registerScreen('lua_diversao', () => ({
  id: 'lua_diversao',
  title: '🎮 DIVERSÃO',
  body: 'Jogos, zueira e entretenimento.',
  listTitle: '🎮 Diversão',
  buttonText: '🌙 Abrir',
  buttons: [
    { id: 'games', text: '🎮 Games', description: 'Jogos dentro do WhatsApp', run: (c) => nav.openScreen(c, 'lua_games') },
    { id: 'fun', text: '😂 Zueira', description: 'Diversão e interações', run: (c) => nav.openScreen(c, 'lua_fun') },
    { id: 'anime', text: '🍥 Anime', description: 'Animes, mangás e personagens', run: (c) => nav.openScreen(c, 'lua_anime') },
    { id: 'rpg', text: '⚔️ RPG & Economia', description: 'Economia, fazenda e empregos', run: (c) => nav.openScreen(c, 'lua_rpg') },
    { id: 'life', text: '🌎 Lua Life', description: 'Vida virtual: trabalho, pesca, mineração', run: (c) => nav.openScreen(c, 'lua_life') },
    { id: 'xp', text: '⭐ XP & Level', description: 'Sua progressão no bot', run: (c) => nav.openScreen(c, 'lua_xp') },
    { id: 'rankings', text: '🏆 Rankings', description: 'Top usuários do bot', run: (c) => nav.openScreen(c, 'lua_rankings') },
  ],
}));

/* ---------------- GRUPO (submenu de ferramentas de grupo) ------------ */

nav.registerScreen('lua_grupo', () => ({
  id: 'lua_grupo',
  title: '👥 GRUPO',
  body: 'Ferramentas para grupos e membros.',
  listTitle: '👥 Grupo',
  buttonText: '🌙 Abrir',
  buttons: [
    { id: 'admin', text: '👑 Administração', description: 'Moderação e gestão do grupo', run: (c) => nav.openScreen(c, 'lua_admin_menu') },
    { id: 'members', text: '👥 Membros', description: 'Perfil, rank e XP', run: (c) => nav.openScreen(c, 'lua_members') },
    { id: 'xp', text: '⭐ XP & Level', description: 'Sua progressão no bot', run: (c) => nav.openScreen(c, 'lua_xp') },
    { id: 'rankings', text: '🏆 Rankings', description: 'Top usuários do bot', run: (c) => nav.openScreen(c, 'lua_rankings') },
  ],
}));

/* ---------------------- categorias de comandos ---------------------- */

categoryScreen('lua_commands', 'COMANDOS', '📋', 'general');
categoryScreen('lua_downloads', 'DOWNLOADS', '📥', 'downloads');
categoryScreen('lua_fun', 'DIVERSÃO', '🎮', 'fun');
categoryScreen('lua_members', 'MEMBROS', '👥', 'members');
categoryScreen('lua_utility', 'UTILIDADES', '🛠️', 'utility');
categoryScreen('lua_sticker', 'STICKERS', '🎨', 'stickers');
categoryScreen('lua_ia', 'IA & ASSISTENTE', '🤖', 'ai');
categoryScreen('lua_games', 'GAMES', '🎮', 'games');
categoryScreen('lua_anime', 'ANIME', '🍥', 'anime');
categoryScreen('lua_rpg', 'RPG & ECONOMIA', '⚔️', 'rpg');
categoryScreen('lua_admin_all', 'ADMIN — TODOS', '🛡️', 'admin');
categoryScreen('lua_life_all', 'LUA LIFE — TODOS', '🌎', 'life');
categoryScreen('lua_owner_all', 'DONO — TODOS', '👑', 'owner');
categoryScreen('lua_rankings_all', 'RANKINGS — TODOS', '🏆', 'rankings');

/* ----------------------- IA (menu dedicado) ------------------------- */

nav.registerScreen('lua_ia_menu', () => ({
  id: 'lua_ia_menu',
  title: '🤖 MENU IA',
  body: 'Assistente do Lua — local (offline) ou API externa, com fallback automático.',
  buttons: [
    { id: 'chat', text: '💬 Chat (exemplo)', run: run('ia', ['oi']) },
    { id: 'ask', text: '🧠 Perguntar (conta)', run: run('ia', ['quanto é 15% de 80']) },
    { id: 'code', text: '💻 Código', run: run('codigo', ['função JS']) },
    { id: 'translate', text: '🌎 Tradução', run: run('traduzir', ['inglês', 'bom dia']) },
    { id: 'summarize', text: '📄 Resumo', run: run('resumir') },
    { id: 'memory', text: '🧠 Memória', run: run('aimemory') },
    { id: 'status', text: 'ℹ️ Status', run: run('aistatus') },
  ],
}));

/* ---------------------- STICKER (menu dedicado) --------------------- */

nav.registerScreen('lua_sticker_menu', () => ({
  id: 'lua_sticker_menu',
  title: '🎨 STICKER LUA',
  body: 'Crie e edite figurinhas. Responda a uma mídia antes de tocar nos botões de foto/vídeo.',
  image: 'sticker',
  buttons: [
    { id: 'photo', text: '🖼️ Foto → Sticker', run: run('sticker') },
    { id: 'video', text: '🎬 Vídeo → Sticker', run: run('sticker') },
    { id: 'text', text: '📝 Texto → Sticker', run: run('stickertext', ['Lua Bot']) },
    { id: 'emoji', text: '😀 Emoji → Sticker', run: run('emojisticker', ['😂']) },
    { id: 'crop', text: '✂️ Cortar', run: run('crop') },
    { id: 'convert', text: '🔄 Converter (→ imagem)', run: run('toimg') },
    { id: 'tovideo', text: '🎥 Converter (→ vídeo)', run: run('tovideo') },
    { id: 'togif', text: '🎞️ Converter (→ GIF)', run: run('togif') },
    { id: 'resize', text: '📐 Redimensionar', run: run('resize') },
    { id: 'help', text: 'ℹ️ Ajuda', run: run('help', ['sticker']) },
  ],
}));

/* ------------------------ MÍDIA (menu dedicado) --------------------- */

nav.registerScreen('lua_media', () => ({
  id: 'lua_media',
  title: '🖼️ MÍDIA',
  body: 'Conversão e edição de mídia (responda a uma imagem/sticker para usar).',
  buttons: [
    { id: 'sticker', text: '🎨 Sticker', run: run('sticker') },
    { id: 'convert', text: '🔄 Converter (sticker → imagem)', run: run('toimg') },
    { id: 'crop', text: '✂️ Cortar', run: run('crop') },
    { id: 'resize', text: '📐 Redimensionar', run: run('resize') },
    { id: 'circle', text: '⭕ Circular', run: run('circle') },
    { id: 'text', text: '📝 Texto → Sticker', run: run('stickertext') },
    { id: 'emoji', text: '😀 Emoji → Sticker', run: run('emojisticker', ['😂']) },
    { id: 'reveal', text: '👁️ Revelar ver-uma-vez', run: run('revelar') },
    { id: 'info', text: '🔍 Informações', run: run('help', ['sticker']) },
  ],
}));

/* ----------------------- ADMIN (menu dedicado) ---------------------- */

nav.registerScreen('lua_admin_menu', () => ({
  id: 'lua_admin_menu',
  title: '👑 ADMINISTRAÇÃO',
  body: '🛡️ Moderação e gestão do grupo (comandos exigem admin).',
  image: 'admin',
  buttons: [
    { id: 'abrir', text: '🔓 Abrir grupo', run: run('abrirgrupo') },
    { id: 'fechar', text: '🔒 Fechar grupo', run: run('fechargrupo') },
    { id: 'admins', text: '👑 Admins', run: run('admins') },
    { id: 'membros', text: '👥 Membros', run: run('membros') },
    { id: 'inativos', text: '😴 Inativos', run: run('inativos') },
    { id: 'advertir', text: '⚠️ Advertir', run: run('advertir') },
    { id: 'warnings', text: '📋 Advertências', run: run('warnings') },
    { id: 'resetadv', text: '🧹 Limpar advertências', run: run('resetadv') },
    { id: 'mute', text: '🔇 Silenciar', run: run('mute') },
    { id: 'unmute', text: '🔊 Dessilenciar', run: run('unmute') },
    { id: 'kick', text: '👢 Expulsar', run: run('kick') },
    { id: 'ban', text: '🚫 Banir', run: run('ban') },
    { id: 'unban', text: '✅ Desbanir', run: run('unban') },
    { id: 'promover', text: '⬆️ Promover', run: run('promover') },
    { id: 'rebaixar', text: '⬇️ Rebaixar', run: run('rebaixar') },
    { id: 'marcar', text: '📢 Marcar todos', run: run('marcar') },
    { id: 'hidetag', text: '🤫 Marcar (hidetag)', run: run('hidetag') },
    { id: 'nome', text: '🏷️ Nome do grupo', run: run('nomegrupo') },
    { id: 'desc', text: '📝 Descrição', run: run('descgrupo') },
    { id: 'foto', text: '🖼️ Foto do grupo', run: run('foto') },
    { id: 'link', text: '🔗 Link do grupo', run: run('linkgrupo') },
    { id: 'revogar', text: '🔁 Revogar link', run: run('revogarlink') },
    { id: 'pedidos', text: '🔔 Pedidos de entrada', run: run('pedidos') },
    { id: 'aprovar', text: '✅ Aprovar', run: run('aprovar') },
    { id: 'aprovarall', text: '✅ Aprovar todos', run: run('aprovarall') },
    { id: 'rejeitar', text: '❌ Rejeitar', run: run('rejeitar') },
    { id: 'rejeitarall', text: '❌ Rejeitar todos', run: run('rejeitarall') },
    { id: 'welcome', text: '🌙 LUA WELCOME', run: (c) => nav.openScreen(c, 'lua_welcome') },
    { id: 'setwelcome', text: '🖊️ Definir boas-vindas', run: run('setwelcome') },
    { id: 'setgoodbye', text: '🖊️ Definir despedida', run: run('setgoodbye') },
    { id: 'automod', text: '🤖 AUTOMOD', run: (c) => nav.openScreen(c, 'lua_automod') },
    { id: 'all', text: '📋 Todos os comandos', run: (c) => nav.openScreen(c, 'lua_admin_all') },
  ],
}));

/* ----------------------- LUA WELCOME (menu dedicado) ----------------- */

nav.registerScreen('lua_welcome', () => ({
  id: 'lua_welcome',
  title: '🌙 LUA WELCOME',
  body: 'Cards visuais de entrada e saída do grupo (tema roxo/lua/neon).',
  image: 'admin',
  buttons: [
    { id: 'welcome', text: '🌙 Boas-vindas', run: run('welcome') },
    { id: 'goodbye', text: '🌑 Despedida', run: run('goodbye') },
    { id: 'templates', text: '🎨 Templates', run: run('welcome', ['template']) },
    { id: 'config', text: '⚙️ Configuração', run: run('welcome', ['status']) },
    { id: 'preview', text: '🖼️ Prévia da card', run: run('welcome', ['preview']) },
    { id: 'setwelcome', text: '🖊️ Mensagem de texto', run: run('setwelcome') },
    { id: 'setgoodbye', text: '🖊️ Despedida de texto', run: run('setgoodbye') },
  ],
}));

/* ----------------------- AUTOMOD (menu dedicado) -------------------- */

nav.registerScreen('lua_automod', () => ({
  id: 'lua_automod',
  title: '🤖 AUTOMOD V2',
  body: '🛡️ Sistema avançado de antis com ação configurável (ban/warn/mute/delete + purge).\n\nToque em um anti para configurar, ou use:\n!anti lista — ver todos\n!anti antilink on ban --purge 10 — bane e apaga 10 msgs\n!anti antipix on warn\n!anti antisticker on mute --purge',
  buttons: [
    { id: 'anti_lista', text: '📋 Listar todos antis', run: run('anti', ['lista']) },
    { id: 'antilink', text: '🔗 Anti-link', run: run('anti', ['config', 'antilink']) },
    { id: 'antiinvite', text: '📱 Anti-invite', run: run('anti', ['config', 'antiinvite']) },
    { id: 'antipix', text: '💸 Anti-pix/pagamento', run: run('anti', ['config', 'antipix']) },
    { id: 'antispam', text: '📨 Anti-spam', run: run('anti', ['config', 'antispam']) },
    { id: 'antiflood', text: '📢 Anti-flood', run: run('anti', ['config', 'antiflood']) },
    { id: 'antiimagem', text: '🖼️ Anti-imagem', run: run('anti', ['config', 'antiimagem']) },
    { id: 'antivideo', text: '🎬 Anti-vídeo', run: run('anti', ['config', 'antivideo']) },
    { id: 'antiaudio', text: '🎵 Anti-áudio', run: run('anti', ['config', 'antiaudio']) },
    { id: 'antidocumento', text: '📄 Anti-documento', run: run('anti', ['config', 'antidocumento']) },
    { id: 'antisticker', text: '🎨 Anti-sticker', run: run('anti', ['config', 'antisticker']) },
    { id: 'antiviewonce', text: '👁️ Anti-view-once', run: run('anti', ['config', 'antiviewonce']) },
    { id: 'antimedia', text: '🖼️ Anti-mídia', run: run('anti', ['config', 'antimedia']) },
    { id: 'antiparentese', text: '🔤 Anti-parêntese', run: run('anti', ['config', 'antiparentese']) },
    { id: 'antilocalizacao', text: '📍 Anti-localização', run: run('anti', ['config', 'antilocalizacao']) },
    { id: 'anticontato', text: '👤 Anti-contato', run: run('anti', ['config', 'anticontato']) },
    { id: 'antifake', text: '🌎 Anti-fake', run: run('anti', ['config', 'antifake']) },
    { id: 'antibot', text: '🤖 Anti-bot', run: run('anti', ['config', 'antibot']) },
    { id: 'antitoxic', text: '🤬 Anti-tóxico', run: run('anti', ['config', 'antitoxic']) },
    { id: 'antipalavrao', text: '🤬 Anti-palavrão', run: run('anti', ['config', 'antipalavrao']) },
    { id: 'apagar', text: '🧹 Apagar histórico', run: run('apagar') },
    { id: 'antireset', text: '♻️ Resetar todos', run: run('anti', ['reset']) },
  ],
}));

/* ------------------------ DONO (menu dedicado) ---------------------- */

nav.registerScreen('lua_owner', (ctx) => ({
  id: 'lua_owner',
  title: '👑 MENU DO DONO',
  body: 'Controle total do bot (apenas dono).',
  image: 'admin',
  buttons: [
    { id: 'info', text: '👤 Dono', run: run('owner') },
    { id: 'backup', text: '💾 Backup', run: run('backup') },
    { id: 'restore', text: '♻️ Restaurar', run: run('restore') },
    { id: 'restart', text: '🔄 Reiniciar', run: run('restart') },
    { id: 'shutdown', text: '⏹️ Desligar', run: run('shutdown') },
    { id: 'reload', text: '🔁 Recarregar comandos', run: run('reload') },
    { id: 'plugins', text: '🧩 Plugins', run: run('plugins') },
    { id: 'pluginsreload', text: '🧩 Recarregar plugins', run: run('pluginsreload') },
    { id: 'broadcast', text: '📢 Broadcast', run: run('broadcast') },
    { id: 'block', text: '🚫 Bloquear', run: run('block') },
    { id: 'unblock', text: '✅ Desbloquear', run: run('unblock') },
    { id: 'logs', text: '📜 Logs', run: run('logs') },
    { id: 'database', text: '🗄️ Banco de dados', run: run('database') },
    { id: 'system', text: '⚙️ Sistema', run: run('system') },
    { id: 'statsbot', text: '📊 Estatísticas', run: run('statsbot') },
    { id: 'uptime', text: '⏱️ Uptime', run: run('uptime') },
    { id: 'memory', text: '🧠 Memória', run: run('memory') },
    { id: 'lifeadmin', text: '🎮 Lua Life Admin', run: (c) => nav.openScreen(c, 'lua_admin') },
    { id: 'all', text: '📋 Todos os comandos', run: (c) => nav.openScreen(c, 'lua_owner_all') },
  ],
}));

nav.registerScreen('lua_config', () => ({
  id: 'lua_config',
  title: '⚙️ CONFIGURAÇÕES',
  body: 'Configurações do bot e dos botões.',
  image: 'main',
  buttons: [
    { id: 'config', text: '⚙️ Ver configuração', run: run('config') },
    { id: 'botao_on', text: '🔘 Botões: ligar', run: run('botao', ['on']) },
    { id: 'botao_off', text: '🔘 Botões: desligar', run: run('botao', ['off']) },
    { id: 'lermais', text: '📖 Ler mais', run: run('lermais') },
    { id: 'prefix', text: '🔤 Prefixo', run: run('prefix') },
  ],
}));

/* ------------------------ XP / ECONOMIA / RANK ---------------------- */

nav.registerScreen('lua_xp', (ctx) => ({
  id: 'lua_xp',
  title: '⭐ XP & LEVEL',
  body: 'Veja sua progressão no bot e no Lua Life.',
  image: 'profile',
  buttons: [
    { id: 'level', text: '📈 Meu nível', run: run('level') },
    { id: 'xp', text: '✨ Meu XP', run: run('xp') },
    { id: 'rank', text: '🏅 Minha posição', run: run('rank') },
    { id: 'vida', text: '🎮 Nível do Lua Life', run: run('vida') },
  ],
}));

nav.registerScreen('lua_economia', (ctx) => ({
  id: 'lua_economia',
  title: '💰 ECONOMIA',
  body: 'Sua vida financeira no Lua Life.',
  image: 'main',
  buttons: [
    { id: 'saldo', text: '💰 Saldo', run: run('saldo') },
    { id: 'banco', text: '🏦 Banco', run: run('banco') },
    { id: 'patrimonio', text: '📊 Patrimônio', run: run('patrimonio') },
    { id: 'mercado', text: '📈 Mercado', run: run('mercado') },
    { id: 'diario', text: '🎁 Presente diário', run: run('daily') },
    { id: 'cassino', text: '🎰 Cassino', run: run('cassino') },
    { id: 'tigrinho', text: '🐯 Tigrinho', run: run('tigrinho') },
    { id: 'cripto', text: '🪙 Criptomoedas', run: run('cripto') },
    { id: 'investir', text: '📈 Investir', run: run('investir') },
    { id: 'investimentos', text: '📊 Meus investimentos', run: run('investimentos') },
  ],
}));

nav.registerScreen('lua_rankings', (ctx) => {
  const types = ['xp', 'rpg', 'dinheiro', 'patrimonio', 'level', 'fazenda', 'conquistas'];
  const labels = { xp: '🏆 XP', rpg: '⚔️ RPG', dinheiro: '💰 Mais ricos', patrimonio: '🏠 Patrimônio', level: '⭐ Level', fazenda: '🌾 Fazenda', conquistas: '🏆 Conquistas' };
  return {
    id: 'lua_rankings',
    title: '🏆 RANKINGS',
    body: 'Escolha o ranking.',
    image: 'main',
    buttons: [
      ...types.map((t) => ({ id: t, text: labels[t], run: run('ranking', [t]) })),
      { id: 'all', text: '📋 Todos os comandos', run: (c) => nav.openScreen(c, 'lua_rankings_all') },
    ],
  };
});

/* --------------------------- LUA LIFE ------------------------------ */

nav.registerScreen('lua_life', (ctx) => ({
  id: 'lua_life',
  title: '🎮 LUA LIFE',
  body: 'Sua vida virtual no WhatsApp.',
  image: 'life',
  buttons: [
    { id: 'perfil', text: '👤 PERFIL', run: run('vida') },
    { id: 'trabalho', text: '💼 TRABALHO', run: run('trabalho') },
    { id: 'mineracao', text: '⛏️ MINERAÇÃO', run: run('minerar') },
    { id: 'pesca', text: '🎣 PESCA', run: run('pescar') },
    { id: 'fazenda', text: '🌾 FAZENDA', run: run('fazenda') },
    { id: 'animais', text: '🐔 ANIMAIS', run: run('animais') },
    { id: 'casa', text: '🏠 CASA', run: run('propriedades') },
    { id: 'veiculos', text: '🚗 VEÍCULOS', run: run('veiculos') },
    { id: 'loja', text: '🏪 LOJA', run: run('loja') },
    { id: 'inventario', text: '🎒 INVENTÁRIO', run: run('inventario') },
    { id: 'economia', text: '💰 ECONOMIA', run: (c) => nav.openScreen(c, 'lua_economia') },
    { id: 'banco', text: '🏦 BANCO', run: run('banco') },
    { id: 'mercado', text: '📈 MERCADO', run: run('mercado') },
    { id: 'conquistas', text: '🏆 CONQUISTAS', run: run('conquistas') },
    { id: 'missoes', text: '📜 MISSÕES', run: run('missoes') },
    { id: 'ranking', text: '🏅 RANKING', run: (c) => nav.openScreen(c, 'lua_rankings') },
    { id: 'all', text: '📋 Todos os comandos', run: (c) => nav.openScreen(c, 'lua_life_all') },
  ],
}));

/* ------------------------- LUA ADMIN (dono) ------------------------- */

nav.registerScreen('lua_admin', (ctx) => ({
  id: 'lua_admin',
  title: '👑 LUA ADMIN',
  body: 'Painel administrativo do Lua Life (apenas dono).',
  image: 'admin',
  buttons: [
    { id: 'players', text: '👥 Jogadores', run: run('player') },
    { id: 'economia', text: '💰 Economia', run: run('economia') },
    { id: 'mercado', text: '🏪 Mercado', run: run('mercado') },
    { id: 'eventos', text: '🎮 Eventos', run: run('evento') },
    { id: 'stats', text: '📊 Estatísticas', run: run('economia') },
    { id: 'logs', text: '📜 Logs', run: run('economy') },
  ],
}));

/* --------------------------- pré-carrega ---------------------------- */

// garante que os handlers legacy (lua_commands, lua_config…) continuem ativos
module.exports = nav;
