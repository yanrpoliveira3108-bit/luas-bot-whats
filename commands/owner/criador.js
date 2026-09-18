/**
 * commands/owner/criador.js — edição da identidade do criador e do selo do cartão.
 *
 *   !setcriador                  → lista os campos e o valor atual de cada um
 *   !setcriador name Lua Dev     → grava (fica no banco, sobrevive a update)
 *   !setcriador reset [campo]    → volta ao padrão do arquivo
 *   !selo                        → lista os selos com prévia
 *   !selo random                 → sorteia um selo a cada cartão
 *   !selo seguranca              → fixa um selo
 *
 * Só o dono: esses valores aparecem para TODO mundo que usar !criador / !owner.
 */

'use strict';

const creatorProfile = require('../../utils/creatorProfile');
const consts = require('../../utils/consts');

const MAX_SHOW = 70;

function show(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value);
  return text.length > MAX_SHOW ? `${text.slice(0, MAX_SHOW - 1)}…` : text;
}

function fieldList(ctx) {
  const p = ctx.prefix || '!';
  const lines = [
    `👤 *Identidade do criador* — edite com ${p}setcriador <campo> <valor>`,
    '',
  ];
  for (const [field, spec] of Object.entries(creatorProfile.FIELDS)) {
    const custom = creatorProfile.isCustom(field) ? ' ✏️' : '';
    lines.push(`▸ *${field}*${custom} — ${spec.label}\n   ${show(creatorProfile.get(field))}`);
  }
  lines.push('');
  lines.push(`✏️ = valor definido por comando (os outros vêm do padrão do arquivo).`);
  lines.push(`Para voltar ao padrão: ${p}setcriador reset <campo> (ou ${p}setcriador reset para todos).`);
  return lines.join('\n');
}

function sealList(ctx) {
  const p = ctx.prefix || '!';
  const current = creatorProfile.sealChoice();
  const mode = current === 'random' ? 'aleatório (sorteia a cada cartão)' : `fixo em *${current}*`;
  return [
    `🎭 *Selos do cartão* — modo atual: ${mode}`,
    '',
    consts.sealPreview(),
    '',
    `Escolher: ${p}selo <nome>   •   Sortear: ${p}selo random`,
  ].join('\n');
}

module.exports = [
  {
    name: 'setcriador',
    commands: ['setcriador', 'criadorconfig', 'configcriador', 'editcriador'],
    category: 'owner',
    ownerOnly: true,
    description:
      'Edita os dados do criador que aparecem no cartão !criador e no !owner (nome, desenvolvedor, sobre, frase, redes, suporte e fotos).',
    usage: '!setcriador <campo> <valor>',
    examples: [
      '!setcriador name Ana',
      '!setcriador developer Ana Dev',
      '!setcriador about dev do Lua|Node.js|chama no suporte',
      '!setcriador supportUrl https://wa.me/5511999999999',
      '!setcriador photoUrl https://exemplo.com/eu.jpg',
      '!setcriador reset name',
    ],
    cooldown: 3000,
    execute: async (ctx) => {
      const args = Array.isArray(ctx.args) ? ctx.args : [];
      if (!args.length) return ctx.reply(fieldList(ctx));

      if (String(args[0]).toLowerCase() === 'reset') {
        const field = args[1] ? creatorProfile.resolveField(args[1]) || String(args[1]) : null;
        const done = creatorProfile.reset(field);
        if (!done.ok) return ctx.reply(`⚠️ ${done.error}`);
        return ctx.reply(
          field
            ? `✅ *${field}* voltou ao padrão do arquivo.`
            : '✅ Todos os campos voltaram ao padrão do arquivo.'
        );
      }

      // campo aceito em qualquer caixa: supporturl == supportUrl
      const first = creatorProfile.resolveField(args[0]);
      if (!first) {
        return ctx.reply(
          `⚠️ Campo desconhecido: *${args[0]}*\n\nCampos válidos: ${Object.keys(creatorProfile.FIELDS).join(', ')}\n\n${fieldList(ctx)}`
        );
      }

      const rawValue = args.slice(1).join(' ').trim();
      if (!rawValue) {
        return ctx.reply(
          `ℹ️ *${first}* — ${creatorProfile.FIELDS[first].label}\nValor atual: ${show(creatorProfile.get(first))}\n\nUse: ${ctx.prefix}setcriador ${first} <novo valor>`
        );
      }

      const done = creatorProfile.set(first, rawValue);
      if (!done.ok) return ctx.reply(`⚠️ ${done.error}`);

      const lines = [`✅ *${first}* atualizado.`, `▸ ${show(done.value)}`];
      if (first === 'photoUrl' || first === 'botPhotoUrl') {
        lines.push('', '💡 A imagem precisa ser um link público (http/https) para aparecer no cartão.');
      }
      lines.push('', `Veja o resultado com ${ctx.prefix}criador`);
      return ctx.reply(lines.join('\n'));
    },
  },
  {
    name: 'selo',
    commands: ['selo', 'selos', 'setselo', 'selocriador'],
    category: 'owner',
    ownerOnly: true,
    description:
      'Escolhe o selo (citação) que aparece no cartão !criador, ou deixa aleatório para sortear a cada envio.',
    usage: '!selo [nome|random]',
    examples: ['!selo', '!selo random', '!selo seguranca', '!selo dev'],
    cooldown: 3000,
    execute: async (ctx) => {
      const args = Array.isArray(ctx.args) ? ctx.args : [];
      if (!args.length) return ctx.reply(sealList(ctx));

      const choice = String(args[0]).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      if (choice === 'random' || choice === 'aleatorio') {
        creatorProfile.setSealChoice('random');
        return ctx.reply(
          `🎲 Modo *aleatório* ativado: cada ${ctx.prefix}criador sorteia um selo.\n\nDisponíveis: ${consts.sealNames().join(', ')}`
        );
      }

      if (!consts.SEALS[choice]) {
        return ctx.reply(
          `⚠️ Selo desconhecido: *${args[0]}*\n\nDisponíveis: ${consts.sealNames().join(', ')} (ou *random*)\n\n${sealList(ctx)}`
        );
      }

      creatorProfile.setSealChoice(choice);
      return ctx.reply(
        `✅ Selo *${choice}* ativado.\n\n${consts.sealText(choice)}\n\nTeste com ${ctx.prefix}criador`
      );
    },
  },
];
