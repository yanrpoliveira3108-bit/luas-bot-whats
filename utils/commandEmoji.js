/**
 * utils/commandEmoji.js — emoji por comando/categoria para os menus.
 *
 * Os menus gerados a partir do registro (categoryMenu, categoryScreen,
 * sendCategoryAsText) usam este módulo para mostrar cada comando com um
 * ícone. Falls back para o emoji da categoria quando o comando não tem um
 * próprio — nunca quebra o menu.
 */

'use strict';

const CATEGORY_EMOJI = {
  admin: '🛡️',
  ai: '🤖',
  anime: '🍥',
  downloads: '📥',
  fun: '😂',
  games: '🎮',
  general: '⚙️',
  life: '🌎',
  members: '👥',
  owner: '👑',
  rankings: '🏆',
  rpg: '⚔️',
  stickers: '🎨',
  utility: '🛠️',
};

const COMMAND_EMOJI = {
  // general
  menu: '🏠', menucompleto: '📋', help: '❓', info: 'ℹ️', id: '🆔', ping: '🏓',
  config: '⚙️', botao: '🔘', temahtml: '🎨', modohtml: '🖥️', lermais: '📖', prefix: '🔤', owner: '👤',
  menuadm: '🛡️', menuautomod: '🤖', menudono: '👑', menulifeadmin: '👑',
  menudownload: '📥', menurpg: '⚔️', menulife: '🌎', menuanime: '🍥',
  menugames: '🎮', menuzoeira: '😂', menuutil: '🛠️', menumembros: '👥',
  menuia: '🤖', menusticker: '🎨', menumedia: '🖼️',
  // admin
  abrirgrupo: '🔓', fechargrupo: '🔒', horariogrupo: '⏰', admins: '👑', membros: '👥', inativos: '😴',
  advertir: '⚠️', warnings: '📋', resetadv: '🧹', rmadv: '🧹', mute: '🔇',
  unmute: '🔊', kick: '👢', ban: '🚫', unban: '✅', promover: '⬆️', rebaixar: '⬇️',
  marcar: '📢', hidetag: '🤫', nomegrupo: '🏷️', descgrupo: '📝', foto: '🖼️',
  linkgrupo: '🔗', revogarlink: '🔁', pedidos: '🔔', aprovar: '✅', aprovarall: '✅',
  rejeitar: '❌', rejeitarall: '❌', welcome: '🌙', bemvindo: '🌙', goodbye: '🌑', despedida: '🌑',
  setwelcome: '🖊️', setgoodbye: '🖊️',
  grupo: '🏠', adicionar: '➕', x9: '🕵️',
  antilink: '🔗', antispam: '🗣️', antiflood: '🌊', antifake: '🛂', antibot: '🤖',
  antiparentese: '🧹', antiinvite: '📨', antimedia: '🖼️', antiimagem: '🖼️',
  antivideo: '🎬', antiaudio: '🎵', antidocumento: '📄', antisticker: '🎨',
  antiviewonce: '👁️', antipix: '💸', antilocalizacao: '📍', anticontato: '👤',
  // life
  vida: '👤', trabalho: '💼', minerar: '⛏️', pescar: '🎣', comer: '🍎', descansar: '😴',
  abrirempresa: '🏢', empresas: '🏢', contratar: '🤝', coletar: '📦', atributos: '📊',
  clima: '⛅', evento: '🎮', event: '🎮', missoes: '📜', conquistas: '🏆',
  economia: '💰', economylog: '📜', mercado: '📈', precos: '💹', patrimonio: '🏠',
  ofertar: '🏷️', compraroferta: '💰', minhasofertas: '📋', cancelaroferta: '❌',
  pagar: '💸', presente: '🎁', loteria: '🎰', comprarcasa: '🏠', comprarterreno: '🏞️',
  propriedades: '🏠', melhorar: '⬆️', veiculos: '🚗', galinheiro: '🐔', estabulo: '🐴',
  venderpesca: '💰', player: '👥', givecoin: '💰', giveitem: '🎁', removeitem: '🗑️',
  setlevel: '⭐', setmoney: '💰', setprice: '💹', setxp: '✨',
  // rpg
  rpg: '⚔️', perfilrpg: '🎮', saldo: '💰', banco: '🏦', depositar: '📥', sacar: '📤',
  transferir: '🔁', fazenda: '🌾', plantar: '🌱', colher: '🌾', regar: '💧',
  compraranimal: '🐔', animais: '🐄', alimentar: '🍖', venderanimal: '💰',
  empregos: '💼', emprego: '💼', trabalhar: '💼', carreira: '📈', daily: '🎁',
  semanal: '🗓️', rankrpg: '🏆', loja: '🏪', comprar: '🛒', vender: '💰',
  inventario: '🎒', usar: '🧪',
  cassino: '🎰', casino: '🎰', apostas: '🎰', apostar: '🎯', bet: '🎯',
  coinflip: '🪙', caraoucoroa: '🪙', flip: '🪙', dados: '🎲', dice: '🎲',
  rolardado: '🎲', roleta: '🎡', roulette: '🎡', slots: '🕹️', cacaniquel: '🕹️',
  cripto: '🪙', criptomoedas: '🪙', crypto: '🪙', comprarcripto: '💹',
  comprarcrypto: '💹', buycrypto: '💹', vendercripto: '💰', vendercrypto: '💰',
  sellcrypto: '💰', carteiracripto: '💼', minhascriptos: '💼', cryptowallet: '💼',
  investir: '📈', investimento: '📈', aplicar: '📈', resgatar: '🏦',
  resgate: '🏦', sacarinvestimento: '🏦', investimentos: '📊', fundo: '📊',
  meuinvestimento: '📊',
  tigrinho: '🐯',
  // stickers
  sticker: '🎨', stickerimg: '🖼️', stickertext: '📝', txtsticker: '📝',
  toimg: '🔄', tovideo: '🎥', togif: '🎞️', crop: '✂️', resize: '📐', circle: '⭕',
  emoji: '😀', emojisticker: '😀', pack: '📦', take: '📷',
  // ai
  ia: '🤖', codigo: '💻', traduzir: '🌎', resumir: '📄', aimemory: '🧠', aistatus: 'ℹ️',
  // anime
  anime: '🍥', animeinfo: 'ℹ️', animequiz: '🧠', animerandom: '🎲', husbando: '💘',
  waifu: '💖', manga: '📖', otaku: '🎌', personagem: '👤', quoteanime: '💬',
  // downloads
  youtube: '▶️', ytmp3: '🎵', ytmp4: '🎬', play: '🎵', download: '📥',
  instagram: '📸', tiktok: '🎵', facebook: '📘', pinterest: '📌', twitter: '🐦',
  reddit: '👽', imagem: '🖼️', video: '🎬', audio: '🎵', revelar: '👁️',
  // fun
  beijo: '💋', abraco: '🤗', tapinha: '👋', cafune: '🫳', cumprimento: '👋',
  ship: '💘', casal: '💑', meme: '😹', memeuser: '😹', piada: '😂', charada: '🧩',
  '8ball': '🎱', conselho: '💡', fato: '📌', horoscopo: '🔮', sorteio: '🎟️',
  escolher: '🎯', verdadeoudesafio: '🎲', verdade: '🎲', desafio: '🎲', elogio: '🌟',
  roast: '🔥', zoar: '🤪', trollar: '😈', gado: '🐮', burro: '🐴', gaymer: '🌈',
  sigma: '🗿', based: '😎', inteligente: '🧠', chance: '🎲', sorte: '🍀', azar: '☠️',
  eu: '🙋', caption: '📝', karma: '⚖️', rankzueira: '🏆',
  // games
  quiz: '🧠', jokenpo: '✊', dado: '🎲', moeda: '🪙', adivinhacao: '🔢',
  cacatesouro: '🗺️', batalha: '⚔️', memoria: '🧠', matematica: '➗', games: '🎮',
  // members
  perfil: '👤', xp: '✨', level: '📈', rank: '🏅', afk: '💤', voltei: '🏃',
  avatar: '🖼️', banner: '🖼️', bio: '📝', sobre: 'ℹ️', userinfo: '👤', top: '🏆',
  atividade: '📊', tempo: '⏱️', regras: '📜', reportar: '⚠️', sugerir: '💡',
  reputacao: '⭐', badges: '🎖️',
  // owner
  backup: '💾', restore: '♻️', restart: '🔄', shutdown: '⏻', uptime: '⏱️',
  statsbot: '📊', system: '🖥️', database: '🗄️', logs: '📜', memory: '🧠',
  plugins: '🔌', pluginsreload: '🔁', reload: '🔁', broadcast: '📣', block: '🚫',
  unblock: '✅', eval: '🧪',
  // utility
  calc: '🧮', base64: '🔤', cep: '📮', cnpj: '🏢', qr: '📱', senha: '🔑',
  uuid: '🆔', data: '📅', hora: '🕐', fuso: '🌍', porcentagem: '💯', botinfo: '🤖',
  // rankings
  ranking: '🏆', topxp: '✨', topnivel: '⭐', topricho: '💰', topfazenda: '🌾',
};

/**
 * Emoji de um comando (aceita objeto {category,name} ou string).
 * @returns {string}
 */
function commandEmoji(cmd) {
  const name = typeof cmd === 'string' ? cmd : cmd && cmd.name;
  const category = typeof cmd === 'object' ? cmd.category : '';
  if (name && COMMAND_EMOJI[name]) return COMMAND_EMOJI[name];
  return (category && CATEGORY_EMOJI[category]) || '▸';
}

module.exports = { commandEmoji, CATEGORY_EMOJI, COMMAND_EMOJI };
