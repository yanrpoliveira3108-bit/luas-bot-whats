# 🌙 LUA — PROMPT DE CONTINUIDADE (cole isto no chat novo)

> Sou o dono do bot **🌙 LUA** (WhatsApp). Você vai continuar o trabalho de um
> chat anterior. Reenviei o pacote `lua-host-completo-v1.0.0.zip` junto com este
> prompt. Extraia-o em `/home/user/lua` (ou onde preferir) antes de mexer.

## 1. O QUE É

Bot WhatsApp em **Node.js**, identidade "🌙 LUA" (lua/noite/roxo/espaço/tech/premium).
Motor: **`@lucasmod/boruto-vk7-baileys` v2.1.0** (fork "BK7"), vendored em
`vendor/boruto-vk7-baileys` (o npm cria symlink `node_modules/@lucasmod/... → vendor/`).

## 2. AMBIENTE (muito importante)

- **Node 22+ obrigatório.** No sandbox, o Node 20 do sistema dá **segfault no
  better-sqlite3**. Solução: Node 24 baixado em `/tmp/node-v24.18.0-linux-x64`
  (some entre sessões — reinstale se preciso):
  ```bash
  cd /tmp && curl -fsSL https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz -o n24.tar.xz && tar -xf n24.tar.xz
  export PATH="/tmp/node-v24.18.0-linux-x64/bin:$PATH"
  ```
- **npm 12 bloqueia install-scripts**, mas o `better-sqlite3@13` já traz
  **prebuilds N-API** para todas as plataformas (linux x64/arm64/musl…) — carrega
  sem compilar nada. NÃO precisa node-gyp.
- `node_modules` **não persiste** entre mensagens no sandbox — reinstale:
  ```bash
  npm install --legacy-peer-deps --no-audit --no-fund
  ```
  (o `.npmrc` já tem `legacy-peer-deps=true`; rodar `npm install` puro também funciona)

## 3. COMANDOS ÚTEIS

```bash
npm test                      # suíte completa → esperado: 69 verificações, 0 falha(s)
node scripts/audit.js         # auditoria de integridade (69 checks)
node index.js                 # iniciar o bot
./start.sh                    # iniciar com auto-reinício (Termux/host)
bash install.sh               # instalador (Termux E host Linux)
bash scripts/make-release.sh zip            # pacote de UPDATE (sem dados do usuário)
bash scripts/make-host-zip.sh zip           # pacote host (sem node_modules)
bash scripts/make-host-complete-zip.sh      # pacote host COMPLETO (com node_modules, sem sharp)
bash scripts/make-host-total-zip.sh         # idem + .env (contém o número do dono — SEGREDO)
```

## 4. ARQUITETURA (não reescrever; preservar)

- `config.js` — CONFIG central (`.env` via dotenv). Seções novas: `ui` (theme,
  uiMode, antiFlood, cache, debug, footerTagline) e `performance.metricsEnabled`.
- `config/themes.js` — **fonte única de cores**: 10 presets `LUA_NIGHT`, `LUA_VIOLET`,
  `LUA_GALAXY`, `LUA_MYSTIC`, `LUA_ECLIPSE`, `LUA_COSMIC`, `LUA_ROYAL`, `LUA_LAVENDER`,
  `LUA_NEON`, `LUA_AMOLED`. Cores NUNCA espalhadas manualmente.
- `utils/theme.js` (tema ativo + persistência), `utils/ui.js` (componentes de texto),
  `utils/perf.js` (métricas), `utils/flood.js` (rate limit), `utils/cache.js`
  (TtlCache com hits/misses), `utils/cooldown.js`.
- `handlers/commandHandler.js` — pipeline: normalize → prefixo → registry →
  permissões → cooldown → execute. Navegação `menu`/`0`/`voltar` aqui.
- `engine/plugins.js` — **registry único** de comandos com detecção de duplicados.
- `connection/connect.js` — `makeWASocket`, pairing code por design (QR só opcional),
  `attachToSocket` (API seletiva experimental).
