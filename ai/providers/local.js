/**
 * ai/providers/local.js — assistente local (offline).
 *
 * NÃO é um LLM: é um assistente determinístico e honesto que resolve tarefas
 * concretas sem depender de rede. Para respostas livres em linguagem natural,
 * configure GROQ_API_KEY (provider remoto). O bot NUNCA finge ser mais do que é.
 */

'use strict';

const os = require('os');
const crypto = require('crypto');

/* ----------------------------- utilidades ----------------------------- */

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Avalia uma expressão aritmética simples de forma segura (sem eval). */
function safeMath(input) {
  const expr = String(input)
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/,/g, '.');
  if (!/^[-+*/().\d\s^%]+$/.test(expr) || !/\d/.test(expr)) return null;
  const withPow = expr.replace(/\^/g, '**');
  try {
    // eslint-disable-next-line no-new-func
    const value = Function(`"use strict"; return (${withPow});`)();
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.round(value * 1e6) / 1e6;
  } catch (_) {
    return null;
  }
}

/* ----------------------------- datasets ------------------------------- */

const DICT = {
  'hello': 'olá', 'hi': 'oi', 'good morning': 'bom dia', 'good night': 'boa noite',
  'thank you': 'obrigado(a)', 'thanks': 'obrigado', 'please': 'por favor',
  'yes': 'sim', 'no': 'não', 'water': 'água', 'food': 'comida', 'love': 'amor',
  'friend': 'amigo(a)', 'house': 'casa', 'car': 'carro', 'money': 'dinheiro',
  'work': 'trabalho', 'day': 'dia', 'night': 'noite', 'good': 'bom/boa',
  'bad': 'ruim', 'big': 'grande', 'small': 'pequeno', 'fast': 'rápido',
  'slow': 'lento', 'hot': 'quente', 'cold': 'frio', 'dog': 'cachorro',
  'cat': 'gato', 'bird': 'pássaro', 'time': 'tempo', 'city': 'cidade',
  'olá': 'hello', 'oi': 'hi', 'bom dia': 'good morning', 'boa noite': 'good night',
  'obrigado': 'thank you', 'obrigada': 'thank you', 'por favor': 'please',
  'sim': 'yes', 'não': 'no', 'água': 'water', 'comida': 'food', 'amor': 'love',
  'amigo': 'friend', 'amiga': 'friend', 'casa': 'house', 'carro': 'car',
  'dinheiro': 'money', 'trabalho': 'work', 'dia': 'day', 'noite': 'night',
  'bom': 'good', 'ruim': 'bad', 'grande': 'big', 'pequeno': 'small',
  'rápido': 'fast', 'lento': 'slow', 'quente': 'hot', 'frio': 'cold',
  'cachorro': 'dog', 'gato': 'cat', 'tempo': 'time', 'cidade': 'city',
};

const JOKES = [
  'Por que o livro de matemática ficou triste? Porque tinha muitos problemas. 📚',
  'O que o zero disse para o oito? "Que cinto maneiro!" 😄',
  'Por que o computador foi ao médico? Porque pegou um vírus. 🖥️',
  'Qual é o café mais perigoso? O ex-preso. ☕😅',
];

const FACTS = [
  'O coração de um camarão fica na cabeça. 🦐',
  'O mel nunca estraga: já foram encontrados potes com 3.000 anos. 🍯',
  'Polvos têm três corações. 🐙',
  'O Sol representa 99,86% da massa do Sistema Solar. ☀️',
];

const CONSELHOS = [
  'Faça uma pausa: a cada hora de tela, alongue-se por 5 minutos.',
  'Beba água ao longo do dia. Seu corpo agradece.',
  'Quebre tarefas grandes em passos pequenos — o progresso fica visível.',
  'Durma de 7 a 9 horas: é quando o cérebro consolida o aprendizado.',
  'Anote suas ideias assim que surgirem. Memória é traiçoeira.',
];

const PIADAS_DE_MESA = {
  charadas: [
    { p: 'O que é, o que é? Tem cabeça e não pensa, tem dente e não morde.', r: 'O alho. 🧄' },
    { p: 'O que é, o que é? Quanto mais seca, mais molhada fica.', r: 'A toalha. 🧻' },
    { p: 'O que é, o que é? Anda com os pés na cabeça.', r: 'O piolho. 🐜' },
    { p: 'O que é, o que é? Quanto mais se tira, maior fica.', r: 'O buraco. 🕳️' },
  ],
};

