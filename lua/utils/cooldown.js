/**
 * utils/cooldown.js — gerenciador de cooldown (por comando, usuário e grupo).
 *
 * Singleton global. Protege contra spam e uso duplicado de comandos.
 */

'use strict';

const CONFIG = require('../config');
const { formatDuration } = require('./formatter');

class CooldownManager {
  constructor() {
    // chave -> { until }
    this.cooldowns = new Map();
  }

  _key(scope, id, command) {
    return `${scope}:${id}:${command}`;
  }

  /**
   * Verifica se um comando pode rodar agora.
   * @returns {{allowed:boolean, remaining:number}}
   */
  check(command, ctx) {
    const cooldownMs = Number(command.cooldown) || CONFIG.limits.defaultCooldownMs;
    if (cooldownMs <= 0) return { allowed: true, remaining: 0 };

    const now = Date.now();
    const keys = [];

    // por usuário
    if (ctx.sender) keys.push(this._key('user', ctx.sender, command.name));
    // por grupo
    if (ctx.isGroup) keys.push(this._key('group', ctx.remoteJid, command.name));
    // global do comando (evita flood extremo)
    keys.push(this._key('global', '*', command.name));

    let remaining = 0;
    for (const k of keys) {
      const entry = this.cooldowns.get(k);
      if (entry && entry.until > now) {
        remaining = Math.max(remaining, entry.until - now);
      }
    }

    if (remaining > 0) return { allowed: false, remaining };

    // registra
    const until = now + cooldownMs;
    for (const k of keys) this.cooldowns.set(k, { until });

    // limpeza periódica
    if (this.cooldowns.size > 20000) {
      for (const [k, v] of this.cooldowns) {
        if (v.until < now) this.cooldowns.delete(k);
      }
    }
    return { allowed: true, remaining: 0 };
  }

  /** Limpa o cooldown de um usuário/comando (útil p/ testes). */
  reset(scope, id, command) {
    this.cooldowns.delete(this._key(scope, id, command));
  }

  message(remainingMs) {
    return CONFIG.messages.cooldown.replace('{time}', formatDuration(remainingMs));
  }
}

module.exports = new CooldownManager();
