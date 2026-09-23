/**
 * menus/html/actions.js — o que o botão "Usar" pode fazer, DERIVADO do registro.
 *
 * Contexto (por que este arquivo existe) — e de onde vem cada afirmação:
 *
 *   (1) quem mediu em aparelho foram os projetos que publicaram o mesmo método
 *       de card (upstream `@rexxhayanasi/elaina-baileys` e a documentação do
 *       `@Yudzxml/Baileys`, de onde sai o formato que `utils/richHtml.js`
 *       replica). O que eles relatam do WebView do card, no Android:
 *
 *         location.origin    = null      (document.baseURI = about:blank)
 *         location.protocol  = about:
 *         isSecureContext    = false
 *         rede: fetch / XHR / <script> remoto / <img> remoto / <iframe> → não
 *               carregam (sem evento de erro/securitypolicyviolation)
 *         trustedSources     = não muda isso (testado com host dentro e fora)
 *         storage            = localStorage/sessionStorage/cookie/indexedDB
 *                              lançam SecurityError
 *         ponte JS           = só `AndroidBridge.updateSize` (altura do card)
 *       Nós NÃO conseguimos repetir essa medição daqui (o sandbox não tem o
 *       WebView do WhatsApp) — então isto é documentação de terceiros, tratada
 *       como hipótese de projeto, não como medida nossa.
 *
 *   (2) o sintoma relatado no aparelho do dono: com `!modohtml on`, o "Usar"
 *       antigo (`<a href="https://wa.me/<bot>?text=!comando">`) não realizava a
 *       ação esperada.
 *
 * Juntando (1) e (2): não há como contar com navegação/clique-em-link dentro do
 * card, e não existe canal HTML→bot comprovado. O único transporte que sai da
 * página é um WebSocket `wss://` (também relatado por (1)), mas ele não prova
 * quem tocou — o card de grupo é uma página só para todos — então não serve
 * para executar comando com permissão.
 *
 * O que sobra, e é o que fazemos: o botão "Usar" monta o comando COMPLETO no
 * próprio aparelho (campos validados a partir do `usage` real do comando) e
 * oferece a cópia para o usuário enviar. Quando o comando tem argumentos, os
 * campos são pedidos antes; quando exige mídia/menção/resposta, o card avisa
 * que esse contexto só existe no chat. Quem executa continua sendo o pipeline
 * de comandos de sempre, com permissão/limite/validação e a identidade REAL de
 * quem mandou a mensagem.
 *
 * Este módulo é lógica pura (sem HTML, sem socket): é o espelho, em Node, do
 * mesmo cálculo que o client.js faz no aparelho — e é testável.
 */

'use strict';

/** Limite de campos só para não explodir com usage esquisito. */
const MAX_CAMPOS = 4;

/**
 * Corta o usage na PRIMEIRA variante.
 * `usage` no projeto às vezes lista usos alternativos separados por " | "
 * (ex.: `!apagar @user [quantidade] | !apagar [quantidade] (apaga do bot)`).
 * Os campos vêm sempre da primeira variante.
 */
function primeiroUso(usage) {
  const t = String(usage || '').trim();
  if (!t) return '';
  const partes = t.split(/\s+\|\s+/);
  return partes[0].trim();
}

/** Remove o nome do comando do começo do usage (o card já mostra o nome). */
function somenteArgumentos(usage, trigger) {
  let t = primeiroUso(usage);
  if (!t) return '';
  // tira o primeiro token (ex.: "!ytmp3"), com ou sem prefixo
  t = t.replace(/^\S+\s*/, '');
  if (trigger) {
    const semPrefixo = String(trigger).replace(/^[^\w]+/, '');
    if (!t && String(primeiroUso(usage)).replace(/^[^\w]+/, '') === semPrefixo) return '';
  }
  return t.trim();
}

/** Um token dentro de `<...>`/`[...]`, com escolhas `<a|b|c>`. */
function tokenParaCampo(bruto, obrigatorio) {
  const nome = String(bruto || '').trim();
  if (!nome) return null;
  if (nome.length > 24) return null; // texto solto, não é campo
  const escolhas = nome.includes('|') ? nome.split('|').map((s) => s.trim()).filter(Boolean) : [];
  const dica = escolhas.length ? escolhas.join(', ') : nome;
  const tipo = /^@/.test(nome) ? 'mencao' : /link|url|site|vídeo|video/i.test(nome) ? 'link' : 'texto';
  return {
    nome,
    rotulo: dica,
    obrigatorio: !!obrigatorio,
    opcoes: escolhas,
    tipo,
  };
}

