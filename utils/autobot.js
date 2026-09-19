/**
 * utils/autobot.js — núcleo do sistema AutoBot.
 *
 * PROBLEMA HISTÓRICO: cada recurso tinha seu próprio jeito de ligar/desligar
 * (`filters.x`, `anti[x].enabled`, `welcome_state.x`, ajustes soltos em
 * `groups.settings`), cada um com leitura/gravação própria, sem cache e sem
 * padrão de resposta. Resultado: opção ligada que não fazia nada, opção
 * desligada que continuava agindo e comandos que respondiam coisas diferentes.
 *
 * SOLUÇÃO: UM registro único de recursos (abaixo) + UM caminho de escrita e
 * leitura (abaixo). Todo recurso do AutoBot:
 *
 *   • liga/desliga com o mesmo comando padrão (`!<recurso> on|off`)
 *   • grava na hora no banco (grupo → groups.settings.autobot; global → settings)
 *   • mantém compatibilidade com as chaves antigas (`filters`, `anti`, welcome)
 *   • passa pelo cache de settings do grupo (leitura O(1) por mensagem)
 *   • é lido direto da memória em tempo de execução — NUNCA precisa reiniciar
 *   • responde sempre "✅ Recurso ativado." / "❌ Recurso desativado."
 *
 * O status (`!statusgrupo`) é gerado a partir deste mesmo registro, então
 * nunca fica "dessincronizado" do que o bot realmente executa.
 */

'use strict';

const groups = require('../database/groups');
const settings = require('../database/settings');
const logger = require('./logger').child('autobot');

/* ------------------------------ seções -------------------------------- */

const SECTIONS = [
  { id: 'protecoes', title: '🔒 PROTEÇÕES' },
  { id: 'midia', title: '🚫 ANTI MÍDIA' },
  { id: 'bemvindo', title: '👋 BEM-VINDO' },
  { id: 'automacao', title: '🤖 AUTOMAÇÃO' },
  { id: 'outros', title: '📋 OUTROS' },
  { id: 'global', title: '🌐 GLOBAL' },
];

/* ----------------------------- registro ------------------------------- */

/**
 * Metadados de um recurso.
 * @param {string} section  seção do painel
 * @param {string} scope    'group' | 'global' | 'welcome'
 * @param {string} id       chave canônica (também é o id do anti/detector)
 * @param {string} label    nome exibido no status
 * @param {object} o        { cmd, aliases, desc, usage, legacy, welcomeKind,
 *                            anti, event, options, ownerOnly, args }
 */
function feat(section, scope, id, label, o = {}) {
  return {
    id,
    label,
    section,
    scope,
    cmd: o.cmd === undefined ? id : o.cmd,
    aliases: o.aliases || [],
    desc: o.desc || '',
    usage: o.usage || '',
    // chave legada espelhada (filters.<legacy> / anti.<legacy>)
    legacy: o.legacy === undefined ? null : o.legacy,
    // comando legado que já controla este recurso (não geramos outro)
    legacyCmd: o.legacyCmd || null,
    welcomeKind: o.welcomeKind || null,
    anti: !!o.anti,
    // evento que dispara o recurso (documentação + testes)
    event: o.event || 'message',
    options: o.options || null,
    ownerOnly: !!o.ownerOnly,
    toggleOwnerOnly: !!o.toggleOwnerOnly,
    args: !!o.args,
    generated: o.generated !== false,
  };
}

const GRP = 'group';
const GLB = 'global';

