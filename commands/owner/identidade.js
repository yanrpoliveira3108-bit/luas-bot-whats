'use strict';

/**
 * commands/owner/dono.js — `!identidade` responde "por que o comando de dono não funciona?"
 *
 * Motivo (relato de 25/09/2026): "tem alguns comandos de dono que não funcionam
 * mesmo eu sendo o dono". As causas possíveis são sempre as mesmas — e todas dão
 * para VERIFICAR em vez de supor:
 *
 *   1. IDENTIDADE: em grupo/comunidade o WhatsApp pode mandar o remetente como
 *      LID; se o bot não converte para telefone, ele não reconhece o dono
 *      (resposta vira "Apenas o dono do bot..."). O comando mostra exatamente o
 *      que o bot viu.
 *   2. NÚMERO: o número que está falando não é o que está em OWNER_NUMBER.
 *   3. RECURSO DESLIGADO: alguns comandos dependem de opção (ex.: !eval precisa
 *      de ENABLE_EVAL=true).
 *   4. PLUGIN DESLIGADO: comando de dono dentro de um plugin desativado por
 *      `!plugins off <plugin>`.
 *   5. NOME ERRADO: o `!identidade comandos` lista os comandos de dono que existem.
 *
 * O comando é ABERTO a qualquer pessoa (sem dado sensível): mostrar só o que o
 * bot viu sobre QUEM PERGUNTOU é o que faz a pessoa perceber na hora o problema.
 * Os números do dono aparecem mascarados.
 */

const CONFIG = require('../../config');
const { registry } = require('../../engine/plugins');
const loader = require('../../commands/loader');

/** Mascara um número deixando só os últimos 4 dígitos (nada de expor telefone). */
function mascarar(jid) {
  const d = String(jid || '').replace(/[^0-9]/g, '');
  if (!d) return '(vazio)';
  if (d.length <= 4) return '****';
  return `${'*'.repeat(Math.max(0, d.length - 4))}${d.slice(-4)}`;
}

/** Comandos de dono registrados, por nome (para a lista). */
function comandosDeDono() {
  return registry
    .all()
    .filter((c) => c.ownerOnly)
    .map((c) => c.name)
    .sort();
}

/** Recursos que precisam de opção ligada/desligada para o comando funcionar. */
function recursos() {
  const itens = [];
  itens.push({
    nome: '!eval',
    ok: !!CONFIG.limits.evalEnabled,
    detalhe: CONFIG.limits.evalEnabled ? 'habilitado' : 'DESLIGADO — defina ENABLE_EVAL=true no .env',
  });
  itens.push({
    nome: 'cards HTML / menu nativo',
    ok: !require('../../utils/safety').safeMode(),
    detalhe: require('../../utils/safety').safeMode()
      ? 'MODO SEGURO ligado (SAFE_MODE=1) — cards e menu nativo bloqueados'
      : 'liberado',
  });
  try {
    const settingsDb = require('../../database/settings');
    const on = typeof settingsDb.buttonsEnabled === 'function' ? settingsDb.buttonsEnabled() : null;
    itens.push({
      nome: 'botões/interativo',
      ok: on !== false,
      detalhe: on === false ? 'DESLIGADO — menu cai no texto numerado' : 'ligado',
    });
  } catch (_) {
    itens.push({ nome: 'botões/interativo', ok: true, detalhe: 'conforme configuração' });
  }
  return itens;
}

