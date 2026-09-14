/**
 * engine/plugins.js — registro central de comandos/plugins.
 *
 * - registro com validação de metadados
 * - resolução por trigger (nome + aliases)
 * - agrupamento por categoria
 * - estado habilitado/desabilitado por plugin
 * - recarregamento sem derrubar o bot
 */

'use strict';

const logger = require('../utils/logger').child('plugins');

class PluginRegistry {
  constructor() {
    this.commands = new Map(); // name -> command
    this.triggers = new Map(); // trigger -> command
    this.plugins = new Map(); // pluginName -> { name, file, commands: [names], status }
    this.skipped = []; // [{ name, trigger, plugin, reason }] — comandos ignorados no load
  }

  /** Registra um plugin (pasta de comandos). */
  registerPlugin(name, file, status) {
    this.plugins.set(name, { name, file, commands: [], status: status || 'enabled' });
  }

  setPluginStatus(name, status) {
    const p = this.plugins.get(name);
    if (p) p.status = status;
  }

  /**
   * Registra um comando. Retorna true em caso de sucesso.
   * Ignora (com aviso) comandos inválidos ou com trigger duplicado.
   */
  registerCommand(cmd, pluginName) {
    // validação de schema
    if (!cmd || typeof cmd !== 'object') {
      logger.warn({ plugin: pluginName }, 'comando inválido (não é objeto)');
      this.skipped.push({ name: '?', trigger: '?', plugin: pluginName, reason: 'não é objeto' });
      return false;
    }
    if (typeof cmd.execute !== 'function') {
      logger.warn({ name: cmd.name, plugin: pluginName }, 'comando sem execute() — ignorado');
      this.skipped.push({ name: cmd.name, trigger: '?', plugin: pluginName, reason: 'sem execute()' });
      return false;
    }
    const name = String(cmd.name || '').toLowerCase().trim();
    if (!name) {
      logger.warn({ plugin: pluginName }, 'comando sem name — ignorado');
      this.skipped.push({ name: '?', trigger: '?', plugin: pluginName, reason: 'sem name' });
      return false;
    }

    cmd.name = name;
    cmd.category = String(cmd.category || pluginName || 'general').toLowerCase();
    cmd.commands = Array.isArray(cmd.commands) && cmd.commands.length ? cmd.commands : [name];
    cmd.aliases = Array.isArray(cmd.aliases) ? cmd.aliases : [];
    cmd.cooldown = Number(cmd.cooldown) || 0;

    const triggers = [...cmd.commands, ...cmd.aliases].map((t) => String(t).toLowerCase());
    // não registrar se algum trigger já existe
    for (const t of triggers) {
      if (this.triggers.has(t) && this.triggers.get(t).name !== name) {
        logger.warn({ trigger: t, name, existing: this.triggers.get(t).name }, 'trigger duplicado — comando ignorado');
        this.skipped.push({ name, trigger: t, plugin: pluginName, reason: `trigger duplicado (já usado por ${this.triggers.get(t).name})` });
        return false;
      }
    }

    this.commands.set(name, cmd);
    for (const t of triggers) this.triggers.set(t, cmd);

    const p = this.plugins.get(cmd.category);
    if (p && !p.commands.includes(name)) p.commands.push(name);

    return true;
  }

  /** Remove um comando (usado no reload). */
  unregisterCommand(name) {
    const cmd = this.commands.get(name);
    if (!cmd) return;
    const triggers = [...cmd.commands, ...cmd.aliases].map((t) => String(t).toLowerCase());
    for (const t of triggers) {
      if (this.triggers.get(t) === cmd) this.triggers.delete(t);
    }
    this.commands.delete(name);
  }

  resolveTrigger(trigger) {
    return this.triggers.get(String(trigger || '').toLowerCase()) || null;
  }

  getCommand(name) {
    return this.commands.get(String(name || '').toLowerCase()) || null;
  }

  byCategory() {
    const map = new Map();
    for (const cmd of this.commands.values()) {
      if (!map.has(cmd.category)) map.set(cmd.category, []);
      map.get(cmd.category).push(cmd);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }

  categories() {
    return [...this.byCategory().keys()].sort();
  }

  all() {
    return [...this.commands.values()];
  }

  count() {
    return this.commands.size;
  }

  /** Comandos ignorados durante o load (duplicados/inválidos). */
  skippedCommands() {
    return this.skipped.slice();
  }

  /** Zera o contador de comandos ignorados (usado no reload). */
  resetSkipped() {
    this.skipped = [];
  }

  pluginList() {
    return [...this.plugins.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

// instância global única
const registry = new PluginRegistry();

module.exports = { registry, PluginRegistry };