/* ------------------------- snippets de código ------------------------- */

function codeSnippet(input) {
  const t = input.toLowerCase();
  if (t.includes('olá mundo') || t.includes('ola mundo') || t.includes('hello world')) {
    return { lang: 'js', code: `console.log('Olá, mundo!');` };
  }
  if (t.includes('função') || t.includes('funcao') || t.includes('function')) {
    return {
      lang: 'js',
      code: `function soma(a, b) {\n  return a + b;\n}\n\n// uso:\nconsole.log(soma(2, 3)); // 5`,
    };
  }
  if (t.includes('fibonacci')) {
    return {
      lang: 'js',
      code: `function fibonacci(n) {\n  const seq = [0, 1];\n  for (let i = 2; i < n; i++) seq.push(seq[i - 1] + seq[i - 2]);\n  return seq.slice(0, n);\n}\n\nconsole.log(fibonacci(10));`,
    };
  }
  if (t.includes('fizzbuzz')) {
    return {
      lang: 'js',
      code: `for (let i = 1; i <= 100; i++) {\n  let out = '';\n  if (i % 3 === 0) out += 'Fizz';\n  if (i % 5 === 0) out += 'Buzz';\n  console.log(out || i);\n}`,
    };
  }
  if (t.includes('ordenar') || t.includes('sort')) {
    return {
      lang: 'js',
      code: `const numeros = [5, 3, 8, 1, 2];\nconst ordenados = [...numeros].sort((a, b) => a - b);\nconsole.log(ordenados); // [1, 2, 3, 5, 8]`,
    };
  }
  if (t.includes('servidor') || t.includes('http') || t.includes('server')) {
    return {
      lang: 'js',
      code: `const http = require('http');\n\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, { 'Content-Type': 'text/plain' });\n  res.end('Olá do Node!');\n});\n\nserver.listen(3000, () => console.log('Rodando na porta 3000'));`,
    };
  }
  return null;
}

/* ----------------------------- modos --------------------------------- */

function chatResponse(input) {
  const t = input.toLowerCase();

  if (/^(oi|olá|ola|opa|eae|eai|hey|hello|bom dia|boa tarde|boa noite)\b/.test(t)) {
    return `Olá! 👋 Eu sou o *${require('../../config').bot.name}*, seu assistente. Posso:\n` +
      '▸ fazer contas (ex.: "quanto é 15% de 80" ou "2+2*3")\n' +
      '▸ traduzir palavras comuns PT⇄EN\n' +
      '▸ gerar trechos de código (use !codigo)\n' +
      '▸ contar piadas, fatos e conselhos\n' +
      'Conversa livre por modelo remoto não está disponível no modo local.';
  }
  if (t.includes('quem é você') || t.includes('quem e voce') || t.includes('o que você é') || t.includes('o que voce e')) {
    return `Eu sou o *${require('../../config').bot.name}* 🌙, um bot de WhatsApp. Meu modo de IA atual é o *assistente local* (offline, sem LLM) — resolve contas, traduções básicas, código e curiosidades. O provider remoto não está disponível no momento.`;
  }
  if (t.includes('piada')) return pick(JOKES);
  if (t.includes('fato') || t.includes('curiosidade')) return pick(FACTS);
  if (t.includes('conselho')) return pick(CONSELHOS);
  if (t.includes('dado')) return `🎲 Você tirou *${1 + Math.floor(Math.random() * 6)}*!`;
  if (t.includes('cara ou coroa') || t.includes('moeda')) return pick(['🪙 *Cara!*', '🪙 *Coroa!*']);

  const m = safeMath(t);
  if (m !== null) return `🧮 O resultado é *${m}*`;

  const mh = t.match(/(?:quanto é|quanto e|calcule)?\s*(\d+(?:[.,]\d+)?)\s*(?:%|por cento)\s*(?:de|do|da)?\s*(\d+(?:[.,]\d+)?)/);
  if (mh) {
    const a = parseFloat(mh[1].replace(',', '.'));
    const b = parseFloat(mh[2].replace(',', '.'));
    return `🧮 ${a}% de ${b} = *${Math.round(a / 100 * b * 100) / 100}*`;
  }

  if (/^(ajuda|help|menu)/.test(t)) {
    return '💡 Use !ia <pergunta>, !codigo <pedido>, !traduzir <idioma> <texto>, !resumir (respondendo a uma mensagem) e !aistatus.';
  }

  // tradução de palavra única (local)
  const word = t.split(/\s+/).filter((w) => /[a-záéíóúâêôãõçü]/.test(w));
  if (word.length <= 3) {
    const hit = word.map((w) => DICT[w.toLowerCase()]).find(Boolean);
    if (hit) return `🌎 Tradução local: *${hit}*`;
  }

  return '🤖 Sou o assistente *local* (offline): sei fazer contas, traduzir palavras comuns, gerar código simples, piadas, fatos e conselhos. Conversa livre por modelo remoto não está disponível no modo local.';
}

