/**
 * utils/perfilHtmlView.js — Renderizador do Perfil Tabulado em HTML para WhatsApp.
 *
 * Abas: Geral | Atividade | RPG/Vida | Figurinhas | Coleções
 *
 * Características:
 * - Design moderno, responsivo e de alto contraste (paleta padrão grafite refinado + violeta suave)
 * - Compatível com temas claros e escuros via htmlTheme.cssOverrides()
 * - Alternância de abas local via JavaScript (sem recarregar o card ou reenviar mensagens)
 * - Rolagem vertical suave preservando a posição das abas
 * - Avatar em data URI embutido (offline/sandbox) com fallback
 * - Identidade contextual (solicitante vs perfil visualizado, grupo vs privado, bot/dono)
 * - Separação estrita de escopo para privacidade (nunca vaza estatísticas do PV em grupos)
 * - Escapagem rigorosa de caracteres dinâmicos para prevenir XSS/quebra
 */

'use strict';

const htmlTheme = require('./htmlTheme');
const { formatMoney, formatDate } = require('./formatter');

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPerfilHtml(data) {
  const visual = htmlTheme.get();
  const themeCss = htmlTheme.cssOverrides();
  const emojis = visual.emojis !== false;

  const activeTab = String(data.initialTab || 'geral').toLowerCase();

  // Avatar em Base64
  let avatarSrc = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="%238B5CF6"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>';
  if (data.avatarDataUri) {
    avatarSrc = data.avatarDataUri;
  }

  // Progresso de XP
  const xpCurrent = data.xp || 0;
  const xpNext = data.nextXp || 100;
  const xpPct = Math.min(100, Math.max(0, Math.round((xpCurrent / Math.max(1, xpNext)) * 100)));

  // 1. ABA GERAL
  const tabGeral = `
    <div id="tab-content-geral" class="tab-pane ${activeTab === 'geral' ? 'active' : ''}">
      <div class="section-title">${emojis ? '📊 ' : ''}Dados Gerais</div>
      <div class="stat-grid">
        <div class="stat-box">
          <div class="stat-label">Nível Geral</div>
          <div class="stat-val highlight">${data.level}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Reputação</div>
          <div class="stat-val">⭐ ${data.reputation}</div>
        </div>
      </div>

      <div class="progress-container">
        <div class="progress-labels">
          <span>Experiência Geral</span>
          <span>${xpCurrent} / ${xpNext} XP (${xpPct}%)</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${xpPct}%;"></div>
        </div>
      </div>

      <div class="info-list">
        <div class="info-row">
          <span class="info-label">${emojis ? '🆔 ' : ''}Identificador</span>
          <span class="info-val mono">${escapeHtml(data.userId)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">${emojis ? '📅 ' : ''}Primeira Interação</span>
          <span class="info-val">${data.firstSeen ? formatDate(new Date(data.firstSeen).getTime()) : 'Recente'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">${emojis ? '📱 ' : ''}Origem Estimada</span>
          <span class="info-val badge-device">${escapeHtml(data.estimatedPlatform || 'Desconhecida')}</span>
        </div>
        <div class="info-row">
          <span class="info-label">${emojis ? '🌐 ' : ''}Contexto Atual</span>
          <span class="info-val">${escapeHtml(data.contextName || (data.isGroup ? 'Grupo' : 'Mensagem Privada'))}</span>
        </div>
        ${data.groupJoinedAt ? `
        <div class="info-row">
          <span class="info-label">${emojis ? '🚪 ' : ''}Entrada no Grupo</span>
          <span class="info-val">${formatDate(new Date(data.groupJoinedAt).getTime())}</span>
        </div>` : ''}
        ${data.about ? `
        <div class="info-row" style="flex-direction:column; align-items:flex-start; gap:4px;">
          <span class="info-label">${emojis ? '📝 ' : ''}Biografia / Sobre</span>
          <span class="info-val quote">${escapeHtml(data.about)}</span>
        </div>` : ''}
      </div>
    </div>
  `;

  // 2. ABA ATIVIDADE (Separação estrita de escopo)
  const topCmdsHtml = data.activity && data.activity.topCommands && data.activity.topCommands.length
    ? data.activity.topCommands.map((c, i) => `
        <div class="sub-row">
          <span>${i + 1}. <code>${escapeHtml(data.prefix || '!')}${escapeHtml(c.cmd)}</code></span>
          <span class="highlight font-bold">${c.count}x</span>
        </div>
      `).join('')
    : '<div class="empty-state">Nenhum comando registrado neste escopo ainda.</div>';

  const tabAtividade = `
    <div id="tab-content-atividade" class="tab-pane ${activeTab === 'atividade' ? 'active' : ''}">
      <div class="section-title">${emojis ? '⚡ ' : ''}Atividade (${data.isGroup ? 'Neste Grupo' : 'Privado com o Bot'})</div>
      <div class="privacy-notice">
        🛡️ Estatísticas estritamente limitadas a este escopo. Atividades de chats privados e outros grupos não são vazadas.
      </div>
      <div class="stat-grid">
        <div class="stat-box">
          <div class="stat-label">Mensagens Registradas</div>
          <div class="stat-val">${data.activity ? data.activity.messages : 0}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Comandos Executados</div>
          <div class="stat-val highlight">${data.activity ? data.activity.commands : 0}</div>
        </div>
      </div>

      <div class="card-inner">
        <div class="card-inner-title">${emojis ? '🏆 ' : ''}Comandos Mais Utilizados</div>
        ${topCmdsHtml}
      </div>

      <div class="info-list" style="margin-top:10px;">
        <div class="info-row">
          <span class="info-label">${emojis ? '🎯 ' : ''}Comandos Únicos Usados</span>
          <span class="info-val">${data.activity ? Object.keys(data.activity.commandCounts || {}).length : 0}</span>
        </div>
        <div class="info-row">
          <span class="info-label">${emojis ? '⏱️ ' : ''}Última Interação</span>
          <span class="info-val">${data.activity && data.activity.lastInteraction ? formatDate(new Date(data.activity.lastInteraction).getTime()) : 'Agora'}</span>
        </div>
      </div>
    </div>
  `;

  // 3. ABA RPG / VIDA
  let rpgBody = '';
  if (!data.hasCharacter) {
    rpgBody = `
      <div class="empty-prompt">
        <div class="empty-icon">${emojis ? '🛡️' : '⚔️'}</div>
        <div class="empty-title">Nenhum Personagem Criado</div>
        <div class="empty-desc">Você ainda não iniciou sua jornada no universo RPG do Lua Bot!</div>
        <div class="command-box">Use <code>${escapeHtml(data.prefix || '!')}rpg</code> ou <code>${escapeHtml(data.prefix || '!')}criar</code> para começar.</div>
      </div>
    `;
  } else {
    const invPreview = data.rpg.topItems && data.rpg.topItems.length
      ? data.rpg.topItems.map((it) => `<span class="chip-item">${it.emoji || '📦'} ${escapeHtml(it.name)} (x${it.quantity})</span>`).join(' ')
      : '<span class="empty-hint">Mochila vazia. Adquira itens com !loja</span>';

    rpgBody = `
      <div class="stat-grid">
        <div class="stat-box">
          <div class="stat-label">Classe / Profissão</div>
          <div class="stat-val highlight">${escapeHtml(data.rpg.profession || 'Aventureiro')}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Nível RPG</div>
          <div class="stat-val">${data.rpg.level || 1}</div>
        </div>
      </div>

      <div class="stat-grid" style="margin-top:8px;">
        <div class="stat-box">
          <div class="stat-label">🪙 Carteira</div>
          <div class="stat-val" style="color:var(--lua-ok-text, #6EE7B7);">${formatMoney(data.economy.wallet)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">🏦 Banco</div>
          <div class="stat-val">${formatMoney(data.economy.bank)}</div>
        </div>
      </div>

      <div class="progress-container">
        <div class="progress-labels">
          <span>⚡ Energia Vital</span>
          <span>${data.rpg.energy} / 200</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill energy-fill" style="width: ${Math.min(100, Math.round((data.rpg.energy / 200) * 100))}%;"></div>
        </div>
      </div>

      <div class="card-inner">
        <div class="card-inner-title">${emojis ? '🎒 ' : ''}Resumo da Mochila (${data.rpg.inventoryTotal || 0} itens)</div>
        <div class="chips-container">${invPreview}</div>
      </div>

      <div class="info-list" style="margin-top:10px;">
        <div class="info-row">
          <span class="info-label">${emojis ? '🗺️ ' : ''}Expedições Concluídas</span>
          <span class="info-val font-bold">${data.rpg.completedExpeditions || 0}</span>
        </div>
        <div class="info-row">
          <span class="info-label">${emojis ? '🐉 ' : ''}Chefes & Raids (Dano)</span>
          <span class="info-val font-bold">${data.rpg.coopDamage ? `${data.rpg.coopDamage} dmg` : 'Nenhum'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">${emojis ? '🏪 ' : ''}Feira (Itens Anunciados)</span>
          <span class="info-val">${data.rpg.activeMarketListings || 0} ativos</span>
        </div>
        <div class="info-row">
          <span class="info-label">${emojis ? '📜 ' : ''}Missões Concluídas</span>
          <span class="info-val">${data.rpg.completedMissions || 0}</span>
        </div>
      </div>
    `;
  }

  const tabRpg = `
    <div id="tab-content-rpg" class="tab-pane ${activeTab === 'rpg' ? 'active' : ''}">
      <div class="section-title">${emojis ? '⚔️ ' : ''}Jornada RPG & Vida</div>
      ${rpgBody}
    </div>
  `;

  // 4. ABA FIGURINHAS
  const fig = data.stickers || {};
  const totalStickersOps = (fig.created || 0) + (fig.stolen || 0);

  const tabFigurinhas = `
    <div id="tab-content-figurinhas" class="tab-pane ${activeTab === 'figurinhas' ? 'active' : ''}">
      <div class="section-title">${emojis ? '🎨 ' : ''}Oficina de Figurinhas</div>
      
      <div class="stat-grid">
        <div class="stat-box">
          <div class="stat-label">Figurinhas Criadas</div>
          <div class="stat-val highlight">${fig.created || 0}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Roubadas (!take)</div>
          <div class="stat-val">${fig.stolen || 0}</div>
        </div>
      </div>

      <div class="info-list" style="margin-top:12px;">
        <div class="info-row">
          <span class="info-label">${emojis ? '🖼️ ' : ''}A partir de Imagens</span>
          <span class="info-val">${fig.fromImage || 0}</span>
        </div>
        <div class="info-row">
          <span class="info-label">${emojis ? '🎞️ ' : ''}A partir de Vídeos/GIFs</span>
          <span class="info-val">${fig.fromVideoGif || 0}</span>
        </div>
        <div class="info-row">
          <span class="info-label">${emojis ? '✨ ' : ''}Figurinhas Animadas</span>
          <span class="info-val">${fig.animated || 0}</span>
        </div>
        <div class="info-row">
          <span class="info-label">${emojis ? '✍️ ' : ''}Figurinhas de Texto</span>
          <span class="info-val">${fig.textStickers || 0}</span>
        </div>
        <div class="info-row">
          <span class="info-label">${emojis ? '🔄 ' : ''}Convertidas para Imagem/Mídia</span>
          <span class="info-val">${fig.conversionsToMedia || 0}</span>
        </div>
      </div>

      <div class="card-inner" style="margin-top:12px;">
        <div class="card-inner-title">${emojis ? '💡 ' : ''}Dica de Comandos</div>
        <div class="sub-desc">
          Crie figurinhas marcando imagens ou vídeos com <code>${escapeHtml(data.prefix || '!')}s</code> ou roube com <code>${escapeHtml(data.prefix || '!')}take</code>!
        </div>
      </div>
    </div>
  `;

  // 5. ABA COLEÇÕES & VITRINE
  const cols = data.collections || [];
  const completedColsCount = cols.filter((c) => c.isComplete).length;

  let showcaseHtml = '';
  if (data.showcase && data.showcase.length > 0) {
    const sItems = data.showcase
      .map((it) => `<div class="showcase-item"><span class="showcase-emoji">${it.emoji}</span><span class="showcase-name">${escapeHtml(it.name)}</span></div>`)
      .join('');
    showcaseHtml = `
      <div class="card-inner">
        <div class="card-inner-title">${emojis ? '✨ ' : ''}Vitrine em Destaque</div>
        <div class="showcase-grid">${sItems}</div>
      </div>
    `;
  }

  const collectionsListHtml = cols.length
    ? cols.map((col) => `
        <div class="collection-card ${col.isComplete ? 'complete' : ''}">
          <div class="collection-header">
            <span class="col-title">${col.emoji} ${escapeHtml(col.name)}</span>
            <span class="col-badge ${col.isComplete ? 'badge-ok' : ''}">${col.foundCount}/${col.total} (${col.percent}%)</span>
          </div>
          <div class="progress-bar mini">
            <div class="progress-fill" style="width: ${col.percent}%;"></div>
          </div>
        </div>
      `).join('')
    : '<div class="empty-state">Nenhuma coleção cadastrada no momento.</div>';

  const tabColecoes = `
    <div id="tab-content-colecoes" class="tab-pane ${activeTab === 'colecoes' ? 'active' : ''}">
      <div class="section-title">${emojis ? '🏆 ' : ''}Coleções & Conquistas</div>
      
      ${showcaseHtml}

      <div class="stat-grid" style="margin-top:10px;">
        <div class="stat-box">
          <div class="stat-label">Coleções Concluídas</div>
          <div class="stat-val highlight">${completedColsCount} / ${cols.length}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Conquistas Desbloqueadas</div>
          <div class="stat-val">${data.achievementsCount || 0}</div>
        </div>
      </div>

      <div class="section-subtitle">${emojis ? '📚 ' : ''}Progresso das Coleções</div>
      <div class="collections-list">
        ${collectionsListHtml}
      </div>
    </div>
  `;

  // Indicador de Dono / Bot no cabeçalho secundário
  let botOwnerBadge = '';
  if (data.isBotOwner) {
    botOwnerBadge = `<span class="badge badge-owner">${emojis ? '👑 ' : ''}Dono do Bot</span>`;
  } else if (data.isTargetBot) {
    botOwnerBadge = `<span class="badge badge-bot">${emojis ? '🤖 ' : ''}Lua Bot</span>`;
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Perfil de ${escapeHtml(data.name)}</title>
  <style>
    :root {
      --lua-bg: #121316;
      --lua-bg-secondary: #1A1B20;
      --lua-card: #1E2026;
      --lua-primary: #8B5CF6;
      --lua-primary-light: #A78BFA;
      --lua-primary-dark: #581C87;
      --lua-neon: #C084FC;
      --lua-text: #F8FAFC;
      --lua-text-secondary: #94A3B8;
      --lua-border: rgba(255, 255, 255, 0.12);
      --lua-border-soft: rgba(255, 255, 255, 0.08);
      --lua-chip: rgba(255, 255, 255, 0.08);
      --lua-glow: rgba(139, 92, 246, 0.25);
      --lua-radius: 12px;
      --lua-radius-sm: 8px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    
    body {
      background: var(--lua-bg, #121316);
      color: var(--lua-text, #F8FAFC);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 12px;
      font-size: 13.5px;
      line-height: 1.4;
    }

    .profile-card {
      background: var(--lua-card, #1E2026);
      border: 1px solid var(--lua-border, rgba(255, 255, 255, 0.12));
      border-radius: var(--lua-radius, 12px);
      max-width: 440px;
      margin: 0 auto;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
      display: flex;
      flex-direction: column;
    }

    /* HEADER */
    .profile-header {
      background: linear-gradient(180deg, var(--lua-bg-secondary, #1A1B20) 0%, var(--lua-card, #1E2026) 100%);
      padding: 16px 14px 12px;
      border-bottom: 1px solid var(--lua-border-soft, rgba(255, 255, 255, 0.08));
    }

    .identity-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .avatar-wrapper {
      position: relative;
      flex-shrink: 0;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      border: 2px solid var(--lua-primary, #8B5CF6);
      padding: 2px;
      background: var(--lua-bg, #121316);
      box-shadow: 0 2px 8px var(--lua-glow, rgba(139, 92, 246, 0.3));
    }

    .avatar-img {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      object-fit: cover;
      display: block;
    }

    .user-meta {
      flex: 1;
      min-width: 0;
    }

    .user-name {
      font-size: 17px;
      font-weight: 700;
      color: var(--lua-text, #F8FAFC);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .user-badges {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 4px;
      flex-wrap: wrap;
    }

    .badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .badge-primary { background: var(--lua-primary, #8B5CF6); color: #fff; }
    .badge-device { background: var(--lua-chip, rgba(255, 255, 255, 0.1)); color: var(--lua-primary-light, #A78BFA); border: 1px solid var(--lua-border-soft); }
    .badge-owner { background: rgba(250, 204, 21, 0.2); color: #FACC15; border: 1px solid rgba(250, 204, 21, 0.4); }
    .badge-bot { background: rgba(59, 130, 246, 0.2); color: #93C5FD; border: 1px solid rgba(59, 130, 246, 0.4); }

    .context-indicator {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
      padding: 6px 10px;
      border-radius: var(--lua-radius-sm, 8px);
      background: var(--lua-bg, #121316);
      border: 1px solid var(--lua-border-soft, rgba(255, 255, 255, 0.06));
      font-size: 11px;
      color: var(--lua-text-secondary, #94A3B8);
    }

    /* TABS */
    .tabs-bar-wrapper {
      display: flex;
      align-items: center;
      background: var(--lua-bg-secondary, #1A1B20);
      border-bottom: 1px solid var(--lua-border, rgba(255, 255, 255, 0.12));
      padding: 6px 8px;
      gap: 4px;
    }

    .tabs-scroll {
      display: flex;
      overflow-x: auto;
      scrollbar-width: none;
      gap: 6px;
      flex: 1;
      padding: 2px 0;
      scroll-behavior: smooth;
    }
    .tabs-scroll::-webkit-scrollbar { display: none; }

    .tab-btn {
      flex: 0 0 auto;
      background: transparent;
      border: 1px solid transparent;
      color: var(--lua-text-secondary, #94A3B8);
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    .tab-btn.active {
      background: var(--lua-primary, #8B5CF6);
      color: #fff;
      box-shadow: 0 2px 8px var(--lua-glow, rgba(139, 92, 246, 0.3));
    }

    .nav-arrow {
      background: var(--lua-card, #1E2026);
      border: 1px solid var(--lua-border-soft, rgba(255,255,255,0.1));
      color: var(--lua-text, #fff);
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 12px;
      flex-shrink: 0;
    }

    /* CONTENT BODY */
    .content-body {
      padding: 14px;
      min-height: 260px;
    }

    .tab-pane {
      display: none;
      animation: fadeIn 0.2s ease;
    }
    .tab-pane.active {
      display: block;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .section-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--lua-primary-light, #A78BFA);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .section-subtitle {
      font-size: 12px;
      font-weight: 700;
      color: var(--lua-text-secondary, #94A3B8);
      margin: 14px 0 8px;
    }

    .stat-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 10px;
    }

    .stat-box {
      background: var(--lua-bg-secondary, #1A1B20);
      border: 1px solid var(--lua-border-soft, rgba(255, 255, 255, 0.06));
      border-radius: var(--lua-radius-sm, 8px);
      padding: 8px 10px;
    }

    .stat-label {
      font-size: 11px;
      color: var(--lua-text-secondary, #94A3B8);
      margin-bottom: 2px;
    }

    .stat-val {
      font-size: 15px;
      font-weight: 700;
      color: var(--lua-text, #F8FAFC);
    }
    .stat-val.highlight {
      color: var(--lua-neon, #C084FC);
    }

    .progress-container {
      margin: 10px 0;
    }

    .progress-labels {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: var(--lua-text-secondary, #94A3B8);
      margin-bottom: 4px;
    }

    .progress-bar {
      height: 7px;
      border-radius: 999px;
      background: var(--lua-bg, #121316);
      border: 1px solid var(--lua-border-soft, rgba(255, 255, 255, 0.08));
      overflow: hidden;
      position: relative;
    }
    .progress-bar.mini {
      height: 5px;
      margin-top: 6px;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--lua-primary, #8B5CF6), var(--lua-neon, #C084FC));
      border-radius: 999px;
      transition: width 0.3s ease;
    }
    .energy-fill {
      background: linear-gradient(90deg, #F59E0B, #EF4444);
    }

    .info-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px dashed var(--lua-border-soft, rgba(255, 255, 255, 0.08));
      font-size: 12.5px;
    }

    .info-label { color: var(--lua-text-secondary, #94A3B8); }
    .info-val { font-weight: 600; color: var(--lua-text, #F8FAFC); }
    .mono { font-family: ui-monospace, monospace; font-size: 11.5px; }
    .font-bold { font-weight: 700; }
    .quote { font-style: italic; color: var(--lua-primary-light, #A78BFA); font-size: 12px; }

    .card-inner {
      background: var(--lua-bg, #121316);
      border: 1px solid var(--lua-border-soft, rgba(255, 255, 255, 0.06));
      border-radius: var(--lua-radius-sm, 8px);
      padding: 10px;
      margin-top: 8px;
    }

    .card-inner-title {
      font-size: 11.5px;
      font-weight: 700;
      color: var(--lua-primary-light, #A78BFA);
      margin-bottom: 8px;
    }

    .sub-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 0;
      font-size: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }
    .sub-row:last-child { border-bottom: none; }
    .sub-desc { font-size: 11.5px; color: var(--lua-text-secondary, #94A3B8); line-height: 1.35; }

    .privacy-notice {
      background: rgba(139, 92, 246, 0.1);
      border: 1px solid rgba(139, 92, 246, 0.2);
      border-radius: var(--lua-radius-sm, 8px);
      padding: 7px 10px;
      font-size: 11px;
      color: var(--lua-primary-light, #A78BFA);
      margin-bottom: 10px;
      line-height: 1.35;
    }

    .empty-state {
      padding: 18px 10px;
      text-align: center;
      color: var(--lua-text-secondary, #94A3B8);
      font-size: 12px;
    }

    .empty-prompt {
      text-align: center;
      padding: 24px 12px;
    }
    .empty-icon { font-size: 32px; margin-bottom: 8px; }
    .empty-title { font-size: 15px; font-weight: 700; color: var(--lua-text, #F8FAFC); margin-bottom: 4px; }
    .empty-desc { font-size: 12px; color: var(--lua-text-secondary, #94A3B8); margin-bottom: 12px; }
    .command-box {
      background: var(--lua-bg, #121316);
      border: 1px dashed var(--lua-primary, #8B5CF6);
      border-radius: var(--lua-radius-sm, 8px);
      padding: 8px 12px;
      font-size: 12.5px;
      color: var(--lua-neon, #C084FC);
      display: inline-block;
    }

    .chips-container {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .chip-item {
      background: var(--lua-chip, rgba(255, 255, 255, 0.08));
      border: 1px solid var(--lua-border-soft);
      border-radius: 6px;
      padding: 3px 7px;
      font-size: 11px;
      color: var(--lua-text, #F8FAFC);
    }
    .empty-hint { font-size: 11px; color: var(--lua-text-secondary, #94A3B8); font-style: italic; }

    .showcase-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
      gap: 6px;
    }
    .showcase-item {
      background: var(--lua-bg-secondary, #1A1B20);
      border: 1px solid var(--lua-border-soft, rgba(255, 255, 255, 0.08));
      border-radius: 6px;
      padding: 6px;
      text-align: center;
    }
    .showcase-emoji { font-size: 20px; display: block; margin-bottom: 2px; }
    .showcase-name { font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }

    .collections-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .collection-card {
      background: var(--lua-bg-secondary, #1A1B20);
      border: 1px solid var(--lua-border-soft, rgba(255, 255, 255, 0.06));
      border-radius: var(--lua-radius-sm, 8px);
      padding: 8px 10px;
    }
    .collection-card.complete {
      border-color: rgba(16, 185, 129, 0.4);
      background: rgba(16, 185, 129, 0.04);
    }
    .collection-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
    }
    .col-title { font-weight: 600; }
    .col-badge { font-size: 10px; color: var(--lua-text-secondary, #94A3B8); }
    .col-badge.badge-ok { color: #10B981; font-weight: 700; }

    /* FOOTER */
    .profile-footer {
      background: var(--lua-bg, #121316);
      border-top: 1px solid var(--lua-border-soft, rgba(255, 255, 255, 0.08));
      padding: 8px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10.5px;
      color: var(--lua-text-secondary, #94A3B8);
    }

    code {
      font-family: ui-monospace, monospace;
      background: var(--lua-chip, rgba(255, 255, 255, 0.1));
      padding: 1px 4px;
      border-radius: 4px;
      color: var(--lua-neon, #C084FC);
      font-size: 11.5px;
    }

    ${themeCss || ''}
  </style>
</head>
<body>
  <div class="profile-card">
    
    <!-- CABEÇALHO -->
    <div class="profile-header">
      <div class="identity-row">
        <div class="avatar-wrapper">
          <img class="avatar-img" src="${avatarSrc}" alt="Avatar">
        </div>
        <div class="user-meta">
          <div class="user-name">${escapeHtml(data.name)}</div>
          <div class="user-badges">
            <span class="badge badge-primary">Nível ${data.level}</span>
            ${botOwnerBadge}
            <span class="badge badge-device">${escapeHtml(data.estimatedPlatform || 'WhatsApp')}</span>
          </div>
        </div>
      </div>

      <div class="context-indicator">
        <span>📍 <b>Local:</b> ${escapeHtml(data.contextName || (data.isGroup ? 'Grupo' : 'Privado'))}</span>
        <span>⚡ Prefixo: <code>${escapeHtml(data.prefix || '!')}</code></span>
      </div>
    </div>

    <!-- ABAS -->
    <div class="tabs-bar-wrapper">
      <button class="nav-arrow" id="btn-tab-prev" aria-label="Aba anterior">‹</button>
      <div class="tabs-scroll" id="tabs-container">
        <button class="tab-btn ${activeTab === 'geral' ? 'active' : ''}" data-tab="geral">Geral</button>
        <button class="tab-btn ${activeTab === 'atividade' ? 'active' : ''}" data-tab="atividade">Atividade</button>
        <button class="tab-btn ${activeTab === 'rpg' ? 'active' : ''}" data-tab="rpg">RPG/Vida</button>
        <button class="tab-btn ${activeTab === 'figurinhas' ? 'active' : ''}" data-tab="figurinhas">Figurinhas</button>
        <button class="tab-btn ${activeTab === 'colecoes' ? 'active' : ''}" data-tab="colecoes">Coleções</button>
      </div>
      <button class="nav-arrow" id="btn-tab-next" aria-label="Próxima aba">›</button>
    </div>

    <!-- CONTEÚDO DINÂMICO -->
    <div class="content-body" id="profile-content-body">
      ${tabGeral}
      ${tabAtividade}
      ${tabRpg}
      ${tabFigurinhas}
      ${tabColecoes}
    </div>

    <!-- RODAPÉ -->
    <div class="profile-footer">
      <span>Lua Bot • Perfil Integrado</span>
      <span>${data.isRequesterSelf ? 'Seu Perfil' : 'Consulta'}</span>
    </div>

  </div>

  <script>
    (function() {
      var tabsContainer = document.getElementById('tabs-container');
      var tabBtns = document.querySelectorAll('.tab-btn');
      var tabPanes = document.querySelectorAll('.tab-pane');
      var btnPrev = document.getElementById('btn-tab-prev');
      var btnNext = document.getElementById('btn-tab-next');

      function switchTab(targetName) {
        tabBtns.forEach(function(btn) {
          if (btn.getAttribute('data-tab') === targetName) {
            btn.classList.add('active');
            btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
          } else {
            btn.classList.remove('active');
          }
        });

        tabPanes.forEach(function(pane) {
          if (pane.id === 'tab-content-' + targetName) {
            pane.classList.add('active');
          } else {
            pane.classList.remove('active');
          }
        });
      }

      tabBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
          var t = this.getAttribute('data-tab');
          if (t) switchTab(t);
        });
      });

      if (btnPrev) {
        btnPrev.addEventListener('click', function() {
          tabsContainer.scrollBy({ left: -80, behavior: 'smooth' });
        });
      }

      if (btnNext) {
        btnNext.addEventListener('click', function() {
          tabsContainer.scrollBy({ left: 80, behavior: 'smooth' });
        });
      }
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  renderPerfilHtml,
};