const FEATURES = [
  /* ─────────────────────── 🔒 PROTEÇÕES ─────────────────────── */
  feat('protecoes', GRP, 'antilink', 'Anti Link', {
    cmd: 'antilink',
    legacy: 'antilink',
    legacyCmd: 'antilink',
    generated: false,
    anti: true,
    desc: 'Bloqueia links (http/https/www) de não-admins.',
    usage: '!antilink on|off | !antilink whitelist add|remove|list <domínio>',
    args: true,
  }),
  feat('protecoes', GRP, 'antilink2', 'Anti Link 2', {
    legacy: null,
    anti: true,
    desc: 'Bloqueio reforçado: links sem protocolo, encurtadores, ofuscados (hxxp, site[.]com) e domínios soltos.',
    usage: '!antilink2 on|off',
  }),
  feat('protecoes', GRP, 'antilinkgp', 'Anti Link GP', {
    aliases: ['antilinkgrupo', 'anticonvite'],
    legacy: 'antiinvite',
    legacyCmd: 'antiinvite',
    anti: true,
    desc: 'Bloqueia links de convite de grupo/canal do WhatsApp (chat.whatsapp.com, wa.me).',
    usage: '!antilinkgp on|off',
  }),
  feat('protecoes', GRP, 'antipalavrao', 'Anti Palavrão', {
    legacy: 'antipalavrao',
    anti: true,
    desc: 'Apaga mensagens com palavrões/profanidades.',
    usage: '!antipalavrao on|off',
  }),
  feat('protecoes', GRP, 'antifake', 'Anti Fake', {
    legacy: 'antifake',
    legacyCmd: 'antifake',
    generated: false,
    anti: true,
    event: 'join',
    desc: 'Marca/remove números estrangeiros (fakes) que entram no grupo.',
    usage: '!antifake on|off',
  }),
  feat('protecoes', GRP, 'anticatalogo', 'Anti Catálogo', {
    anti: true,
    desc: 'Apaga catálogos de produtos e links de catálogo (wa.me/c/...).',
    usage: '!anticatalogo on|off',
  }),
  feat('protecoes', GRP, 'antilocalizacao', 'Anti Localização', {
    legacy: 'antilocalizacao',
    legacyCmd: 'antilocalizacao',
    generated: false,
    anti: true,
    desc: 'Apaga localizações fixas enviadas no grupo.',
    usage: '!antilocalizacao on|off',
  }),
  feat('protecoes', GRP, 'limitecaracteres', 'Limite Caracteres', {
    options: { limite: 1200 },
    anti: true,
    desc: 'Limita o tamanho de textos/legendas (padrão 1200 caracteres).',
    usage: '!limitecaracteres on|off | !limitecaracteres <n>',
    args: true,
  }),
  feat('protecoes', GRP, 'antispam', 'Anti Spam', {
    legacy: 'antispam',
    legacyCmd: 'antispam',
    generated: false,
    anti: true,
    desc: 'Apaga mensagens repetidas em sequência.',
    usage: '!antispam on|off',
  }),
  feat('protecoes', GRP, 'antistatus', 'Anti Status', {
    anti: true,
    desc: 'Apaga respostas/encaminhamentos de status e "menções de status".',
    usage: '!antistatus on|off',
  }),
  feat('protecoes', GRP, 'antiflood', 'Anti Flood', {
    legacy: 'antiflood',
    legacyCmd: 'antiflood',
    generated: false,
    anti: true,
    desc: 'Bloqueia rajadas de mensagens (muitas msgs em pouco tempo).',
    usage: '!antiflood on|off',
  }),
  feat('protecoes', GRP, 'antiparentese', 'Anti Símbolos', {
    legacy: 'antiparentese',
    legacyCmd: 'antiparentese',
    generated: false,
    anti: true,
    desc: 'Apaga mensagens dominadas por símbolos.',
    usage: '!antiparentese on|off',
  }),
  feat('protecoes', GRP, 'antipix', 'Anti Pagamento', {
    legacy: 'antipix',
    legacyCmd: 'antipix',
    generated: false,
    anti: true,
    desc: 'Detecta cobranças: PIX, links de pagamento, comprovantes, QR de pagamento e mensagens nativas de pagamento do WhatsApp.',
    usage: '!antipix on|off',
  }),
  feat('protecoes', GRP, 'antibot', 'Anti Bot', {
    legacy: 'antibot',
    legacyCmd: 'antibot',
    generated: false,
    anti: true,
    event: 'join+message',
    desc: 'Bloqueia/marca possíveis bots (nome suspeito ao entrar e mensagens de bot do WhatsApp).',
    usage: '!antibot on|off',
  }),
  feat('protecoes', GRP, 'antienquete', 'Anti Enquete', {
    anti: true,
    desc: 'Apaga enquetes e resultados de enquete.',
    usage: '!antienquete on|off',
  }),
  feat('protecoes', GRP, 'anticomunidade', 'Anti Comunidade', {
    anti: true,
    desc: 'Apaga conteúdo de comunidade (comentários/anúncios) e link de comunidade.',
    usage: '!anticomunidade on|off',
  }),
  feat('protecoes', GRP, 'antimencaomassa', 'Anti Menção em Massa', {
    options: { limite: 5 },
    anti: true,
    desc: 'Apaga mensagens que marcam muita gente de uma vez (padrão: 5+).',
    usage: '!antimencaomassa on|off | !antimencaomassa <n>',
    args: true,
  }),
  feat('protecoes', GRP, 'antiencaminhamento', 'Anti Encaminhamento', {
    anti: true,
    desc: 'Apaga mensagens encaminhadas (forward).',
    usage: '!antiencaminhamento on|off',
  }),
  feat('protecoes', GRP, 'antitextogigante', 'Anti Texto Gigante', {
    options: { limite: 4000 },
    anti: true,
    desc: 'Apaga textos/legendas absurdamente longos (padrão 4000 caracteres).',
    usage: '!antitextogigante on|off | !antitextogigante <n>',
    args: true,
  }),
  feat('protecoes', GRP, 'antiemojispam', 'Anti Emoji Spam', {
    options: { limite: 10 },
    anti: true,
    desc: 'Apaga mensagens com excesso de emojis (padrão 10+).',
    usage: '!antiemojispam on|off | !antiemojispam <n>',
    args: true,
  }),
  feat('protecoes', GRP, 'antieditarmensagem', 'Anti Editar Msg', {
    aliases: ['antiedit'],
    anti: true,
    event: 'message-edit',
    desc: 'Apaga a mensagem quando o autor a edita depois de enviada.',
    usage: '!antieditarmensagem on|off',
  }),
  feat('protecoes', GRP, 'antiapagarmensagem', 'Anti Apagar Msg', {
    aliases: ['antiapagar', 'antirevoke'],
    anti: true,
    event: 'message-revoke',
    desc: 'Aplica a ação configurada quando alguém apaga ("apagar para todos") uma mensagem.',
    usage: '!antiapagarmensagem on|off',
  }),
  feat('protecoes', GRP, 'antireacao', 'Anti Reação', {
    anti: true,
    event: 'reaction',
    desc: 'Remove reações de não-admins (a reação some do chat).',
    usage: '!antireacao on|off',
  }),
  feat('protecoes', GRP, 'antichamada', 'Anti Chamada', {
    anti: true,
    event: 'call',
    desc: 'Rejeita chamadas de vídeo/voz e aplica a ação configurada.',
    usage: '!antichamada on|off',
    ownerOnly: false,
  }),
  feat('protecoes', GRP, 'antitoxic', 'Anti Toxicidade', {
    legacy: 'antitoxic',
    anti: true,
    desc: 'Apaga conteúdo tóxico grave (ofensas pesadas).',
    usage: '!antitoxic on|off',
  }),

  /* ─────────────────────── 🚫 ANTI MÍDIA ────────────────────── */
  feat('midia', GRP, 'antivideo', 'Anti Vídeo', {
    legacy: 'antivideo',
    legacyCmd: 'antivideo',
    generated: false,
    anti: true,
    desc: 'Apaga vídeos de não-admins.',
    usage: '!antivideo on|off',
  }),
  feat('midia', GRP, 'antiimagem', 'Anti Imagem', {
    legacy: 'antiimagem',
    legacyCmd: 'antiimagem',
    generated: false,
    anti: true,
    desc: 'Apaga imagens/fotos de não-admins.',
    usage: '!antiimagem on|off',
  }),
  feat('midia', GRP, 'antiaudio', 'Anti Áudio', {
    legacy: 'antiaudio',
    legacyCmd: 'antiaudio',
    generated: false,
    anti: true,
    desc: 'Apaga áudios de não-admins.',
    usage: '!antiaudio on|off',
  }),
  feat('midia', GRP, 'antidocumento', 'Anti Documento', {
    legacy: 'antidocumento',
    legacyCmd: 'antidocumento',
    generated: false,
    anti: true,
    desc: 'Apaga documentos/arquivos de não-admins.',
    usage: '!antidocumento on|off',
  }),
  feat('midia', GRP, 'anticontato', 'Anti Contato', {
    legacy: 'anticontato',
    legacyCmd: 'anticontato',
    generated: false,
    anti: true,
    desc: 'Apaga cartões de contato.',
    usage: '!anticontato on|off',
  }),
  feat('midia', GRP, 'antisticker', 'Anti Sticker', {
    legacy: 'antisticker',
    legacyCmd: 'antisticker',
    generated: false,
    anti: true,
    desc: 'Apaga figurinhas de não-admins.',
    usage: '!antisticker on|off',
  }),
  feat('midia', GRP, 'antimedia', 'Anti Mídia', {
    legacy: 'antimedia',
    legacyCmd: 'antimedia',
    generated: false,
    anti: true,
    desc: 'Apaga QUALQUER mídia (imagem, vídeo, áudio, doc, sticker...).',
    usage: '!antimedia on|off',
  }),
  feat('midia', GRP, 'antiviewonce', 'Anti View Once', {
    legacy: 'antiviewonce',
    legacyCmd: 'antiviewonce',
    generated: false,
    anti: true,
    desc: 'Apaga mídias de visualização única.',
    usage: '!antiviewonce on|off',
  }),
  feat('midia', GRP, 'antigif', 'Anti GIF', {
    anti: true,
    desc: 'Apaga GIFs animados.',
    usage: '!antigif on|off',
  }),
  feat('midia', GRP, 'antilocalizacaotemp', 'Anti Localização Real', {
    aliases: ['antilocalizacaotempo', 'antilocalreal'],
    anti: true,
    desc: 'Apaga localização em tempo real (live location).',
    usage: '!antilocalizacaotemp on|off',
  }),
  feat('midia', GRP, 'antilive', 'Anti Live', {
    anti: true,
    desc: 'Apaga convites de evento/live do WhatsApp.',
    usage: '!antilive on|off',
  }),
  feat('midia', GRP, 'anticanal', 'Anti Canal', {
    anti: true,
    desc: 'Apaga mensagens encaminhadas de canais e convites de canal.',
    usage: '!anticanal on|off',
  }),
  feat('midia', GRP, 'antiapk', 'Anti APK', {
    aliases: ['antidocumentoapk', 'antidocapk'],
    anti: true,
    desc: 'Apaga documentos .apk (anti documento APK).',
    usage: '!antiapk on|off',
  }),
  feat('midia', GRP, 'antizip', 'Anti ZIP', {
    aliases: ['antirar'],
    anti: true,
    desc: 'Apaga arquivos compactados (.zip, .rar, .7z, .tar).',
    usage: '!antizip on|off',
  }),
  feat('midia', GRP, 'antiexe', 'Anti EXE', {
    anti: true,
    desc: 'Apaga executáveis (.exe, .bat, .cmd, .msi, .sh, .jar).',
    usage: '!antiexe on|off',
  }),
  feat('midia', GRP, 'antipdf', 'Anti PDF', {
    anti: true,
    desc: 'Apaga documentos PDF.',
    usage: '!antipdf on|off',
  }),

  /* ─────────────────────── 👋 BEM-VINDO ─────────────────────── */
  feat('bemvindo', 'welcome', 'bemvindo1', 'Bemvindo1', {
    welcomeKind: 'text-welcome',
    legacyCmd: 'setwelcome',
    event: 'join',
    desc: 'Mensagem TEXTUAL de boas-vindas ({user} é substituído).',
    usage: '!bemvindo1 on|off | !setwelcome <mensagem>',
  }),
  feat('bemvindo', 'welcome', 'bemvindo2', 'Bemvindo2', {
    welcomeKind: 'card-welcome',
    legacyCmd: 'welcome',
    event: 'join',
    desc: 'CARD visual de boas-vindas (imagem).',
    usage: '!bemvindo2 on|off | !welcome on|off',
  }),
  feat('bemvindo', 'welcome', 'saiu1', 'Saiu1', {
    welcomeKind: 'text-goodbye',
    legacyCmd: 'setgoodbye',
    event: 'leave',
    desc: 'Mensagem TEXTUAL de despedida.',
    usage: '!saiu1 on|off | !setgoodbye <mensagem>',
  }),
  feat('bemvindo', 'welcome', 'saiu2', 'Saiu2', {
    welcomeKind: 'card-goodbye',
    legacyCmd: 'goodbye',
    event: 'leave',
    desc: 'CARD visual de despedida (imagem).',
    usage: '!saiu2 on|off | !goodbye on|off',
  }),

  /* ─────────────────────── 🤖 AUTOMAÇÃO ─────────────────────── */
  feat('automacao', GRP, 'autofigu', 'Autofigu', {
    event: 'automation',
    desc: 'Converte automaticamente imagens/vídeos/GIFs recebidos em figurinha.',
    usage: '!autofigu on|off',
  }),
  feat('automacao', GRP, 'autoresposta', 'AutoResposta', {
    args: true,
    event: 'automation',
    desc: 'Responde automaticamente a gatilhos definidos.',
    usage: '!autoresposta on|off | !autoresposta add <gatilho> = <resposta> | !autoresposta list | !autoresposta del <n|gatilho> | !autoresposta clear',
  }),
  feat('automacao', GRP, 'simih', 'Simih', {
    event: 'automation',
    desc: 'Chat automático estilo SimSimi: responde as mensagens do grupo com IA local.',
    usage: '!simih on|off',
  }),
  feat('automacao', GRP, 'simih2', 'Simih2', {
    event: 'automation',
    desc: 'Chat automático moderado: só responde quando o bot é citado (menção/resposta).',
    usage: '!simih2 on|off',
  }),
  feat('automacao', GRP, 'iaaleatory', 'IA Aleatory', {
    aliases: ['iarandom'],
    options: { chance: 3 },
    args: true,
    event: 'automation',
    desc: 'Participa de vez em quando com uma resposta de IA (padrão: 3% das mensagens).',
    usage: '!iaaleatory on|off | !iaaleatory <porcentagem>',
  }),
  feat('automacao', GRP, 'autobaixar', 'Auto Baixar', {
    aliases: ['autodownload'],
    event: 'automation',
    desc: 'Baixa automaticamente mídia de links suportados (YouTube, TikTok, Instagram, Facebook, Twitter, Pinterest).',
    usage: '!autobaixar on|off',
  }),

  /* ───────────────────────── 📋 OUTROS ──────────────────────── */
  feat('outros', GRP, 'cargox9', 'Cargo X9', {
    args: true,
    desc: 'Cargo de moderador X9: membros marcados podem usar comandos de admin.',
    usage: '!cargox9 on|off | !cargox9 add|remove @membro | !cargox9 list',
  }),
  feat('outros', GRP, 'x9visaounica', 'Visu Única', {
    aliases: ['visaounica'],
    event: 'message',
    desc: 'Revela automaticamente mídias de visualização única no grupo.',
    usage: '!x9visaounica on|off',
  }),
  feat('outros', GRP, 'modobrincadeira', 'Modo Brincadeira', {
    aliases: ['brincadeira'],
    event: 'automation',
    desc: 'Modo zoeira: o bot reage/participa das conversas de vez em quando.',
    usage: '!modobrincadeira on|off',
  }),
  feat('outros', GRP, 'limitarcomandos', 'Limitar Comandos', {
    options: { limite: 10, janela: 60 },
    args: true,
    event: 'command',
    desc: 'Limita quantos comandos cada membro pode usar por minuto (padrão 10).',
    usage: '!limitarcomandos on|off | !limitarcomandos <n>',
  }),
  feat('outros', GRP, 'modogold', 'Modo Gold', {
    args: true,
    desc: 'Modo Gold: membros gold ignoram cooldown e ganham selo ✨.',
    usage: '!modogold on|off | !modogold add|remove @membro | !modogold list',
  }),

  /* ───────────────────────── 🌐 GLOBAL ──────────────────────── */
  feat('global', GLB, 'antipv', 'Anti PV', {
    ownerOnly: true,
    event: 'private',
    desc: 'Avisa (uma vez por dia) quem chama o bot no privado e ignora a conversa.',
    usage: '!antipv on|off',
  }),
  feat('global', GLB, 'antipv2', 'Anti PV2', {
    ownerOnly: true,
    event: 'private',
    desc: 'Ignora silenciosamente qualquer mensagem no privado.',
    usage: '!antipv2 on|off',
  }),
  feat('global', GLB, 'antipv3', 'Anti PV3', {
    ownerOnly: true,
    event: 'private',
    desc: 'Bloqueia quem chama no privado e avisa o dono.',
    usage: '!antipv3 on|off',
  }),
  feat('global', GLB, 'aniversario', 'Aniversário', {
    ownerOnly: false,
    toggleOwnerOnly: true,
    args: true,
    event: 'schedule',
    desc: 'Avisa o grupo no aniversário dos membros (os membros cadastram com !aniversario dd/mm).',
    usage: '!aniversario on|off | !aniversario dd/mm',
  }),
  feat('global', GLB, 'modoregistro', 'Modo Registro', {
    ownerOnly: true,
    event: 'command',
    desc: 'Só usuários registrados usam os comandos (!registrar / !unregistrar).',
    usage: '!modoregistro on|off',
  }),
];