function codeResponse(input) {
  const s = codeSnippet(input);
  if (s) return `\`\`\`${s.lang}\n${s.code}\n\`\`\``;
  return '💻 Não tenho um snippet pronto para isso. Sou um assistente local; para código livre, o provider remoto precisa estar disponível. Peça algo como "função JS", "fibonacci", "servidor http" ou "ordenar array".';
}

function translateResponse(input) {
  // formato aceito: <idioma> <texto...> ou texto solto
  const tokens = String(input).trim().split(/\s+/);
  let lang = null;
  let rest = tokens;
  const langs = { 'inglês': 'en', 'ingles': 'en', 'en': 'en', 'english': 'en', 'português': 'pt', 'portugues': 'pt', 'pt': 'pt', 'espanhol': 'es', 'es': 'es' };
  if (tokens[0] && langs[tokens[0].toLowerCase()]) {
    lang = langs[tokens[0].toLowerCase()];
    rest = tokens.slice(1);
  }
  const text = rest.join(' ').toLowerCase();
  if (!text) return '⚠️ Envie o texto: !traduzir <idioma> <texto>.';

  const hit = DICT[text] || (text.split(' ').map((w) => DICT[w]).filter(Boolean).join(' '));
  if (hit) return `🌎 Tradução (${lang || 'auto'}): *${hit}*`;
  return '🌎 Não conheço esse texto no modo local (dicionário limitado PT⇄EN). O provider remoto precisa estar disponível para tradução completa, ou peça palavras simples como "hello", "água", "cachorro".';
}

function summarizeResponse(input) {
  const clean = String(input)
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '📄 Nada para resumir. Responda a uma mensagem de texto com !resumir.';
  const sentences = clean.split(/(?<=[.!?])\s+/).filter((s) => s.length > 3);
  if (sentences.length <= 2) {
    return `📄 *Resumo:*\n${sentences.join(' ')}`;
  }
  // resumo extrativo: primeira frase + frases com palavras-chave
  const words = clean.toLowerCase().split(/[^a-záéíóúâêôãõçü]+/).filter((w) => w.length > 3);
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
  const scored = sentences.slice(1).map((s, i) => ({
    s,
    i,
    score: top.reduce((acc, w) => acc + (s.toLowerCase().includes(w) ? 1 : 0), 0),
  }));
  const picked = scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 2).sort((a, b) => a.i - b.i).map((x) => x.s);
  const summary = [sentences[0], ...picked].join(' ');
  return `📄 *Resumo (extrativo):*\n${summary}\n\n_(${clean.length} caracteres → ${summary.length})_`;
}

/* ------------------------------ handler ------------------------------- */

/**
 * @param {{ chatId, userId, text, mode, history }} ctx
 * @returns {Promise<{ ok:true, text, provider:'local', model:'assistente-local' }>}
 */
async function handle({ text, mode }) {
  const input = String(text || '').trim();
  let out;
  switch (mode) {
    case 'code':
      out = codeResponse(input);
      break;
    case 'translate':
      out = translateResponse(input);
      break;
    case 'summarize':
      out = summarizeResponse(input);
      break;
    default:
      out = chatResponse(input);
  }
  return { ok: true, text: out, provider: 'local', model: 'assistente-local' };
}

module.exports = { handle, name: 'local', isConfigured: () => true, capabilities: ['math', 'dictionary', 'snippets', 'jokes'] };
