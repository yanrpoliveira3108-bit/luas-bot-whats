# MEGA PROMPT — LUA BOT 2.0 · estado real em 2026-09-14

> Gerado a partir do **registry em execução**, não de memória:
> **324 comandos · 636 triggers · 14 categorias**
> Branch `arena/01a0a187-luas-bot-whats` @ `dbc9bf1` · PR #2 aberto contra `main` (**não mergado** — merge único no final)
> Base de referência funcional: commit `29f9f30`.

---

## 1. PAPEL

Você é o engenheiro responsável pelo repositório
`https://github.com/yanrpoliveira3108-bit/luas-bot-whats`.

O trabalho abaixo **já está implementado e testado**. Sua tarefa é continuar a
partir daqui sem regredir nada: nada de recriar módulo que já existe, nada de
duplicar trigger de comando, nada de comando sem backend real.

---

## 2. ESTADO ATUAL (números verificados, não estimados)

| Item | Valor real |
| --- | --- |
| Auditoria (`scripts/audit.js`) | **69 verificações, 0 falha(s)** |
| Smoke (`test/smoke.js`) | **27 passou, 0 falhou** |
| Suítes novas (11 arquivos) | **106 verificações, 0 falhas** |
| `npm test` | **exit 0** (workspace e clone `--single-branch` limpo) |
| Comandos / triggers | **324 / 636** em 14 categorias |
| Node | `engines >=22` (validado no Termux com v24.18.0) |
| SQLite | `better-sqlite3 ^13.0.3`, prepared statements, WAL |
| Single instance | lock exclusivo (`wx`) com PID; 2ª instância sai com exit 1 |
| Backup | staging `.tmp` → validação → rename atômico → rotação (5) |
| Update | 7 cenários testados: dirty · behind · ahead · diverged · single-branch · `--force` · `--delete-source` |

---

## 3. ARQUITETURA — módulos centrais (NÃO recriar)

| Caminho | Responsabilidade |
| --- | --- |
| `utils/menuRenderer.js` | **Renderizador central de menus**: `header`, `statusBlock`, `section`, `row`, `page`, `footer`, `mainMenu`. Decide fonte e separador pelo modo do chat. |
| `utils/fonts.js` | 18 fontes Unicode. `fonts.apply(texto, estilo)` / `fonts.safe()` protege comando, URL, jid, telefone e caminho. |
| `utils/dividers.js` | 56 separadores em 13 categorias + `divider.random()`, `divider.box()`, `divider.pair()`. |
| `utils/icons.js` | Ícones semânticos e por categoria (`icons.get`, `icons.forCategory`). |
| `utils/uiKit.js` | `header/footer/card/progress/list/button` + `error/success/loading/permission/notFound/info` + `truncate/safeText/paginate`. |
| `utils/commandCache.js` | Índice invertido para `!menu`/`!help`; lookup de trigger O(1). |
| `utils/fuzzySearch.js` | Levenshtein ≤ 3; substring só com tamanhos comparáveis (senão `x` casava com tudo). |
| `utils/stateMachine.js` | `SEARCHING→FOUND→DOWNLOADING→CONVERTING→UPLOADING→DONE`, `ERROR` de qualquer etapa. |
| `utils/progress.js` | **Uma** mensagem por operação, throttle 700 ms, etapa sempre visível, TTL + GC. |
| `utils/resilience.js` | `withTimeout()` com `AbortSignal`; `retry()` com backoff, sem retry em erro permanente. |
| `utils/tmpCleaner.js` | `withTempFile()` (`try/finally`) + varredura de órfãos. |
| `utils/autoBackup.js` | Backup atômico validado + rotação + `sweepStaleTmp()`. |
| `utils/singleInstance.js` | Lock `tmp/.lock` com flag `wx`; `readLockPid()`. |
| `utils/mediaCache.js` | Cache `youtube:<id>:audio:128` com TTL, LRU 500 MB e lock por chave. |
| `utils/downloadQueue.js` | Fila com concorrência, prioridade, timeout e cancelamento. |
| `commands/_shared/downloadFlow.js` | `runStaged()` + `resultCard`/`completeCard` (usado por play/ytmp3/ytmp4/twitter). |
| `handlers/buttonHandler.js` | IDs `lua…`; `register`, `registerOnce` (consome + TTL 120 s), `resolveDynamic` para `lua:suggest_*`. |
| `engine/plugins.js` | Registry único; trigger duplicado ⇒ comando descartado (por isso a lista abaixo é a fonte da verdade). |

---

## 4. CAMADA VISUAL

Modos de menu (`!menumode`, **por grupo**, com fallback global no PV):

| Modo | Fonte | Separadores |
| --- | --- | --- |
| `default` | boldScript | royal |
| `dark` | fraktur | dark |
| `cute` | script | cute |
| `minimal` | sans | minimal |
| `royal` | boldItalic | floral |
| `cyber` | mono | cyber |

