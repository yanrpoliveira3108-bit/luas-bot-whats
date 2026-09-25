/**
 * utils/safeNodeCache.js — o cache da biblioteca que NÃO estoura com chave inválida.
 *
 * O DEFEITO (aparelho do dono, 25/09/2026 — causa raiz PROVADA pelo primeiro
 * frame do stack: `at NodeCache.formatKey (…/@cacheable/node-cache/dist/index.cjs:509:16)`):
 *
 *   1. grupo em modo LID: `extractGroupMetadata` monta o participante como
 *      `id: attrs.phone_number` (Socket/groups.js:346). Em comunidade/LID esse
 *      atributo pode NÃO existir → `id` = `undefined`;
 *   2. o envio chama `getUSyncDevices(participantes)` e faz
 *      `const decoded = jidDecode(jid); const user = decoded?.user`
 *      (Socket/messages-send.js:243). `jidDecode(undefined)` devolve `undefined`
 *      (WABinary/jid-utils.js:21-25, não tem '@') → `user` = `undefined`;
 *   3. `userDevicesCache.get(undefined)` → `NodeCache.formatKey`
 *      (`return key.toString()`) → **TypeError: Cannot read properties of
 *      undefined (reading 'toString')**.
 *
 * Resultado no aparelho: TODO envio naquele grupo falhava (56→65 falhas), o
 * comando rodava, o "digitando…" aparecia e nada era enviado — inclusive o
 * reenvio sem citação, porque o erro não tem nada a ver com a citação.
 *
 * O nd de entrada da CORREÇÃO é duplo:
 *   • o patch na biblioteca (vendor/…/messages-send.js, marcado
 *     `[LUA-BOT-PATCH]`) descarta o destinatário sem jid decodificável;
 *   • este cache (passado ao socket como `userDevicesCache`) garante que uma
 *     chave inválida nunca mais derrube um envio: em vez de `key.toString()`,
 *     chave ausente vira um valor-sentinela que simplesmente não casa (miss).
 *
 * É a mesma ideia do resto do bot: a proteção fica na BORDA (aqui, no cache que
 * a biblioteca usa), para que nenhum caminho futuro repita o mesmo acidente.
 */

'use strict';

const logger = require('./logger').child('cache');
const mod = require('@cacheable/node-cache');
const NodeCache = mod && mod.default ? mod.default : mod;

/** Nome da chave-sentinela (nunca é usada por chave real da biblioteca). */
const CHAVE_INVALIDA = '__lua_bot_chave_invalida__';

const stats = { invalidas: 0, ultima: null };

class CacheSeguro extends NodeCache {
  /**
   * `formatKey` é o ponto exato onde o erro acontecia (`key.toString()`).
   * Aqui, chave ausente/ inválida NÃO lança: vira uma chave-sentinela (miss),
   * e o caso fica contado para o diagnóstico.
   */
  formatKey(key) {
    if (invalida(key)) return CHAVE_INVALIDA;
    if (typeof key === 'string') return key;
    try {
      return String(key);
    } catch (_) {
      stats.invalidas++;
      return CHAVE_INVALIDA;
    }
  }

  /* A biblioteca valida o TIPO da chave ANTES de formatar (`set` lança
     "The key argument has to be of type string or number"). Por isso os
     métodos também são protegidos: chave inválida não entra e não estoura. */
  get(key) {
    if (invalida(key)) return undefined;
    return super.get(key);
  }

  set(key, value, ttl) {
    if (invalida(key)) return false;
    return ttl === undefined ? super.set(key, value) : super.set(key, value, ttl);
  }

  has(key) {
    if (invalida(key)) return false;
    return super.has(key);
  }

  del(key) {
    if (invalida(key)) return 0;
    return super.del(key);
  }

  take(key) {
    if (invalida(key)) return undefined;
    return super.take(key);
  }

  /** Diagnóstico (para o doctor/`!freio`). */
  static stats() {
    return { invalidas: stats.invalidas, ultima: stats.ultima };
  }
}

/** Conta e marca uma chave inválida (usada pelos métodos acima e pelo formatKey). */
function invalida(key) {
  if (!(key === undefined || key === null || key === '')) return false;
  stats.invalidas++;
  stats.ultima = { at: new Date().toISOString(), chave: String(key) };
  if (stats.invalidas === 1) {
    logger.warn(
      "chave inválida no cache da biblioteca (era isso que estourava \"Cannot read properties of undefined (reading 'toString')\"): seguindo sem derrubar o envio"
    );
  }
  return true;
}

/** TTLs padrão da biblioteca (para o cache protegido se comportar IGUAL). */
function ttls() {
  try {
    return require('../vendor/boruto-vk7-baileys/lib/Defaults').DEFAULT_CACHE_TTLS || {};
  } catch (_) {
    return {};
  }
}

/**
 * Cria o cache protegido com as MESMAS opções que a biblioteca usa por padrão.
 * `para` diz qual uso (userDevices / signalStore) só para escolher o TTL igual.
 */
function criar(opcoes = {}, para = 'userDevices') {
  const t = ttls();
  const padrao = para === 'signalStore' ? t.SIGNAL_STORE : t.USER_DEVICES;
  return new CacheSeguro(
    Object.assign({ stdTTL: padrao || 300, useClones: false, deleteOnExpire: true }, opcoes)
  );
}

module.exports = { criar, CacheSeguro, CHAVE_INVALIDA, stats: () => CacheSeguro.stats(), NodeCache };
