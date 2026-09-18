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

## 🎨 Lua Bot 2.0 — camada visual e de resiliência

A partir da 2.0 toda a identidade visual e a robustez de I/O ficam em módulos
centrais. Nenhum comando monta template na mão nem faz chamada externa sem
timeout.

| Módulo | Responsabilidade |
| --- | --- |
| `utils/fonts.js` | Fontes Unicode (18 estilos: bold, italic, script, fraktur, double, mono, smallCaps...). `fonts.safe()` estiliza **sem tocar** em comandos, URLs, jids, IDs e caminhos. |
| `utils/dividers.js` | 56 separadores em 13 categorias (`floral`, `dark`, `minimal`, `music`, `cute`, `royal`, `warning`, `box`, `wave`, `heavy`, `anime`, `cyber`, `classic`). `divider('music')`, `divider.random()`, `divider.box(titulo)`. |
| `utils/icons.js` | Ícones semânticos (`success`, `error`, `warning`, `loading`, `music`, `admin`...) + tema visual por categoria. |
| `utils/menuRenderer.js` | Renderizador **central** de menus: `header`, `section`, `row`, `footer`, `statusBlock`, `page`, `mainMenu`. Lê o modo visual do chat e decide fonte + família de separadores. Comandos executáveis saem sempre em texto puro. |
| `utils/uiKit.js` | Componentes: `header`, `footer`, `card`, `progress`, `list`, `button`, `divider` e mensagens `error/success/loading/permission/notFound/info`. Também `truncate`, `safeText` e `paginate` (limites do WhatsApp). |
| `utils/progress.js` | Mensagem de progresso reutilizável: `state()`, `update({percent})`, `complete()`, `fail()`. **Uma mensagem por operação** (nada de edições concorrentes), throttle de 700 ms e TTL com coleta automática. |
| `utils/stateMachine.js` | `SEARCHING → FOUND → DOWNLOADING → CONVERTING → UPLOADING → DONE`, com `ERROR` acessível de qualquer etapa. Transição inválida lança `INVALID_TRANSITION`. |
| `utils/resilience.js` | `withTimeout()` (com `AbortSignal`) e `retry()` com backoff exponencial — **sem retry** para erro permanente (auth, 404, input inválido, permissão). |
| `utils/commandCache.js` | Índice invertido (nome, alias, categoria, descrição, keywords) para `!menu <termo>` / `!help <termo>`; lookup de trigger continua O(1) pelo registry. |
| `utils/tmpCleaner.js` | Ciclo `create → use → cleanup` (`withTempFile` com `try/finally`) + varredura de órfãos no boot e a cada 10 min. |

### Modos de menu (`!menumode`)

O visual dos menus é trocável em runtime e **vale por grupo** (no PV, vale
global). Cada modo muda a fonte dos títulos e a família de separadores de uma
vez — nada de string decorativa espalhada pelos comandos.

| Modo | Fonte | Separadores |
| --- | --- | --- |
| `default` | boldScript | royal |
| `dark` | fraktur | dark |
| `cute` | script | cute |
| `minimal` | sans | minimal |
| `royal` | boldItalic | floral |
| `cyber` | mono | cyber |

```
!menumode            lista os modos com prévia de cada um
!menumode dark       aplica no grupo atual
!menumode cute       idem
```

### Identidade editável por comando

```
!setcriador                          → lista os campos e o valor atual
!setcriador name Ana                 → nome do criador
!setcriador developer Ana Dev        → desenvolvedor
!setcriador about dev do Lua|Node.js → itens separados por |
!setcriador supportUrl https://wa.me/5511999999999
!setcriador photoUrl https://exemplo.com/eu.jpg
!setcriador reset name               → volta ao padrão do arquivo
!selo random                         → sorteia o selo a cada cartão
!selo seguranca                      → fixa um selo
```

Os valores ficam na tabela `settings` (chave `creator.<campo>`) e são lidos por
`utils/creatorProfile.js`, que é a fonte única de `!criador`, `!owner` e do selo.
Os padrões continuam no topo de `utils/creatorProfile.js` para quem preferir
editar o arquivo. `!setcriador supportUrl https://wa.me/<numero>` também define o
número do contato que o `!owner` envia.

### Cartão do criador (`!criador`)

```
!criador
!criador quem criou a Lua?
```

