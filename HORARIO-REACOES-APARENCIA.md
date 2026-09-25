# Horário do grupo, reações, prefixo, estilos e aparência dos menus HTML

Documentação das funcionalidades adicionadas juntas. Nos exemplos, `!` é só
ilustração: o bot usa sempre o **prefixo efetivo** (`BOT_PREFIX` / `!prefix`).
O prefixo é **global**: não existe prefixo por grupo neste projeto.

---

## 1. `!horariogrupo` — abrir e fechar o grupo automaticamente

| Forma | O que faz |
|---|---|
| `!horariogrupo` ou `!horariogrupo status` | Mostra a configuração, o estado atual e a **próxima** abertura e o próximo fechamento (data, hora e fuso) |
| `!horariogrupo 08:00 23:00` | Define abertura e fechamento e **ativa** |
| `!horariogrupo abrir 08:00` | Muda só a abertura (o fechamento é mantido) |
| `!horariogrupo fechar 23:00` | Muda só o fechamento (a abertura é mantida) |
| `!horariogrupo on` | Ativa (só se os dois horários existirem) |
| `!horariogrupo off` | Desativa. Mantém os horários salvos e **não** mexe no estado atual do grupo |

**Regras**
- Só em grupos. Usar exige **admin do grupo ou dono do bot**, verificado na
  hora. Para ativar, o bot precisa ser admin do grupo, e isso é conferido de
  novo antes de cada abertura ou fechamento.
- Horários de `00:00` a `23:59` (`00:00` = meia-noite). Abertura e fechamento
  não podem ser iguais. Janelas que atravessam a meia-noite são aceitas
  (ex.: `18:00 02:00`).
- Entrada inválida (hora fora do intervalo, argumento a mais, formato errado)
  **não altera nada** e a resposta mostra exemplos.
- Uma configuração incompleta pode ser salva, mas não é ativada; a resposta diz
  qual horário falta. Mudar um só horário **não** reativa um agendamento
  desligado.
- A resposta separa "configuração salva" de "estado do grupo alterado", e só
  confirma depois que o banco gravou.

**Como funciona**
- Abrir = `groupSettingUpdate(jid, 'not_announcement')`; fechar =
  `groupSettingUpdate(jid, 'announcement')`.
- Fuso: `CONFIG.bot.timezone` (variável `BOT_TIMEZONE`, padrão
  `America/Sao_Paulo`). As contas de data usam `Intl` com esse fuso, nunca o
  relógio local do servidor.
- **Reconciliação** ao ativar, ao mudar um horário e ao reconectar: o bot
  calcula o estado esperado para agora, lê o estado real (`announce` nos
  metadados do grupo) e só aplica se for diferente. Eventos perdidos com o bot
  offline **não são repetidos**; ele só corrige o estado atual.
- Um único timer por grupo: reconexões e recargas invalidam os anteriores (sem
  disparo duplicado). Se a chamada estourar o tempo, o bot relê o estado real e
  tenta de novo um número limitado de vezes.
- `!abrirgrupo` e `!fechargrupo` continuam funcionando normalmente. Com o
  agendamento ativo, o próximo horário programado pode reverter a ação manual.
- **O bot precisa estar online** no horário para abrir ou fechar.
- Armazenamento: `groups.settings.horarioGrupo` no SQLite (por grupo; persiste
  entre reinícios).

## 2. Reações contextuais

O bot reage com **um** emoji (no máximo um por mensagem) quando:
- a mensagem é um **comando reconhecido**: o emoji vem do comando ou da categoria;
- a mensagem **responde a uma mensagem do próprio bot**: a citação real é
  conferida (`contextInfo.stanzaId` + `participant` contra `sock.user.id` ou
  `sock.user.lid`);
- é um pedido direto reconhecido (ex.: "prefixo" respondendo ao bot).

Mapa central em `utils/reactionTopics.js`:

| Emoji | Tópico |
|---|---|
| 💻 | prefixo e informações técnicas |
| 🧭 | menu e navegação |
| ❓ | ajuda |
| 🛠️ | administração |
| ⏰ | horários |
| ⚔️ | RPG |
| 💰 | carteira |
| 🗺️ | caça ao tesouro |
| 🎰 | tigrinho |
| 🎵 | música |
| 🤝 | agradecimento |
| 💬 | resposta ao bot sem tema reconhecido |

Outros temas cobrem jogos, downloads, figurinhas, IA e anime.

- Casamento só por **palavra inteira** (ex.: "prefixoso" não casa). Sem IA e
  sem APIs pagas.
- Deduplicação por chat+id da mensagem. Mensagens do próprio bot, reações,
  mensagens de protocolo e status nunca recebem reação.
- A reação **não indica sucesso** do comando, e uma falha ao reagir nunca
  bloqueia o comando. O PV silencioso (`pvSilencioso`) é respeitado.
