/**
 * commands/general/modohtml.js — escolhe o formato dos menus.
 *
 *   !modohtml          → estado atual + como usar (qualquer pessoa)
 *   !modohtml on       → ativa os menus HTML    (dono)
 *   !modohtml off      → volta ao menu tradicional (dono)
 *
 * ESCOPO: GLOBAL, igual ao `!botao on/off` e ao `!tema` — o formato do menu é
 * uma preferência de apresentação do bot inteiro e fica em `settings` (banco).
 * Não é por grupo: por isso quem altera é só o DONO (um admin de grupo não pode
 * mexer em configuração global).
 *
 * Persistência: `database/settings.js` (`menu_html`). Sem a chave no banco, o
 * estado é DESLIGADO (menu tradicional).
 */

'use strict';

const CONFIG = require('../../config');
const settings = require('../../database/settings');
const menuFormat = require('../../utils/menuFormat');

const ON = ['on', 'ligar', 'ativar', 'ativo', '1', 'sim'];
const OFF = ['off', 'desligar', 'desativar', 'inativo', '0', 'nao', 'não'];

function painel(ctx, st) {
  const p = ctx.prefix;
  const linhas = [
    '🌙 *MENUS EM HTML*',
    '━━━━━━━━━━━━━━━━━━━━',
    `▸ Estado: ${st.enabled ? '✅ *LIGADO*' : '⚪ *DESLIGADO*'}`,
    `▸ Em uso agora: ${st.active ? 'card HTML' : 'menu tradicional'}`,
  ];
  if (st.enabled && !st.allowed) {
    linhas.push(`⚠️ ${st.motivo}`);
    linhas.push('▸ O modo seguro bloqueia cards HTML (`!freio seguro off` libera).');
  }
  linhas.push(
    '',
    '*Como usar*',
    `▸ \`${p}modohtml on\` — ativa os menus em HTML`,
    `▸ \`${p}modohtml off\` — volta ao menu tradicional`,
    `▸ \`${p}menu\` — abre o menu no formato ativo`,
    `▸ \`${p}menucompleto\` (ou \`${p}menu --texto\`) — menu tradicional sempre disponível`,
    '',
    `*Escopo:* ${st.scope === 'global' ? 'GLOBAL (todos os chats)' : st.scope} — alterar é só para o dono.`,
    `_Modo seguro: ${st.safeMode ? 'ligado' : 'desligado'}._`
  );
  return linhas.join('\n');
}

module.exports = [
  {
    name: 'modohtml',
    commands: ['modohtml', 'menuhtml', 'htmlmenu'],
    category: 'general',
    description: 'Liga/desliga os menus interativos em HTML (escopo global; alterar = dono).',
    usage: '!modohtml [on|off]',
    cooldown: 1500,
    execute: async (ctx) => {
      const arg = String(ctx.args[0] || '').toLowerCase().trim();

      // sem argumento: estado + uso (liberado para qualquer um consultar)
      if (!arg) {
        await ctx.reply(painel(ctx, menuFormat.status()));
        return;
      }

      if (!ON.includes(arg) && !OFF.includes(arg)) {
        await ctx.reply(
          `⚠️ Argumento inválido: *${arg}*\n` +
            `▸ Use \`${ctx.prefix}modohtml on\` ou \`${ctx.prefix}modohtml off\`.\n` +
            `▸ Sem argumento, mostro o estado atual.`
        );
        return;
      }

      // alterar configuração GLOBAL = dono
      if (!ctx.isOwner) {
        await ctx.reply(CONFIG.messages.deniedOwner);
        return;
      }

      const querLigar = ON.includes(arg);
      let st;
      try {
        st = menuFormat.setEnabled(querLigar);
      } catch (err) {
        await ctx.reply(`❌ Não consegui salvar a configuração: ${err && err.message ? err.message : 'erro no banco'}.`);
        return;
      }

      // confirma SÓ depois de salvar, relendo do banco (prova de persistência)
      const salvo = settings.menuHtmlEnabled();
      if (salvo !== querLigar) {
        await ctx.reply('❌ A configuração não foi salva. Tente novamente.');
        return;
      }

      const linhas = [
        querLigar ? '✅ *Menus em HTML ATIVADOS*' : '✅ *Menus em HTML DESATIVADOS*',
        '',
        querLigar
          ? `▸ \`${ctx.prefix}menu\` abre o card HTML com as categorias e a busca.`
          : `▸ \`${ctx.prefix}menu\` volto ao menu tradicional.`,
        `▸ Escopo: GLOBAL — vale em todos os chats (persistido no banco).`,
      ];
      if (querLigar && !st.allowed) {
        linhas.push(`⚠️ ${st.motivo} → vou continuar usando o menu tradicional até o modo seguro sair.`);
      }
      await ctx.reply(linhas.join('\n'));
    },
  },
];
