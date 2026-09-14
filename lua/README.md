# 🌙 Lua — Bot WhatsApp

Bot WhatsApp **modular**, **estável** e **realmente funcional**, construído com **Node.js + Baileys**, usando **pairing code** (sem QR Code), banco de dados local (SQLite), arquitetura de **plugins/comandos** e **interface profissional de terminal** com entrada inteligente de número telefônico.

> Identidade, código e arquitetura próprios. Nenhum código proprietário de outros bots foi copiado.

---

## ✅ Estado atual

- **273+ comandos reais**, organizados em 14 plugins/categorias — incluindo **Lua Life** (simulador de vida + economia, ver `README_LUA_LIFE.md`) e **IA** (assistente local + API externa opcional).
- Interface de terminal interativa com **pairing code** e **parsing internacional de números** (libphonenumber-js).
- Nenhum comando falso, nenhum botão decorativo, nenhum import quebrado.
- Verificado por `npm test` (auditoria + smoke + testes de telefone).

---

## 1. Requisitos

| Item | Versão recomendada |
|---|---|
| Node.js | **22 LTS ou superior** (testado em 20.20.2 e 26.4.0) |
| npm | vem com o Node |
| ffmpeg | **opcional** — necessário apenas para stickers **animados** (vídeo/GIF). Stickers estáticos (imagem/texto) e `!toimg` funcionam sem ele (fallback jimp + libwebp). |
| Celular | WhatsApp com "Aparelhos conectados" (para o pairing code) |

> ⚠️ **Node 22+ é obrigatório**: o `better-sqlite3@13` (usado pelo banco) exige Node ≥ 22. O Node 20 está fora de suporte desde abril/2026.

**Termux (Android):**
```bash
pkg update && pkg upgrade
pkg install nodejs-lts        # Node 22/24 (ou nodejs para o mais recente)
pkg install python make clang # ferramentas para compilar o better-sqlite3
pkg install ffmpeg            # recomendado (stickers de vídeo)
pkg install git
```

> ⚠️ **Correção obrigatória no Termux** (bug do node-gyp): antes do primeiro `npm install`, rode uma única vez:
> ```bash
> export GYP_DEFINES="android_ndk_path=''"
> mkdir -p ~/.gyp && echo "{'variables':{'android_ndk_path':''}}" > ~/.gyp/include.gypi
> ```
> Isso evita o erro `gyp: Undefined variable android_ndk_path in binding.gyp`. O `install.sh` e o `update.sh` **já aplicam isso automaticamente**.

---

## 2. Instalação

```bash
# clone/entre na pasta do projeto (Termux: crie ~/lua e extraia o zip da pasta Downloads)
cd lua

# instala tudo (dependências, diretórios, .env, banco, módulo nativo)
./install.sh
# ou manualmente:
npm install   # o .npmrc do projeto já define legacy-peer-deps=true
```

> **Dica (Termux):** se você baixou o projeto e ele caiu na pasta Downloads, extraia e instale assim:
> ```bash
> pkg install python make clang                 # necessário para compilar o better-sqlite3
> mkdir -p ~/lua && cd ~/lua
> unzip -q ~/storage/downloads/lua*.zip -d .   # extrai o projeto
> mv lua-main/* . 2>/dev/null; rmdir lua-main 2>/dev/null   # sobe o conteúdo, se houver subpasta
> bash install.sh                              # instala dependências, .env e banco
> ```
> O `node_modules/` **não vem no zip** — é preciso rodar o `npm install` (feito pelo `install.sh`) uma vez antes do primeiro `npm start`.

> **Por que `--legacy-peer-deps`?** A árvore de dependências do Baileys declara peers opcionais (`sharp`, `jimp`, `link-preview-js`…). O `.npmrc` do projeto define `legacy-peer-deps=true` para aceitar a combinação já validada pelos testes, **sem `--force`**. No Termux, o `install.sh`/`update.sh` ainda adicionam `--ignore-scripts` para pular o build nativo de `sharp`/`wrtc` (sem binário para Android e não usados pelo Lua).

### Versões utilizadas (fixadas/testadas)

| Pacote | Versão |
|---|---|
| `@innovatorssoft/baileys` | **7.4.7** (fork mantido da linha 7; única implementação ativa) |
| `@itsukichan/libsignal-node` | 1.0.1 (protocolo criptográfico, usado pelo Baileys 7) |
| `jimp` | 0.16.1 (pipeline de stickers e imagens) |
| `pino` | ^9.6.0 (mesma família usada internamente pelo Baileys) |
| `better-sqlite3` | ^13.0.3 (exige Node ≥ 22; compatível com Node 22/24/26) |
| `@distube/ytdl-core` | ^4.16.12 (fork mantido do ytdl-core) |
| `yt-search` | ^2.13.1 |
| `node-webpmux` | ^3.2.1 (metadados de sticker + fallback webp sem ffmpeg) |
| `dotenv` | ^16.4.5 |
| `libphonenumber-js` | ^1.13.12 (parser internacional de números) |
| `sharp` | ^0.32.6 (opcional) |

