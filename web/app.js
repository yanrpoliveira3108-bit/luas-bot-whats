'use strict';

const territories = {
  atlas: { name: 'Atlas', code: 'AT-01', status: 'ESTÁVEL', population: '2.306', activity: '68%', protection: '88%', commands: '1.214', progress: 88, capital: 'Núcleo Atlas', last: 'há 9 min', relation: 'Aliada', color: 'stable' },
  aurora: { name: 'Aurora', code: 'AU-07', status: 'ESTÁVEL', population: '4.821', activity: '82%', protection: '94%', commands: '1.946', progress: 94, capital: 'Grupo principal', last: 'há 4 min', relation: 'Aliada', color: 'stable' },
  orion: { name: 'Orion', code: 'OR-02', status: 'ESTÁVEL', population: '3.104', activity: '73%', protection: '91%', commands: '1.108', progress: 91, capital: 'Comando Orion', last: 'há 13 min', relation: 'Cooperativa', color: 'stable' },
  sahara: { name: 'Sahara', code: 'SH-11', status: 'ATENÇÃO', population: '1.288', activity: '41%', protection: '63%', commands: '482', progress: 63, capital: 'Posto Sahara', last: 'há 31 min', relation: 'Em observação', color: 'alert' },
  leste: { name: 'Leste', code: 'LE-04', status: 'ATIVO', population: '2.743', activity: '91%', protection: '86%', commands: '1.672', progress: 86, capital: 'Estação Leste', last: 'há 2 min', relation: 'Aliada', color: 'active' },
  meridiana: { name: 'Meridiana', code: 'ME-03', status: 'ESTÁVEL', population: '1.917', activity: '64%', protection: '90%', commands: '903', progress: 90, capital: 'Célula Sul', last: 'há 18 min', relation: 'Aliada', color: 'stable' },
  pacifica: { name: 'Pacífica', code: 'PA-08', status: 'ESTÁVEL', population: '1.102', activity: '58%', protection: '84%', commands: '521', progress: 84, capital: 'Porto Pacífico', last: 'há 22 min', relation: 'Neutra', color: 'stable' },
  sul: { name: 'Sul', code: 'SU-06', status: 'ATIVO', population: '1.361', activity: '77%', protection: '81%', commands: '535', progress: 81, capital: 'Divisão Sul', last: 'há 7 min', relation: 'Cooperativa', color: 'active' }
};

const events = [
  { icon: '✓', title: 'Proteção atualizada', text: 'Políticas anti-flood aplicadas em Leste.', time: 'há 2 min' },
  { icon: '◈', title: 'Novo território reconhecido', text: 'Aurora ultrapassou 4.800 membros ativos.', time: 'há 19 min' },
  { icon: '!', title: 'Revisão necessária', text: 'Sahara registrou queda de atividade.', time: 'há 31 min', alert: true },
  { icon: '⇄', title: 'Relação diplomática alterada', text: 'Pacífica firmou um pacto de cooperação.', time: 'há 1 h' }
];

