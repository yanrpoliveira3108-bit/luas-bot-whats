/**
 * commands/general/temahtml.js — aparência dos menus HTML.
 *
 *   !temahtml [status]                 → tema, cores, fonte, emojis e escopo (qualquer um)
 *   !temahtml temas                    → temas prontos e fontes disponíveis (qualquer um)
 *   !temahtml cores #111 #EF4444 [#A855F7]  → fundo + destaque [+ secundário]   (dono)
 *   !temahtml aplicar <tema>           → aplica um tema pronto                  (dono)
 *   !temahtml emojis on|off            → emojis decorativos do card             (dono)
 *   !temahtml fonte padrao|sans|serif|mono|off                                   (dono)
 *   !temahtml restaurar                → volta SÓ o visual do card ao padrão    (dono)
 *
 * ESCOPO: GLOBAL — o mesmo do `!modohtml` e do `!tema` (o card é montado com
 * as preferências do bot inteiro). Por isso alterar é só do DONO; admin de
 * grupo pode consultar, não alterar.
 *
 * Cada alteração mexe em UMA propriedade (as outras são preservadas) e só é
 * confirmada depois de relida do banco. Vale para os PRÓXIMOS menus enviados —
 * cards antigos continuam como foram gerados.
 */

'use strict';

const CONFIG = require('../../config');
const htmlTheme = require('../../utils/htmlTheme');
const { HTML_FONTS, EMOJI, LINHA, titulo } = require('../../config/textStyles');

const ON = ['on', 'ligar', 'ativar', 'sim'];
const OFF = ['off', 'desligar', 'desativar', 'nao', 'não'];

function descreverCores(v) {
  if (!v.bg) return '▸ Cores: padrão do projeto (paleta do `tema` ativo)';
  const pal = htmlTheme.derivarPaleta(v.bg, v.primary, v.secondary);
  return [
    `▸ Fundo: ${v.bg} (${pal.escuro ? 'escuro' : 'claro'})`,
    `▸ Destaque principal: ${v.primary}`,
    `▸ Destaque secundário: ${v.secondary || `automático (${pal['--lua-secondary']})`}`,
  ].join('\n');
}

function statusTexto(ctx) {
  const v = htmlTheme.get();
  const p = ctx.prefix;
  const nomeTema = v.preset ? `${htmlTheme.PRESETS[v.preset].label} (\`${v.preset}\`)` : v.bg ? 'cores personalizadas' : 'padrão do projeto';
  let modo = '';
  try {
    const st = require('../../utils/menuFormat').status();
    modo = st.active ? 'menus em HTML ativos' : 'menus em HTML desligados (use `modohtml on`)';
  } catch (_) {
    modo = '';
  }
  return [
    `${EMOJI.tecnico.tema} *${titulo('APARÊNCIA DOS MENUS HTML')}*`,
    LINHA,
    `▸ Tema: ${nomeTema}`,
    descreverCores(v),
    `▸ Fonte: ${HTML_FONTS[v.font].label} (\`${v.font}\`)`,
    `▸ Emojis decorativos: ${v.emojis ? 'ligados' : 'desligados'}`,
    `▸ Escopo: *GLOBAL* (todos os chats) — alterar é só para o dono`,
    modo ? `▸ Formato: ${modo}` : '',
    LINHA,
    `▸ \`${p}temahtml temas\` — temas prontos e fontes`,
    `▸ \`${p}temahtml cores #111111 #EF4444 [#A855F7]\``,
    `▸ \`${p}temahtml aplicar claro\` · \`${p}temahtml fonte mono\` · \`${p}temahtml emojis off\``,
    `▸ \`${p}temahtml restaurar\` — volta só o visual do card ao padrão`,
    '_Vale para os próximos menus enviados; cards antigos não mudam._',
  ]
    .filter(Boolean)
    .join('\n');
}

function listaTexto(ctx) {
  const p = ctx.prefix;
  const temas = htmlTheme
    .listarPresets()
    .map((t) => `▸ \`${t.id}\` — ${t.label} (${t.claro ? 'claro' : 'escuro'}: ${[t.bg, t.primary, t.secondary].filter(Boolean).join(' ')})`);
  const fontes = Object.entries(HTML_FONTS).map(([id, f]) => `▸ \`${id}\` — ${f.label}`);
  return [
    `${EMOJI.tecnico.tema} *${titulo('TEMAS PRONTOS')}*`,
    ...temas,
    '',
    `${EMOJI.tecnico.fonte} *${titulo('FONTES')}*`,
    ...fontes,
    '▸ `off` — volta à fonte padrão do sistema',
    '',
    `_Aplicar: ${p}temahtml aplicar <tema> · Fonte: ${p}temahtml fonte <nome>_`,
    '_Fontes do próprio aparelho (nada é baixado); se faltar uma, o sistema usa a alternativa legível._',
  ].join('\n');
}

function erroSalvar(err) {
  return `${EMOJI.status.erro} *Não salvei* (${err && err.code === 'save-failed' ? 'o banco não confirmou a gravação' : 'erro no banco'}). A aparência anterior foi mantida.`;
}

function confirmar(titulo1, v) {
  return [
    `${EMOJI.status.ok} *${titulo1}*`,
    descreverCores(v),
    `▸ Fonte: ${HTML_FONTS[v.font].label} · Emojis: ${v.emojis ? 'ligados' : 'desligados'}`,
    '▸ Escopo: GLOBAL · salvo no banco. Vale para os próximos menus.',
  ].join('\n');
}