/* ------------------------------ índices -------------------------------- */

const byId = new Map();
const byTrigger = new Map();

for (const f of FEATURES) {
  if (byId.has(f.id)) throw new Error(`autobot: id duplicado "${f.id}"`);
  byId.set(f.id, f);
  const triggers = [f.cmd, ...f.aliases].filter(Boolean);
  for (const t of triggers) {
    if (byTrigger.has(t) && byTrigger.get(t) !== f.id) {
      throw new Error(`autobot: comando duplicado "${t}" (${byTrigger.get(t)} x ${f.id})`);
    }
    byTrigger.set(t, f.id);
  }
}

/* ---------------- aliases de tipos de anti (compatibilidade) ------------ */

// nomes antigos aceitos em `!anti <tipo>` que apontam para o id novo
const ANTI_ALIASES = {
  antiinvite: 'antilinkgp',
};

function resolve(idOrAlias) {
  const key = String(idOrAlias || '').toLowerCase().trim().replace(/^!/, '');
  if (byId.has(key)) return byId.get(key);
  const canonical = ANTI_ALIASES[key];
  if (canonical && byId.has(canonical)) return byId.get(canonical);
  const byCmd = byTrigger.get(key);
  return byCmd ? byId.get(byCmd) : null;
}

function all() {
  return FEATURES.slice();
}

