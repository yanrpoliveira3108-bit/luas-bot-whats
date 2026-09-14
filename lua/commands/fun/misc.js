/**
 * commands/fun/misc.js — comandos leves e seguros de diversão (sem API).
 *
 * piada, charada, 8ball, conselho, fato, curiosidade, horoscopo, sorteio,
 * escolher/random, verdadeoudesafio.
 */

'use strict';

const crypto = require('crypto');
const { runInteraction } = require('../../engine/interactionEngine');
const R = require('./_responses');

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  const range = max - min + 1;
  const buf = crypto.randomBytes(4);
  return min + (buf.readUInt32BE(0) % range);
}

const PIADAS = [
  'Por que o livro de matemática ficou triste? Porque tinha muitos problemas. 📚',
  'O que o zero disse para o oito? "Que cinto maneiro!" 😄',
  'Por que o computador foi ao médico? Porque pegou um vírus. 🖥️',
  'Qual é o café mais perigoso do mundo? O ex-preso. ☕😅',
  'O que um pato disse para o outro? "Nada, eles não falam." 🦆',
  'Por que o esqueleto não brigou com ninguém? Porque ele não tem estômago. 💀',
];

const CHARADAS = [
  { p: 'O que é, o que é? Tem cabeça e não pensa, tem dente e não morde.', r: 'O alho. 🧄' },
  { p: 'O que é, o que é? Quanto mais seca, mais molhada fica.', r: 'A toalha. 🧻' },
  { p: 'O que é, o que é? Anda com os pés na cabeça.', r: 'O piolho. 🐜' },
  { p: 'O que é, o que é? Quanto mais se tira, maior fica.', r: 'O buraco. 🕳️' },
  { p: 'O que é, o que é? Tem asa e não voa, tem bico e não pica.', r: 'O bule. ☕' },
  { p: 'O que é, o que é? Cai em pé e corre deitado.', r: 'A chuva. 🌧️' },
];

const BALL = [
  'Com certeza! ✅', 'Pode apostar que sim. 😉', 'Sem dúvida alguma. 💯',
  'Sinais apontam que sim. 🔮', 'Melhor não contar com isso. 🤔', 'Duvido muito. 🙃',
  'Minha resposta é não. ❌', 'Não conte com isso. 🚫', 'Pergunte de novo mais tarde. ⏳',
  'As perspectivas não são boas. ☁️', 'Acho que sim. 👍', 'Resposta incerta, tente novamente. 🎲',
];

const CONSELHOS = [
  'Faça uma pausa: a cada hora de tela, alongue-se por 5 minutos. 🧘',
  'Beba água ao longo do dia. Seu corpo agradece. 💧',
  'Quebre tarefas grandes em passos pequenos — o progresso fica visível. 📝',
  'Durma de 7 a 9 horas: é quando o cérebro consolida o aprendizado. 😴',
  'Anote suas ideias assim que surgirem. Memória é traiçoeira. 🗒️',
  'Responda mensagens importantes em até 24h. Simples e poderoso. 📱',
];

const FATOS = [
  'O coração de um camarão fica na cabeça. 🦐',
  'O mel nunca estraga: já foram encontrados potes com 3.000 anos. 🍯',
  'Polvos têm três corações. 🐙',
  'O Sol representa 99,86% da massa do Sistema Solar. ☀️',
  'Abelhas reconhecem rostos humanos. 🐝',
  'A Terra não é perfeitamente redonda: é achatada nos polos. 🌍',
];

const SIGNOS = {
  áries: 'Áries', aries: 'Áries', touro: 'Touro', gêmeos: 'Gêmeos', gemeos: 'Gêmeos',
  câncer: 'Câncer', cancer: 'Câncer', leão: 'Leão', leao: 'Leão', virgem: 'Virgem',
  libra: 'Libra', escorpião: 'Escorpião', escorpiao: 'Escorpião', sagitário: 'Sagitário',
  sagitario: 'Sagitário', capricórnio: 'Capricórnio', capricornio: 'Capricórnio',
  aquário: 'Aquário', aquario: 'Aquário', peixes: 'Peixes',
};

const HOROSCOPO = {
  geral: [
    'Bom dia para resolver pendências pequenas. ✨',
    'Alguém próximo pode precisar de você hoje. 💛',
    'Uma boa surpresa pode surgir à tarde. 🎁',
    'Evite decisões apressadas hoje. 🐢',
    'Dia favorável para colocar ideias no papel. 📝',
    'Sua paciência será testada — respire fundo. 🌬️',
  ],
  amor: [
    'No amor, a comunicação vai bem hoje. 💬',
    'Um gesto simples pode aproximar vocês. 💞',
    'Evite ciúmes desnecessários. 🌹',
  ],
  dinheiro: [
    'No dinheiro, organize suas contas. 💰',
    'Dia neutro para investimentos. 📊',
    'Evite gastos por impulso. 🛑',
  ],
};

// estado para charada (in-memory, por chat)
const lastCharada = new Map();

