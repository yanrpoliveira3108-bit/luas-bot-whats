#!/usr/bin/env node
/**
 * scripts/menu-preview.js — gera o card de menu em arquivo, para conferir
 * layout e tamanho SEM depender do WhatsApp.
 *
 * ATENÇÃO, para não criar expectativa errada: abrir o arquivo num navegador
 * comum mostra o layout, a navegação e o painel do "Usar" — mas **não prova**
 * que o WhatsApp vai renderizar o card (isso depende do aparelho e da versão do
 * app). Também não é assim que o card é enviado: em produção ele vai dentro de
 * `botForwardedMessage → richResponseMessage` (ver utils/richHtml.js).
 *
 * Uso:
 *   node scripts/menu-preview.js                    # principal + admin + membros + downloads
 *   node scripts/menu-preview.js categoria games    # uma categoria qualquer
 *   MENU_HTML_HEIGHT=700 node scripts/menu-preview.js
 *
 * Saída: `tmp/menu-preview-<nome>.html` (+ um resumo no terminal: tamanho,
 * categorias, botões "Usar" e subresources remotos — que devem ser sempre 0).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
process.chdir(RAIZ);

// O preview vive no tmp/ do PROJETO (não no TMPDIR do sistema): é mais fácil de
// achar e o diretório já está no .gitignore.
const dir = path.join(RAIZ, 'tmp');
fs.mkdirSync(dir, { recursive: true });
process.env.DATABASE_FILE = process.env.DATABASE_FILE || path.join(dir, 'menu-preview.db');

require('../database/database').open();
require('../commands/loader').loadCommands(true);
const htmlMenu = require('../menus/html');

/** Contexto de mentira: o preview não fala com o WhatsApp. */
const ctx = {
  socket: { user: { id: '5511977776666:3@s.whatsapp.net' } },
  remoteJid: '120363000000000000@g.us',
  isGroup: true,
  prefix: '!',
  sender: '5511999999999@s.whatsapp.net',
};

function gerar(nome, opts) {
  const out = htmlMenu.montarDocumento(ctx, opts);
  const arquivo = path.join(dir, `menu-preview-${nome}.html`);
  fs.writeFileSync(arquivo, out.html);
  const bytes = Buffer.byteLength(out.html, 'utf8');
  const usares = (out.html.match(/data-usar="/g) || []).length;
  const remotos = (out.html.match(/\b(?:href|src)\s*=\s*["']?(?:https?:)?\/\//gi) || []).length;
  const linksMortos = (out.html.match(/<a class="go"/g) || []).length;
  const mostrados = out.grupo.categorias.reduce((n, c) => n + c.comandos.length, 0);
  const total = out.grupo.categorias.reduce((n, c) => n + (c.count || c.comandos.length), 0);
  console.log(
    `${path.relative(RAIZ, arquivo).padEnd(38)} ${(bytes / 1024).toFixed(1).padStart(7)} KB` +
      ` | categorias ${out.grupo.categorias.length}` +
      ` | Usar ${usares}` +
      ` | comandos ${mostrados}/${total}` +
      ` | remotos ${remotos}` +
      ` | links mortos ${linksMortos}`
  );
  return arquivo;
}

const [, , comando, categoria] = process.argv;
const gerados = [];

if (comando === 'categoria') {
  if (!categoria) {
    console.error('Informe a categoria: node scripts/menu-preview.js categoria <nome>');
    process.exit(1);
  }
  gerados.push(gerar(categoria, { kind: 'categoria', categoria }));
} else {
  gerados.push(gerar('main', { kind: 'main' }));
  gerados.push(gerar('admin', { kind: 'admin' }));
  gerados.push(gerar('membros', { kind: 'membros' }));
  gerados.push(gerar('downloads', { kind: 'categoria', categoria: 'downloads' }));
}

console.log(
  '\nLembrete: navegador comum mostra o layout, mas o card só é comprovado no WhatsApp do aparelho.' +
    (gerados.length ? `\nGerado em ${path.relative(RAIZ, dir)}/` : '')
);
process.exit(0);