function bySection(sectionId) {
  return FEATURES.filter((f) => f.section === sectionId);
}

/** Recursos com ação configurável (delete/warn/mute/ban/kick + purge). */
function antiFeatures() {
  return FEATURES.filter((f) => f.anti);
}

function antiIds() {
  return antiFeatures().map((f) => f.id);
}

/* ------------------------------ leitura -------------------------------- */

// cache dos recursos globais (invalidado em toda escrita)
const globalCache = new Map();
const GLOBAL_TTL = 30000;

function globalEnabled(def) {
  const now = Date.now();
  const hit = globalCache.get(def.id);
  if (hit && hit.expiresAt > now) return hit.value;
  const value = settings.getBool(`autobot:${def.id}`, false);
  globalCache.set(def.id, { value, expiresAt: now + GLOBAL_TTL });
  return value;
}

function welcomeState(jid) {
  try {
    return require('../database/welcome').getState(jid);
  } catch (_) {
    return {};
  }
}

function welcomeEnabled(def, jid) {
  if (def.welcomeKind === 'text-welcome' || def.welcomeKind === 'text-goodbye') {
    const g = groups.get(jid);
    if (!g) return false;
    return !!((def.welcomeKind === 'text-welcome' ? g.welcome_enabled : g.goodbye_enabled));
  }
  const st = welcomeState(jid);
  return !!((def.welcomeKind === 'card-welcome' ? st.welcome_enabled : st.goodbye_enabled));
}

