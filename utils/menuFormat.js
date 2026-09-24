/**
 * utils/menuFormat.js — decisão ÚNICA do formato dos menus.
 *
 * Todos os pontos de entrada de menu (menu principal, categorias, atalhos
 * `!menuadm`/`!menumembros`, …) passam por aqui. Assim:
 *   - existe um só lugar que sabe se o formato é HTML ou tradicional;
 *   - o menu tradicional continua sendo o caminho de sempre quando o HTML não
 *     é usado (nada foi removido);
 *   - com o modo desligado, `menus/html/*` NUNCA é carregado (require
 *     preguiçoso) — nada de processar template à toa.
 *
 * Escopo da configuração: GLOBAL (ver database/settings.js), mesmo padrão do
 * `!botao on/off` e do `!tema`. O comando que altera é restrito ao dono.
 *
 * Interação com o modo seguro (`!freio seguro on` → utils/safety.js):
 * o card HTML é um payload de "bot IA" e o modo seguro o BLOQUEIA. Nesse caso
 * o formato volta ao tradicional — o `!modohtml` continua ligado, mas há uma
 * razão explícita para não render HTML (mostrada no `!modohtml`).
 */

'use strict';

const settings = require('../database/settings');
const CONFIG = require('../config');

const ESCOPO = 'global';

/** Preferência do dono (persistida no banco). Padrão: desligado. */
function htmlAtivo() {
  try {
    return settings.menuHtmlEnabled();
  } catch (_) {
    return false;
  }
}

/** O modo seguro permite card HTML agora? */
function htmlPermitido() {
  try {
    return !require('./safety').blocksRichCards();
  } catch (_) {
    return true;
  }
}

/** Resumo usado pelo `!modohtml` (estado + motivo, sem enganar o usuário). */
function status() {
  const enabled = htmlAtivo();
  const allowed = htmlPermitido();
  let safeMode = false;
  try {
    safeMode = require('./safety').safeMode();
  } catch (_) {
    safeMode = !!CONFIG.safety.safeMode;
  }
  return {
    enabled,
    allowed,
    active: enabled && allowed,
    scope: ESCOPO,
    safeMode,
    motivo: !enabled
      ? 'desligado (padrão)'
      : allowed
        ? 'ligado'
        : 'ligado, mas o MODO SEGURO bloqueia cards HTML',
  };
}

/** Ativa/desativa (persistido). Retorna o status novo. */
function setEnabled(on) {
  settings.setMenuHtmlEnabled(!!on);
  return status();
}

/**
 * Tenta abrir o menu em HTML.
 * @param {object} ctx contexto do comando
 * @param {object} opts { kind, categoria, foco, forceText }
 * @returns {Promise<boolean>} true = já respondeu em HTML; false = use o
 *          menu tradicional (esta função NÃO envia nada nesse caso)
 */
async function abrir(ctx, opts = {}) {
  if (opts.forceText) return false;
  if (!htmlAtivo()) return false;
  if (!htmlPermitido()) return false;
  if (!ctx || typeof ctx.reply !== 'function' || !ctx.socket) return false;

  // require preguiçoso: só com o modo ligado e permitido
  try {
    const html = require('../menus/html');
    return await html.enviar(ctx, opts);
  } catch (err) {
    // Nunca deixa o menu quebrar: cai no tradicional.
    try {
      require('./logger').child('menuFormat').warn({ err: err && err.message }, 'falha no menu HTML — tradicional');
    } catch (_) {}
    return false;
  }
}

/**
 * O dono já mexeu na chave `menu_html` alguma vez?
 * Permite distinguir "desligado de propósito" de "nunca configurou".
 */
function htmlFoiConfigurado() {
  try {
    return settings.get('menu_html', null) !== null;
  } catch (_) {
    return false;
  }
}

/**
 * Decisão de HTML para os JOGOS (caça ao tesouro e tigrinho).
 *
 * Diferença em relação aos MENUS (htmlAtivo): o menu tradicional continua sendo
 * o padrão de quem nunca configurou nada; já o tigrinho SEMPRE enviou o card
 * visual, e o caça ao tesouro é pedido como interface HTML. Então:
 *   - `!modohtml on`  → card (HTML);
 *   - `!modohtml off` → texto (o fluxo textual tem os MESMOS dados e ações);
 *   - nunca configurado → card (comportamento que os jogos já tinham);
 *   - modo seguro ligado → nunca card (o payload é bloqueado).
 * @returns {{usar:boolean, motivo:string}}
 */
function usarHtmlJogo() {
  if (!htmlPermitido()) return { usar: false, motivo: 'modo seguro bloqueia cards HTML' };
  if (htmlFoiConfigurado() && !htmlAtivo()) return { usar: false, motivo: 'modohtml desligado' };
  return { usar: true, motivo: htmlAtivo() ? 'modohtml ligado' : 'padrão dos jogos' };
}

module.exports = {
  ESCOPO,
  htmlAtivo,
  htmlPermitido,
  htmlFoiConfigurado,
  usarHtmlJogo,
  status,
  setEnabled,
  abrir,
};
