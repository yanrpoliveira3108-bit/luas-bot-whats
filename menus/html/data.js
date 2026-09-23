/**
 * menus/html/data.js — dados dos menus HTML.
 *
 * FONTE ÚNICA: o registro de comandos (`engine/plugins.js`) + a ordem/títulos
 * das categorias (`menus/index.js`, o mesmo arquivo que o menu tradicional
 * usa). Nenhuma lista de comandos é duplicada aqui — comando novo, alias novo
 * ou comando removido aparecem sozinhos nos dois formatos.
 *
 * Este módulo NÃO conhece HTML: só devolve estruturas de dados.
 */

'use strict';

const MENUS = require('../index');
const { registry } = require('../../engine/plugins');

/** Categorias em ordem, com dados do registro. */
function listarCategorias() {
  let porCategoria = new Map();
  try {
    porCategoria = registry.byCategory();
  } catch (_) {
    porCategoria = new Map();
  }

  const categorias = [];
  const vistas = new Set();

  for (const menu of MENUS) {
    // 'settings' é um menu especial (mostra estado das configurações, não uma
    // lista de comandos) — segue no formato tradicional, igual ao audit espera.
    if (menu.id === 'settings') continue;
    const comandos = (porCategoria.get(menu.id) || []).filter((c) => !c.hidden);
    vistas.add(menu.id);
    categorias.push({
      id: menu.id,
      title: menu.title || menu.id,
      emoji: menu.emoji || '📂',
      description: menu.description || '',
      count: comandos.length,
      comandos,
    });
  }

  // Categoria que existe no registro mas não tem entrada em menus/index.js
  // (criada por plugin novo): entra no fim, para não ficar invisível.
  for (const [id, comandos] of porCategoria) {
    if (vistas.has(id) || id === 'settings') continue;
    const visiveis = comandos.filter((c) => !c.hidden);
    if (!visiveis.length) continue;
    categorias.push({
      id,
      title: id.charAt(0).toUpperCase() + id.slice(1),
      emoji: '📂',
      description: 'Categoria detectada automaticamente.',
      count: visiveis.length,
      comandos: visiveis,
    });
  }

  return categorias;
}

/** Total de comandos que aparecem nos menus HTML. */
function totalDeComandos(categorias) {
  return (categorias || listarCategorias()).reduce((n, c) => n + c.count, 0);
}

/**
 * Grupos de menu que o HTML sabe montar.
 * As categorias do grupo vêm do registro — os atalhos existentes (`!menu`,
 * `!menuadm`, `!menumembros`, …) só escolhem QUAL grupo abrir.
 */
const GRUPOS = {
  main: { titulo: 'Menu principal', emoji: '🌙', ids: null },
  admin: { titulo: 'Administração', emoji: '🛡️', ids: ['admin'] },
  membros: { titulo: 'Membros', emoji: '👥', ids: ['members'] },
  owner: { titulo: 'Dono', emoji: '👑', ids: ['owner'] },
  categoria: { titulo: 'Categoria', emoji: '📂', ids: [] },
};

/**
 * Monta o conjunto de categorias de um grupo.
 * @param {string} kind 'main' | 'admin' | 'membros' | 'owner' | 'categoria'
 * @param {string} [categoria] usada quando kind = 'categoria'
 */
function grupoDoMenu(kind, categoria) {
  const todas = listarCategorias();
  const grupo = GRUPOS[kind] || GRUPOS.main;
  let categorias;
  if (kind === 'categoria') {
    categorias = todas.filter((c) => c.id === String(categoria || ''));
  } else if (grupo.ids) {
    categorias = todas.filter((c) => grupo.ids.includes(c.id));
  } else {
    categorias = todas;
  }
  const inicial = categorias[0] ? categorias[0].id : '';
  return {
    kind,
    titulo: grupo.titulo,
    emoji: grupo.emoji,
    categorias,
    inicial,
    total: totalDeComandos(categorias),
  };
}

/** Primeiro trigger de um comando (nome) — usado nos atalhos. */
function triggerDe(cmd) {
  return (cmd && cmd.commands && cmd.commands[0]) || (cmd && cmd.name) || '';
}

/**
 * Comando de menu de uma categoria (`!menuadm`, `!menudownload`, …), achado no
 * PRÓPRIO registro — sem tabela paralela que envelhece. Serve para o aviso de
 * corte oferecer um link real para o menu completo daquela categoria.
 */
function menuCommandOf(categoria) {
  const cmds = (registry.byCategory().get(String(categoria || '')) || []).filter((c) => !c.hidden);
  const achado = cmds.find((c) => /^menu/i.test(c.name) && c.name !== 'menu');
  return achado ? triggerDe(achado) : '';
}

module.exports = { listarCategorias, totalDeComandos, grupoDoMenu, GRUPOS, menuCommandOf, triggerDe };