module.exports = [
  {
    name: 'temahtml',
    commands: ['temahtml', 'visualhtml'],
    category: 'general',
    description: 'Cores, fonte e emojis dos menus HTML (escopo global; alterar = dono).',
    usage: '!temahtml [status|temas|cores <fundo> <destaque> [secundária]|aplicar <tema>|emojis on/off|fonte <nome>|restaurar]',
    cooldown: 1500,
    execute: async (ctx) => {
      const p = ctx.prefix;
      const args = (ctx.args || []).map((a) => String(a).trim()).filter(Boolean);
      const sub = (args[0] || '').toLowerCase();

      if (!sub || (sub === 'status' && args.length === 1)) return ctx.reply(statusTexto(ctx));
      if (['temas', 'lista', 'fontes'].includes(sub) && args.length === 1) return ctx.reply(listaTexto(ctx));

      const invalido = (msg) =>
        ctx.reply(`${EMOJI.status.aviso} ${msg}\n▸ Veja \`${p}temahtml\` e \`${p}temahtml temas\`.\n_Nada foi alterado._`);

      // validar ANTES da permissão e do banco: entrada ruim nunca grava nada
      let acao = null;
      if (sub === 'cores') {
        if (args.length !== 3 && args.length !== 4) {
          return invalido(`Use 2 ou 3 cores: \`${p}temahtml cores #111111 #EF4444\` ou \`${p}temahtml cores #111111 #EF4444 #A855F7\`.`);
        }
        const [bg, primary, secondary] = args.slice(1).map(htmlTheme.normalizarCor);
        const ruins = args.slice(1).filter((c, i) => ![bg, primary, secondary][i]);
        if (ruins.length) {
          return invalido(`Cor inválida: *${ruins.map((c) => c.slice(0, 24)).join(', ')}*. Use hexadecimal #RGB ou #RRGGBB (ex.: #111, #EF4444).`);
        }
        if (bg === primary) return invalido('Fundo e destaque iguais deixariam botões e seleção invisíveis. Escolha cores diferentes.');
        acao = { cores: { bg, primary, secondary: args.length === 4 ? secondary : null } };
      } else if (sub === 'aplicar') {
        const id = (args[1] || '').toLowerCase();
        if (args.length !== 2 || !htmlTheme.PRESETS[id]) {
          return invalido(`Tema desconhecido${args[1] ? `: *${args[1].slice(0, 30)}*` : ''}. Disponíveis: ${Object.keys(htmlTheme.PRESETS).map((k) => '`' + k + '`').join(', ')}.`);
        }
        acao = { preset: id };
      } else if (sub === 'emojis' || sub === 'emoji') {
        const v = (args[1] || '').toLowerCase();
        if (args.length !== 2 || (!ON.includes(v) && !OFF.includes(v))) return invalido(`Use \`${p}temahtml emojis on\` ou \`${p}temahtml emojis off\`.`);
        acao = { emojis: ON.includes(v) };
      } else if (sub === 'fonte') {
        const f = require('../../config/textStyles').resolverFonteHtml(args[1]);
        if (args.length !== 2 || !f) return invalido(`Fonte desconhecida. Use: ${Object.keys(HTML_FONTS).map((k) => '`' + k + '`').join(', ')} ou \`off\`.`);
        acao = { font: f };
      } else if ((sub === 'restaurar' || sub === 'padrao' || sub === 'reset') && args.length === 1) {
        acao = { restaurar: true };
      } else {
        return invalido(`Opção não reconhecida: *${args.join(' ').slice(0, 40)}*.`);
      }

      // alterar configuração GLOBAL = dono
      if (!ctx.isOwner) return ctx.reply(CONFIG.messages.deniedOwner);

      let v;
      try {
        if (acao.restaurar) v = htmlTheme.restaurar();
        else if (acao.preset) v = htmlTheme.aplicarPreset(acao.preset);
        else v = htmlTheme.set(acao);
      } catch (err) {
        return ctx.reply(erroSalvar(err));
      }

      if (acao.restaurar) {
        return ctx.reply(
          `${EMOJI.status.ok} *Aparência dos menus HTML restaurada ao padrão.*\n` +
            '▸ Só o visual do card mudou: modohtml, prefixo, identificação e demais configurações foram mantidos.'
        );
      }
      if (acao.preset) return ctx.reply(confirmar(`Tema aplicado: ${htmlTheme.PRESETS[acao.preset].label}`, v));
      if (acao.cores) return ctx.reply(confirmar(args.length === 4 ? 'Cores salvas (3 cores)' : 'Cores salvas (2 cores)', v));
      if (acao.emojis !== undefined) {
        return ctx.reply(
          `${EMOJI.status.ok} *Emojis decorativos ${v.emojis ? 'ligados' : 'desligados'} nos menus HTML.*\n` +
            '▸ Cores e fonte foram mantidas. Reações do bot e emojis das mensagens comuns não mudam.'
        );
      }
      return ctx.reply(
        `${EMOJI.status.ok} *Fonte dos menus HTML: ${HTML_FONTS[v.font].label}.*\n▸ Cores, emojis e tamanhos foram mantidos.`
      );
    },
  },
];