module.exports = [
  {
    name: 'piada',
    commands: ['piada'],
    category: 'fun',
    description: 'Conta uma piada leve.',
    usage: '!piada',
    cooldown: 2000,
    execute: async (ctx) => ctx.reply(`😂 ${pick(PIADAS)}`),
  },
  {
    name: 'charada',
    commands: ['charada'],
    category: 'fun',
    description: 'Faz uma charada. Use !charada resposta para ver a resposta.',
    usage: '!charada | !charada resposta',
    cooldown: 2000,
    execute: async (ctx) => {
      const arg = String(ctx.args[0] || '').toLowerCase();
      if (arg === 'resposta' || arg === 'resposta?') {
        const saved = lastCharada.get(ctx.remoteJid);
        if (!saved) return ctx.reply('🤔 Nenhuma charada ativa. Peça uma com !charada.');
        lastCharada.delete(ctx.remoteJid);
        return ctx.reply(`💡 Resposta: *${saved.r}*`);
      }
      const c = pick(CHARADAS);
      lastCharada.set(ctx.remoteJid, c);
      await ctx.reply(`🧩 ${c.p}\n\n_Responda com !charada resposta para ver._`);
    },
  },
  {
    name: '8ball',
    commands: ['8ball', 'bola8', 'pergunta'],
    category: 'fun',
    description: 'Bola mágica responde sim/não.',
    usage: '!8ball <pergunta>',
    cooldown: 2000,
    execute: async (ctx) => {
      const q = ctx.args.join(' ');
      if (!q) return ctx.reply('🎱 Faça uma pergunta de sim/não: !8ball <pergunta>');
      await ctx.reply(`🎱 *${q}*\n▸ ${pick(BALL)}`);
    },
  },
  {
    name: 'conselho',
    commands: ['conselho'],
    category: 'fun',
    description: 'Dá um conselho útil.',
    usage: '!conselho',
    cooldown: 2000,
    execute: async (ctx) => ctx.reply(`💡 ${pick(CONSELHOS)}`),
  },
  {
    name: 'fato',
    commands: ['fato', 'curiosidade'],
    category: 'fun',
    description: 'Curiosidade aleatória.',
    usage: '!fato',
    cooldown: 2000,
    execute: async (ctx) => ctx.reply(`🤓 ${pick(FATOS)}`),
  },
  {
    name: 'horoscopo',
    commands: ['horoscopo', 'signo'],
    category: 'fun',
    description: 'Horóscopo divertido do dia.',
    usage: '!horoscopo <signo>',
    cooldown: 3000,
    execute: async (ctx) => {
      const sign = String(ctx.args[0] || '').toLowerCase();
      const name = SIGNOS[sign];
      if (!name) return ctx.reply('🔮 Use: !horoscopo <signo>\nEx.: !horoscopo leão');
      // previsão determinística por dia+signo (todos com o mesmo signo veem a mesma)
      const day = new Date().toISOString().slice(0, 10);
      const seed = day + name;
      const h = crypto.createHash('md5').update(seed).digest();
      const geral = HOROSCOPO.geral[h[0] % HOROSCOPO.geral.length];
      const amor = HOROSCOPO.amor[h[1] % HOROSCOPO.amor.length];
      const dinheiro = HOROSCOPO.dinheiro[h[2] % HOROSCOPO.dinheiro.length];
      await ctx.reply(
        `🔮 *Horóscopo de ${name}* — ${new Date().toLocaleDateString('pt-BR')}\n\n▸ ${geral}\n▸ ${amor}\n▸ ${dinheiro}\n\n_Conteúdo de entretenimento._`
      );
    },
  },
  {
    name: 'sorteio',
    commands: ['sorteio', 'sortear'],
    category: 'fun',
    description: 'Sorteia um vencedor entre os usuários marcados.',
    usage: '!sorteio @user1 @user2 ...',
    cooldown: 3000,
    execute: async (ctx) => {
      const alvo = ctx.mentionedJid;
      if (!alvo.length) return ctx.reply('🎲 Marque os participantes: !sorteio @user1 @user2 ...');
      const winner = alvo[randInt(0, alvo.length - 1)];
      await ctx.reply(`🎉 *Sorteio entre ${alvo.length} participantes!*\n🏆 Vencedor(a): @${winner.split('@')[0]}!`);
    },
  },
  {
    name: 'escolher',
    commands: ['escolher', 'random'],
    category: 'fun',
    description: 'Escolhe aleatoriamente entre opções.',
    usage: '!escolher opção1, opção2, ...',
    cooldown: 2000,
    execute: async (ctx) => {
      const joined = ctx.args.join(' ');
      if (!joined) return ctx.reply('🎲 Use: !escolher opção1, opção2, ...');
      const options = joined.split(',').map((s) => s.trim()).filter(Boolean);
      if (options.length < 2) return ctx.reply('🎲 Separe pelo menos 2 opções por vírgula.');
      await ctx.reply(`🎲 Escolhi: *${pick(options)}*`);
    },
  },
  {
    name: 'verdadeoudesafio',
    commands: ['verdadeoudesafio', 'vod'],
    category: 'fun',
    description: 'Verdade ou desafio aleatório.',
    usage: '!verdadeoudesafio [@usuario]',
    cooldown: 2000,
    execute: async (ctx) => {
      const bank = [...R.verdade, ...R.desafio];
      await runInteraction(ctx, { action: 'verdadeoudesafio', responses: bank, karma: 1 });
    },
  },
];