/**
 * Campos pedidos pelo comando, lidos do `usage` real (nada inventado):
 *   `<x>`      → obrigatório
 *   `[x]`      → opcional
 *   `<a|b|c>`  → escolha
 *   `on|off`   → escolha opcional (usage sem colchetes, ex.: `!aimemory on|off`)
 * Ignorados: exemplo solto (`5511...`), texto entre parênteses, alternativas `|`.
 */
function camposDoUso(usage, trigger) {
  const args = somenteArgumentos(usage, trigger);
  if (!args) return [];

  const campos = [];
  // Varre os tokens EM ORDEM (argumentos são posicionais):
  //   <x>        obrigatório
  //   [x]        opcional
  //   @usuario   obrigatório (menção — o bot precisa da menção real)
  //   a|b|c      escolha opcional (usage sem colchetes, ex.: `!aimemory on|off`)
  const tokens = args.match(/<[^<>]*>|\[[^\[\]]*\]|@\S+|\S+/g) || [];
  for (const tk of tokens) {
    if (campos.length >= MAX_CAMPOS) break;
    if (tk.startsWith('<') && tk.endsWith('>')) {
      const campo = tokenParaCampo(tk.slice(1, -1), true);
      if (campo) campos.push(campo);
      continue;
    }
    if (tk.startsWith('[') && tk.endsWith(']')) {
      const campo = tokenParaCampo(tk.slice(1, -1), false);
      if (campo) campos.push(campo);
      continue;
    }
    if (tk.startsWith('@')) {
      const campo = tokenParaCampo(tk.replace(/[.,;)]+$/, ''), true);
      if (campo) campos.push(campo);
      continue;
    }
    // `on|off|clear|status` solto: escolha, mas opcional (o comando costuma ter
    // um modo padrão quando vem sem argumento).
    if (tk.includes('|') && tk.split('|').length <= 6) {
      const campo = tokenParaCampo(tk, false);
      if (campo && campo.opcoes.length) campos.push(campo);
    }
  }

  // Dedup por nome (usage repetido), preservando a ordem.
  const vistos = new Set();
  return campos.filter((c) => {
    const k = c.nome.toLowerCase();
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

/**
 * Texto do comando (usage/description) que denuncia necessidade de contexto.
 * Heurística DELIBERADAMENTE estreita: só marca quando o texto manda responder
 * ou mencionar. Nada de adivinhar por nome de comando.
 */
const PADROES = [
  { chave: 'resposta', re: /responda|responde a\b|em resposta|responder (a|à|a uma)|mensagem respondida|quote/i },
  { chave: 'mencao', re: /mencione|mencionar|marque (@|o usuário|a pessoa)|@usuario|@usuário/i },
  { chave: 'midia', re: /(imagem|foto|vídeo|video|áudio|audio|sticker|figurinha)[^.]{0,40}(respond|enviad|anexad)|(respond|enviad|anexad)[^.]{0,40}(imagem|foto|vídeo|video|áudio|audio|sticker|figurinha)/i },
];

/** Requisitos do comando: flags do registro + sinais do texto. */
function requisitosDe(cmd) {
  const c = cmd || {};
  const texto = `${c.usage || ''} ${c.description || ''}`;
  const req = {
    grupo: !!c.groupOnly,
    dono: !!c.ownerOnly,
    admin: !!c.adminOnly,
    botAdmin: !!c.botAdmin,
    pv: !!c.privateOnly,
    resposta: false,
    mencao: false,
    midia: false,
  };
  for (const p of PADROES) {
    if (p.re.test(texto)) req[p.chave] = true;
  }
  // Campo de menção no usage já é sinal suficiente.
  if (camposDoUso(c.usage, (c.commands && c.commands[0]) || c.name).some((f) => f.tipo === 'mencao')) {
    req.mencao = true;
  }
  return req;
}

/** Códigos compactos usados no HTML (menos bytes no payload). */
function flagsCompactas(req) {
  const r = req || {};
  const out = [];
  if (r.grupo) out.push('g');
  if (r.dono) out.push('d');
  if (r.admin) out.push('a');
  if (r.botAdmin) out.push('ba');
  if (r.pv) out.push('pv');
  if (r.resposta) out.push('r');
  if (r.mencao) out.push('m');
  if (r.midia) out.push('md');
  return out.join(',');
}

/** Explicação curta de um código (usada no card e no painel do cliente). */
const EXPLICACOES = {
  g: 'este comando só funciona no grupo',
  d: 'só o dono do bot pode usar',
  a: 'só admin do grupo pode usar',
  ba: 'o bot precisa ser admin do grupo',
  pv: 'este comando é só no privado',
  r: 'responda uma mensagem com este comando',
  m: 'escreva @ e escolha a pessoa no chat (menção de verdade)',
  md: 'funciona com mídia enviada ou respondida no chat',
};

/**
 * Comando pronto, na ordem dos campos (argumentos são posicionais).
 * Opcional só entra se todos os anteriores também entraram — senão o valor
 * cairia no lugar errado.
 */
function montarComando(prefix, trigger, campos, valores) {
  const p = prefix === undefined || prefix === null ? '!' : String(prefix);
  const nome = p + String(trigger || '');
  const partes = [];
  const cs = campos || [];
  const vs = valores || [];
  for (let i = 0; i < cs.length; i++) {
    const v = String(vs[i] === undefined || vs[i] === null ? '' : vs[i]).trim();
    // Vazio (obrigatório ou opcional) para a montagem: os argumentos são
    // posicionais e um valor depois do vazio cairia no lugar errado.
    if (!v) break;
    partes.push(v);
  }
  return partes.length ? `${nome} ${partes.join(' ')}` : nome;
}

/**
 * Validação (mesma regra do cliente, espelhada aqui para teste).
 * @returns {{ok:boolean, erros:Object}}
 */
function validarCampos(campos, valores) {
  const erros = {};
  const cs = campos || [];
  const vs = valores || [];
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const v = String(vs[i] === undefined || vs[i] === null ? '' : vs[i]).trim();
    if (!v) {
      if (c.obrigatorio) erros[c.nome] = `Preencha ${c.rotulo || c.nome}.`;
      continue;
    }
    if (c.opcoes && c.opcoes.length && !c.opcoes.includes(v)) {
      erros[c.nome] = `Use uma destas opções: ${c.opcoes.join(', ')}.`;
      continue;
    }
    if (c.tipo === 'mencao' && !v.startsWith('@')) {
      erros[c.nome] = 'Para mencionar alguém use @ no chat (digitar @nome não marca ninguém).';
      continue;
    }
    if (c.tipo === 'link' && /\s/.test(v) && /^https?:\/\//i.test(v) === false && v.includes('.')) {
      erros[c.nome] = 'Isso parece um link com espaço. Confira o endereço.';
    }
  }
  return { ok: Object.keys(erros).length === 0, erros };
}

/** Spec do comando usada pelo card (o que o cliente precisa, e só isso). */
function specDoComando(cmd, opts = {}) {
  const c = cmd || {};
  const trigger = (c.commands && c.commands[0]) || c.name || '';
  const campos = camposDoUso(c.usage, trigger);
  const req = requisitosDe(c);
  return {
    trigger,
    campos,
    req,
    flags: flagsCompactas(req),
    args: somenteArgumentos(c.usage, trigger),
    exemplo: String(c.usage || '').trim() || `${opts.prefix || '!'}${trigger}`,
  };
}

/** Frases de requisito para o painel (uma por requisito ativo). */
function avisosDe(req) {
  const r = req || {};
  const out = [];
  const mapa = [
    ['g', 'grupo'],
    ['d', 'dono'],
    ['a', 'admin'],
    ['ba', 'botAdmin'],
    ['pv', 'pv'],
    ['r', 'resposta'],
    ['m', 'mencao'],
    ['md', 'midia'],
  ];
  for (const [k, campo] of mapa) {
    if (r[campo]) out.push(EXPLICACOES[k]);
  }
  return out;
}

module.exports = {
  MAX_CAMPOS,
  primeiroUso,
  somenteArgumentos,
  camposDoUso,
  requisitosDe,
  flagsCompactas,
  montarComando,
  validarCampos,
  specDoComando,
  avisosDe,
  EXPLICACOES,
};