Separador também varia por contexto: música `music`, download `wave`, sticker
`cute`, admin `heavy`, erro `warning`.

**Regra inegociável:** fonte é decoração. `!play música do ano` continua
`!play música do ano`.

---

## 5. COMANDOS EXISTENTES (324) — não duplicar nenhum trigger


### 🛡️ Moderação/Admin — `admin` (56)

| Comando | Aliases | Descrição | Restrição |
| --- | --- | --- | --- |
| `abrirgrupo` | `abrir` | Abre o grupo para todos enviarem mensagens. | admin+só grupo |
| `adicionar` | `add` | Adiciona um usuário pelo número. | admin+só grupo |
| `admins` | — | Lista os administradores do grupo. | só grupo |
| `advertir` | `adv`, `warn` | Aplica uma advertência a um usuário. | admin+só grupo |
| `anti` | `antis`, `antifiltro` | Sistema avançado de antis com ação configurável (ban/warn/mute/delete + purge de histórico). | admin+só grupo |
| `antiaudio` | — | Apaga áudios de não-admins. | admin+só grupo |
| `antibot` | — | Marca possíveis bots que entrarem no grupo. | admin+só grupo |
| `anticonfig` | `anti-config` | Mostra configuração detalhada de um anti. | admin+só grupo |
| `anticontato` | `antictt` | Apaga contatos enviados por não-admins. | admin+só grupo |
| `antidocumento` | `antidoc` | Apaga documentos/arquivos de não-admins. | admin+só grupo |
| `antifake` | — | Marca números estrangeiros que entrarem no grupo. | admin+só grupo |
| `antiflood` | — | Limita a quantidade de mensagens por intervalo. | admin+só grupo |
| `antiimagem` | `antifoto` | Apaga imagens/fotos de não-admins. | admin+só grupo |
| `antiinvite` | — | Apaga links de convite enviados por membros. | admin+só grupo |
| `antilink` | — | Bloqueia links de não-admins (com whitelist). | admin+só grupo |
| `antilocalizacao` | `antiloc`, `antilocal` | Apaga localizações enviadas por não-admins. | admin+só grupo |
| `antimedia` | — | Apaga qualquer mídia de não-admins. | admin+só grupo |
| `antiparentese` | — | Apaga mensagens dominadas por símbolos. | admin+só grupo |
| `antipix` | `antipagamento`, `antipag` | Apaga links/chaves de pagamento (pix) de não-admins. | admin+só grupo |
| `antispam` | — | Detecta mensagens repetidas em sequência. | admin+só grupo |
| `antisticker` | `antifig`, `antifigurinha` | Apaga figurinhas de não-admins. | admin+só grupo |
| `antivideo` | — | Apaga vídeos de não-admins. | admin+só grupo |
| `antiviewonce` | `antivv` | Apaga mídias de visualização única de não-admins. | admin+só grupo |
| `apagar` | `limpar`, `purge`, `limparhistorico`, `apagarhistorico`, `delhistorico` | Apaga histórico de mensagens de um usuário (últimas N). Use !apagar @user [qtd] ou responda a mensagem dele. | admin+só grupo |
| `apagartudo` | `limpartudo`, `purgeall` | Apaga todo histórico rastreado de um usuário (até 50 msgs). | admin+só grupo |
| `aprovar` | `aceitar` | Aprova um pedido de entrada. | admin+só grupo |
| `aprovarall` | — | Aprova todos os pedidos pendentes. | admin+só grupo |
| `ban` | `banir` | Remove e impede o retorno do usuário. | admin+só grupo |
| `descgrupo` | `descricao`, `setdesc` | Altera a descrição do grupo. | admin+só grupo |
| `fechargrupo` | `fechar` | Fecha o grupo (apenas admins enviam). | admin+só grupo |
| `foto` | `fotogrupo`, `setfoto`, `setpp` | Define a foto do grupo (marque uma imagem). | admin+só grupo |
| `goodbye` | `despedida` | 🌑 Card visual de despedida (on/off, template, random, preview). | admin+só grupo |
| `grupo` | `grupoinfo`, `groupinfo` | Informações do grupo. | só grupo |
| `hidetag` | — | Marca todos sem mostrar os nomes. | admin+só grupo |
| `inativos` | — | Membros sem mensagens nas últimas horas. | admin+só grupo |
| `kick` | `remover`, `expulsar`, `remove` | Remove um membro do grupo. | admin+só grupo |
| `linkgrupo` | `link`, `linkgroup` | Obtém o link de convite do grupo. | admin+só grupo |
| `marcar` | `tagall`, `todos`, `everyone` | Marca todos os membros do grupo. | admin+só grupo |
| `membros` | `members` | Lista os membros do grupo. | só grupo |
| `mute` | `silenciar` | Silencia um usuário (mensagens dele são apagadas). | admin+só grupo |
| `nomegrupo` | `nome`, `setname` | Altera o nome do grupo. | admin+só grupo |
| `pedidos` | `solicitacoes` | Mostra pedidos pendentes para entrar no grupo. | admin+só grupo |
| `promover` | `promote` | Promove um membro a administrador. | admin+só grupo |
| `rebaixar` | `demote` | Remove o cargo de administrador. | admin+só grupo |
| `rejeitar` | `recusar` | Rejeita um pedido de entrada. | admin+só grupo |
| `rejeitarall` | — | Rejeita todos os pedidos pendentes. | admin+só grupo |
| `resetadv` | `limparadv` | Zera as advertências de um usuário. | admin+só grupo |
| `revogarlink` | `resetarlink`, `revoke` | Revoga o link de convite atual. | admin+só grupo |
| `rmadv` | `removeradv`, `unwarn` | Remove a última advertência do usuário. | admin+só grupo |
| `setgoodbye` | — | Configura a mensagem de despedida. | admin+só grupo |
| `setwelcome` | — | Configura a mensagem de boas-vindas. | admin+só grupo |
| `unban` | `desbanir` | Remove o banimento de um usuário. | admin+só grupo |
| `unmute` | `dessilenciar` | Remove o silêncio de um usuário. | admin+só grupo |
| `warnings` | `advertencias`, `advs` | Lista as advertências de um usuário. | admin+só grupo |
| `welcome` | `bemvindo` | 🌙 Card visual de boas-vindas (on/off, template, random, preview). | admin+só grupo |
| `x9` | `registro`, `auditoria` | Painel de eventos administrativos do grupo. | admin+só grupo |