> ℹ️ **Migração**: o Lua migrou de `@whiskeysockets/baileys@6.7.24` para **`@innovatorssoft/baileys@7.4.7`**. Existe apenas UMA implementação ativa (verifique com `npm list @innovatorssoft/baileys`). As APIs usadas pelo Lua (`makeWASocket`, `useMultiFileAuthState`, `makeCacheableSignalKeyStore`, `fetchLatestBaileysVersion`, `DisconnectReason`, `Browsers`, `downloadContentFromMessage`) foram auditadas e adaptadas para a nova versão.

---

## 3. Configuração (`.env`)

O instalador cria o `.env` a partir de `.env.example`. **Edite antes de iniciar:**

```env
BOT_NAME=Lua
BOT_PREFIX=!                      # ⚠️ use BOT_PREFIX, nunca "PREFIX" (ver nota abaixo)
OWNER_NUMBER=5511999999999        # OBRIGATÓRIO — DDI+DDD+número, só dígitos
OWNER_NAME=Dono
PAIRING_NUMBER=                   # opcional: número usado no pairing (senão, pergunta no terminal)
DEFAULT_COUNTRY=BR                # país padrão para números sem DDI explícito
PRIVATE_MODE=false
MAX_DOWNLOAD_MB=50
LOG_LEVEL=info
ENABLE_EVAL=false                 # !eval desabilitado por padrão (segurança)
```

Nada sensível fica no código. As credenciais de sessão ficam em `session/` (nunca versionada) e **nunca são impressas no terminal**.

> ⚠️ **Por que `BOT_PREFIX` e não `PREFIX`?** No Termux, `PREFIX` é uma variável de ambiente **do próprio sistema** (aponta para `/data/data/com.termux/files/usr`). O `dotenv` não sobrescreve variáveis já existentes, então usar `PREFIX` fazia o bot adotar esse caminho como prefixo — e **nenhum comando respondia**. O Lua agora usa `BOT_PREFIX` (e ainda aceita o `PREFIX` legado, desde que não seja um caminho).

---

## 4. Como iniciar

```bash
./start.sh      # inicia com reinício automático
# ou
npm start
# ou
node index.js
```

Ao iniciar, o Lua mostra uma **tela profissional no terminal**:

```
╔══════════════════════════════════════╗
║              🌙 LUA BOT              ║
║        WhatsApp Assistant            ║
╚══════════════════════════════════════╝

Inicializando sistema...

✓ Configuração carregada
✓ Banco de dados conectado
✓ Plugins carregados
✓ Comandos carregados
✓ Menus carregados
✓ Sistema de conexão iniciado
```

Depois, um **menu interativo**:

```
[1] Conectar WhatsApp
[2] Configurações
[3] Verificar sistema
[0] Sair
```

---

## 5. Pairing code (primeiro login)

1. Escolha **`[1] Conectar WhatsApp`**.
2. Digite o número completo em **qualquer formato** (o sistema identifica país, DDI e DDD automaticamente):

   ```
   +1 (742) 369-1883
   +1 742 3691883
   17423691883        ← os três representam o MESMO número
   +55 19 99999-9999
   +351 912 345 678
   +44 20 7946 0958
   +81 90-1234-5678
   ```

3. O sistema mostra a **confirmação** (número mascarado, ex.: `+55 *******9999`).
4. Confirmando, o terminal exibe o **pairing code**:

   ```
   ╭──────────── 🔐 PAIRING CODE ────────────╮
   │                ABCD-EFGH                │
   ╰─────────────────────────────────────────╯
   ```

5. No celular: **WhatsApp → Aparelhos conectados → Conectar aparelho → Conectar com número de telefone** e digite o código.
6. Pronto — a sessão é salva e **restaurada automaticamente** nas próximas execuções.

> QR Code **não é usado** em nenhum momento (`printQRInTerminal: false`).

---

## 6. Entrada inteligente de número (sem confundir DDI com DDD)

O parser usa **libphonenumber-js** (mesma metadata do libphonenumber do Google) — **não** usa regras simplistas de quantidade de dígitos:

