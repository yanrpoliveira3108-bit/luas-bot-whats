/**
 * commands/loader.js — carregamento automático de comandos (plugins).
 *
 * - percorre commands/ (cada subpasta = um plugin)
 * - respeita o estado habilitado/desabilitado salvo no banco
 * - valida e registra cada comando no PluginRegistry
 * - permite reload sem derrubar o bot
 */

'use strict';

const fs = require('fs');
const path = require('path');
const CONFIG = require('../config');
const logger = require('../utils/logger').child('loader');
const { registry } = require('../engine/plugins');

let loadedFiles = []; // [{ plugin, file, abs }]

function isPluginEnabled(name) {
  try {
    const settings = require('../database/settings');
    return settings.getBool(`plugin:${name}`, true);
  } catch (_) {
    return true;
  }
}

function setPluginEnabled(name, enabled) {
  const settings = require('../database/settings');
  settings.set(`plugin:${name}`, enabled ? 'true' : 'false');
}

/** Requer um arquivo e normaliza o export para lista de comandos. */
function requireCommands(file) {
  // limpa cache para permitir reload
  delete require.cache[require.resolve(file)];
  const mod = require(file);
  if (!mod) return [];
  if (Array.isArray(mod)) return mod;
  if (typeof mod === 'object' && Array.isArray(mod.commands)) return mod.commands;
  if (typeof mod === 'object' && typeof mod.execute === 'function') return [mod];
  logger.warn({ file }, 'formato de export inválido (esperado array ou objeto de comando)');
  return [];
}

/**
 * Carrega (ou recarrega) todos os comandos no registry.
 * @param {boolean} reset se true, limpa o registry antes
 */
function loadCommands(reset = true) {
  const commandsDir = path.join(CONFIG.paths.root, 'commands');
  if (!fs.existsSync(commandsDir)) {
    logger.warn('pasta commands/ não encontrada');
    return registry;
  }

  if (reset) {
    for (const name of [...registry.commands.keys()]) registry.unregisterCommand(name);
    loadedFiles = [];
  }

  const pluginDirs = fs
    .readdirSync(commandsDir)
    .filter((d) => {
      const full = path.join(commandsDir, d);
      return fs.statSync(full).isDirectory() && !d.startsWith('.') && !d.startsWith('_');
    })
    .sort();

  for (const dir of pluginDirs) {
    const enabled = isPluginEnabled(dir);
    const files = collectJsFiles(path.join(commandsDir, dir));
    registry.registerPlugin(dir, path.join(commandsDir, dir), enabled ? 'enabled' : 'disabled');

    if (!enabled) {
      logger.info({ plugin: dir }, 'plugin desabilitado — ignorado');
      continue;
    }

    let added = 0;
    for (const file of files) {
      try {
        const cmds = requireCommands(file);
        for (const raw of cmds) {
          const cmd = Object.assign({}, raw);
          if (!cmd.category) cmd.category = dir;
          if (registry.registerCommand(cmd, dir)) added++;
        }
        loadedFiles.push({ plugin: dir, file, abs: file });
      } catch (err) {
        // um plugin quebrado NÃO pode derrubar o bot
        logger.error({ plugin: dir, file, err: err.message }, 'falha ao carregar arquivo de comandos');
        registry.setPluginStatus(dir, 'error');
      }
    }
    logger.info({ plugin: dir, comandos: added }, 'plugin carregado');
  }

  logger.info({ total: registry.count(), plugins: registry.plugins.size }, 'carregamento de comandos concluído');
  return registry;
}

function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith('_') || entry.startsWith('.')) continue; // ignora helpers/dados
    const full = path.join(dir, entry);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      out.push(...collectJsFiles(full));
    } else if (st.isFile() && entry.endsWith('.js')) {
      out.push(full);
    }
  }
  return out.sort();
}

module.exports = { loadCommands, isPluginEnabled, setPluginEnabled, loadedFiles };