### 🎮 Lua Life — `life` (44)

| Comando | Aliases | Descrição | Restrição |
| --- | --- | --- | --- |
| `abrirempresa` | `criarempresa` | Abre uma empresa. | — |
| `atributos` | — | Mostra seus atributos do Lua Life. | — |
| `cancelaroferta` | — | Cancela uma oferta (devolve o item). | — |
| `clima` | — | Mostra o clima virtual atual. | — |
| `coletar` | `lucro`, `producao` | Coleta o lucro de uma empresa. | — |
| `comer` | — | Come e recupera fome. | — |
| `comprarcasa` | — | Compra uma casa. | — |
| `compraroferta` | — | Compra uma oferta do mercado. | — |
| `comprarterreno` | `terreno` | Compra um terreno. | — |
| `conquistas` | `achievements` | Lista suas conquistas. | — |
| `contratar` | `funcionario` | Contrata um funcionário para a empresa. | — |
| `descansar` | `dormir` | Descansa e recupera energia. | — |
| `economia` | — | Painel de economia do Lua Life (dono). | dono |
| `economylog` | `economy` | Últimos logs econômicos (dono). | dono |
| `empresas` | `negocios`, `funcionarios` | Lista suas empresas. | — |
| `estabulo` | `celeiro` | Compra/melhora o estábulo (capacidade de animais grandes). | — |
| `event` | — | Força/desativa o evento ativo (dono). | dono |
| `evento` | `eventos` | Mostra o evento ativo da semana. | — |
| `galinheiro` | — | Compra/melhora o galinheiro (capacidade de aves). | — |
| `givecoin` | — | Dá LuaCoins a um usuário (dono). | dono |
| `giveitem` | `additem` | Dá um item (dono). | dono |
| `loteria` | `lottery` | Aposta na loteria (moeda virtual). | — |
| `melhorar` | `upgrade`, `upgradecasa` | Melhora uma propriedade (casa/terreno/veículo). | — |
| `mercado` | — | Mostra o mercado (preços e ofertas). | — |
| `minerar` | `mineracao` | Minera minérios (precisa de picareta). | — |
| `minhasofertas` | — | Lista suas ofertas no mercado. | — |
| `missoes` | `missao` | Lista suas missões (ou resgata: !missao <id>). | — |
| `ofertar` | — | Cria uma oferta no mercado (vende a jogadores). | — |
| `pagar` | — | Paga LuaCoins para outro usuário. | — |
| `patrimonio` | — | Mostra seu patrimônio total. | — |
| `pescar` | `pesca` | Pesca peixes (precisa de vara). | — |
| `player` | `jogador` | Inspeciona um jogador (dono). | dono |
| `precos` | — | Mostra os preços atuais dos recursos. | — |
| `presente` | `presentear` | Envia um item de presente para um usuário. | — |
| `propriedades` | `casa`, `casas` | Lista suas propriedades. | — |
| `removeitem` | — | Remove um item (dono). | dono |
| `setlevel` | — | Define o nível de vida de um usuário (dono). | dono |
| `setmoney` | — | Define o saldo de um usuário (dono). | dono |
| `setprice` | — | Ajusta o preço de um item (dono). | dono |
| `setxp` | — | Define o XP de vida de um usuário (dono). | dono |
| `trabalho` | — | Abre o menu de profissões. | — |
| `veiculos` | `veiculo` | Lista e compra veículos. | — |
| `venderpesca` | `venderpeixes`, `venderpeixe` | Vende todos os peixes do inventário. | — |
| `vida` | `luavida`, `perfilvida` | Cria/seu personagem e mostra o perfil do Lua Life. | — |