- **`+` no início** → número internacional explícito; o país é identificado pelo DDI (ex.: `+1...`, `+55...`, `+351...`).
- **Sem `+` e sem país padrão** → o sistema tenta interpretar automaticamente:
  - **uma única interpretação** → `✓ Número identificado`;
  - **ambiguidade** → lista os países candidatos (`[1] 🇨🇦 Canadá (+1) ...`) e pede **apenas** a escolha do país;
  - **nenhuma** → `❌ Número inválido. Digite novamente:`.
- **Número local** (ex.: `19999999999`) → interpretado conforme `DEFAULT_COUNTRY` (padrão `BR`), com confirmação antes de conectar.
- **Modo guiado** (alternativa): escolher país manualmente e informar o número nacional.

Funções reutilizáveis em `connection/phoneParser.js`: `normalizePhoneNumber`, `parsePhoneNumber`, `validatePhoneNumber`, `detectCountry`, `formatPhoneNumber`, `maskPhoneNumber`.

### Exemplos aceitos

| Entrada | País | Normalizado |
|---|---|---|
| `+1 (742) 369-1883` | 🇨🇦 Canadá (área 742 — não assume EUA) | `17423691883` |
| `+1 202 555 0148` | 🇺🇸 Estados Unidos | `12025550148` |
| `+55 (19) 99999-9999` | 🇧🇷 Brasil | `5519999999999` |
| `+351 912 345 678` | 🇵🇹 Portugal | `351912345678` |
| `+44 20 7946 0958` | 🇬🇧 Reino Unido | `442079460958` |
| `+81 90-1234-5678` | 🇯🇵 Japão | `819012345678` |
| `+54 9 11 5555-1234` | 🇦🇷 Argentina | `5491155551234` |
| `+34 612 345 678` | 🇪🇸 Espanha | `34612345678` |

---

## 7. Sessão, troca e restauração

- **Sessão encontrada?** → restaura automaticamente (`✓ Sessão encontrada → ✓ Restaurando sessão...`). **Não** pede número nem gera pairing de novo.
- **Só pede novo número** quando: não há sessão, o usuário pediu troca, ou a sessão foi invalidada (logout).
- **Menu conectado**:

  ```
  [1] Conectar
  [2] Trocar sessão   ← encerra a sessão e apaga credenciais (com confirmação)
  [3] Restaurar sessão
  [4] Status
  [0] Sair
  ```

- **Nunca** apaga a sessão por erro de conexão. Queda de rede → `↻ Restaurando conexão...` (reconexão com backoff). Logout real → `⚠ Sessão encerrada. Será necessário autenticar novamente.`

---

## 8. Estrutura do projeto

```
lua/
├── index.js                 # ponto de entrada
├── config.js                # configuração central (lê .env)
├── package.json
├── .env / .env.example
├── install.sh / start.sh / update.sh
├── README.md
├── database/
│   ├── database.js          # núcleo SQLite + migrações + backup
│   ├── users.js             # usuários, XP, nível, reputação
│   ├── groups.js            # grupos, membros, advertências, X9
│   ├── economy.js           # carteira, banco, transferências, inventário
│   ├── rpg.js               # jogador, loja, fazenda, cooldowns
│   ├── games.js             # estatísticas de jogos + quiz
│   ├── blocked.js           # usuários bloqueados
│   ├── settings.js          # chave/valor (prefixo, plugins)
│   └── seed/                # loja e perguntas do quiz
├── connection/
│   ├── connect.js           # Baileys + reconexão + anti dupla conexão
│   ├── pairing.js           # pairing code (validação + geração)
│   ├── phoneParser.js       # normalizar/validar/detectar números (libphonenumber)
│   ├── phone.js             # decisões de alto nível sobre números
│   ├── sessionRecovery.js   # backup/restauração/logout
│   └── connectionUI.js      # interface interativa do terminal
├── commands/                # plugins (1 pasta = 1 plugin)
│   ├── loader.js            # carregamento automático + reload
│   ├── _shared/             # helpers (não são comandos)
│   ├── general/ owner/ admin/ members/ downloads/ stickers/
│   ├── games/ rpg/ anime/ fun/ utility/ rankings/
├── downloaders/             # youtube / tiktok / instagram / facebook
├── anime/
│   └── providers/jikan.js   # adaptador Jikan (MyAnimeList)
├── menus/                   # menus interativos (index.js = ordem)
├── handlers/
│   ├── commandHandler.js    # pipeline de mensagens/comandos
│   ├── buttonHandler.js     # roteador único de botões/listas
│   ├── groupHandler.js      # eventos + filtros de grupo
│   ├── mediaHandler.js      # helpers de mídia
│   └── errorHandler.js      # erros amigáveis
├── engine/
│   ├── plugins.js           # registry de comandos
│   └── interactionEngine.js # motor de interações (zueira)
├── utils/                   # logger, permissões, cache, cooldown, terminal, etc.
├── assets/menu.jpg          # imagem do menu
├── scripts/audit.js         # auditoria automática
├── scripts/make-release.sh  # gera pacote de atualização seguro
└── test/                    # smoke.test, phone.test, drive_ui (PTY)
```