/**
 * O recurso está ativo?
 *
 * Ordem de precedência (compatibilidade total):
 *   1. `settings.autobot[id].enabled`  (fonte de verdade nova)
 *   2. `settings.anti[legacy].enabled` (sistema avançado existente)
 *   3. `settings.filters[legacy]`      (sistema antigo, booleano)
 */
function isEnabled(jid, idOrAlias) {
  const def = resolve(idOrAlias);
  if (!def) return false;

  if (def.scope === 'global') return globalEnabled(def);
  if (def.scope === 'welcome') return welcomeEnabled(def, jid);
  if (!jid) return false;

  const s = groups.getSettings(jid);
  const key = def.legacy || def.id;
  const auto = s.autobot && s.autobot[def.id];
  const anti = s.anti && s.anti[key];
  const filters = s.filters || {};

  // "Ligado" em QUALQUER um dos sistemas = ligado. Isso protege quem já tinha
  // o filtro ativo antes do AutoBot existir (a chave antiga não pode ser
  // mascarada por um padrão `false` recém-criado). O `off` sempre espelha os
  // três (ver setEnabled), então desligar continua funcionando na hora.
  if (auto && auto.enabled === true) return true;
  if (anti && anti.enabled === true) return true;
  if (filters[key] === true) return true;

  if (auto && typeof auto.enabled === 'boolean') return auto.enabled;
  if (anti && typeof anti.enabled === 'boolean') return anti.enabled;
  if (typeof filters[key] === 'boolean') return filters[key];
  return false;
}

