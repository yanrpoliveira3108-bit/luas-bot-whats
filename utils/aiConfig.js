'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CONFIG = require('../config');
const logger = require('./logger').child('ai:config');

let envFile = path.join(CONFIG.paths.root, '.env');

function validApiKey(value) {
  const key = String(value || '').trim();
  return key.length >= 8 && key.length <= 512 && !/[\r\n\s]/.test(key);
}

function replaceEnvValue(source, name, value) {
  const lines = String(source || '').split(/\r?\n/);
  const escaped = String(value);
  let found = false;
  const result = lines.map((line) => {
    if (/^\s*(?:export\s+)?GROQ_API_KEY\s*=/.test(line)) {
      found = true;
      return `GROQ_API_KEY=${escaped}`;
    }
    return line;
  });
  if (!found) {
    if (result.length && result[result.length - 1] !== '') result.push('');
    result.push(`${name}=${escaped}`);
  }
  return result.join('\n');
}

function persistGroqApiKey(value) {
  const key = String(value || '').trim();
  if (!validApiKey(key)) {
    const err = new Error('Formato de chave Groq inválido.');
    err.code = 'GROQ_KEY_INVALID_FORMAT';
    throw err;
  }
  const original = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  const next = replaceEnvValue(original, 'GROQ_API_KEY', key);
  const temp = `${envFile}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, next, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, envFile);
    try { fs.chmodSync(envFile, 0o600); } catch (_) {}
    process.env.GROQ_API_KEY = key;
    logger.info('[AI_CONFIG] Groq API key updated');
    return true;
  } catch (err) {
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
    const wrapped = new Error('Não consegui salvar a configuração da IA.');
    wrapped.code = 'GROQ_ENV_WRITE_FAILED';
    wrapped.cause = err;
    throw wrapped;
  }
}

function isConfigured() { return Boolean(String(process.env.GROQ_API_KEY || '').trim()); }

module.exports = {
  get ENV_FILE() { return envFile; },
  _setEnvFileForTests(file) { envFile = file; },
  validApiKey,
  replaceEnvValue,
  persistGroqApiKey,
  isConfigured,
};