---

## 9. Comandos (por categoria)

| Categoria | Comandos |
|---|---|
| ⚙️ Geral | `!ping` `!menu` `!menucompleto` `!help` `!info` `!owner` `!dono` `!prefix` `!prefixo` `!id` `!config` `!lermais` + menus `!menuadm` `!menuautomod` `!menusticker` `!menuia` `!menumedia` `!menudono` `!menulifeadmin` |
| 👑 Dono | `!restart` `!shutdown` `!reload` `!plugins` `!pluginsreload` `!eval` `!statsbot` `!uptime` `!memory` `!system` `!logs` `!database` `!backup` `!restore` `!block` `!unblock` `!broadcast` |
| 🛡️ Admin | `!promover` `!rebaixar` `!kick` `!ban` `!unban` `!adicionar` `!marcar` `!hidetag` `!admins` `!membros` `!inativos` `!grupo` `!abrirgrupo` `!fechargrupo` `!nomegrupo` `!descgrupo` `!linkgrupo` `!revogarlink` `!foto` `!advertir` `!rmadv` `!warnings` `!resetadv` `!mute` `!unmute` `!setwelcome` `!setgoodbye` `!welcome` `!pedidos` `!aprovar` `!rejeitar` `!aprovarall` `!rejeitarall` `!x9` + 14 filtros |
| 👥 Membros | `!perfil` `!userinfo` `!badges` `!rank` `!top` `!level` `!xp` `!tempo` `!atividade` `!reputacao` `!sobre` `!regras` `!afk` `!voltei` `!avatar` `!banner` `!bio` `!reportar` `!sugerir` |
| 📥 Downloads | `!play` `!ytmp3` `!ytmp4` `!youtube` `!ytsearch` `!tiktok` `!instagram` `!facebook` `!pinterest` `!download` `!audio` `!video` `!imagem` (YouTube, TikTok, Instagram, Facebook, Pinterest, X/Twitter, Reddit) |
| 🎨 Stickers | `!sticker` `!s` `!stickerimg` `!stickertext` `!txtsticker` `!emojisticker` `!toimg` `!take` `!pack` `!rename` `!emoji` `!circle` `!crop` `!resize` |
| 🤖 IA | `!ia` `!ai` `!ask` `!perguntar` `!chat` `!codigo` `!traduzir` `!resumir` `!aistatus` `!aimemory` (local offline + API externa opcional com fallback) |
| 🎮 Games | `!games` `!dado` `!moeda` `!adivinhacao` `!matematica` `!jokenpo` `!batalha` `!cacatesouro` `!memoria` `!quiz` |
| ⚔️ RPG | `!rpg` `!perfilrpg` `!saldo` `!banco` `!depositar` `!sacar` `!trabalhar` `!emprego` `!empregos` `!inventario` `!loja` `!comprar` `!vender` `!usar` `!transferir` `!daily` `!semanal` `!rankrpg` + fazenda |
| 🍥 Anime | `!anime` `!manga` `!personagem` `!waifu` `!husbando` `!animequiz` `!animerandom` `!otaku` `!quoteanime` `!animeinfo` |
| 😂 Zueira | `!beijo` `!abraco` `!tapinha` `!cumprimento` `!cafune` `!zoar` `!trollar` `!ship` `!casal` `!sorte` `!azar` `!gaymer` `!burro` `!inteligente` `!gado` `!sigma` `!based` `!meme` `!memeuser` `!caption` `!roast` `!elogio` `!verdade` `!desafio` `!eu` `!chance` `!rankzueira` `!karma` `!piada` `!charada` `!8ball` `!conselho` `!fato` `!horoscopo` `!sorteio` `!escolher` `!verdadeoudesafio` |
| 🛠️ Utilidades | `!calc` `!cep` `!cnpj` `!botinfo` `!data` `!hora` `!fuso` `!qr` `!base64` `!uuid` `!senha` `!porcentagem` |
| 📊 Rankings | `!ranking` |

> **Menu gerado dinamicamente:** se um plugin não carregar, o comando **não aparece** no menu. Não existe comando só no menu.

### 🤖 IA (assistente)

O bot traz um módulo de IA em camadas (`ai/`): **provider local** (offline: contas, tradução PT⇄EN básica, snippets de código, piadas/fatos/conselhos), **provider externo** (API compatível com OpenAI, via `AI_API_URL`/`AI_API_KEY`/`AI_MODEL`) e **fallback** honesto. A ordem é decidida pelo `AI_PROVIDER` (`auto`/`local`/`api`) e o usuário nunca recebe uma resposta "fingida". `!aistatus` mostra a configuração **sem expor chaves**, e `!aimemory on|off|clear` controla a memória da conversa (em RAM, nunca em disco).