Usa a estrutura `botForwardedMessage → richResponseMessage` com `unifiedResponse.data`
em base64, que existe no proto desta biblioteca (`WAProto/E2E/E2E.proto`:
`botForwardedMessage = 104`, `richResponseMessage = 97`, `MessageContextInfo.botMetadata = 7`)
e é enviado por `socket.relayMessage`. O `contextInfo` (stanzaId/participant/quotedMessage)
vem de `utils/consts.js → seloNubank()`, que usa o id da mensagem real para a citação
ser resolvida no aparelho de quem recebe.

Personalize no bloco `CREATOR` no topo do arquivo: nome, sobre, Instagram, TikTok,
link de suporte (padrão: `wa.me` do `OWNER_NUMBER` do `.env`) e as imagens.

### Enquetes (`!poll` e `!pollresult`)

```
!poll Qual linguagem você prefere? | Lua | JavaScript | Python
!poll Qual linguagem você prefere? | Lua | JavaScript --selectableCount=2 --announcement=false
!pollresult Minha enquete | Lua:1000 | JavaScript:2000 | Python:500
```

- parâmetros opcionais usam sempre `--chave=valor`, podem vir em qualquer posição
  e nunca entram no nome nem nas opções;
- `--selectableCount` só aceita inteiro de 1 até o número de opções (rejeita
  `0`, `-1`, `1.5`, `+2`, `01`, vazio); votos aceitam inteiro ≥ 0 com o mesmo rigor;
- a enquete é desenhada numa caixa de **40 colunas** (padding 2, quebra de linha
  sem cortar palavra e continuação alinhada ao texto — `│` + 2 + `N. `);
- nada é enviado sem confirmação: estado em `utils/pendingPoll.js`
  (`pendingPollConfirmations`, chave `senderJid`, 30s).

### Confirmação de chamada (`!call`)

O `!call` usa `{ call: { name, type } }`, que o Baileys vendored converte em
`scheduledCallCreationMessage` (`type 1` → `VOICE`, `type 2` → `VIDEO` — verificado
contra o proto da lib). Nenhuma chamada sai sem confirmação explícita:

1. `!call 5511999999999` → o bot guarda a solicitação em
   `utils/pendingCall.js` (`pendingCallConfirmations`, chaveada por **senderJid**)
   e mostra o cartão de confirmação;
2. a próxima mensagem do **mesmo autor** é consumida por um único ponto de
   interceptação em `handlers/commandHandler.js` (sem listener por execução);
3. `1`/`sim`/`s`/`confirmar` envia • `2`/`não`/`n`/`cancelar`/`cancel` aborta •
   qualquer outra resposta re-pergunta;
4. depois de 30s o estado é removido e uma confirmação tardia não envia nada.

A chave é quem pediu, nunca o destino: o `1` de outro usuário não autoriza a
chamada criada por você.

**O modo vale nos dois tipos de menu.** Na navegação por lista/botões o WhatsApp
não tem campo de descrição no fluxo nativo com imagem, então a decoração vai na
legenda da imagem (título na fonte do modo + separador por contexto) e no rodapé;
o título da lista e a seção "Navegação" também usam a fonte — mas só quando cabem
inteiros no limite de 24 unidades do WhatsApp (`menuRenderer.styleFit` corta por
code point e prefere o texto puro a uma palavra pela metade). Rótulos de linha
ficam sempre puros: são clicáveis e muitas vezes contêm o comando real.

O separador também muda por contexto, mesmo dentro de um modo: música usa
`music`, download usa `wave`, sticker usa `cute`, admin usa `heavy`, erro usa
`warning`.

> **Regra:** a fonte é só decoração. `!play música do ano` continua
> `!play música do ano` — copiável e executável.

### Novos comandos da camada 2.0