- Não existe resposta automática genérica: fora do caso do prefixo, é só a reação.

## 3. Pedido de prefixo

`!prefix` sem argumentos, ou uma resposta a uma mensagem do bot com um pedido
claro ("prefixo", "qual o prefixo?", "qual é o seu prefixo"):

```
💻 Meu prefixo neste grupo é: X
🧭 Para abrir o menu, envie: Xmenu
```

`X` é o prefixo efetivo (`settings.effectivePrefix()`), nunca um `!` fixo.
Frases que só mencionam a palavra ("não gostei desse prefixo") são ignoradas.

## 4. Estilos de título — `!tema titulo [estilo]`

Estilos `padrao`, `classico`, `tecnologico` e `moderno`. Sem argumento, lista os
estilos com exemplo; trocar é só do dono (chave `text_title_style` em
`settings`). As letras Unicode decorativas são usadas **só em títulos**:
comandos, prefixos, números, valores e links ficam sempre em texto normal, para
continuar dando para copiar e colar.

## 5. Painel de identificação nos menus HTML

Com `!modohtml on`, **todos** os menus HTML (o principal e os de categoria)
mostram no cabeçalho um painel compacto em grade 2×2:

| Campo | Origem |
|---|---|
| **Pedido por** | nome do WhatsApp (`pushName`) → nome salvo → número (só se o remetente veio como telefone) |
| **Prefixo** | prefixo efetivo + total de comandos do card |
| **Dono** | `OWNER_NUMBER` (o primeiro, o dono principal) |
| **Bot** | número e nome da conta conectada (`sock.user`) |

- **LID nunca é mostrado como telefone.** Quando o dado não foi resolvido, o
  painel mostra "não identificado", "não configurado" ou "indisponível".
- Tudo é escapado. Nomes são limitados a 40 caracteres, e cada célula ocupa uma
  linha com reticências (o valor completo aparece no `title`). No campo Bot, o
  número vem antes do nome, então se algo for cortado é o nome.
- O painel substituiu a antiga linha "Prefixo • N comandos". O cabeçalho ficou
  **menor** (moldura de 210 px → 206 px). Sem `zoom` e sem `transform:scale`.
- Componente único: `painelIdentidade()` em `menus/html/components.js`; os
  dados vêm de `utils/menuIdentity.js`.

## 6. Aparência dos menus HTML — `!temahtml`

| Forma | Quem |
|---|---|
| `!temahtml` / `!temahtml status` | qualquer um |
| `!temahtml temas` | qualquer um (temas prontos e fontes) |
| `!temahtml cores #fundo #destaque [#secundaria]` | dono |
| `!temahtml aplicar <tema>` | dono |
| `!temahtml emojis on\|off` | dono |
| `!temahtml fonte padrao\|sans\|serif\|mono\|off` | dono |
| `!temahtml restaurar` | dono |

- **Escopo: GLOBAL**, o mesmo do `!modohtml` e do `!tema`. Por isso alterar é só
  do dono. Chave `menu_html_visual` (JSON) em `settings`.
- Temas prontos: `preto-azul`, `roxo-verde`, `preto-vermelho`, `vermelho-roxo`,
  `preto-vermelho-roxo`, `amoled-ciano`, `claro`, `claro-verde`.
- Cores só em `#RGB` ou `#RRGGBB` (normalizadas para maiúsculas). As cores de
  texto, superfícies, bordas e do texto dos botões são **derivadas** para
  manter contraste legível (meta WCAG ≥ 4.5:1). Um fundo claro também ajusta
  `color-scheme`.
- Cada comando muda **uma** propriedade e preserva as outras; a confirmação só
  vem depois de relida do banco. `restaurar` volta **só** o visual do card:
  modohtml, prefixo e o resto continuam como estavam.
- `emojis off` remove os emojis decorativos **na origem**: logo, emojis das abas
  e seções, ícone dos cards, 🔎 da busca e 🌙 do título. Botões e setas mantêm
  os rótulos em texto. As **reações** do bot não são afetadas.
- Fontes: só as do próprio aparelho (nada é baixado), com alternativas legíveis.
- Vale para os **próximos** menus enviados; cards já enviados não mudam.

## 7. Onde fica cada configuração

| O quê | Onde |
|---|---|
| Fuso do horário do grupo | `BOT_TIMEZONE` → `CONFIG.bot.timezone` (`config.js`) |
| Horário de cada grupo | SQLite `groups.settings.horarioGrupo` |
| Aparência dos menus HTML | SQLite `settings.menu_html_visual` |
| Estilo dos títulos | SQLite `settings.text_title_style` |
| Mapa de reações | `utils/reactionTopics.js` |
| Estilos, fontes e emojis organizados | `config/textStyles.js` |