### ⚔️ RPG — `rpg` (41)

| Comando | Aliases | Descrição | Restrição |
| --- | --- | --- | --- |
| `alimentar` | — | Alimenta os animais e coleta a produção. | — |
| `animais` | `meusanimais` | Lista os animais da fazenda. | — |
| `apostar` | `bet` | Aposta rápida (50/50, 2x). | — |
| `banco` | `meubanco` | Mostra seu banco. | — |
| `carreira` | — | Mostra sua carreira atual. | — |
| `carteiracripto` | `minhascriptos`, `cryptowallet` | Mostra seus ativos em criptomoedas. | — |
| `cassino` | `casino`, `apostas` | Menu do cassino (coinflip, dados, roleta, slots). | — |
| `colher` | `colheita` | Colhe plantações prontas. | — |
| `comprar` | `buy` | Compra um item da loja. | — |
| `compraranimal` | — | Compra um animal para a fazenda. | — |
| `comprarcripto` | `comprarcrypto`, `buycrypto` | Compra criptomoedas com LuaCoins. | — |
| `cripto` | `criptomoedas`, `crypto` | Mercado de criptomoedas (preços mudam a cada 15 min). | — |
| `dados` | `rolardado`, `dadoaposta` | Aposta no dado (número 6x, par/ímpar 2x). | — |
| `daily` | `diario` | Resgata sua recompensa diária (com sequência). | — |
| `depositar` | `dep` | Deposita dinheiro no banco. | — |
| `emprego` | `profissao` | Escolhe sua profissão. | — |
| `empregos` | `profissoes`, `trabalhos` | Lista as profissões disponíveis. | — |
| `fazenda` | `farm` | Mostra sua fazenda (plantações e animais). | — |
| `flip` | `flipar`, `caraoucoroaaposta` | Aposta cara ou coroa (2x). | — |
| `inventario` | `mochila`, `inv` | Mostra seu inventário. | — |
| `investimentos` | `fundo`, `meuinvestimento` | Mostra seu investimento e o rendimento atual. | — |
| `investir` | `investimento`, `aplicar` | Investe LuaCoins no fundo (rendimento diário variável). | — |
| `loja` | `shop` | Mostra os itens da loja. | — |
| `perfilrpg` | `status`, `statusrpg` | Status completo do seu personagem. | — |
| `plantar` | — | Planta uma semente na fazenda. | — |
| `rankrpg` | `toprpg` | Ranking dos jogadores do RPG. | — |
| `regar` | — | Rega plantações (acelera o crescimento). | — |
| `resgatar` | `resgate`, `sacarinvestimento` | Resgata seu investimento (com rendimento). | — |
| `roleta` | `roulette` | Aposta na roleta (cor 2x, verde 14x, número 36x). | — |
| `rpg` | — | Mostra o painel inicial do RPG. | — |
| `sacar` | `saque` | Saca dinheiro do banco. | — |
| `saldo` | `carteira`, `bal` | Mostra seu saldo (carteira + banco). | — |
| `semanal` | `weekly` | Resgata sua recompensa semanal. | — |
| `slots` | `cacaniquel` | Caça-níquel (até 10x). | — |
| `tigrinho` | — | 🐯 Caça-níquel de 5 rolos (valendo LuaCoins). | — |
| `trabalhar` | `work` | Trabalha e ganha LuaCoins. | — |
| `transferir` | `enviar` | Transfere moedas para outro usuário. | — |
| `usar` | `use` | Usa um item consumível. | — |
| `vender` | `sell` | Vende um item do inventário. | — |
| `venderanimal` | — | Vende um animal da fazenda. | — |
| `vendercripto` | `vendercrypto`, `sellcrypto` | Vende criptomoedas por LuaCoins. | — |

### 😂 Zueira — `fun` (37)