| Comando | O que faz |
| --- | --- |
| `!menumode [modo]` | Lista/troca o modo visual dos menus (por grupo). |
| `!fotobot` | (dono) Troca a foto de perfil **do bot** respondendo a uma imagem — diferente de `!foto`, que muda a do grupo. Limite de 5 MB, erro sem stack. |
| `!setcriador <campo> <valor>` | (dono) Edita a identidade que aparece no `!criador` e no `!owner`: `name`, `developer`, `about`, `quote`, `instagram`, `instagramUrl`, `tiktok`, `tiktokUrl`, `supportUrl`, `photoUrl`, `botPhotoUrl`. Fica no banco — sobrevive a restart e a update. `!setcriador reset [campo]` volta ao padrão. |
| `!selo [nome\|random]` | (dono) Escolhe o selo (citação) do cartão `!criador`: `lua`, `sistema`, `seguranca`, `suporte`, `premium`, `anuncio`, `dev` — ou `random` para sortear a cada envio. |
| `!criador [pergunta]` | Quem criou o Lua Bot: cartão **richResponse/GenAI** via `relayMessage` (imagem, dados reais do bot, redes sociais, suporte, data/hora). Se o servidor recusar o cartão, entrega as mesmas informações em texto. Dados editáveis no topo de `commands/general/criador.js`. |
| `!poll <pergunta> \| <opção 1> \| <opção 2> [--selectableCount=N] [--announcement=true\|false]` | Cria uma **enquete** no chat (`pollCreationMessage` / V3 / V2). Pede confirmação antes de enviar. |
| `!pollresult <nome> \| <opção>:<votos> \| ...` | Envia o **placar** de uma enquete (`pollResultSnapshotMessage`). Pede confirmação antes de enviar. |
| `!call <numero|@mencao> [voz|video] [nome]` | Envia uma **Call Message** (chamada de voz `type 1` ou vídeo `type 2`, nome padrão `Hay`) para um número ou grupo. **Nunca envia direto**: cria uma pendência e só dispara depois que o mesmo usuário responde `1`/`sim`/`confirmar` (`2`/`não`/`cancelar` aborta). Expira em 30s. |
| `!fotomenubot [chave]` | (dono) Troca a **imagem de cabeçalho dos menus** (`main`, `admin`, `sticker`, `life`, `download`, `profile`). Valida a imagem, regrava como JPEG, guarda backup em `backup/menu/` e desfaz com `!fotomenubot reset [chave]`. |
| `!twitter <url>` (alias `!tw`, `!x`) | Baixa o vídeo/foto de um tweet com fluxo em etapas e card de resultado. |
| `!fontes [estilo] <texto>` | Mostra/aplica as 18 fontes Unicode. |
| `!dividers [categoria]` | Lista os separadores por categoria. |
| `!timestamp [seg\|ms\|iso]` | Converte timestamp Unix (s, ms, ISO, horário em America/Sao_Paulo). |

### Fluxo de mídia em etapas (`!play`, `!ytmp3`, `!ytmp4`, `!twitter`)

```
╔════════╗
║ 🎵 𝓟𝓛𝓐𝓨 ║      Estado: BUSCANDO
╚════════╝
```

O bot **não inventa porcentagem**: sem progresso real ele mostra a etapa
(`BUSCANDO`, `ENCONTRADO`, `BAIXANDO`, `ENVIANDO`, `CONCLUÍDO`). Ao terminar,
exibe card com título, canal, duração, formato, tamanho e tempo de
processamento — apenas os dados que realmente existem.

```
╭─〔 🎵 𝐏𝐋𝐀𝐘 𝐑𝐄𝐀𝐃𝐘 〕
│
│ 🎵 *Título:* Imagine Dragons - Believer
│ ℹ️ *Artista/Canal:* ImagineDragonsVEVO
│ ⏱️ *Duração:* 3m 34s
│ ⬇️ *Formato:* MP3
│ ✨ *Tamanho:* 4.1 MB
│
╰──────────────────────────
```

### Identidade visual

- `!fontes` lista os 18 estilos; `!fontes <estilo> <texto>` aplica no seu texto.
- `!dividers [categoria]` mostra os separadores por categoria.
- `!tema <preset>` troca o tema de cores (persistido no banco).

Texto decorativo pode ser estilizado; **comandos executáveis nunca são** — `!fontes mono use !play` devolve `𝚞𝚜𝚎 !play`, com o comando copiável.

### Metadados de comando (2.0)

Além de `name`, `commands`, `category`, `description`, `usage`, `cooldown`,
`ownerOnly`, `adminOnly`, `groupOnly`, `privateOnly` e `hidden`, os comandos
aceitam `examples` (array) e `tags` (array, indexado pela busca do menu):

