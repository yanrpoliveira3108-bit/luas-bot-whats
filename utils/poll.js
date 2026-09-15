/**
 * utils/poll.js — parser e renderização visual de enquetes (!poll / !pollresult).
 *
 * Duas responsabilidades:
 *   1. parse estrito dos argumentos, incluindo os opcionais "--chave=valor";
 *   2. desenho da caixa da enquete (40 colunas, padding 2, quebra de linha com
 *      recuo de continuação alinhado ao texto).
 *
 * Nada aqui envia mensagem: o envio fica em utils/pendingPoll.js, depois da
 * confirmação do usuário.
 */

'use strict';

/**
 * Largura TOTAL de cada linha da caixa, incluindo as bordas │.
 * Com PAD=2 de cada lado, sobram INNER colunas de texto.
 *
 * Obs.: o briefing traz a conta "40 - 2 - 2 = 36 úteis", que ignora as duas
 * bordas; os desenhos de exemplo (e a regra "exatamente 40 caracteres,
 * incluindo bordas") fecham em 40 com 34 de texto. BOX_WIDTH é o ponto único
 * de ajuste: troque para 42 e o conteúdo interno passa a ter 36 colunas.
 */
const BOX_WIDTH = 40;
const PAD = 2;
const INNER = BOX_WIDTH - 2 - PAD * 2; // 34 colunas de texto

/** Limites de segurança contra valores absurdos. */
const MAX_VOTES = 1000000000; // 1 bilhão
const MAX_OPTIONS = 12;
const MAX_NAME = 300;

const segmenter = new Intl.Segmenter('pt', { granularity: 'grapheme' });

/** Texto em grafeamas (acentos e emoji contam 1). */
function graphemes(text) {
  return [...segmenter.segment(String(text == null ? '' : text))].map((s) => s.segment);
}