| Comando | Aliases | Descrição | Restrição |
| --- | --- | --- | --- |
| `8ball` | `bola8`, `pergunta` | Bola mágica responde sim/não. | — |
| `abraco` | — | Dá um abraço em alguém. | — |
| `azar` | — | Seu nível de azar. | — |
| `based` | — | Medidor de based. | — |
| `beijo` | — | Manda um beijo para alguém. | — |
| `burro` | — | Medidor de burrice (zoeira leve). | — |
| `cafune` | — | Faz um cafuné em alguém. | — |
| `caption` | `legenda` | Sugere uma legenda (para a imagem marcada). | — |
| `casal` | `casadoperfeito` | Acha o "casal perfeito" do grupo. | só grupo |
| `chance` | `probabilidade` | Chance de algo acontecer. | — |
| `charada` | — | Faz uma charada. Use !charada resposta para ver a resposta. | — |
| `conselho` | — | Dá um conselho útil. | — |
| `cumprimento` | — | Cumprimenta alguém. | — |
| `desafio` | — | Desafia alguém. | — |
| `elogio` | — | Elogia alguém. | — |
| `escolher` | `random` | Escolhe aleatoriamente entre opções. | — |
| `eu` | — | Autoelogio instantâneo. | — |
| `fato` | `curiosidade` | Curiosidade aleatória. | — |
| `gado` | — | Medidor de gado (zoeira leve). | — |
| `gaymer` | — | Medidor de gaymer. | — |
| `horoscopo` | `signo` | Horóscopo divertido do dia. | — |
| `inteligente` | — | Medidor de inteligência. | — |
| `karma` | — | Mostra seu karma acumulado. | — |
| `meme` | — | Meme aleatório em texto. | — |
| `memeuser` | — | Cria um meme com o usuário marcado. | — |
| `piada` | — | Conta uma piada leve. | — |
| `rankzueira` | `topzueira` | Ranking das interações (zueira). | — |
| `roast` | — | Zoação leve estilo roast. | — |
| `ship` | `shippar` | Calcula a compatibilidade entre duas pessoas. | — |
| `sigma` | — | Medidor de sigma. | — |
| `sorte` | `sortehoje` | Sua sorte de hoje. | — |
| `sorteio` | `sortear` | Sorteia um vencedor entre os usuários marcados. | — |
| `tapinha` | — | Dá um tapinha amigável. | — |
| `trollar` | — | Trolla alguém. | — |
| `verdade` | — | Revela uma "verdade" sobre alguém. | — |
| `verdadeoudesafio` | `vod` | Verdade ou desafio aleatório. | — |
| `zoar` | — | Zoa alguém (na brincadeira). | — |

### 🏠 Geral — `general` (33)

| Comando | Aliases | Descrição | Restrição |
| --- | --- | --- | --- |
| `botao` | `botões`, `botoes`, `buttons` | Liga/desliga os botões interativos (alterar = dono). | — |
| `config` | — | Mostra a configuração (alterar país padrão = dono). | — |
| `debug` | `diagnostico` | Painel de diagnóstico do bot. | — |
| `help` | `ajuda`, `cmd`, `comando` | Mostra detalhes de qualquer comando. Se não existir, sugere similares. | — |
| `id` | — | Mostra os IDs do chat e do usuário. | — |
| `info` | `sobreobot` | Informações sobre o bot. | — |
| `lermais` | `readmore` | Liga/desliga o "ler mais" (alterar = dono). | — |
| `menu` | `menuprincipal` | Abre o menu principal interativo. Use !menu <termo> para buscar comandos. | — |
| `menuadm` | `menuadmin` | Abre o menu de administração do grupo. | — |
| `menuanime` | — | Abre o menu de anime. | — |
| `menuautomod` | — | Abre o menu de filtros automáticos (automod). | — |
| `menucompleto` | `todoscomandos`, `listacomandos` | Lista todos os comandos carregados por categoria. | — |
| `menudono` | `menuowner` | Abre o menu exclusivo do dono. | dono |
| `menudownload` | — | Abre o menu de downloads. | — |
| `menugames` | — | Abre o menu de games. | — |
| `menuia` | `menuai` | Abre o menu da IA. | — |
| `menulife` | — | Abre o menu do Lua Life (vida virtual). | — |
| `menulifeadmin` | — | Abre o painel administrativo do Lua Life. | dono |
| `menumedia` | — | Abre o menu de mídia. | — |
| `menumembros` | — | Abre o menu de membros (perfil, XP, rank). | — |
| `menumode` | `modomenu`, `menustyle`, `temamenu`, `visualmenu` | Mostra ou troca o modo visual dos menus (default/dark/cute/minimal/royal/cyber). | — |
| `menurpg` | — | Abre o menu do RPG (economia, fazenda, empregos). | — |
| `menusticker` | — | Abre o menu de stickers. | — |
| `menuutil` | — | Abre o menu de utilidades. | — |
| `menuzoeira` | — | Abre o menu de zueira/diversão. | — |
| `owner` | `dono`, `criador` | Mostra o contato do dono do bot. | — |
| `ping` | — | Testa a resposta do bot. | — |
| `ping2` | — | Central de diagnóstico visual (HTML) do bot. | — |
| `pix` | — | Envia uma solicitação de pagamento (Payment Message). | — |
| `prefix` | `prefixo` | Mostra o prefixo atual (alterar = dono). | — |
| `selectivepay` | `sp`, `selectivepayment`, `spay` | (experimental) Payment de grupo com transporte seletivo de recipients. | dono+só grupo |
| `selectivetext` | `st` | (experimental) Texto de grupo com transporte seletivo (controle). | dono+só grupo |
| `tema` | `theme` | Lista ou troca o tema visual do bot. | — |

