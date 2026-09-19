# 🌙 Lua Bot — Auditoria e Reconstrução do AutoBot

> Relatório da auditoria completa do projeto com foco no **AutoBot** (proteções,
> anti-mídia, boas-vindas, automações, outros e globais), sem quebrar nada do
> que já existia.

---

## 1. Bugs encontrados na auditoria

| # | Problema | Impacto |
|---|----------|---------|
| 1 | **Metade dos recursos do AutoBot não existia**: `autofigu`, `autoresposta`, `simih`, `simih2`, `iaaleatory`, `autobaixar`, `cargox9`, `x9visaounica`, `modobrincadeira`, `limitarcomandos`, `modogold`, `antipv`, `antipv2`, `antipv3`, `aniversario`, `modoregistro` não tinham **nenhuma** implementação. | Comando inexistente: ativar não fazia nada. |
| 2 | **Dois sistemas de antis paralelos**: `commands/admin/filters.js` escrevia só em `settings.filters[x]`, enquanto `!anti` escrevia em `settings.anti[x].enabled`. Quem ligava por um lado não era visto pelo outro. | "Liguei e continuou agindo" / "desliguei e continuou ligado". |
| 3 | **Eventos do Baileys que nunca rodavam**: `connection/connect.js` só escutava `messages.upsert`, `group-participants.update` e `groups.update`. Sem `messages.update`, `messages.reaction` e `call`. | Anti editar msg, anti apagar msg, anti reação e anti chamada eram impossíveis. |
| 4 | **Anti "fantasma"**: vários antis pedidos (status, catálogo, enquete, comunidade, menção em massa, encaminhamento, GIF, live, canal, APK/ZIP/EXE/PDF…) não tinham detecção nenhuma. | Não existiam de fato. |
| 5 | **Chaves novas mascarando recursos antigos**: ao criar `autobot[x].enabled = false` para todos os recursos, um grupo que já tinha `filters.antilink = true` era desligado silenciosamente no upgrade. | Perda de configuração do usuário. |
| 6 | **Anti-flood/mute duplicado e histórico duplicado**: a mesma mensagem era registrada duas vezes no histórico de antis (o purge apagava o mesmo item 2x) e checagens se repetiam no pipeline. | CPU/memória à toa e efeitos duplicados. |
| 7 | **Grupo relido do banco a cada mensagem** (`groups.get` + metadados sem cache compartilhado). | Consumo de CPU/DB alto em grupo movimentado. |
| 8 | **`resolveTarget` gerava JID inválido**: `@5522…` (menção sem `contextInfo`) era salvo como `"@5522…"` em listas (x9/gold) e no registro. | Cargo X9/modo gold não funcionavam por menção digitada. |
| 9 | **Despedida ignorava saída voluntária**: só a ação `remove` disparava o goodbye; `leave` era descartado (o Baileys emite `leave`). | Ninguém era despedido quando saía sozinho. |
| 10 | **Respostas inconsistentes**: cada comando respondia de um jeito ("Anti-link ligado", "Filtro ligado"…). | Impossível automatizar/entender o estado. |
| 11 | **`!status` já existia** (perfil de RPG em `commands/rpg/core.js`). | Não podia ser reutilizado sem quebrar compatibilidade. |
| 12 | **Toggles com cooldown e subcomandos conflitantes**: `!cargox9 on` caía no help do subcomando e perdia o on/off; toggles pegavam cooldown de 1,2s. | Ação imediata não acontecia. |
| 13 | **Aniversário inexistente no banco** (sem tabela, sem parser de data, sem tarefa diária). | Recurso pedido não funcionava. |

---

## 2. Correções (arquitetura nova)

**Um registro único de recursos — `utils/autobot.js`**
- 61 recursos com `id`, comando, aliases, descrição, seção, escopo (`group`/`welcome`/`global`), opções padrão e chave legada.
- Precendência segura na leitura: *ligado em qualquer sistema = ligado* (`autobot` → `anti` → `filters`), garantindo que um filtro antigo ligado continue ligado.
- `setEnabled()` grava **na hora** no banco e **espelha** `filters[x]` e `anti[x].enabled` → os três sistemas nunca divergem.
- Cache em memória com invalidação instantânea + espelho global em `settings` (`autobot:<id>`, cache de 30s).
- `!statusgrupo` é gerado do **mesmo registro** que executa os recursos: nada de status decorativo.
- `ensureGroupDefaults()` cria automaticamente todas as chaves com valor padrão e **migra** quem já tinha filtro ligado antes.