### 📥 Downloads modulares

Cada plataforma é um provider independente em `downloaders/` (YouTube, TikTok, Instagram, Facebook, Pinterest, X/Twitter, Reddit) com fila (`utils/downloadQueue.js`), limite de tamanho, timeout, retry controlado e limpeza de temporários. Serviços públicos de terceiros (tikwm, fxtwitter, Reddit JSON, Twemoji) podem mudar ou sair do ar — nesse caso o bot responde `❌ Não foi possível baixar` com o motivo, **nunca trava o processo**.

- **Instagram**: baixa o **vídeo de verdade** (não só a capa). O bot usa a página de embed (`instagram.com/{p|reel}/{id}/embed/captioned/`), que expõe o `video_url` (mp4 do CDN) mesmo sem login; se não achar, cai no Open Graph. Posts privados/bloqueados respondem erro amigável.

---

## 10. Banco de dados

- SQLite local (`database/lua.db`) via `better-sqlite3`.
- Migrações versionadas (`schema_migrations`) e seed idempotente.
- Backup: `!backup` (gera `.db` em `backup/`) e `!restore` (restaura o mais recente). Backup de credenciais automático ao conectar.

---

## 11. Diagnóstico e Termux

Se **stickers**, **downloads** ou **IA** não responderem no Termux, rode:

```bash
node scripts/diagnose.js
```

Ele verifica Node, `better-sqlite3`, `ffmpeg`, `yt-dlp`, conversores, `fetch`, rede e providers, e imprime exatamente o que falta. Correções comuns:

```bash
pkg update && pkg upgrade
pkg install ffmpeg       # vídeo do YouTube (mescla vídeo+áudio) + sticker de vídeo/GIF
pkg install yt-dlp       # download de YouTube confiável (recomendado!)
pkg install nodejs-lts   # Node 22 LTS (better-sqlite3 13 pede Node novo)
hash -r
# dentro da pasta do bot:
npm install
npm rebuild better-sqlite3   # se o banco não abrir
node index.js
```

- **YouTube**: o bot usa o **yt-dlp** quando disponível (muito mais robusto que o ytdl-core, que quebra a cada mudança do YouTube). Sem yt-dlp, cai no ytdl-core (client WEB). Áudio não precisa de ffmpeg; **vídeo precisa de ffmpeg** (o YouTube serve vídeo e áudio separados — DASH). Se o YouTube responder *"Sign in to confirm you're not a bot"* (comum em IP de datacenter/VPS), o bot tenta de novo com o **client `android`** do yt-dlp, que devolve o formato combinado (360p A+V) mesmo para esses vídeos bloqueados.
- **Stickers de imagem** funcionam sem binário nativo (conversor WASM) e **redimensionam automaticamente para 512x512** (fotos grandes não saem mais em branco/indisponíveis). Só vídeo/GIF exige `ffmpeg`.
- **Envio de mídia (todos os downloads)**: o Baileys 7.4.7 não aceita caminho de arquivo como string pura — o bot converte para `{ url }` (ver `utils/media.js#asMedia`). Era a causa de "nenhum download funcionava" apesar do arquivo ser baixado.
- No Termux o `sharp` (nativo glibc) é ignorado automaticamente — o bot usa ffmpeg/node-webpmux. Se você compilou o sharp do zero, defina `LUA_ALLOW_SHARP=1`.

## 12. Testes

```bash
npm test                       # auditoria + smoke + testes de telefone
node test/phone.test.js        # só os testes de número
python3 test/drive_ui.py       # interface interativa via PTY (Linux/macOS)
python3 test/drive_ui2.py      # ambiguidade de número + restauração de sessão
```

---

## 13. Troubleshooting