### 👥 Membros — `members` (19)

| Comando | Aliases | Descrição | Restrição |
| --- | --- | --- | --- |
| `afk` | — | Marca você como ausente. | — |
| `atividade` | — | Suas mensagens neste grupo. | só grupo |
| `avatar` | `fotoperfil` | Mostra a foto de perfil de alguém. | — |
| `badges` | `insignias` | Mostra suas conquistas (insígnias) do Lua Life. | — |
| `banner` | `capa` | Mostra a foto de perfil (o WhatsApp não tem banner separado). | — |
| `bio` | `recado` | Mostra o recado (about) do WhatsApp de alguém. | — |
| `level` | `nivel` | Mostra seu nível atual. | — |
| `perfil` | `me`, `meuperfil` | Mostra seu perfil completo. | — |
| `rank` | — | Mostra sua posição no ranking de XP. | — |
| `regras` | — | Mostra as regras do grupo. | só grupo |
| `reportar` | `report` | Envia uma denúncia ao dono do bot. | — |
| `reputacao` | `rep` | Mostra sua reputação. | — |
| `sobre` | `sobremim` | Define um texto sobre você (aparece no perfil). | — |
| `sugerir` | `sugestao` | Envia uma sugestão ao dono do bot. | — |
| `tempo` | — | Há quanto tempo você está no grupo. | só grupo |
| `top` | — | Mostra o top 10 (xp, mensagens, reputacao, karma, rpg, zueira, quiz). | — |
| `userinfo` | `ui`, `minhaconta` | Informações detalhadas de um usuário. | — |
| `voltei` | — | Remove seu status de ausente. | — |
| `xp` | — | Mostra seu XP acumulado. | — |

### 👑 Owner — `owner` (19)

| Comando | Aliases | Descrição | Restrição |
| --- | --- | --- | --- |
| `backup` | — | Faz backup do banco de dados e lista backups automáticos. | dono |
| `backupauto` | `autobackup` | Gerencia backups automáticos. | dono |
| `block` | `bloquear` | Bloqueia um usuário de usar o bot. | dono |
| `broadcast` | `anuncio` | Envia um anúncio para todos os grupos registrados. | dono |
| `database` | — | Resumo do banco de dados. | dono |
| `eval` | `exec` | Executa código JavaScript (APENAS dono). | dono |
| `fotobot` | `setbotpp`, `botpp`, `perfilbot` | Define a foto de perfil do bot (marque uma imagem). | dono |
| `logs` | — | Últimos comandos executados (organizado). "!logs arquivo" = log bruto. | dono |
| `memory` | — | Uso de memória do processo. | dono |
| `plugins` | — | Lista plugins ou ativa/desativa (on/off <nome>). | dono |
| `pluginsreload` | — | Recarrega os plugins do zero. | dono |
| `reload` | `recarregar` | Recarrega todos os comandos (hot reload). | dono |
| `restart` | `reiniciar` | Reinicia o bot. | dono |
| `restore` | `restaurar` | Restaura o backup mais recente. | dono |
| `shutdown` | `desligar` | Desliga o bot (não reinicia sozinho). | dono |
| `statsbot` | `estatisticas` | Estatísticas gerais do bot. | dono |
| `system` | `sistema`, `cpu`, `ram`, `disk` | Informações do sistema. | dono |
| `unblock` | `desbloquear` | Desbloqueia um usuário. | dono |
| `uptime` | `runtime` | Tempo online do bot. | dono |

### 🎨 Stickers — `stickers` (15)

| Comando | Aliases | Descrição | Restrição |
| --- | --- | --- | --- |
| `circle` | `circular` | Deixa uma imagem circular. | — |
| `crop` | `cortar` | Recorta a imagem em quadrado (cover). | — |
| `emoji` | `setemoji` | Define o emoji associado a um sticker. | — |
| `emojisticker` | `emojistk`, `figemoji` | Transforma um emoji em sticker com bio rica. | — |
| `pack` | `rename`, `renomear`, `setpack` | Altera o pacote/autor de um sticker. Sem args, gera bio rica automática. | — |
| `resize` | `redimensionar` | Redimensiona uma imagem. | — |
| `sticker` | `s`, `fig`, `figurinha` | Transforma imagem/vídeo/GIF em sticker com bio rica (criador, origem, bot, dono). | — |
| `stickerimg` | `stickerimagem` | Transforma uma imagem em sticker com bio rica. | — |
| `stickerinfo` | `infosticker`, `exif`, `rginfo`, `figinfo` | Mostra informações da figurinha (pack, autor, criador, origem, bio). | — |
| `stickertext` | `textosticker`, `stext` | Cria um sticker de texto com bio rica. | — |
| `take` | `roubar`, `rg`, `rgtake`, `roubargrande`, `steal` | Rouba/reenvia sticker com bio rica: criador, origem (GP/PV), bot, dono, dev. Use !take <pack>/<autor> para custom. | — |
| `togif` | `sticker2gif`, `stickergif` | Converte um sticker animado em GIF. | — |
| `toimg` | `stickerimg2`, `figparaimg`, `stickerfoto`, `stickerimage` | Converte um sticker em imagem. | — |
| `tovideo` | `sticker2video`, `stickervideo` | Converte um sticker animado em vídeo (MP4). | — |
| `txtsticker` | `textsticker` | Cria um sticker de texto com cor de fundo e bio rica. | — |

