'use strict';

const fs = require('fs');
const richHtml = require('./richHtml');
const CONFIG = require('../config');
const settings = require('../database/settings');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])).replace(/\r/g, '&#13;').replace(/\n/g, '&#10;');
}
function validPublicUrl(value) {
  try { const u = new URL(String(value || '')); return ['http:', 'https:'].includes(u.protocol) ? u.toString() : ''; } catch (_) { return ''; }
}
function field(label, value) {
  if (value === undefined || value === null || value === '' || value === 'NaN') return '';
  return `<div class="hp-field"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}
function normalizeMediaInfo(result = {}, extra = {}) {
  const url = validPublicUrl(result.url || extra.url);
  const duration = result.duration || extra.duration;
  const views = result.views;
  let size = result.filesize || result.size;
  if (!size && result.path) { try { size = fs.statSync(result.path).size; } catch (_) {} }
  if (typeof size === 'number') size = `${(size / (1024 * 1024)).toFixed(2)} MB`;
  return {
    title: String(result.title || extra.title || '').trim(),
    author: String(result.author || result.channel || extra.author || '').trim(),
    platform: String(result.platform || extra.platform || (url.includes('spotify') ? 'Spotify' : 'YouTube')).trim(),
    duration: duration ? String(duration) : '',
    views: views === 0 ? '0' : (views ? String(views) : ''),
    date: result.date || result.publishDate || result.uploadDate || '',
    quality: result.quality || extra.quality || '',
    format: result.format || result.mimetype || extra.format || '',
    filesize: size || '',
    url,
    thumbnail: String(result.thumbnail || extra.thumbnail || ''),
    kind: extra.kind || 'audio',
  };
}
function command(prefix, name, arg) { return `${prefix}${name}${arg ? ` ${arg}` : ''}`; }
function buildHtmlPlay(info, prefix = '!', commands = {}) {
  const image = info.thumbnail.startsWith('data:image/') ? `<img class="hp-cover" src="${info.thumbnail}" alt="Capa da mídia">` : '<div class="hp-placeholder" aria-label="Imagem indisponível">♪</div>';
  const copyInfo = [`Título: ${info.title}`, info.author && `Autor: ${info.author}`, info.duration && `Duração: ${info.duration}`, info.views !== '' && `Visualizações: ${info.views}`, info.url && `Link: ${info.url}`].filter(Boolean).join('\n');
  const commandButtons = [
    commands.audio && `<button data-copy="${escapeHtml(command(prefix, commands.audio, info.url))}">🎵 ÁUDIO</button>`,
    commands.video && `<button data-copy="${escapeHtml(command(prefix, commands.video, info.url))}">🎬 VÍDEO</button>`,
    commands.lyrics && `<button data-copy="${escapeHtml(command(prefix, commands.lyrics, info.title))}">📝 LETRA</button>`,
    commands.search && `<button data-copy="${escapeHtml(command(prefix, commands.search, info.title))}">🔎 PESQUISAR</button>`,
  ].filter(Boolean).join('');
  const linkButtons = [
    info.url && `<button data-copy="${escapeHtml(info.url)}">COPIAR LINK</button>`,
    info.title && `<button data-copy="${escapeHtml(info.title)}">COPIAR NOME</button>`,
    copyInfo && `<button data-copy="${escapeHtml(copyInfo)}">COPIAR INFORMAÇÕES</button>`,
  ].filter(Boolean).join('');
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#071416;color:#e5eee7;font:13px Arial;padding:8px}.hp{max-width:560px;margin:auto;border:1px solid #315457;border-radius:14px;overflow:hidden;background:#0d2225;box-shadow:0 10px 28px #0008}.hp-cover,.hp-placeholder{display:block;width:100%;height:210px;object-fit:cover;background:linear-gradient(140deg,#214a49,#101d27);text-align:center}.hp-placeholder{font:90px Georgia;color:#70d2c6;line-height:210px}.hp-main{padding:16px}.hp-kicker{color:#e3bb72;font-size:9px;letter-spacing:2px}.hp h1{font:26px Georgia;margin:6px 0 14px;overflow-wrap:anywhere}.hp-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.hp-field{border-top:1px solid #29494b;padding:9px 0;min-width:0}.hp-field span{display:block;color:#85a29d;font-size:10px;margin-bottom:4px}.hp-field b{display:block;overflow-wrap:anywhere;font-weight:500}.hp-url{color:#70d2c6;overflow-wrap:anywhere;font-size:11px;margin:14px 0}.hp-section{border-top:1px solid #29494b;padding-top:14px;margin-top:14px}.hp-section h2{font:16px Georgia;margin:0 0 9px}.hp-actions{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.hp-actions button{border:1px solid #396563;background:#143437;color:#e5eee7;padding:11px 7px;border-radius:5px;font-size:10px;cursor:pointer}.hp-actions button:active{background:#2e6660}.hp-feedback{height:18px;color:#70d2c6;font-size:11px;margin-top:10px}.hp-note{color:#85a29d;font-size:10px;margin:0}.hp-foot{border-top:1px solid #29494b;padding:11px 16px;color:#66837f;font-size:9px}@media(max-width:390px){.hp-cover,.hp-placeholder{height:160px}.hp-placeholder{line-height:160px}.hp h1{font-size:22px}.hp-grid{grid-template-columns:1fr}.hp-actions button{min-height:42px}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}</style><article class="hp"><div>${image}</div><div class="hp-main"><div class="hp-kicker">HTML PLAY · ${escapeHtml(info.platform)}</div><h1>${escapeHtml(info.title || 'Mídia')}</h1><div class="hp-grid">${field('Autor / Canal', info.author)}${field('Plataforma', info.platform)}${field('Duração', info.duration)}${field('Visualizações', info.views)}${field('Data', info.date)}${field('Qualidade', info.quality)}${field('Formato', info.format)}${field('Tamanho', info.filesize)}</div>${info.url ? `<div class="hp-url">🔗 ${escapeHtml(info.url)}</div>` : ''}<div class="hp-section"><h2>Copiar</h2><div class="hp-actions">${linkButtons}</div><div class="hp-feedback" aria-live="polite"></div></div>${commandButtons ? `<div class="hp-section"><h2>Ações / comandos</h2><p class="hp-note">Os botões apenas copiam o comando. Envie-o no chat para executar.</p><div class="hp-actions">${commandButtons}</div><div class="hp-feedback" aria-live="polite"></div></div>` : ''}</div><footer class="hp-foot">HTML PLAY · interface visual opcional</footer></article><script>(function(){
  'use strict';
  function feedbackFor(button){
    return button.parentNode && button.parentNode.parentNode
      ? button.parentNode.parentNode.querySelector('.hp-feedback') : null;
  }
  function showFeedback(button, text, ok){
    var f=feedbackFor(button);
    if(f){ f.textContent=text; f.style.color=ok?'#70d2c6':'#e3bb72'; }
    if(!button.dataset.originalLabel) button.dataset.originalLabel=button.textContent;
    button.textContent=ok?'COPIADO ✓':'COPIE MANUALMENTE';
    if(ok) setTimeout(function(){
      button.textContent=button.dataset.originalLabel||'';
      if(f) f.textContent='';
    },1500);
  }
  function legacyCopy(text){
    var area=document.createElement('textarea');
    area.value=text; area.setAttribute('readonly','');
    area.className='hp-copy-manual';
    area.style.position='fixed'; area.style.left='8px'; area.style.top='8px';
    area.style.width='calc(100% - 16px)'; area.style.zIndex='9999';
    document.body.appendChild(area);
    area.focus(); area.select();
    if(area.setSelectionRange) area.setSelectionRange(0,text.length);
    var ok=false;
    try{ ok=!!(document.execCommand&&document.execCommand('copy')); }catch(e){ ok=false; }
    if(ok) document.body.removeChild(area);
    return {ok:ok, area:area};
  }
  function copyText(text,button){
    var value=String(text||'');
    if(!value){ showFeedback(button,'Nada para copiar',false); return; }
    var clipboard=navigator.clipboard;
    if(clipboard&&typeof clipboard.writeText==='function'){
      try{
        Promise.resolve(clipboard.writeText(value)).then(function(){
          showFeedback(button,'COPIADO ✓',true);
        }).catch(function(){
          var result=legacyCopy(value);
          showFeedback(button,result.ok?'COPIADO ✓':'Selecione e copie o texto',result.ok);
        });
        return;
      }catch(e){}
    }
    var result=legacyCopy(value);
    showFeedback(button,result.ok?'COPIADO ✓':'Selecione e copie o texto',result.ok);
  }
  document.addEventListener('click',function(event){
    var button=event.target&&event.target.closest
      ? event.target.closest('[data-copy]') : null;
    if(!button) return;
    event.preventDefault(); event.stopPropagation();
    copyText(button.getAttribute('data-copy')||'',button);
  });
})();</script>`;
}
async function send(ctx, info, prefix, commands) {
  // A chave persistida tem precedência e permite !htmlplay on/off em runtime.
  let enabled = !!(CONFIG.htmlPlay && CONFIG.htmlPlay.enabled);
  try { enabled = settings.htmlPlayEnabled(); } catch (_) {}
  console.log('[PLAY CARD] htmlEnabled', { targetJid: ctx && ctx.remoteJid, enabled });
  if (!enabled) return false;
  const html = buildHtmlPlay(info, prefix, commands);
  await richHtml.sendHtml(ctx.socket, ctx.remoteJid, html, { title: 'HTML PLAY' });
  return true;
}
function textFallbackEnabled() {
  try { return settings.getBool('html_play_text_fallback', CONFIG.htmlPlay && CONFIG.htmlPlay.textFallback !== false); } catch (_) { return CONFIG.htmlPlay ? CONFIG.htmlPlay.textFallback !== false : true; }
}
module.exports = { normalizeMediaInfo, buildHtmlPlay, send, validPublicUrl, textFallbackEnabled };