| Problema | Solução |
|---|---|
| O terminal mostra só log JSON, sem o menu/splash bonito | sua versão é antiga ou o modo interativo não ativou. **Atualize para a versão nova** (que usa `tty.isatty`, confiável no Termux). Os logs JSON continuam sendo gravados em `logs/lua-YYYY-MM-DD.log`. Para forçar modo não interativo limpo, use `LUA_NO_UI=1 ./start.sh`. |
| O bot conecta mas **não responde comandos** / `Bad MAC` / `Failed to decrypt message with any known session` | sessão corrompida ou **o mesmo número está ativo em outro lugar ao mesmo tempo** (celular + bot). Não use o mesmo número logado no celular e no bot simultaneamente enquanto pareia. Para limpar: pare o bot, apague a pasta `session/` (ou use `[2] Trocar sessão`), e refaça o pairing **uma única vez** com um número que não esteja em uso em outro aparelho. |
| **Mostra o código, depois "Conexão perdida (restartRequired)"** | **isso é SUCESSO, não erro.** Quando o WhatsApp aceita o código, ele fecha a conexão com `restartRequired` e pede para o cliente reconectar — o login conclui na reconexão. A versão nova faz isso automaticamente (você verá "reconectando — o código continua válido" e depois "🌙 LUA ONLINE"). Só era um problema na versão antiga. |
| `npm install` falha no Termux com erro de **sharp** ou **wrtc** | o `@innovatorssoft/baileys@7` traz `sharp` e `@roamhq/wrtc` como dependências (não têm binário para Android). O `install.sh`/`update.sh` já detectam o Termux e usam `--ignore-scripts` para pular o build nativo desses módulos — o Lua **não os usa** (sharp é opcional em runtime; wrtc é só para chamadas VoIP). O `better-sqlite3` é compilado normalmente em seguida. |
| **Não mostra o pairing code** / "O WhatsApp fechou a conexão ao pedir o código" | a versão nova aguarda o websocket abrir antes de pedir o código (correção de corrida de conexão — era o erro "Connection Closed" 428). Se ainda aparecer: o WhatsApp está **limitando as tentativas** (rate-limit 429) ou o número está em uso em outro aparelho. **Aguarde 15–30 min (às vezes horas)** entre tentativas, use Wi-Fi, e não fique repetindo. |
| Fica **"○ Aguardando autenticação..."** para sempre, sem mensagem de erro | isso acontecia quando a conexão fechava por um motivo não classificado (ex.: queda de rede) durante o pareamento. A versão nova **sempre mostra a causa** (`❌ Falha na conexão: ...`) em vez de travar até o timeout. Veja também `logs/baileys-YYYY-MM-DD.log` para o erro exato do WhatsApp. |
| Quero ver os **erros internos do WhatsApp/Baileys** | eles são gravados em `logs/baileys-YYYY-MM-DD.log` (nível `warn` por padrão). Para diagnóstico: `BAILEYS_LOG_LEVEL=debug LUA_DEBUG_CONN=1 ./start.sh` (mostra também no terminal). Nunca usa credenciais. |
| Fica "reconectando"/"Conexão perdida" várias vezes | a versão nova para sozinha após 8 tentativas e mostra as causas na tela. Limpe a sessão (`rm -rf session`), aguarde, e tente **uma única vez**. |
| **Mando `!comando` e o bot não responde** | confira: (1) o prefixo é `!` (mande só `prefixo` e o bot responde qual é); (2) **não teste pelo MESMO número do bot** — mande de outro número ou num grupo; se testar pelo próprio número, use o recurso "mensagem para você mesmo" (o dono pode usar comandos por lá). Se continuar, veja `logs/lua-YYYY-MM-DD.log`. |
| O bot responde com prefixo esquisito tipo `/data/data/com.termux/files/usr` | é a variável `PREFIX` do Termux invadindo o bot. **Atualize para a versão nova** (usa `BOT_PREFIX`). Se preferir corrigir na mão, edite o `.env`: troque `PREFIX=!` por `BOT_PREFIX=!`. |
| O terminal mostra "Closing open session..." e despeja chaves (lixo do libsignal) | isso é log interno do libsignal (criptografia do WhatsApp) que poluía o terminal. A versão nova **filtra esse ruído** em modo interativo. Não é erro — é só log. |
| O terminal não mostra um log organizado dos comandos | agora cada comando executado imprime uma linha organizada no terminal: `[data hora] 👤 Nome +55 *******9999 → !comando`. No WhatsApp, use `!logs` (dono) para ver as últimas execuções no mesmo formato. |
| `Error: Cannot find module 'dotenv'` (ou outro módulo) | as dependências não estão instaladas — rode `npm install --legacy-peer-deps` (ou `bash install.sh`) uma vez antes do `npm start` |
| `npm error ERESOLVE ... jimp@0.16.1 ... peerOptional jimp@"^1.6.0" from baileys` | use `--legacy-peer-deps`. O projeto já traz um `.npmrc` com `legacy-peer-deps=true`, então `npm install` puro funciona. Nunca use `--force`. |
| `Cannot find module '.../better-sqlite3/build/Release/better_sqlite3.node'` | no Android o better-sqlite3 **não tem binário pré-compilado** e precisa ser compilado uma vez. Rode: `pkg install python make clang` e depois `cd node_modules/better-sqlite3 && npm run build-release`. O `install.sh` faz isso automaticamente. |
| `gyp: Undefined variable android_ndk_path in binding.gyp` (Termux) | bug do node-gyp no Termux. Rode uma vez: `export GYP_DEFINES="android_ndk_path=''"` e `mkdir -p ~/.gyp && echo "{'variables':{'android_ndk_path':''}}" > ~/.gyp/include.gypi`. O `install.sh`/`update.sh` já aplicam isso automaticamente. |
| `sharp: Installation error: Prebuilt libvips ... not yet available for android-arm64v8` | **inofensivo** — o `sharp` é opcional e não tem versão para Android. O Lua usa `jimp` para stickers no Termux. Ignore. |
| `./start.sh: Permission denied` | o zip remove a permissão de execução. Rode: `chmod +x *.sh` (o `install.sh`/`update.sh` também corrigem sozinho) |
| `better-sqlite3` falha ao instalar/compilar no Termux | instale as ferramentas: `pkg install python make clang` e rode `npm rebuild better-sqlite3` |
| Erro de Node antigo (`node < 22`) | atualize: `pkg install nodejs-lts` (o `better-sqlite3@13` exige Node 22+) |
| "Nenhum conversor disponível" ao criar sticker | **só para stickers animados (vídeo/GIF)**: instale o `ffmpeg` (`pkg install ffmpeg`). Stickers de imagem/texto e `!toimg` funcionam sem nada extra (fallback jimp + libwebp embutido). |
| `❌ Número inválido` | digite o número completo com DDI (`+55...`) ou ajuste `DEFAULT_COUNTRY` |
| `⚠ Não foi possível determinar o país` | o número é ambíguo; escolha o país na lista exibida |
| Pairing code não conecta | confirme o número no celular e o código; o código expira em ~2 min |
| Sessão caiu (logged out) | o bot remove as credenciais e pede **novo pairing code** |
| Download do YouTube falha | (1) instale `pkg install yt-dlp ffmpeg` e rode `node scripts/diagnose.js`; (2) se o YouTube pedir "sign in" (IP de servidor), o bot já tenta o client `android` automaticamente; (3) em último caso o IP do servidor pode estar bloqueado — tente rede/VPS diferente |
| `better-sqlite3` não compila no Termux | `pkg install python make clang` e `npm rebuild better-sqlite3` |
| Quero trocar o prefixo | `!prefix <novo>` (dono) |