const commands = [
  { name: ',menu', label: 'Menu principal', count: '1.842', width: 92 },
  { name: ',play', label: 'Música e mídia', count: '1.216', width: 72 },
  { name: ',perfil', label: 'Perfis', count: '987', width: 59 },
  { name: ',sticker', label: 'Stickers', count: '744', width: 46 },
  { name: ',rank', label: 'Rankings', count: '531', width: 33 }
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let zoom = 1;
let selectedTerritory = 'aurora';
let toastTimer;

function renderEvents() {
  const list = $('#event-list');
  events.forEach((event) => {
    const item = document.createElement('div');
    item.className = `event-item${event.alert ? ' alert' : ''}`;
    const marker = document.createElement('span'); marker.className = 'event-marker'; marker.textContent = event.icon;
    const body = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = event.title;
    const text = document.createElement('p'); text.textContent = event.text;
    body.append(title, text);
    const time = document.createElement('time'); time.textContent = event.time;
    item.append(marker, body, time); list.append(item);
  });
}

function renderCommands() {
  const list = $('#command-bars');
  commands.forEach((command) => {
    const row = document.createElement('div'); row.className = 'command-row';
    const meta = document.createElement('div'); meta.className = 'command-meta';
    const name = document.createElement('span'); name.textContent = `${command.name} · ${command.label}`;
    const count = document.createElement('b'); count.textContent = command.count;
    meta.append(name, count);
    const track = document.createElement('div'); track.className = 'command-track';
    const bar = document.createElement('i'); bar.style.width = `${command.width}%`; track.append(bar);
    row.append(meta, track); list.append(row);
  });
}

function updateDetails(key) {
  const data = territories[key]; if (!data) return;
  selectedTerritory = key;
  $$('.territory').forEach((territory) => territory.classList.toggle('selected', territory.dataset.territory === key));
  const values = { '#details-title': data.name, '#details-status': data.status, '#details-code': data.code, '#details-population': data.population, '#details-activity': data.activity, '#details-protection': `${data.progress}%`, '#details-commands': data.commands, '#details-progress-label': `${data.progress}%`, '#details-capital': data.capital, '#details-last': data.last, '#details-relation': data.relation, '.banner-symbol': data.name[0] };
  Object.entries(values).forEach(([selector, value]) => { const element = $(selector); if (element) element.textContent = value; });
  $('#details-progress').style.width = `${data.progress}%`;
  const status = $('#details-status'); status.className = `status-pill ${data.color === 'alert' ? 'alert-pill' : data.color === 'active' ? 'active-pill' : 'stable-pill'}`;
}

function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function setZoom(value) {
  zoom = Math.max(.82, Math.min(1.55, value));
  $('#world-map').style.transform = `scale(${zoom})`;
}

function closeMobileMenu() {
  const sidebar = $('#sidebar'); const toggle = $('.menu-toggle'); sidebar.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false');
}

function bindInteractions() {
  $$('.territory').forEach((territory) => {
    const select = () => updateDetails(territory.dataset.territory);
    territory.addEventListener('click', select);
    territory.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
    territory.addEventListener('pointermove', (event) => {
      const tooltip = $('#map-tooltip'); const data = territories[territory.dataset.territory];
      tooltip.textContent = `${data.name} · ${data.status} · ${data.population} habitantes`;
      tooltip.style.display = 'block'; tooltip.style.left = `${event.offsetX + 12}px`; tooltip.style.top = `${event.offsetY - 12}px`;
    });
    territory.addEventListener('pointerleave', () => { $('#map-tooltip').style.display = 'none'; });
  });
  $$('.nav-link').forEach((link) => link.addEventListener('click', () => { $$('.nav-link').forEach((item) => item.classList.remove('active')); link.classList.add('active'); closeMobileMenu(); }));
  $('.menu-toggle').addEventListener('click', () => { const sidebar = $('#sidebar'); const open = sidebar.classList.toggle('open'); $('.menu-toggle').setAttribute('aria-expanded', String(open)); });
  $$('[data-map]').forEach((button) => button.addEventListener('click', () => { const action = button.dataset.map; if (action === 'zoom-in') setZoom(zoom + .12); if (action === 'zoom-out') setZoom(zoom - .12); if (action === 'reset') setZoom(1); }));
  $$('[data-action]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'refresh') showToast('Dados atualizados · todos os territórios respondendo');
    if (action === 'notifications') showToast('3 alertas aguardam revisão no registro de eventos');
    if (action === 'operator') showToast('Sessão do operador · acesso administrativo');
    if (action === 'open-territory') showToast(`Dossiê de ${territories[selectedTerritory].name} preparado para a API`);
    if (action === 'view-all-events') showToast('Registro completo disponível quando a API estiver conectada');
    if (action === 'show-commands') showToast('Catálogo de comandos pronto para integração');
  }));
}

function init() { renderEvents(); renderCommands(); updateDetails('aurora'); bindInteractions(); }
document.addEventListener('DOMContentLoaded', init);