/** Opções do recurso (ex.: limite de caracteres). */
function options(jid, idOrAlias) {
  const def = resolve(idOrAlias);
  if (!def) return {};
  const defaults = def.options ? { ...def.options } : {};
  if (def.scope === 'global' || !jid) return defaults;
  const s = groups.getSettings(jid);
  const auto = (s.autobot && s.autobot[def.id]) || {};
  const out = { ...defaults };
  for (const k of Object.keys(defaults)) {
    const v = parseInt(auto[k], 10);
    if (Number.isFinite(v)) out[k] = v;
  }
  if (def.options && Object.keys(def.options).length === 0 && auto.opts) Object.assign(out, auto.opts);
  return out;
}

/* ------------------------------ escrita -------------------------------- */

/** Metadados completos do recurso (para painéis). */
function info(jid, idOrAlias) {
  const def = resolve(idOrAlias);
  if (!def) return null;
  return { ...def, enabled: isEnabled(jid, def.id), options: options(jid, def.id) };
}

/**
 * Liga/desliga um recurso. Grava IMEDIATAMENTE e atualiza o cache (nada de
 * reiniciar o bot). Mantém espelhadas as chaves antigas para não quebrar
 * menus/leituras legadas.
 * @returns {{ok:boolean, def:object|null, enabled:boolean}}
 */