### 🛠️ Utilidades — `utility` (15)

| Comando | Aliases | Descrição | Restrição |
| --- | --- | --- | --- |
| `base64` | `encode` | Codifica/decodifica em Base64. | — |
| `botinfo` | — | Informações técnicas do bot. | — |
| `calc` | `calcular`, `conta` | Calcula uma expressão matemática. | — |
| `cep` | — | Consulta um CEP brasileiro (ViaCEP). | — |
| `cnpj` | `empresa` | Consulta um CNPJ (Brasil API). | — |
| `data` | — | Data de hoje. | — |
| `dividers` | `separadores` | Mostra os separadores decorativos por categoria. | — |
| `fontes` | `fonts`, `letras` | Mostra as fontes Unicode do bot ou aplica uma no seu texto. | — |
| `fuso` | `timezone` | Fuso horário do servidor. | — |
| `hora` | — | Hora atual. | — |
| `porcentagem` | `pct` | Calcula X% de um valor. | — |
| `qr` | `gerarqr`, `qrcode` | Gera um QR Code (texto escaneável). | — |
| `senha` | `password`, `gerarsenha` | Gera uma senha segura. | — |
| `timestamp` | `ts`, `epoch` | Mostra/converte timestamp Unix (segundos e ms). | — |
| `uuid` | — | Gera um UUID v4. | — |

### ⬇️ Downloads — `downloads` (14)

| Comando | Aliases | Descrição | Restrição |
| --- | --- | --- | --- |
| `audio` | `musica`, `song` | Baixa o áudio de uma música (busca no YouTube). | — |
| `download` | `baixar` | Baixa mídia de um link (YouTube, TikTok, Instagram, Facebook, Pinterest, X/Twitter, Reddit). | — |
| `facebook` | `fb` | Baixa mídia pública do Facebook. | — |
| `imagem` | `img`, `baixarimagem` | Baixa e envia uma imagem de um link. | — |
| `instagram` | `ig`, `insta` | Baixa mídia pública do Instagram. | — |
| `pinterest` | `pin` | Baixa uma imagem do Pinterest. | — |
| `play` | — | Busca músicas/vídeos no YouTube e mostra opções para baixar. | — |
| `revelar` | `viewonce`, `vv`, `revelarvu` | Revela a mídia de visualização única do chat. | — |
| `tiktok` | `tt` | Baixa um vídeo do TikTok. | — |
| `twitter` | `tw`, `x`, `twitterdl`, `baixartwitter` | Baixa o vídeo ou a foto de um tweet (X/Twitter). | — |
| `video` | `ytvideo2` | Baixa o vídeo de uma busca no YouTube. | — |
| `youtube` | `ytbusca`, `ytsearch` | Busca vídeos no YouTube (com opções de download). | — |
| `ytmp3` | `ytmp4audio`, `audiourl` | Baixa o áudio de um link do YouTube. | — |
| `ytmp4` | `videourl` | Baixa o vídeo de um link do YouTube. | — |

### 🍥 Anime — `anime` (10)

| Comando | Aliases | Descrição | Restrição |
| --- | --- | --- | --- |
| `anime` | — | Busca informações de um anime. | — |
| `animeinfo` | `animeinfo2` | Detalhes completos de um anime (com imagem). | — |
| `animequiz` | `quizanime` | Quiz com perguntas de anime. | — |
| `animerandom` | `randomanime` | Sugere um anime aleatório. | — |
| `husbando` | — | Personagem aleatório (o provedor não informa gênero). | — |
| `manga` | — | Busca informações de um mangá. | — |
| `otaku` | `otakometro` | Mede seu nível de otaku. | — |
| `personagem` | `char`, `character` | Busca um personagem de anime. | — |
| `quoteanime` | `fraseanime`, `citacao` | Frase aleatória inspirada em animes. | — |
| `waifu` | — | Personagem aleatório (o provedor não informa gênero). | — |

### 🎮 Games — `games` (10)