**Execução imediata (sem reiniciar)**
- `handlers/groupHandler.js` reescrito: `applyFilters()` → saída rápida se nenhum anti está ligado → imunidade (dono/admin/bot) → detecção → ação.
- `handlers/autoHandler.js`: autofigu, autobaixar, autoresposta, simih, simih2, iaaleatory, visu única, modo brincadeira + tarefa diária de aniversário.
- `handlers/eventHandler.js`: `messages.update` (editar/apagar), `messages.reaction` (reação), `call` (chamada) com deduplicação (5 min) e imunidade para dono/admin.
- Nada é lido de arquivo/env em tempo de execução: ligar/desligar é apenas memória + 1 UPDATE.

**Detecção real — `utils/antiDetect.js`** (funções puras, testadas uma a uma)
- pix/pagamento (chave copia-e-cola, `requestPaymentMessage`, `sendPaymentMessage`, `paymentInviteMessage`, links de pagamento, invoice)
- links, links soltos, convites de grupo, catálogo
- bot, enquete, comunidade, canal, status, encaminhamento, menção em massa
- view once, GIF, live/localização (inclusive localização em tempo real), APK/ZIP/EXE/PDF/documento
- vídeo, imagem, áudio, contato, sticker, mídia genérica
- limite de caracteres, emoji spam, símbolos, toxicidade

**Padronização**
- Todo comando on/off responde **exatamente** `✅ Recurso ativado.` ou `❌ Recurso desativado.`
- `!statusgrupo` no formato oficial (seções 🔒 🚫 👋 🤖 📋 🌐, cada item com ✅/❌ + comando).
- Comando avançado `!anti` mantido (`lista`, `on/off`, `action`, `--purge`, `config`, `reset`) e agora operando sobre o mesmo registro.

**Banco e desempenho**
- `database/groups.js`: cache de configurações (15s/2000 grupos), `patchSettings` (1 UPDATE), `getList/setList/addToList/removeFromList`, `groupsOfMember`, `invalidateSettings`.
- Migração **#40**: tabela `birthdays` + índice por dia/mês.
- `utils/groupMeta.js`: metadados de grupo compartilhados entre handlers.
- `utils/janitor.js`: 7 tarefas de limpeza periódica (caches, histórico de antis, cooldowns, mapas de rate-limit, aniversário…).

---

## 3. Arquivos

**Criados**
```
utils/autobot.js            registro único + status + boot + toggle
utils/antiDetect.js         detecção (pura) de todos os antis
utils/antiManager.js        ações dos antis (reescrito) e histórico
utils/birthday.js           parser dd/mm + consultas de aniversário
utils/groupMeta.js          cache compartilhado de metadados do grupo
utils/janitor.js            limpeza periódica de memória
handlers/autoHandler.js     automações + aniversário
handlers/eventHandler.js    antis de edição/remoção/reação/chamada
commands/admin/autobot.js   todos os comandos do AutoBot (gerados do registro)
commands/admin/status.js    !statusgrupo / !statusglobal
test/autobot.test.js        suíte completa do AutoBot (15 blocos)
RELATORIO-AUTOBOT.md        este relatório
```

**Modificados**
```
index.js                    liga AutoBot, janitor e eventos novos
connection/connect.js       novos listeners (messages.update/reaction/call)
handlers/commandHandler.js  pipeline único, anti-PV, x9, gold, limite, registro
handlers/groupHandler.js    filtros, mute, boas-vindas, log, antifake/antibot (reescrito)
database/groups.js          cache + patchSettings + listas + grupos do membro
database/database.js        migração #40 (aniversários)
utils/antiManager.js        antis unificados no registro do AutoBot
commands/admin/filters.js   comandos legados agora usam o AutoBot (nomes preservados)
commands/admin/anti.js      !anti sobre o mesmo registro
commands/_shared/admin.js   resolveTarget aceita "@55…" sem contextInfo
menus/screens.js            atalhos "Painel AutoBot" e "Status do grupo"
menus/settings.js           tela de configurações com 24 recursos + atalhos
test/moderation.test.js     antilink ligando/desligando em tempo real
package.json                suíte inclui test/autobot.test.js
```

---

## 4. Recursos entregues (todos configuráveis por comando)