---

## 14. Atualização do Baileys (sem destruir o projeto)

- O Baileys é usado **somente** em `connection/` e em 1 helper de mídia (`utils/media.js`).
- Menus, comandos e handlers falam com um objeto `ctx` padronizado — **não conhecem o Baileys**.
- Para atualizar: altere a versão no `package.json`, rode `npm install` e revise `connection/connect.js` e `utils/messages.js`, se necessário.

### Botões interativos (native flow)

O menu principal usa **botões clicáveis reais** (native flow do Baileys 7), com IDs estáveis:

```
LUA BOT
[ 📋 COMANDOS ]  → lua_commands
[ 👑 ADMINISTRAÇÃO ] → lua_admin
[ ⚙️ CONFIGURAÇÕES ] → lua_config
[ ℹ️ AJUDA ] → lua_help
```

- `!botao on` / `!botao off` liga/desliga os botões (persistido no banco — sobrevive ao reinício).
- `!botao` (sem argumento) mostra o estado: `Botões: ATIVADOS/DESATIVADOS`.
- Com botões **OFF**, `!menu` cai para o menu textual numerado (modo de compatibilidade).
- Botões e comandos compartilham o MESMO handler (o botão `lua_config` executa o mesmo `!config`).

---

## 15. Atualizando o Lua sem perder dados (colar por cima)

Para atualizar a versão do bot **sem apagar** `.env`, `session/`, o banco, os backups, os logs e a imagem do menu, use o fluxo seguro abaixo.

### O que NUNCA é apagado

| Item | Conteúdo |
|---|---|
| `.env` | configurações, dono, país padrão |
| `session/` | credenciais do WhatsApp (não precisa refazer o pairing) |
| `database/*.db` | usuários, RPG, grupos, X9, quiz... |
| `backup/` | backups e snapshots |
| `logs/` | histórico de logs |
| `assets/menu.jpg` | imagem do menu (se personalizada) |

### ⚡ Comando único (extrai em `~/lua` e apaga o arquivo baixado)

Com o pacote já baixado na pasta Downloads, **cole este único comando** no Termux:

```bash
cd ~/lua && f=$(ls -t ~/storage/downloads/lua*.zip ~/storage/downloads/lua*.tar.gz 2>/dev/null | head -1) && if [ -z "$f" ]; then echo "Nenhum pacote lua* encontrado em Downloads"; else case "$f" in *.zip) unzip -oq "$f";; *.tar.gz|*.tgz) tar -xzf "$f";; esac; cp -a lua-main/. . 2>/dev/null; rm -rf lua-main; rm -f "$f"; echo "OK: extraído em ~/lua e removido de Downloads"; fi
```