function setEnabled(jid, idOrAlias, enabled, opts = {}) {
  const def = resolve(idOrAlias);
  if (!def) return { ok: false, def: null, enabled: false };
  const on = !!enabled;

  if (def.scope === 'global') {
    settings.set(`autobot:${def.id}`, on ? 'true' : 'false');
    globalCache.set(def.id, { value: on, expiresAt: Date.now() + GLOBAL_TTL });
    logger.info({ recurso: def.id, enabled: on }, 'recurso global alterado');
    return { ok: true, def, enabled: on };
  }

  if (def.scope === 'welcome') {
    const store = require('../database/welcome');
    const kind = def.welcomeKind;
    if (kind === 'text-welcome') groups.setWelcome(jid, on, (groups.get(jid) || {}).welcome_msg || '');
    else if (kind === 'text-goodbye') groups.setGoodbye(jid, on, (groups.get(jid) || {}).goodbye_msg || '');
    else if (kind === 'card-welcome') store.setWelcome(jid, on);
    else if (kind === 'card-goodbye') store.setGoodbye(jid, on);
    logger.info({ grupo: jid, recurso: def.id, enabled: on }, 'recurso de boas-vindas alterado');
    return { ok: true, def, enabled: on };
  }

  groups.patchSettings(jid, (s) => {
    if (!s.autobot) s.autobot = {};
    const cur = s.autobot[def.id] || {};
    s.autobot[def.id] = { ...cur, enabled: on, updatedAt: new Date().toISOString() };

    // espelho no sistema avançado de antis (mantém ação/purge já configurados)
    const key = def.legacy || def.id;
    if (def.anti) {
      if (!s.anti) s.anti = {};
      s.anti[key] = { ...(s.anti[key] || {}), enabled: on };
    }
    // espelho no sistema antigo de filtros (menus/legado continuam corretos)
    if (!s.filters) s.filters = {};
    if (def.legacy) s.filters[def.legacy] = on;
    else s.filters[def.id] = on;
  });

  // garante as opções padrão na primeira vez (ex.: limite)
  if (on && def.options && opts.withDefaults !== false) {
    const missing = Object.entries(def.options).filter(
      ([k]) => !Number.isFinite(parseInt((groups.getSettings(jid).autobot[def.id] || {})[k], 10))
    );
    if (missing.length) setOptions(jid, def.id, Object.fromEntries(missing));
  }

  logger.info({ grupo: jid, recurso: def.id, enabled: on }, 'recurso do grupo alterado');
  return { ok: true, def, enabled: on };
}

function toggle(jid, idOrAlias) {
  const def = resolve(idOrAlias);
  if (!def) return { ok: false, def: null, enabled: false };
  return setEnabled(jid, def.id, !isEnabled(jid, def.id));
}

/** Grava opções numéricas/arquivo de um recurso do grupo. */
function setOptions(jid, idOrAlias, patch) {
  const def = resolve(idOrAlias);
  if (!def || def.scope !== 'group') return false;
  groups.patchSettings(jid, (s) => {
    if (!s.autobot) s.autobot = {};
    const cur = s.autobot[def.id] || { enabled: false };
    s.autobot[def.id] = { ...cur, ...patch };
  });
  return true;
}

/* --------------------------- valores padrão ---------------------------- */

