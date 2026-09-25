/**
 * config/textStyles.js — estilos de TEXTO, emojis por categoria e fontes do HTML.
 *
 * Três coisas diferentes, cada uma no ambiente que realmente a suporta:
 *
 * 1) MENSAGENS COMUNS (conversa do WhatsApp) — não existe CSS nem fonte aqui.
 *    O que o WhatsApp formata de verdade: *negrito*, _itálico_, ~riscado~,
 *    ```monoespaçado```, `código em linha`, "> citação" e listas "- ". As
 *    funções `fmt.*` só usam isso.
 *
 * 2) TÍTULOS DECORATIVOS (opcional) — letras Unicode "matemáticas" (𝐀, 𝙰, 𝗔).
 *    São SÓ para títulos. Nunca aplicar em: nomes de comandos, prefixos,
 *    exemplos para copiar, telefones, valores, links e identificadores. Por isso
 *    `titulo()` só transforma A–Z/a–z (dígitos, símbolos e acentuadas ficam
 *    iguais) e o padrão é "padrao" (texto comum). Escolha: `!tema titulo <estilo>`
 *    (dono), guardado em settings (`text_title_style`).
 *
 * 3) FONTES DOS MENUS HTML — pilhas de fontes do SISTEMA (sem download, sem
 *    fonte remota: o WebView do card não tem rede). Escolha: `!temahtml fonte`.
 *
 * EMOJIS: organizados por categoria, um por significado, para manter o padrão
 * visual consistente. Use `EMOJI.<categoria>.<nome>` em vez de espalhar
 * símbolos soltos pelo código novo.
 */

'use strict';

/* ------------------------------ emojis por categoria ------------------------------ */

const EMOJI = Object.freeze({
  status: Object.freeze({ ok: '✅', erro: '❌', aviso: '⚠️', info: 'ℹ️', inativo: '⚪', salvo: '💾', dica: '💡' }),
  grupo: Object.freeze({ aberto: '🔓', fechado: '🔒', admin: '🛠️', membros: '👥' }),
  tempo: Object.freeze({ relogio: '⏰', calendario: '📅', fuso: '🌍', proximo: '⏭️', historico: '🕘' }),
  navegacao: Object.freeze({ menu: '🧭', item: '▸', voltar: '↩️' }),
  tecnico: Object.freeze({ prefixo: '💻', config: '⚙️', tema: '🎨', fonte: '🔤' }),
  pessoas: Object.freeze({ solicitante: '🙋', dono: '👑', bot: '🤖' }),
});

/** Separador padrão das mensagens do projeto. */
const LINHA = '━━━━━━━━━━━━━━━━━━━━';

/* ------------------------------ formatação do WhatsApp ------------------------------ */

const fmt = Object.freeze({
  negrito: (t) => `*${t}*`,
  italico: (t) => `_${t}_`,
  riscado: (t) => `~${t}~`,
  mono: (t) => '```' + t + '```',
  codigo: (t) => '`' + t + '`',
  citacao: (t) =>
    String(t)
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n'),
  lista: (itens) => itens.map((i) => `- ${i}`).join('\n'),
});

/* ------------------------------ títulos decorativos ------------------------------ */

// Início dos blocos "Mathematical Alphanumeric Symbols" (A maiúsculo, a minúsculo).
const TITLE_STYLES = Object.freeze({
  padrao: { label: 'Padrão (texto comum)', upper: null, lower: null, exemplo: 'Lua Bot' },
  classico: { label: 'Clássico (serifa em negrito)', upper: 0x1d400, lower: 0x1d41a, exemplo: '𝐋𝐮𝐚 𝐁𝐨𝐭' },
  tecnologico: { label: 'Tecnológico (monoespaçado)', upper: 0x1d670, lower: 0x1d68a, exemplo: '𝙻𝚞𝚊 𝙱𝚘𝚝' },
  moderno: { label: 'Moderno (sem serifa em negrito)', upper: 0x1d5d4, lower: 0x1d5ee, exemplo: '𝗟𝘂𝗮 𝗕𝗼𝘁' },
});

const TITLE_ALIASES = { limpo: 'padrao', normal: 'padrao', off: 'padrao', tech: 'tecnologico', mono: 'tecnologico', serif: 'classico', sans: 'moderno' };

function resolverEstiloTitulo(nome) {
  const k = String(nome || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const id = TITLE_ALIASES[k] || k;
  return Object.prototype.hasOwnProperty.call(TITLE_STYLES, id) ? id : null;
}

/** Estilo de título escolhido (settings); padrão = texto comum. */
function estiloTituloAtivo() {
  try {
    const v = require('../database/settings').get('text_title_style', null);
    return resolverEstiloTitulo(v) || 'padrao';
  } catch (_) {
    return 'padrao';
  }
}

/**
 * Aplica o estilo decorativo a um TÍTULO. Só A–Z/a–z mudam; dígitos,
 * acentuadas, emojis e símbolos ficam como estão (legível e copiável).
 */
function titulo(texto, estilo) {
  const id = resolverEstiloTitulo(estilo) || (estilo === undefined ? estiloTituloAtivo() : 'padrao');
  const st = TITLE_STYLES[id];
  if (!st || !st.upper) return String(texto);
  let out = '';
  for (const ch of String(texto)) {
    const c = ch.charCodeAt(0);
    if (ch.length === 1 && c >= 65 && c <= 90) out += String.fromCodePoint(st.upper + (c - 65));
    else if (ch.length === 1 && c >= 97 && c <= 122) out += String.fromCodePoint(st.lower + (c - 97));
    else out += ch;
  }
  return out;
}

/* ------------------------------ fontes dos menus HTML ------------------------------ */

// Só famílias locais/genéricas (sempre há fallback do sistema).
const HTML_FONTS = Object.freeze({
  padrao: {
    label: 'Padrão legível (sistema)',
    stack: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
  },
  sans: {
    label: 'Sem serifa (limpa)',
    stack: '"Inter","Roboto","Noto Sans","Helvetica Neue",Arial,sans-serif',
  },
  serif: {
    label: 'Com serifa (clássica)',
    stack: '"Noto Serif","Georgia","Cambria","Times New Roman",serif',
  },
  mono: {
    label: 'Monoespaçada (tecnológica)',
    stack: 'ui-monospace,"JetBrains Mono","Roboto Mono","SFMono-Regular",Menlo,Consolas,monospace',
  },
});

const HTML_FONT_MONO_STACK = 'ui-monospace,SFMono-Regular,Menlo,monospace';

const HTML_FONT_ALIASES = { off: 'padrao', padrão: 'padrao', limpo: 'padrao', default: 'padrao', classico: 'serif', tecnologico: 'mono' };

function resolverFonteHtml(nome) {
  const k = String(nome || '')
    .trim()
    .toLowerCase();
  const semAcento = k.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const id = HTML_FONT_ALIASES[k] || HTML_FONT_ALIASES[semAcento] || semAcento;
  return Object.prototype.hasOwnProperty.call(HTML_FONTS, id) ? id : null;
}

module.exports = {
  EMOJI,
  LINHA,
  fmt,
  TITLE_STYLES,
  resolverEstiloTitulo,
  estiloTituloAtivo,
  titulo,
  HTML_FONTS,
  HTML_FONT_MONO_STACK,
  resolverFonteHtml,
};