module.exports = [
  {
    // ⚠️ NÃO usar o trigger `dono`: já existe `!dono` em commands/general/owner.js
    // (mostra o contato do dono). Este aqui é o diagnóstico de identidade.
    name: 'identidade',
    commands: ['identidade', 'quemsoueu', 'meuid', 'quemsoueu', 'minhaidentidade', 'ownercheck'],
    category: 'owner',
    // NÃO é ownerOnly de propósito: se a identidade falhar, o dono precisa poder
    // rodar este comando justamente para descobrir que ela falhou.
    ownerOnly: false,
    description: 'Mostra como o bot identificou você (dono? admin?) e por que um comando de dono pode ser recusado.',
    usage: '!identidade | !identidade comandos',
    cooldown: 2000,
    execute: async (ctx) => {
      const sub = String(ctx.args[0] || '').toLowerCase();

      if (sub === 'comandos' || sub === 'lista' || sub === 'owner') {
        const lista = comandosDeDono();
        const plugins = registry.pluginList ? registry.pluginList() : [];
        const desativados = plugins.filter((p) => p.enabled === false).map((p) => p.name);
        return ctx.reply(
          [
            `👑 *Comandos de dono (${lista.length})*`,
            lista.map((n) => `▸ ${ctx.prefix}${n}`).join('\n'),
            '',
            `🔌 Plugins desativados: ${desativados.length ? desativados.join(', ') : '(nenhum)'}`,
            '_Comando de dono dentro de plugin desativado não responde — ligue com ' +
              `${ctx.prefix}plugins on <plugin>._`,
          ].join('\n')
        );
      }

      const cfg = CONFIG.owner.numbers || [];
      const linhas = [
        '🪪 *COMO O BOT IDENTIFICOU VOCÊ*',
        '━━━━━━━━━━━━━━━━━━━━',
        `Conversa......: ${ctx.isGroup ? 'grupo' : 'privado'}${ctx.isCommunity ? ' (comunidade)' : ''}`,
        `Você é o DONO?: ${ctx.isOwner ? '✅ sim' : '❌ NÃO'}`,
        ...(ctx.isGroup
          ? [
              `Admin do grupo: ${ctx.isAdmin ? '✅ sim' : '❌ não'}`,
              `Bot é admin...: ${ctx.isBotAdmin ? '✅ sim' : '❌ não'}`,
            ]
          : []),
        '',
        '*Formas de identidade que chegaram*',
        // mostra as formas cruas (sem telefone completo): é aqui que se vê o LID
        ...(ctx.identidades || [ctx.sender])
          .slice(0, 4)
          .map((j) => `▸ ${mascarar(j)} ${String(j).endsWith('@lid') ? '(LID)' : String(j).endsWith('@g.us') ? '(grupo)' : '(telefone)'}`),
        `▸ escolhida: ${mascarar(ctx.sender)}`,
        '',
        `*Donos configurados*: ${cfg.length} ${cfg.length ? `(${cfg.map(mascarar).join(', ')})` : '⚠️ NENHUM — defina OWNER_NUMBER no .env'}`,
        `Prefixos em uso: ${ctx.prefix}`,
      ];

      if (!ctx.isOwner) {
        linhas.push(
          '',
          '🚫 *Você NÃO foi reconhecido como dono.* Se você É o dono, a causa é uma destas:',
          '▸ 1. O número em OWNER_NUMBER é outro (confira no .env; aceita DDI 55).',
          '▸ 2. O WhatsApp mandou seu contato como *LID* e o bot não converteu para telefone',
          '     (acontece em comunidade/grupo LID) — o log mostra "não consegui resolver LID → PN".',
          '▸ 3. Você está falando de um *aparelho vinculado* com outro número.',
          '▸ 4. O comando exige admin do grupo (não é o caso de comando de dono).',
        );
      } else {
        const recursosLista = recursos().filter((r) => !r.ok);
        linhas.push('', '✅ *Dono reconhecido.* Se algum comando de dono ainda não responde:');
        if (recursosLista.length) {
          linhas.push(...recursosLista.map((r) => `▸ ${r.nome}: ${r.detalhe}`));
        }
        linhas.push(
          `▸ Veja a lista e os plugins desativados: ${ctx.prefix}identidade comandos`,
          '▸ Comando que exige confirmação: responda *sim* (a confirmação é por remetente;',
          '  se ela "sumir", rode de novo e responda na mesma conversa).'
        );
      }

      return ctx.reply(linhas.join('\n'));
    },
  },
];