const seeded = new Set(); // grupos já inicializados nesta execução

/**
 * Cria automaticamente TODAS as chaves do AutoBot para o grupo (valores
 * padrão). Roda uma única vez por grupo em cada execução — depois disso o
 * cache responde tudo. Também migra grupos antigos que só tinham as chaves
 * legadas, sem sobrescrever nada.
 */
/** Valor herdado dos sistemas antigos (filters/anti) para um recurso. */
function legacyEnabled(cfg, def) {
  const key = def.legacy || def.id;
  const anti = cfg.anti && cfg.anti[key];
  if (anti && typeof anti.enabled === 'boolean') return anti.enabled;
  const filters = cfg.filters || {};
  if (typeof filters[key] === 'boolean') return filters[key];
  return false;
}

function ensureGroupDefaults(jid) {
  if (!jid || seeded.has(jid)) return false;
  seeded.add(jid);
  const s = groups.getSettings(jid);
  if (s.autobot && s.autobot.__seeded) return false;
  groups.patchSettings(jid, (cfg) => {
    if (!cfg.autobot) cfg.autobot = {};
    for (const def of FEATURES) {
      if (def.scope !== 'group') continue;
      // Migração: quem já tinha o filtro ligado no sistema antigo continua ligado.
      if (!cfg.autobot[def.id]) cfg.autobot[def.id] = { enabled: legacyEnabled(cfg, def) };
      else if (typeof cfg.autobot[def.id].enabled !== 'boolean') cfg.autobot[def.id].enabled = legacyEnabled(cfg, def);
    }
    cfg.autobot.__seeded = true;
    cfg.autobot.__version = 1;
  });
  return true;
}

/** Inicializa os recursos globais (chaves padrão). */
function ensureGlobalDefaults() {
  for (const def of FEATURES) {
    if (def.scope !== 'global') continue;
    const key = `autobot:${def.id}`;
    if (settings.get(key, null) === null) settings.set(key, 'false');
  }
  return true;
}

function boot() {
  ensureGlobalDefaults();
  logger.info({ recursos: FEATURES.length, antis: antiIds().length }, 'AutoBot carregado');
  return FEATURES.length;
}

/** Remove o cache de "já inicializado" (usado em testes e no reload). */
function resetSeedCache() {
  seeded.clear();
  globalCache.clear();
}

/* ------------------------------- status -------------------------------- */

function statusIcon(on) {
  return on ? '✅' : '❌';
}

/**
 * Relatório de status no formato oficial do AutoBot.
 * @param {string} jid grupo (ou null para só os globais)
 */
function buildStatus(jid) {
  const prefix = (() => {
    try {
      return require('../database/settings').effectivePrefix();
    } catch (_) {
      return '!';
    }
  })();

  const lines = ['⚙️ STATUS DO GRUPO ⚙️', '_✅ ativado • ❌ desativado_'];
  for (const section of SECTIONS) {
    const feats = bySection(section.id);
    if (!feats.length) continue;
    lines.push('', section.title);
    for (const def of feats) {
      const on = def.scope === 'global' ? isEnabled(null, def.id) : jid ? isEnabled(jid, def.id) : false;
      const cmd = def.cmd ? `${prefix}${def.cmd}` : def.legacyCmd ? `${prefix}${def.legacyCmd}` : '';
      lines.push(`${def.label} ${statusIcon(on)}${cmd ? ` ${cmd}` : ''}`);
    }
  }
  lines.push('', '💡 Use o comando de cada recurso: on | off');
  return lines.join('\n');
}

/** Versão compacta (1 linha por seção) — para menus interativos. */
function summaryRows(jid) {
  return FEATURES.map((def) => ({
    id: `lua:autobot:${def.id}`,
    title: `${def.label} ${isEnabled(def.scope === 'global' ? null : jid, def.id) ? '✅' : '❌'}`,
    description: def.desc.slice(0, 70) || `Comando: ${def.cmd || def.legacyCmd}`,
    def,
  }));
}

module.exports = {
  SECTIONS,
  FEATURES,
  ANTI_ALIASES,
  resolve,
  all,
  bySection,
  antiFeatures,
  antiIds,
  isEnabled,
  options,
  info,
  setEnabled,
  toggle,
  setOptions,
  ensureGroupDefaults,
  ensureGlobalDefaults,
  resetSeedCache,
  buildStatus,
  statusIcon,
  summaryRows,
  boot,
};