- 🔒 **PROTEÇÕES**: Anti Link, Anti Link 2, Anti Link GP, Anti Palavrão, Anti Fake, Anti Catálogo, Anti Localização, Limite Caracteres, Anti Spam, Anti Status, Anti Flood, Anti Símbolos, Anti Pagamento (PIX), Anti Bot, Anti Enquete, Anti Comunidade, Anti Menção em Massa, Anti Encaminhamento, Anti Texto Gigante, Anti Emoji Spam, Anti Editar Msg, Anti Apagar Msg, Anti Reação, Anti Chamada, Anti Toxicidade.
- 🚫 **ANTI MÍDIA**: Vídeo, Imagem, Áudio, Documento, Contato, Sticker, Mídia, View Once, GIF, Localização Real, Live, Canal, APK, ZIP, EXE, PDF.
- 👋 **BEM-VINDO**: Bemvindo1/2, Saiu1/2 (cartão e texto).
- 🤖 **AUTOMAÇÃO**: Autofigu, AutoResposta (add/list/del/clear), Simih, Simih2, IA Aleatory, Auto Baixar.
- 📋 **OUTROS**: Cargo X9 (add/remove/list), Visu Única, Modo Brincadeira, Limitar Comandos, Modo Gold (add/remove/list).
- 🌐 **GLOBAL**: Anti PV, Anti PV2, Anti PV3, Aniversário, Modo Registro (`!registrar`/`!unregistrar`).

---

## 5. Testes executados

```
node scripts/audit.js            → 69/69 verificações, 0 falhas
node test/smoke.js               → OK
node test/phone.test.js          → OK
node test/connect_flow.test.js   → OK
node test/prefix.test.js         → OK
node test/migration.test.js      → OK
node test/life.test.js           → OK
node test/e2e.test.js            → OK
node test/moderation.test.js     → OK (liga/desliga antilink em tempo real)
node test/pix.test.js            → OK
node test/theme.test.js          → OK
node test/platform.test.js       → OK
node test/selective.test.js      → OK
node test/autobot.test.js        → OK (15 blocos, ~90 verificações)
```

Com `OWNER_NUMBER` definido (o único teste que depende dele é o de .env):
`OWNER_NUMBER=5511999999999 npm test`.

O que a suíte do AutoBot cobre: registro sem colisão de gatilhos, criação
automática de chaves, formato do `!statusgrupo`, **todos** os comandos
ligando/desligando com a resposta exata, persistência + espelhos legados,
whitelist do anti-link, 30 detecções de anti (liga apaga / desliga não apaga),
antis de evento, 8 automações, cargo X9, modo gold, limite de comandos,
modo registro, anti PV 1/2/3, aniversário, boas-vindas/despedida e cache
(0 leituras de grupo em 20 mensagens).

---

## 6. Garantia de compatibilidade

- **Nenhum comando foi removido ou renomeado.** Todos os gatilhos antigos
  (`!antilink`, `!antipix`, `!antispam`, `!antiinvite`, `!anti …`, `!setwelcome`,
  `!welcome`, `!setgoodbye`, `!goodbye`, `!anticonfig`, `!x9`, `!status` do RPG…)
  continuam funcionando — agora delegando ao AutoBot.
- `filters[x]` e `anti[x].enabled` continuam sendo gravados (espelho), então
  menus, plugins e códigos antigos que leem essas chaves seguem corretos.
- `!status` continua sendo o perfil de RPG; o painel do grupo é `!statusgrupo`
  (aliases `!statusgp`, `!statusg`, `!grupstatus`).
- Estrutura de pastas, loader e plugins intactos; nenhum plugin quebrou
  (`scripts/audit.js` valida triggers, menus e downloaders).
- Grupos antigos são migrados na primeira mensagem, sem perder configuração.

## 7. Como usar

```
!statusgrupo                painel completo do grupo (formato oficial)
!autobot                    mesmo painel + !autobot all on|off
!statusglobal               recursos globais (dono)
!antilink on|off            liga/desliga imediatamente
!anti lista | !anti <tipo> on|off | !anti <tipo> action ban
!autoresposta add bom dia = Bom dia, {user}!
!aniversario 25/12          cadastra aniversário (global: !aniversario on)
!cargox9 add @user          poderes de moderação para membros
!modogold add @user         ignora cooldown
!limitarcomandos 10         máximo de comandos por minuto
```