```js
module.exports = [
  {
    name: 'play',
    commands: ['play'],
    category: 'downloads',
    description: 'Busca músicas/vídeos no YouTube e mostra opções para baixar.',
    usage: '!play <nome da música>',
    examples: ['!play imagine dragons - believer'],
    tags: ['música', 'audio', 'youtube'],
    cooldown: 8000,
    execute: async (ctx) => { /* ... */ },
  },
];
```

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
| `BUTTONS_ENABLED` | Botões interativos no menu (`true`/`false`) |
| `LUA_THEME` | Tema visual (`LUA_NIGHT`, `LUA_VIOLET`, `LUA_GALAXY`, etc.) |
| `LUA_UI_MODE` | Modo de menu (`text`, `buttons`, `auto`) |
| `LUA_READMORE` | "Ler mais" em mensagens longas |

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
| Download YouTube falha | `pkg install yt-dlp ffmpeg` + `node scripts/diagnose.js`. Bot tenta client `android` automaticamente se YouTube pedir login |
| Sticker animado falha | `pkg install ffmpeg` — imagem funciona sem ffmpeg (WASM) |
| Quer trocar prefixo | `!prefix <novo>` (dono) |
| Logs JSON no terminal, sem menu bonito | Atualize código — versão antiga usava `process.stdin.isTTY` que falha no Termux. Nova usa `tty.isatty()` |

**Diagnóstico completo:**

```bash
node scripts/diagnose.js
```

Verifica Node, better-sqlite3, ffmpeg, yt-dlp, conversores, fetch, rede, downloaders, IA.

---

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

### Recuperação total (instalação limpa sem perder dados)

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
node scripts/diagnose.js      # diagnóstico ambiente
node scripts/sticker-selftest.js # teste pipeline sticker
```

**Cobertura mínima validada:**

- Inicialização e carregamento de configuração
- Banco e migrações
- Comandos e plugins (sem duplicatas, sem comandos sem execute)
- Telefone internacional (libphonenumber-js)
- Prefixo (BOT_PREFIX vs PREFIX do Termux)
- Economia (race conditions, rollback)
- Lua Life (criação, trabalho, banco, compra/venda, mineração, casa, missões, diário, loteria)
- Downloaders (YouTube, TikTok, etc.)
- Menus e navegação por botões
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

**Nunca versione:**

- `.env`, `session/`, `database/*.db`, `logs/`, `backup/`, `node_modules/`, `*.log`, `*.db`, credenciais

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

### Instalação completa no Termux (copia e cola)

```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs-lts python make clang ffmpeg yt-dlp git unzip
git clone https://github.com/yanrpoliveira3108-bit/luas-bot-whats.git ~/lua
cd ~/lua && chmod +x update.sh start.sh
cp .env.example .env          # só na primeira vez
nano .env                     # OWNER_NUMBER=5511999999999 e BOT_PREFIX=!
./update.sh                   # deps + compila better-sqlite3 + audit + smoke
./start.sh                    # escaneia o QR na tela
```

**Ordem importa:** crie o `.env` **antes** do `./update.sh`. A etapa final do
update roda a auditoria, e ela falha com `Dono configurado via .env — 0 dono(s)`
se o `.env` ainda não existir.

> **Enquanto o PR do Lua Bot 2.0 não for mergado na `main`**, troque a linha do
> clone por:
> ```bash
> git clone -b arena/01a0a187-luas-bot-whats https://github.com/yanrpoliveira3108-bit/luas-bot-whats.git ~/lua
> ```
> A `main` ainda não tem as correções de botões, do SIGPIPE do `start.sh` nem do
> fetch single-branch.

No Termux o `npm install` usa `--ignore-scripts` (não há binário Android de
`sharp`/`wrtc`) e o `update.sh` compila o `better-sqlite3` do código-fonte — por
isso `python`, `make` e `clang` são obrigatórios. Leva alguns minutos na
primeira vez. Se faltar algo, o script diz exatamente qual pacote instalar.

**Atualizações seguintes** (preserva `.env`, `session/`, `database/`, `backup/`,
`logs/`, `assets/`):

```bash
cd ~/lua && ./update.sh
```

Use `BOT_PREFIX` no `.env`, **nunca** `PREFIX`: no Termux `PREFIX` já existe
(`/data/data/com.termux/files/usr`) e o `dotenv` não sobrescreve variáveis
existentes — usar `PREFIX` quebra todos os comandos.

---

## Licença

MIT — veja `LICENSE` se existir.

Feito com 🌙 por **Lua Dev** — Beyond the ordinary.