| Comando | Aliases | Descrição | Restrição |
| --- | --- | --- | --- |
| `adivinhacao` | `adivinhar`, `guess` | Adivinhe o número de 1 a 100. | — |
| `batalha` | `lutar`, `duelo` | Batalha em turnos contra o bot. | — |
| `cacatesouro` | `cacar`, `tesouro` | Encontre o tesouro no mapa 3x3. | — |
| `dado` | `dice`, `rolar` | Rola um dado (ou vários). | — |
| `games` | `jogos` | Lista os jogos disponíveis. | — |
| `jokenpo` | `rps`, `pedrapapeltesoura` | Jogue pedra, papel ou tesoura contra o bot. | — |
| `matematica` | `math`, `calcule` | Desafio de contas rápidas (5 rodadas). | — |
| `memoria` | — | Memorize e repita a sequência de números. | — |
| `moeda` | `coinflip`, `caraoucoroa` | Joga uma moeda (cara ou coroa). | — |
| `quiz` | `perguntas` | Quiz de perguntas e respostas. | — |

### 🤖 IA — `ai` (6)

| Comando | Aliases | Descrição | Restrição |
| --- | --- | --- | --- |
| `aimemory` | `memoriaia` | Liga/desliga/limpa a memória da conversa com a IA. | — |
| `aistatus` | `iastatus` | Mostra o status e a configuração da IA. | — |
| `codigo` | `code` | Gera ou explica código via IA. | — |
| `ia` | `ai`, `ask`, `perguntar`, `chat` | Conversa com a IA (assistente local ou API externa). | — |
| `resumir` | `resumo`, `summarize` | Resume o texto de uma mensagem (responda a ela). | — |
| `traduzir` | `traduz`, `translate` | Traduz um texto (idioma + texto). | — |

### 📊 Rankings — `rankings` (5)

| Comando | Aliases | Descrição | Restrição |
| --- | --- | --- | --- |
| `ranking` | — | Ranking geral (xp, mensagens, rpg, zueira, quiz, reputacao). | — |
| `topfazenda` | — | Top maiores fazendas (animais). | — |
| `topnivel` | — | Top usuários por nível (Lua Life). | — |
| `topricho` | — | Top usuários mais ricos (carteira). | — |
| `topxp` | — | Top usuários por XP. | — |


---

## 6. O QUE **NÃO** EXISTE (e por quê)

Comando sem backend funcional é pior que comando ausente. Ficaram de fora:
`emojimix`, `google`, `image`, `wiki`, `lyrics`, `weather`, `short`, `mediafire`,
`twitter` já entrou (downloader existia), `decode` (coberto por `!base64 -d`) e
`antitoxic` (coberto por `!anti antitoxic on <acao>`).

Para adicionar qualquer um deles: primeiro o downloader/API real em
`downloaders/` ou `utils/`, depois o comando, depois o teste.

---

## 7. TESTES (todos rodam em `npm test`)

| Suíte | Verificações |
| --- | --- |
| `scripts/audit.js` | 69 / 0 falhas |
| `test/smoke.js` | 27 / 0 falhas |
| `test/interactive.test.js` | 8 |
| `test/ui2.test.js` | 18 |
| `test/resilience.test.js` | 15 |
| `test/commandCache.test.js` | 10 |
| `test/playflow.test.js` | 4 |
| `test/buttons.test.js` | 11 |
| `test/menu2.test.js` | 9 |
| `test/sticker.test.js` | 8 |
| `test/infra.test.js` | 10 |
| `test/preflight.test.js` | 6 |
| `test/update-scenarios.test.js` | 7 |
| life · e2e · moderation · pix · theme · platform · selective | TUDO OK |

**Nunca** adicione verificações a `scripts/audit.js` ou `test/smoke.js`: 69/27 é
o contrato. Teste novo vai em arquivo próprio.

---

## 8. REGRAS DE QUALIDADE

- Sem comando falso, sem porcentagem falsa, sem botão decorativo.
- Sem segredo hardcoded; `.env` nunca versionado; erro nunca mostra stack/caminho.
- Sem `git reset --hard` silencioso; `--delete-source` só na allowlist
  (`tmp/*.log`, `player-scripts/`, `.gyp/`, `cards/`).
- Toda chamada externa com `withTimeout()`; todo temporário com `try/finally`.
- Strings visuais só nos módulos centrais — nunca espalhadas nos comandos.

---

## 9. COMO VALIDAR ANTES DE DECLARAR PRONTO

```bash
npm test                                    # 69/0, 27/0 e as 106 novas
git clone --single-branch --branch arena/01a0a187-luas-bot-whats \
  https://github.com/yanrpoliveira3108-bit/luas-bot-whats.git /tmp/clean && cd /tmp/clean
cp <seu>/.env . && ./update.sh              # exit 0, "Fetch concluído (3 branch(es))"
npm test                                    # tudo verde no clone limpo
```

No Termux: `pkg install -y nodejs-lts python make clang ffmpeg yt-dlp git unzip`,
crie o `.env` **antes** do `./update.sh` (a auditoria falha sem `OWNER_NUMBER`).