/** Largura VISUAL: ignora marcadores de formatação (* _ ~ `). */
function visualWidth(text) {
  return graphemes(String(text == null ? '' : text).replace(/[*_~`]/g, '')).length;
}

/**
 * Quebra em linhas de até `width` colunas visuais, sem cortar palavra quando
 * der. Palavra maior que a largura é cortada no limite (não há alternativa).
 */
function wrapText(text, width) {
  const raw = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!raw) return [''];
  if (visualWidth(raw) <= width) return [raw];

  const lines = [];
  let current = '';
  for (const word of raw.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (visualWidth(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    // palavra maior que a linha: fatia no limite
    let rest = word;
    while (visualWidth(rest) > width) {
      const g = graphemes(rest);
      lines.push(g.slice(0, width).join(''));
      rest = g.slice(width).join('');
    }
    current = rest;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/** Uma linha da caixa: │ + 2 espaços + conteúdo + preenchimento + │ */
function boxLine(content) {
  const body = String(content == null ? '' : content);
  // padding esquerdo (2) + texto + preenchimento + padding direito (2) + 2 bordas = 40
  const fill = Math.max(0, INNER - visualWidth(body)) + PAD;
  return `│${' '.repeat(PAD)}${body}${' '.repeat(fill)}│`;
}

/**
 * Desenha a enquete.
 * @param {object} opts
 * @param {string} opts.title  título (mesmo padding das opções)
 * @param {string[]} opts.items linhas já montadas ("Lua") ou pares para resultado
 * @param {boolean} [opts.numbered=true] prefixa com "1. ", "2. "…
 * @param {(i:number)=>string} [opts.suffix] texto extra por item (ex.: " → 1000 votos")
 */
function renderBox(opts) {
  const { title = '', items = [], numbered = true, suffix } = opts || {};
  const lines = ['┌' + '─'.repeat(BOX_WIDTH - 2) + '┐'];

  // título: sem prefixo de numeração, continuação usa só o padding
  const titleLines = wrapText(title, INNER);
  for (const t of titleLines) lines.push(boxLine(t));
  lines.push(boxLine(''));

  items.forEach((item, i) => {
    const prefix = numbered ? `${i + 1}. ` : '';
    const text = typeof suffix === 'function' ? `${item}${suffix(i)}` : String(item);
    const width = INNER - prefix.length;
    const wrapped = wrapText(text, width);
    wrapped.forEach((part, idx) => {
      // continuação alinha exatamente abaixo do texto (padding + prefixo)
      const body = idx === 0 ? prefix + part : ' '.repeat(prefix.length) + part;
      lines.push(boxLine(body));
    });
  });

  lines.push('└' + '─'.repeat(BOX_WIDTH - 2) + '┘');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ parser */

/** Parâmetros opcionais conhecidos por comando. */
const PARAM_SPECS = {
  poll: { selectableCount: 'number', announcement: 'bool' },
  pollResult: { announcement: 'bool' },
};

/**
 * Inteiro positivo estrito: só dígitos, sem "0" à esquerda, sem sinal, sem
 * decimais. A conversão só acontece depois da validação de formato.
 */
function parsePositiveInteger(value) {
  const s = String(value == null ? '' : value);
  if (!/^\d+$/.test(s)) return null;
  if (s.length > 1 && s[0] === '0') return null; // "01"
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return n;
}

/** Igual ao anterior, mas aceita 0. */
function parseNonNegativeInteger(value) {
  const s = String(value == null ? '' : value);
  if (!/^\d+$/.test(s)) return null;
  if (s.length > 1 && s[0] === '0') return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

function parseBool(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return null;
}

/**
 * Extrai os "--chave=valor" de qualquer posição e devolve o texto sem eles.
 * Só é parâmetro o que casa exatamente com --letra[letrasDigitos]=valor.
 */
function extractParams(text, kind) {
  const spec = PARAM_SPECS[kind] || {};
  const params = {};
  const errors = [];
  const cleaned = String(text == null ? '' : text).replace(
    /--([A-Za-z][A-Za-z0-9]*)(?:=([^\s|]*))?/g,
    (match, key, value) => {
      if (!Object.prototype.hasOwnProperty.call(spec, key)) {
        errors.push(
          `❌ Parâmetro desconhecido: *--${key}*\n\nAceitos em ${kind === 'poll' ? '!poll' : '!pollresult'}: ${Object.keys(spec)
            .map((k) => `--${k}`)
            .join(', ')}`
        );
        return '';
      }
      if (value === undefined) {
        errors.push(`❌ Faltou o valor de *--${key}*.\n\nUse --${key}=valor (ex: --${key}=${spec[key] === 'bool' ? 'true' : '2'})`);
        return '';
      }
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        errors.push(`❌ Parâmetro repetido: *--${key}*. Informe apenas uma vez.`);
        return '';
      }
      if (spec[key] === 'bool') {
        const b = parseBool(value);
        if (b === null) {
          errors.push(`❌ Valor inválido em *--${key}=${value || ''}*.\n\nO parâmetro --${key} aceita somente:\n▸ true\n▸ false`);
          return '';
        }
        params[key] = b;
        return '';
      }
      const n = parsePositiveInteger(value);
      if (n === null) {
        errors.push(
          `❌ Valor inválido em *--${key}=${value || ''}*.\n\nO parâmetro --${key} deve ser um número inteiro\nentre 1 e a quantidade de opções disponíveis.\n\nExemplo: --${key}=2`
        );
        return '';
      }
      params[key] = n;
      return '';
    }
  );
  return { params, errors, cleaned };
}

/** Divide em segmentos por "|" preservando a ordem. */
function splitSegments(text) {
  return String(text == null ? '' : text)
    .split('|')
    .map((s) => s.replace(/\s+/g, ' ').trim());
}

/**
 * !poll <pergunta> | <opção> | <opção> [--selectableCount=N] [--announcement=bool]
 * @returns {{ok:true, poll:object}|{ok:false, error:string}}
 */
function parsePoll(text) {
  const { params, errors, cleaned } = extractParams(text, 'poll');
  if (errors.length) return { ok: false, error: errors[0] };

  // segmento vazio entre "|" é opção vazia — rejeitado abaixo
  const rawSegments = splitSegments(cleaned);
  if (rawSegments.length < 1 || !rawSegments[0]) {
    return { ok: false, error: '❌ A pergunta da enquete é obrigatória.\n\nExemplo: !poll Qual linguagem você prefere? | Lua | JavaScript' };
  }

  const name = rawSegments[0];
  if (visualWidth(name) > MAX_NAME) {
    return { ok: false, error: `❌ Pergunta muito longa (${visualWidth(name)} caracteres). Máximo: ${MAX_NAME}.` };
  }

  const optionSegments = rawSegments.slice(1);
  if (optionSegments.some((s) => s === '')) {
    return { ok: false, error: '❌ Há uma opção vazia entre os "|".\n\nExemplo: !poll Pergunta? | Lua | JavaScript' };
  }
  if (optionSegments.length < 2) {
    return { ok: false, error: '❌ A enquete precisa de pelo menos *2 opções*.\n\nExemplo: !poll Qual linguagem você prefere? | Lua | JavaScript | Python' };
  }
  if (optionSegments.length > MAX_OPTIONS) {
    return { ok: false, error: `❌ Máximo de ${MAX_OPTIONS} opções (vieram ${optionSegments.length}).` };
  }
  const dup = optionSegments.find((s, i) => optionSegments.indexOf(s) !== i);
  if (dup) return { ok: false, error: `❌ Opção repetida: *${dup}*. Cada opção precisa ser única.` };

  const values = optionSegments;
  const selectableCount = params.selectableCount === undefined ? 1 : params.selectableCount;
  if (selectableCount > values.length) {
    return {
      ok: false,
      error: `❌ Valor inválido em *--selectableCount=${selectableCount}*.\n\nO parâmetro --selectableCount deve ser um número inteiro\nentre 1 e a quantidade de opções disponíveis (${values.length}).\n\nExemplo: --selectableCount=${values.length}`,
    };
  }

  return {
    ok: true,
    poll: {
      name,
      values,
      selectableCount,
      toAnnouncementGroup: params.announcement === undefined ? false : params.announcement,
    },
  };
}

/**
 * !pollresult <nome> | <opção>:<votos> | ... [--announcement=bool]
 * @returns {{ok:true, pollResult:object, announcement:boolean}|{ok:false, error:string}}
 */
function parsePollResult(text) {
  const { params, errors, cleaned } = extractParams(text, 'pollResult');
  if (errors.length) return { ok: false, error: errors[0] };

  const rawSegments = splitSegments(cleaned);
  if (!rawSegments[0]) {
    return { ok: false, error: '❌ O nome da enquete é obrigatório.\n\nExemplo: !pollresult Minha enquete | Lua:1000 | JavaScript:2000' };
  }
  const name = rawSegments[0];

  const entries = rawSegments.slice(1);
  if (entries.some((s) => s === '')) {
    return { ok: false, error: '❌ Há um resultado vazio entre os "|".\n\nExemplo: !pollresult Minha enquete | Lua:1000 | JavaScript:2000' };
  }
  if (entries.length < 2) {
    return { ok: false, error: '❌ Informe pelo menos *2 resultados*.\n\nExemplo: !pollresult Minha enquete | Lua:1000 | JavaScript:2000' };
  }
  if (entries.length > MAX_OPTIONS) {
    return { ok: false, error: `❌ Máximo de ${MAX_OPTIONS} resultados (vieram ${entries.length}).` };
  }

  const values = [];
  for (const entry of entries) {
    const idx = entry.lastIndexOf(':');
    if (idx <= 0) {
      return {
        ok: false,
        error: `❌ Resultado sem quantidade de votos: *${entry}*\n\nUse o formato opção:votos.\nExemplo: ${entry.split(':')[0] || 'Lua'}:100`,
      };
    }
    const optionName = entry.slice(0, idx).trim();
    const rawVotes = entry.slice(idx + 1).trim();
    if (!optionName) {
      return { ok: false, error: `❌ Resultado sem nome de opção: *${entry}*` };
    }
    const votes = parseNonNegativeInteger(rawVotes);
    if (votes === null) {
      return {
        ok: false,
        error: `❌ Quantidade de votos inválida em *${entry}*.\n\nOs votos devem ser um número inteiro maior ou igual a 0.\n\nExemplo: ${optionName}:100`,
      };
    }
    if (votes > MAX_VOTES) {
      return { ok: false, error: `❌ Quantidade de votos alta demais em *${entry}*.\n\nMáximo aceito: ${MAX_VOTES}.` };
    }
    values.push([optionName, votes]);
  }

  const dup = values.map((v) => v[0]).find((s, i, arr) => arr.indexOf(s) !== i);
  if (dup) return { ok: false, error: `❌ Opção repetida: *${dup}*.` };

  return {
    ok: true,
    pollResult: { name, values },
    announcement: params.announcement === undefined ? false : params.announcement,
  };
}

module.exports = {
  BOX_WIDTH,
  PAD,
  INNER,
  MAX_VOTES,
  MAX_OPTIONS,
  MAX_NAME,
  visualWidth,
  graphemes,
  wrapText,
  renderBox,
  extractParams,
  parsePositiveInteger,
  parseNonNegativeInteger,
  parseBool,
  splitSegments,
  parsePoll,
  parsePollResult,
};
