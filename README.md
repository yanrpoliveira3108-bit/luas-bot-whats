# 🌙 Lua — Bot WhatsApp

Bot WhatsApp **modular, estável, seguro e profissional**, construído com **Node.js + Baileys**, usando **pairing code** (sem QR Code), banco local **SQLite**, arquitetura de **plugins/comandos**, **interface de terminal profissional** e sistema de **atualização via Git**.

> Identidade, código e arquitetura próprios. Foco em estabilidade, segurança, compatibilidade com Termux e facilidade de manutenção pelo GitHub.

**Repositório oficial:** https://github.com/yanrpoliveira3108-bit/luas-bot-whats

---

## 📋 Índice

- [O que é](#o-que-é)
- [Estrutura](#estrutura)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Execução](#execução)
- [Atualização](#atualização)
- [Troubleshooting](#troubleshooting)
- [Jogos com aposta (caça ao tesouro e tigrinho)](#jogos-com-aposta-caça-ao-tesouro-e-tigrinho)
- [Restrição de conta / segurança de envio](#restrição-de-conta--segurança-de-envio)
- [Recuperação](#recuperação)
- [Desenvolvimento](#desenvolvimento)
- [Testes](#testes)
- [Segurança](#segurança)
- [Termux](#termux)

---

## O que é

Lua é um bot WhatsApp completo com:

- **273+ comandos reais** organizados em 14 categorias (admin, downloads, stickers, IA, RPG, games, anime, utilidades etc.)
- **Lua Life** — simulador de vida + economia (trabalho, banco, loja, fazenda, missões, conquistas)
- **IA** — assistente local offline + API externa opcional (OpenAI compatível) com fallback honesto
- **Pairing code** — sem QR Code, com parser internacional de números (libphonenumber-js)
- **Banco SQLite** — via better-sqlite3, com migrações versionadas e backup automático
- **Arquitetura de plugins** — cada pasta em `commands/` é um plugin com enable/disable
- **Logs estruturados** — pino, sem expor segredos, com rotação diária
- **Atualização segura via Git** — preserva `.env`, `session/`, `database/`, `backup/`, `logs/`

---

## Estrutura

```
lua/  (raiz do repositório = ~/lua no Termux)
├── index.js                 # ponto de entrada
├── config.js                # configuração central (lê .env)
├── package.json / .npmrc
├── .env.example / .gitignore
├── install.sh / start.sh / update.sh
├── README.md / HOST.md / README_LUA_LIFE.md
├── config/
│   └── themes.js            # 10 presets de tema (fonte única de cores)
├── connection/
│   ├── connect.js           # Baileys + reconexão + anti dupla conexão
│   ├── pairing.js           # pairing code
│   ├── phoneParser.js       # libphonenumber-js wrapper
│   └── connectionUI.js      # interface interativa do terminal
├── commands/                # plugins (1 pasta = 1 plugin)
│   ├── loader.js            # carregamento automático
│   ├── _shared/             # helpers (não são comandos)
│   └── admin/ ai/ anime/ downloads/ fun/ games/ general/ life/ members/ owner/ rpg/ stickers/ utility/
├── downloaders/             # youtube, tiktok, instagram, facebook, pinterest, twitter, reddit
├── handlers/
│   ├── commandHandler.js    # pipeline de mensagens
│   ├── buttonHandler.js     # botões/listas
│   ├── groupHandler.js      # eventos de grupo + filtros
│   └── errorHandler.js
├── engine/
│   ├── plugins.js           # registry de comandos
│   └── interactionEngine.js
├── database/
│   ├── database.js          # núcleo SQLite + migrações
│   ├── users.js, groups.js, economy.js, life.js, etc.
│   └── seed/                # dados iniciais
├── utils/                   # logger, permissões, cache, cooldown, etc.
├── menus/                   # menus interativos
├── ai/                      # provedores de IA (local, api, fallback)
├── anime/                   # provedores anime (jikan)
├── assets/                  # imagens (menu.jpg, actions, welcome/goodbye)
├── scripts/
│   ├── audit.js             # auditoria automática
│   ├── diagnose.js          # diagnóstico do ambiente
│   └── sticker-selftest.js
├── test/                    # testes automatizados
├── vendor/
│   └── boruto-vk7-baileys/  # Baileys vendored (JS puro, sem binários nativos)
├── tmp/                     # temporários (.gitkeep)
├── session/                 # credenciais WhatsApp (NÃO versionado)
├── database/lua.db          # banco (NÃO versionado)
├── logs/                    # logs diários (NÃO versionado)
└── backup/                  # snapshots de atualização (NÃO versionado)
```

**O que é versionado vs local:**

| Tipo | Exemplos | No Git? |
|------|----------|---------|
| Código | `commands/`, `handlers/`, `utils/`, `config.js`, `index.js` | ✅ Sim |
| Configuração exemplo | `.env.example` | ✅ Sim |
| Configuração local | `.env` | ❌ Não (.gitignore) |
| Sessão WhatsApp | `session/` | ❌ Não |
| Banco | `database/*.db` | ❌ Não |
| Logs | `logs/` | ❌ Não |
| Backups | `backup/` | ❌ Não |
| Temporários | `tmp/`, `*-player-script.js` | ❌ Não |
| Dependências | `node_modules/` | ❌ Não |

---

## Requisitos

| Item | Versão |
|------|--------|
| Node.js | **≥22.0.0** (obrigatório para better-sqlite3@13) |
| npm | vem com Node |
| git | para atualização via GitHub |
| ffmpeg | opcional, mas recomendado (stickers animados + YouTube vídeo) |
| yt-dlp | opcional, recomendado (YouTube mais estável) |
| Python + make + clang | apenas no Termux/Android para compilar better-sqlite3 |

**Termux (Android):**

```bash
pkg update && pkg upgrade
pkg install nodejs-lts python make clang ffmpeg yt-dlp git
```

**Linux (Ubuntu/Debian):**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs build-essential ffmpeg git
# opcional: pip install yt-dlp
```

---

## Instalação

### Instalação oficial (recomendada — via Git)

```bash
git clone https://github.com/yanrpoliveira3108-bit/luas-bot-whats.git ~/lua
cd ~/lua
chmod +x update.sh start.sh
./update.sh
./start.sh
```

**O que cada comando faz:**

1. `git clone https://github.com/yanrpoliveira3108-bit/luas-bot-whats.git ~/lua`
   - Clona o repositório oficial para `~/lua` (pasta padrão no Termux)
   - Cria a estrutura completa do projeto

2. `cd ~/lua`
   - Entra na raiz do projeto (onde estão `package.json`, `index.js`, `update.sh`)

3. `chmod +x update.sh start.sh`
   - Devolve permissão de execução (zip pode remover +x)

4. `./update.sh`
   - **Modo Git (padrão):**
     - Valida que é repositório Git e remote origin aponta para `luas-bot-whats`
     - Faz `git fetch` do GitHub
     - Detecta alterações locais e ABORTA se houver risco de sobrescrever
     - Faz `git pull --ff-only` seguro
     - Cria snapshot em `backup/pre-update-*/` antes de alterar
     - Preserva `.env`, `session/`, `database/`, `backup/`, `logs/`, `assets/menu.jpg`
     - Instala/atualiza dependências se `package.json` mudou
     - Compila `better-sqlite3` se necessário (Android)
     - Roda `audit.js` + `smoke.js` para validar integridade
     - Mostra commits e arquivos atualizados
   - **Idempotente:** rodar 2x seguidas não corrompe

5. `./start.sh`
   - Verifica Node ≥22, npm, `.env` com OWNER_NUMBER, `node_modules`, `better-sqlite3`
   - Cria diretórios (`session/`, `tmp/`, `database/`, `logs/`, `backup/`, `assets/`)
   - Inicia o bot com auto-restart (para se dono usar `!shutdown`)
   - Retorna código de erro se não conseguir iniciar

### Instalação via pacote (legado — Downloads)

Se você baixou um `lua-update-*.zip` na pasta Downloads:

```bash
mkdir -p ~/lua && cd ~/lua
unzip -q ~/storage/downloads/lua*.zip -d .
mv lua-main/* . 2>/dev/null; rmdir lua-main 2>/dev/null
bash install.sh
```

Ou use o `update.sh` em modo arquivo:

```bash
cd ~/lua
./update.sh ~/storage/downloads/lua-update-v1.0.0.zip
```

O `install.sh` também detecta automaticamente pacotes em `~/storage/downloads/` se a pasta estiver vazia.

---

## Configuração

O instalador cria `.env` a partir de `.env.example`. **Edite antes de iniciar:**

```bash
nano .env
```

Exemplo mínimo:

```env
BOT_NAME=Lua
BOT_PREFIX=!
OWNER_NUMBER=5511999999999
OWNER_NAME=Dono
```

> **IMPORTANTE:** Use `BOT_PREFIX` e NÃO `PREFIX`. No Termux, `PREFIX` já existe como variável do sistema (`/data/data/com.termux/files/usr`) e o `dotenv` não sobrescreve variáveis existentes — usar `PREFIX` quebra todos os comandos.

---

## Variáveis de Ambiente

Todas as variáveis ficam em `.env` (nunca versionado). Veja `.env.example` completo.

### Essenciais

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `BOT_NAME` | Nome do bot | `Lua` |
| `BOT_PREFIX` | Prefixo dos comandos | `!` |
| `OWNER_NUMBER` | Dono (DDI+DDD+número) | `5511999999999` |
| `OWNER_NUMBERS` | Vários donos (vírgula) | `551199...,551198...` |
| `OWNER_NAME` | Nome do dono | `Dono` |

### Conexão

| Variável | Descrição |
|----------|-----------|
| `PAIRING_NUMBER` | Número para pairing code (opcional, se vazio pergunta no terminal) |
| `DEFAULT_COUNTRY` | País padrão para números sem DDI (ex.: `BR`) |
| `WA_VERSION` | Versão do protocolo WhatsApp (opcional, ex.: `2,3000,1043857760`). Deixe vazio para auto-detecção |
| `SESSION_DIR` | Pasta da sessão (padrão `./session`) |

### Interface

| Variável | Descrição |
|----------|-----------|
| `BUTTONS_ENABLED` | Botões interativos no menu (`true`/`false`). Só é afetado se você ligar `SAFE_MODE=1` |
| `LUA_THEME` | Tema visual (`LUA_NIGHT`, `LUA_VIOLET`, `LUA_GALAXY`, etc.) |
| `LUA_UI_MODE` | Modo de menu (`text`, `buttons`, `auto`) |
| `LUA_READMORE` | "Ler mais" em mensagens longas |

### Segurança de envio (anti-restrição) — leia antes de tirar do padrão

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `SAFE_MODE` | Opcional: bloqueia lista/botões nativos, cards HTML e pagamento | `0` (desligado) |
| `HUMAN_DELAYS` / `MIN_TYPING_DELAY_MS` / `MAX_TYPING_DELAY_MS` | Simula "digitando..." antes de responder (camada humana) | `true` / `600` / `2200` |
| `SILENT_PV` | Não responde conversa casual de desconhecido no PV | `true` |
| `BROWSER_NAME` / `MARK_ONLINE_ON_CONNECT` | Fingerprint do cliente e presença online | `windows` / `false` |
| `ALLOW_INTERACTIVE` / `ALLOW_RICH_CARDS` / `ALLOW_PAYMENT_TEST` | Liberam só aquele payload (vazio = segue o `SAFE_MODE`) | vazio |
| `SEND_MIN_INTERVAL_MS` / `SEND_CHAT_INTERVAL_MS` / `SEND_JITTER_MS` | Freio: intervalo global, por conversa e variação aleatória | `1200` / `2000` / `900` |
| `SEND_MAX_PER_MINUTE` / `SEND_CHAT_MAX_PER_MINUTE` | Teto de mensagens por minuto (total / por conversa) | `15` / `6` |
| `SEND_WARMUP_HOURS` / `SEND_WARMUP_FACTOR` | WARMUP de número novo: limites ÷fator | `48` / `3` |
| `SEND_DUP_MAX_CHATS` / `SEND_DUP_WINDOW_MIN` | Anti-broadcast (0 = desligado) | `0` / `10` |
| `SEND_BLOCK_COLD_PV` | Não iniciar conversa no PV com quem nunca falou com o bot | `1` |
| `SEND_PAUSE_MINUTES` | Pausa automática de tudo ao detectar sinal de restrição | `15` |
| `SEND_CONNECT_GRACE_MS` | Espera após conectar antes do 1º envio | `8000` |

> ℹ️ **Sobre restrição de conta:** não existe causa única nem prova de que cards
> HTML/menu interativo causem banimento (vários bots usam isso sem cair). O
> padrão do bot é o comportamento normal (HTML liberado) + **freio de ritmo**
> ligado. Para investigar um caso real: `node scripts/restricao.js`.
> Detalhes em **[SEGURANCA-ENVIO.md](SEGURANCA-ENVIO.md)**.

### Limites

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `DOWNLOAD_MAX_MB` | Limite download | `100` |
| `MAX_UPLOAD_MB` | Limite upload | `60` |
| `STICKER_MAX_MB` | Limite sticker | `15` |
| `DEFAULT_COOLDOWN_MS` | Cooldown comandos | `3000` |

### Lua Life (economia)

| Variável | Descrição |
|----------|-----------|
| `LUA_COIN_SYMBOL` | Símbolo moeda (`LC`) |
| `LUA_COIN_EMOJI` | Emoji moeda (`🪙`) |
| `LUA_START_MONEY` | Dinheiro inicial |
| `LUA_DAILY_BASE` / `LUA_DAILY_MAX` | Limites daily |

### Logs e Recursos

| Variável | Descrição |
|----------|-----------|
| `LOG_LEVEL` | Nível log (`info`, `debug`, `warn`) |
| `LOG_TO_FILE` | Log em arquivo (`true`/`false`) |
| `ENABLE_EVAL` | Habilita `!eval` (desabilitado por padrão — segurança) |
| `PRIVATE_MODE` | Apenas dono + registrados (`true`/`false`) |

### APIs Externas (opcionais)

| Variável | Descrição |
|----------|-----------|
| `OPENWEATHER_API_KEY` | Clima (`!clima`) |
| `AI_PROVIDER` | `auto`, `local`, `api` |
| `AI_API_URL` | URL compatível OpenAI |
| `AI_API_KEY` | Chave API IA |
| `AI_MODEL` | Modelo (`gpt-4o-mini`) |

---

## Execução

```bash
./start.sh              # com auto-restart (recomendado)
./start.sh --no-restart # uma única vez (para pm2/systemd)
npm start               # direto
node index.js           # direto
```

Ao iniciar, você verá:

```
╔══════════════════════════════════════╗
║              🌙 LUA BOT              ║
║        WhatsApp Assistant            ║
╚══════════════════════════════════════╝

✓ Configuração carregada
✓ Banco de dados conectado
✓ Plugins carregados
✓ Comandos carregados
✓ Menus carregados
✓ Sistema de conexão iniciado

[1] Conectar WhatsApp
[2] Configurações
[3] Verificar sistema
[0] Sair
```

### Pairing Code (primeiro login)

1. Escolha `[1] Conectar WhatsApp`
2. Digite número em qualquer formato: `+55 11 99999-9999`, `5511999999999`, `+1 (742) 369-1883`
3. Confirme número mascarado (`+55 *******9999`)
4. Terminal mostra código: `ABCD-EFGH`
5. No celular: WhatsApp → Aparelhos conectados → Conectar com número → digite código
6. Sessão salva em `session/` e restaurada automaticamente depois

> QR Code nunca é usado (`printQRInTerminal: false`).

### Rodar em segundo plano

**pm2 (VPS):**

```bash
npm install -g pm2
pm2 start start.sh --name lua
pm2 save && pm2 startup
pm2 logs lua
```

**systemd:** crie `/etc/systemd/system/lua.service` apontando para `~/lua/start.sh`.

---

## Atualização

### Fluxo oficial

```bash
cd ~/lua && ./update.sh --delete-source
./start.sh
```

**O que cada comando faz:**

1. `cd ~/lua && ./update.sh --delete-source`
   - Entra em `~/lua` (raiz do projeto)
   - Valida repositório Git e remote origin
   - `git fetch origin --prune` — busca atualizações do GitHub
   - Verifica alterações locais — aborta se houver risco
   - `git pull --ff-only` — atualiza código de forma segura
   - Cria snapshot em `backup/pre-update-YYYYMMDD-HHMMSS/`
   - Preserva `.env`, `session/`, `database/*.db`, `backup/`, `logs/`, `assets/menu.jpg`
   - Atualiza dependências se `package.json` mudou
   - Compila `better-sqlite3` se necessário
   - Valida com `audit.js` + `smoke.js`
   - Mostra commits e arquivos alterados
   - `--delete-source` limpa **apenas** temporários seguros:
     - `tmp/*` (exceto `.gitkeep`)
     - `*.log` na raiz
     - `*-player-script.js`, `1788*.js`
     - `.gyp/` cache
     - previews `card-*.jpg`, `welcome-preview.jpg`, `tigrinho-preview.html`
     - backups `pre-update-*` com +30 dias
   - **NUNCA apaga:** `.env`, `session/`, `database/`, `backup/` recente, `logs/`, `assets/`, `.git/`, arquivos do usuário

2. `./start.sh`
   - Inicia o bot após validar que atualização foi bem-sucedida
   - Se `update.sh` falhou, `start.sh` ainda verifica integridade antes de iniciar
   - Retorna erro se bot não conseguir iniciar

**Idempotente:** rodar `./update.sh --delete-source` duas vezes seguidas não corrompe nem duplica arquivos.

### Outras formas

```bash
./update.sh              # apenas git pull, sem limpeza
./update.sh --help       # ajuda
./update.sh pacote.zip --delete-source  # modo legado (extrai e apaga pacote de Downloads)
```

### O que é preservado (nunca apagado)

| Item | Conteúdo |
|------|----------|
| `.env` | configurações e dono |
| `session/` | credenciais WhatsApp (sem novo pairing) |
| `database/*.db` | usuários, RPG, grupos, X9, quiz |
| `backup/` | snapshots e backups |
| `logs/` | histórico de logs |
| `assets/menu.jpg` | imagem personalizada do menu |

### Se algo der errado

```bash
# snapshot informado pelo update.sh
cp -a backup/pre-update-20250101-120000/. .
./start.sh
```

---

## Troubleshooting

| Problema | Solução |
|----------|---------|
| `Node <22` | `pkg install nodejs-lts && hash -r` (Termux) ou Node 22+ via NodeSource |
| `Cannot find module 'dotenv'` | `npm install --legacy-peer-deps` ou `./update.sh` |
| `better-sqlite3` não carrega | `pkg install python make clang && cd node_modules/better-sqlite3 && npm run build-release` |
| `gyp: Undefined variable android_ndk_path` | `export GYP_DEFINES="android_ndk_path=''" && mkdir -p ~/.gyp && echo "{'variables':{'android_ndk_path':''}}" > ~/.gyp/include.gypi` — `install.sh`/`update.sh` já fazem isso |
| `sharp` erro no Termux | Inofensivo — opcional, bot usa jimp/ffmpeg no Termux |
| `./start.sh: Permission denied` | `chmod +x *.sh` |
| Bot não responde comandos | Verifique prefixo com mensagem `prefixo`, não teste pelo mesmo número do bot (use outro número ou grupo) |
| Prefixo `/data/data/com.termux/...` | Use `BOT_PREFIX` no `.env`, não `PREFIX` (variável do Termux) |
| `Bad MAC` / `Failed to decrypt` | Sessão corrompida ou número em uso em outro aparelho — apague `session/` e refaça pairing |
| `Conexão perdida (restartRequired)` | **Sucesso** — WhatsApp aceitou código e pede reconexão, bot reconecta sozinho |
| Pairing code não aparece / `Connection Closed` 428 | Aguarde websocket abrir (correção na versão atual). Se persistir, rate-limit 429 — aguarde 15-30min |
| Fica "Aguardando autenticação" para sempre | Versão atual sempre mostra causa. Veja `logs/baileys-*.log` |
| **Nenhum download funciona** | Rode `node scripts/downloads-doctor.js` — ele diz o que falhou, item por item. Guia: `DOWNLOAD-TROUBLESHOOTING.md` |
| Download YouTube falha | `pkg install python ffmpeg && pip install -U yt-dlp` (**não** existe `pkg install yt-dlp`) + `node scripts/downloads-doctor.js youtube`. Se aparecer "Sign in to confirm you're not a bot", exporte os cookies e use `YT_COOKIES=./cookies.txt` |
| Áudio/vídeo não chega no WhatsApp (só texto) | Diretório temporário inválido no Android — rode pelo `index.js` (ele corrige) ou `export TMPDIR="$PWD/tmp"`. `node scripts/downloads-doctor.js` mostra |
| Vídeo do YouTube sai sem som / não abre | `pkg install ffmpeg` (mescla vídeo+áudio) |
| Sticker animado falha | `pkg install ffmpeg` — imagem funciona sem ffmpeg (WASM) |
| Quer trocar prefixo | `!prefix <novo>` (dono) |
| Logs JSON no terminal, sem menu bonito | Atualize código — versão antiga usava `process.stdin.isTTY` que falha no Termux. Nova usa `tty.isatty()` |

**Diagnósticos:**

```bash
node scripts/diagnose.js          # ambiente (Node, banco, motores, rede, IA)
node scripts/downloads-doctor.js  # downloads: ambiente + rede + cada site + saída
node scripts/downloads-doctor.js youtube   # só uma plataforma
```

O `downloads-doctor` é o que resolve "nenhum download funciona": ele testa cada
site de verdade e diz, linha por linha, o que fazer. Detalhes em
[`DOWNLOAD-TROUBLESHOOTING.md`](DOWNLOAD-TROUBLESHOOTING.md).

---

## Jogos com aposta (caça ao tesouro e tigrinho)

Os dois jogos que movimentam LuaCoins usam **a mesma carteira**
(`database/economy.js`) e a **mesma camada de aposta**:

- `{prefix}cacatesouro` → 🗺️ caça ao tesouro de 3×3 até 13×13, com painel de
  carteira/aposta, expedição única, pistas de vizinhança, armadilhas e TTL de
  30 min. Também aceita `jogar <n> casual` (sem aposta) e `rapido` (o 3×3
  antigo);
- `{prefix}tigrinho` → 🐯 preservado, agora com o mesmo painel e com a animação
  mostrando o **resultado validado pelo bot** (o card nunca sorteia pêmio).

Detalhes completos (origem do saldo, parâmetros, regras de pagamento, o que o
card pode fazer, testes): **[JOGOS-APOSTA.md](JOGOS-APOSTA.md)**.

Se algum jogo responder “algo deu errado”, rode `npm run jogos:doctor`: ele
mostra a causa real (com stack) e o estado do banco, sem enviar nada no
WhatsApp.

---
## Restrição de conta / segurança de envio

Se aparecer o aviso **"conta restrita"** (ou o número parar de enviar), comece
pela auditoria — ela mostra o que a conta fez antes de cair:

```bash
node scripts/restricao.js          # lê os logs: pareamentos, quedas, 429, ritmo, repetição
node scripts/restricao.js --dias 30
```

O relatório completo (fatos, hipóteses descartadas, checklist da conta e teste
controlado) está em **[SEGURANCA-ENVIO.md](SEGURANCA-ENVIO.md)**. Resumo do
protocolo:

1. `!freio pausar 120` — **pare de enviar**. Não reenvie a mensagem que falhou:
   cada tentativa durante o aviso soma penalidade (restrição → restrição → ban).
2. Espere o prazo do aviso + algumas horas com o número em silêncio total.
3. `!freio retomar` e use pouco nas primeiras horas.
4. Número novo precisa de aquecimento (0–24 h de uso humano antes de ligar o bot).

O que fica **ligado** por padrão: freio de ritmo (fila, intervalo, teto por
minuto, pausa automática ao detectar restrição) e bloqueio de conversa fria no
PV. O que fica **liberado** (comportamento normal): cards HTML, menu por
lista/botões e pagamento.

```bash
!freio              # painel: limites, fila, warmup e restrições detectadas
!antiban            # status das proteções anti-ban + dicas
!freio seguro on    # opcional: bloqueia cards HTML e menu nativo
!freio warmup off   # número já é antigo/aquecido → limites normais
```

## Recuperação

### Backup automático

- Ao conectar, `sessionRecovery` faz backup de credenciais
- Ao atualizar, `update.sh` cria `backup/pre-update-YYYYMMDD-HHMMSS/` com `.env`, `session/`, `database/`, `logs/`, `assets/menu.jpg`

### Restaurar snapshot

```bash
ls backup/
cp -a backup/pre-update-20250101-120000/. .
./start.sh
```

### Comandos de backup no bot

- `!backup` — gera `.db` em `backup/`
- `!restore` — restaura mais recente (dono)

## Recuperação total (instalação limpa sem perder dados)

```bash
# faça backup manual dos dados importantes
cp -a ~/lua/.env /tmp/
cp -a ~/lua/session /tmp/
cp -a ~/lua/database /tmp/
cp -a ~/lua/backup /tmp/

# reinstala
rm -rf ~/lua
git clone https://github.com/yanrpoliveira3108-bit/luas-bot-whats.git ~/lua
cd ~/lua
chmod +x update.sh start.sh

# restaura dados
cp -a /tmp/.env ~/lua/
cp -a /tmp/session ~/lua/
cp -a /tmp/database ~/lua/
cp -a /tmp/backup ~/lua/

./update.sh
./start.sh
```

---

## Desenvolvimento

### Arquitetura

- `config.js` — lê `.env` via dotenv, expõe `CONFIG` central
- `config/themes.js` — 10 presets, fonte única de cores (nunca espalhar cores)
- `commands/loader.js` — carrega plugins, valida, registra no `engine/plugins.js`
- `engine/plugins.js` — registry com validação, detecção de duplicatas, enable/disable
- `handlers/commandHandler.js` — pipeline: registra usuário, checa bloqueados, flood, mute, filtros, resolve comando, permissões, cooldown, executa com try/catch
- `connection/connect.js` — Baileys com reconexão backoff, anti dupla conexão, eventos de status
- `database/database.js` — SQLite com migrações versionadas, prepared statements, backup
- `utils/` — logger (pino, sem segredos), permissões, cache, cooldown, etc.

### Adicionar comando

Crie arquivo em `commands/<categoria>/meucomando.js`:

```js
module.exports = [{
  name: 'meucomando',
  commands: ['meucomando', 'mc'],
  category: 'general',
  description: 'Meu comando',
  execute: async (ctx) => {
    await ctx.reply('Olá!');
  }
}];
```

- `name` único, `commands` = triggers, `category` = pasta
- `ownerOnly`, `adminOnly`, `groupOnly`, `privateOnly`, `botAdmin` para permissões
- `cooldown` em ms
- `ctx` tem `reply`, `sendImage`, `sendSticker`, etc.

### Adicionar profissão/item Lua Life

Edite `plugins/life/config.js` e `database/seed/life.js`.

### Temas

Edite apenas `config/themes.js` — nunca espalhe cores nos comandos. Use `utils/theme.js` para obter tema ativo.

---

## Testes

```bash
npm test                      # suíte completa
npm run audit                 # auditoria (69 verificações)
npm run smoke                 # smoke test (banco, economia, etc.)
node test/phone.test.js       # parser de telefone
node test/prefix.test.js      # prefixo BOT_PREFIX vs PREFIX
node test/migration.test.js   # migrações
node test/life.test.js        # Lua Life (23 regressões)
node test/e2e.test.js         # pipeline ponta a ponta
node test/sendguard.test.js   # freio de envio + modo seguro (anti-restrição)
node scripts/restricao.js     # auditoria de restrição (lê os logs do bot)
node scripts/diagnose.js      # diagnóstico ambiente
node scripts/sticker-selftest.js # teste pipeline sticker
```

**Cobertura mínima validada:**

- Auditoria de restrição de conta (`scripts/restricao.js` — lê logs e auditoria de envios)
- Inicialização e carregamento de configuração
- Banco e migrações
- Comandos e plugins (sem duplicatas, sem comandos sem execute)
- Telefone internacional (libphonenumber-js)
- Prefixo (BOT_PREFIX vs PREFIX do Termux)
- Economia (race conditions, rollback)
- Lua Life (criação, trabalho, banco, compra/venda, mineração, casa, missões, diário, loteria)
- Downloaders (YouTube, TikTok, etc.)
- Menus e navegação por botões (lista nativa no padrão; textual com `SAFE_MODE=1`)
- Freio de envio: ordem da fila, intervalos, teto por conversa, PV frio,
  anti-broadcast, pausa automática por restrição e warmup
- Tratamento de erros (bot nunca morre por exceção isolada)

---

## Segurança

Auditoria realizada:

- ✅ Sem `eval()` em código de produção (apenas teste que verifica ausência)
- ✅ Sem `child_process.exec` com entrada de usuário (apenas `spawnSync` com args fixos para ffmpeg/yt-dlp)
- ✅ Sem credenciais hardcoded
- ✅ Sem command injection
- ✅ Sem path traversal (caminhos resolvidos via `path.resolve(ROOT, ...)`)
- ✅ Validação de entrada em todos os comandos (limite de args, tipos)
- ✅ `.env`, `session/`, `database/*.db`, `logs/`, `backup/` protegidos por `.gitignore`
- ✅ Logger com `redact` para `password`, `token`, `secret`, `credential`, `apiKey`
- ✅ Baileys logs em arquivo separado, sem credenciais no terminal
- ✅ `!eval` desabilitado por padrão (`ENABLE_EVAL=false`)
- ✅ Permissões verificadas via `utils/permissions.js` (owner, admin, botAdmin)
- ✅ Freio de envio (`utils/sendGuard.js`): fila com intervalo/teto por minuto,
  pausa automática ao detectar restrição, warmup de número novo, bloqueio de
  conversa fria no PV e auditoria de envios (`data/sends.jsonl`, sem conteúdo)
- ✅ Modo seguro opcional (`utils/safety.js`, `SAFE_MODE=0` por padrão): permite
  bloquear lista/botões nativos, cards HTML e pagamento se o dono quiser testar

**Nunca versione:**

- `.env`, `session/`, `database/*.db`, `logs/`, `backup/`, `data/`, `node_modules/`, `*.log`, `*.db`, credenciais

---

## Termux

O projeto é otimizado para Termux:

- Detecta Android via `uname -o` e `TERMUX_VERSION`
- Corrige `android_ndk_path` automaticamente (`.gyp/include.gypi`)
- Usa `--ignore-scripts` no Termux para pular build de `sharp`/`wrtc` (sem binário Android)
- Compila `better-sqlite3` do código-fonte quando necessário
- Não assume systemd, Docker, `/home/user`, ou ferramentas de PC
- Shebang `#!/usr/bin/env bash` compatível
- Variáveis com aspas, exit codes corretos, sem comandos destrutivos

**Dependências Termux:**

```bash
pkg update && pkg upgrade
pkg install nodejs-lts python make clang ffmpeg yt-dlp git unzip
```

---

## Licença

MIT — veja `LICENSE` se existir.

Feito com 🌙 por **Lua Dev** — Beyond the ordinary.