- `utils/messages.js`, `utils/media.js`, `utils/richHtml.js` (card HTML padrão).
- Menus: `menus/`, `utils/buttons.js`, `utils/numberFallback.js`, `utils/nav.js`.

## 5. FUNCIONALIDADES RECENTES (já testadas: 69/69 verde)

- **`!pix [texto]|[valor]|[moeda]`** — Payment Message real (`{ payment: { note,
  amount, currency, offset:0, expiry:0, from, image } }`). Teste: `test/pix.test.js`.
- **`!ping2`** — card HTML de diagnóstico. **Padrão comprovado que renderiza:**
  wrapper `botForwardedMessage → message → richResponseMessage` + `contextInfo`
  (`forwardedAiBotMessageInfo.botJid = 867051314767696@bot`, `forwardOrigin:4`,
  `isForwarded:true`) via `relayMessage(jid, msg, {})`. ⚠️ NÃO usar flag `AI:true`
  nem `additionalNodes` — quebra a renderização (já comprovado). O `!ping2` reutiliza
  `utils/richHtml.js` (mesma estrutura do `!tigrinho`, que funciona).
- **Temas/UI** — `!tema` (lista + troca só do dono), `!debug`/`!diagnostico`,
  menu principal reformulado (texto/botões, navegação 1..15), `uiMode` text|buttons|auto.
- **Seletivo (EXPERIMENTAL)** — `!sp`/`!st` (dono, grupo) via `utils/selective.js`.
  Patch no vendor: `messages-send.js` aceita `selectiveParticipants` + `onSelectiveDebug`
  (transporte-only; NÃO é isolamento criptográfico por audiência — ver relatório
  `release/RELATORIO-SELECTIVE-PAYMENT.md` e `release/selective-vendor.patch`).
  Reversível: reverter as 3 inserções marcadas `// EXPERIMENTAL — SELECTIVE` e
  apagar `utils/selective.js`, `commands/general/selectivepay.js`, `test/selective.test.js`.

## 6. PENDÊNCIAS (o que ainda NÃO está resolvido)

1. **BUG LID/comunidade (enviar em grupos @g.us)**: erro
   `Cannot read properties of undefined (reading 'toString')`.
   Log real: `[SEND] FALHOU: chat=120363...@g.us erro=Cannot read properties of
   undefined (reading 'toString')`. Acontece após `[COMMUNITY] recebida ... lid=sim`
   e depois do `!menu` ser parseado. **Não patchear cego** — precisa do stack trace
   real do dispositivo (o `ctx.reply` já loga `e.stack` em `[SEND] STACK: ...`).
2. **Testes em dispositivo real** (pairing, conexão, renderização do card HTML no
   grupo, seletivo real, reconexão/histórico) **não são possíveis no sandbox** —
   sempre declarar explicitamente o que não foi testado.

## 7. REGRAS DO DONO (não quebrar)

- Não remover funcionalidades existentes; se quebrado, corrigir sem deletar.
- Preservar: pairing code, session, banco, usuários, RPG/economia (Lua Life),
  admin, downloads, IA, stickers, jogos, welcome/leave.
- Dono via `.env` (`OWNER_NUMBER`); `BUTTONS_ENABLED` do `.env`; `!botao on/off` dono.
- Um único registry de comandos; sem comandos/sistemas duplicados; sem `rpg2/life2/...`.
- Economia com locks/transações atômicas/cooldowns/logs; providers/downloads nunca
  crasham o bot.
- Stickers: validar WebP de verdade; preservar o erro exato de WebP inválido.
- Termux/Android: evitar deps pesadas e workers extras; estabilidade > performance.

## 8. RESULTADO ESPERADO

Extrafa o zip, instale (Node 24 + `npm install --legacy-peer-deps`), rode `npm test`
(esperado `69 verificações, 0 falha(s)`) e continue a partir do item 6 (pendências).