O que ele faz, em sequência: entra em `~/lua` → encontra o pacote mais recente em `~/storage/downloads` → extrai por cima (achatando subpasta `lua-main/`, se houver) → **apaga o arquivo da pasta Downloads**.

> 💡 **Alternativa ainda mais segura** (também um único comando): use o atualizador, que **preserva `.env`, `session/` e o banco** e já apaga o arquivo:
> ```bash
> cd ~/lua && ./update.sh --delete-source
> ```

### 📲 Do jeito mais simples (Termux) — extrai da pasta Downloads sozinho

```bash
# 1) Baixe o pacote lua-update-vX.Y.Z.zip (ele cai na pasta Downloads)
# 2) No Termux:
cd ~/lua
./update.sh
```

O `update.sh` **procura sozinho** o pacote mais recente em `~/storage/downloads` (e também `~/downloads`, `~/Downloads`), pergunta se pode extrair, e então:

1. cria um **snapshot de segurança** em `backup/pre-update-<data>/`;
2. **extrai o pacote dentro de `~/lua`**;
3. restaura `.env`, `session/`, banco, `menu.jpg` e logs (mesmo que o pacote venha com arquivos indevidos);
4. instala as dependências e roda auditoria + smoke test.

### Opção A — colar os arquivos por cima e rodar o atualizador

```bash
cd ~/lua

# 1) Cole/extraia a versão nova DENTRO da pasta ~/lua
#    (o pacote de atualização já vem SEM .env, session/, banco, etc.)

# 2) rode o atualizador seguro:
./update.sh
```

### Opção B — atualizar direto pelo pacote

```bash
cd ~/lua
./update.sh lua-update-v1.0.0.zip
# ou:
./update.sh lua-update-v1.0.0.tar.gz
```

### 🆕 Primeira instalação a partir da pasta Downloads

```bash
# 1) Baixe o projeto (zip) — ele cai na pasta Downloads
# 2) Crie a pasta e entre nela:
mkdir -p ~/lua && cd ~/lua
# 3) Extraia o projeto (se o zip tiver uma subpasta lua-main/, suba o conteúdo):
unzip -q ~/storage/downloads/lua*.zip -d .
mv lua-main/* . 2>/dev/null; mv lua-main/.[!.]* . 2>/dev/null; rmdir lua-main 2>/dev/null
# 4) Instale:
bash install.sh
```

> O `install.sh` também detecta sozinho: se a pasta estiver vazia, ele procura o `lua*.zip`/`lua*.tar.gz` na pasta Downloads, **extrai e achata a subpasta** automaticamente antes de instalar.

### Se algo der errado

```bash
# o update.sh informa o caminho exato do snapshot; restaure com:
cp -a backup/pre-update-XXXXXXXX-XXXXXX/. .
```

### Para quem distribui a atualização (gerar o pacote seguro)

```bash
cd ~/lua
./scripts/make-release.sh        # → release/lua-update-vX.Y.Z.zip
./scripts/make-release.sh tar    # → release/lua-update-vX.Y.Z.tar.gz
```

O pacote gerado **já exclui** `.env`, `session/`, `database/*.db`, `backup/`, `logs/`, `tmp/*`, `node_modules/` e `.git/` — por isso pode ser colado por cima sem apagar nada. (Termux: `pkg install zip` para o formato zip.)

> **Regra de ouro:** nunca edite/cole por cima dos arquivos de dados manualmente. Se você personalizou `.env` ou `assets/menu.jpg`, mantenha uma cópia — embora o atualizador já os preserve.

---

## 16. Limitações reais do WhatsApp/Baileys

- **Banner separado não existe** no WhatsApp → `!banner` mostra a foto de perfil.
- **Gênero de personagem** não é fornecido pela API pública → `!waifu`/`!husbando` retornam personagem aleatório.
- **Alteração de foto do grupo** não é exposta de forma confiável → o painel X9 informa isso (não inventa dados).
- **Autor de uma ação** nem sempre é fornecido → o X9 mostra "desconhecido" quando não há.
- **Banir** não existe nativamente → `!ban` = remover + lista local + remoção automática ao tentar voltar.
- **Botões/listas** dependem da versão do app do usuário → há **fallback automático** para menu numerado em texto.
- Pedidos de entrada (`!pedidos`) dependem de o grupo estar com aprovação ativada e do suporte do Baileys.

---

Feito com 🌙 por **Lua Dev**.
