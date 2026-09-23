# Menus em HTML (`!modohtml`)

Menu interativo em **Rich HTML** enviado como card, com abas por categoria,
busca e navegação — no lugar do menu tradicional em texto/listas.

O menu tradicional **continua existindo e continua sendo o padrão**. Nada foi
removido: o HTML é um formato alternativo que o dono liga quando quiser.

---

## 1. Como usar

| Comando | Quem | O que faz |
|---|---|---|
| `!modohtml` | qualquer pessoa | mostra o estado atual (ligado/desligado, escopo, motivo) |
| `!modohtml on` | **dono** | liga os menus em HTML (salva no banco) |
| `!modohtml off` | **dono** | volta ao menu tradicional (salva no banco) |
| `!menu --texto` | qualquer pessoa | força o menu tradicional **nesta** chamada, mesmo com o HTML ligado |
| `!menu --tradicional` / `--antigo` | idem | sinônimos de `--texto` |

Aliases do comando: `modohtml`, `menuhtml`, `htmlmenu`.

O que muda quando está ligado:

| Entrada | Sem `modohtml` (padrão) | Com `modohtml on` |
|---|---|---|
| `!menu` | menu tradicional | **card HTML** com todas as categorias |
| `!menuadm` / `!menumembros` / `!menudownload` … | tela de categoria | card HTML já aberto na categoria |
| `!stickers`, `!rankings`, `!config`… (telas com botões próprios) | tela própria | tela própria (ver §5) |

Depois de reiniciar o bot, a escolha **continua** (fica no banco, não em
variável de ambiente).

---

## 2. O que tem dentro do card

- **Cabeçalho**: nome do bot, categoria atual e o **prefixo real** do bot
  (lido da configuração — se o prefixo é `#`, os exemplos aparecem com `#`).
- **Abas**: uma por categoria real do bot (geral, downloads, diversão, membros,
  utilidades, stickers, IA, games, anime, RPG, admin, dono, rankings…).
- **Busca**: filtra os comandos pelo nome enquanto você digita (índice montado
  no próprio aparelho, a partir do texto já presente no card).
- **Cartões de comando**: emoji, nome, **descrição** e **exemplo de uso**
  (`!ytmp3 <link>`), com etiquetas quando o comando pede contexto
  (`precisa do contexto do grupo`, `só admin`, `bot precisa ser admin`).
- **Botão “voltar ao topo”** e navegação por abas/retorno sem recarregar nada.
- **CSS e JS vão embutidos** no próprio card: nenhuma fonte, imagem ou script
  externo é carregado (isso é exigência do formato e também evita lentidão).

A lista de comandos **não é digitada à mão**: sai do registro de comandos
(`engine/plugins.js` + `commands/loader.js`). Comando novo, alias novo ou
categoria nova aparecem no card automaticamente, com os mesmos nomes e as
mesmas permissões do bot.

---

## 3. Configuração e escopo

- Chave no banco: **`menu_html`** (padrão `false` — se a chave não existe, o
  modo está **desligado**).
- Escopo: **GLOBAL**, igual a `!botao on/off` e `!tema`: vale para todos os
  chats e é alterado **só pelo dono**. Admin de grupo recebe a negativa padrão
  de dono e **não** muda a configuração de ninguém.
- A confirmação só aparece **depois** de o banco confirmar a gravação (o
  comando relê o valor antes de responder).
- Argumento inválido (`!modohtml ligado?`) é recusado e **não altera nada**.
- Com o modo **desligado**, os templates HTML nem são carregados (requisição
  preguiçosa em `utils/menuFormat.js`) — zero custo para quem não usa.

Variáveis opcionais (não precisam ser definidas):

| Variável | Padrão | Para que serve |
|---|---|---|
| `MENU_HTML_MAX_BYTES` | `100000` | teto do documento enviado; se passar, o card corta comandos e avisa |
| `MENU_HTML_MAX_PER_CAT` | `30` | máximo de comandos por categoria no card |

O corte é adaptativo: o card mostra “Mostrando X de Y comandos” com o atalho
`!menucompleto <categoria>` para ver a lista completa pelo menu tradicional.

---

## 4. Como o card é enviado

Mesmo caminho já comprovado no bot pelo `!ping2` e `!tigrinho`
(`utils/richHtml.js` → `botForwardedMessage` → `richResponseMessage` →
`AIRichResponseUnifiedResponse`), que é o que o WhatsApp renderiza como
bloco HTML. Não é arquivo `.html` anexado, não é imagem, não é link externo e
**não é WhatsApp Flows** (botão nativo/flow não tem relação com isso).

Fluxo de decisão (um lugar só, `utils/menuFormat.js`):

```
comando de menu
   ├─ modo HTML desligado?              → menu tradicional
   ├─ MODO SEGURO ligado (bloqueia card)? → menu tradicional, com motivo
   ├─ --texto / --tradicional?           → menu tradicional
   ├─ erro ao enviar o card?             → menu tradicional (1 tentativa só,
   │                                       sem envio duplicado)
   └─ senão                              → card HTML
```

Nenhuma tela some: se o card falhar, a pessoa recebe o menu de sempre.

---

## 5. Limites honestos (o que o formato não faz)

**Botão que executa comando dentro do card não existe.** O card só recebe
cliques em links. Para navegar até um comando, cada cartão traz um link
`https://wa.me/<numero-do-bot>?text=<prefixo><comando>` — clicar abre a
conversa no privado com o comando escrito, e o bot valida tudo como sempre
(quem enviou, permissão, grupo, etc.). O número usado é o do **próprio bot**,
e o link só aparece em comando que funciona no privado:

- comandos que **só** funcionam no grupo (`anti-link`, `promover`, …) aparecem
  **sem link**, com a etiqueta “precisa do contexto do grupo” — nada de botão
  decorativo que não faz nada;
- esconder informação no card **não é controle de acesso**: a categoria `admin`
  e a `owner` continuam validadas no servidor, comando por comando, como
  sempre. O card mostra que a ação existe; quem manda continua sendo o bot.

Outras telas com fluxo próprio seguem tradicionais de propósito: `!stickers`,
`!rankings`, `!config`, `!economia` e afins usam telas com botões de navegação
internos e não se encaixam no modelo de abas. Como o menu tradicional está
preservado, elas continuam funcionando igual.

Sucesso de envio **não** é o mesmo que renderização: o servidor confirma que a
mensagem saiu, o desenho do card depende do aparelho e da versão do WhatsApp
(ver §7).

---

## 6. Segurança e privacidade

- Todo texto dinâmico (nome de comando, descrição, exemplo, nome do bot) passa
  por escapagem por contexto (`escapeHtml` / `escapeAttr`) — descrição maliciosa
  não quebra o card nem injeta script.
- O card **não** carrega número de dono, token, sessão, caminho de arquivo nem
  qualquer credencial.
- Nenhuma ação é executada a partir de dados vindos do card: o link apenas
  pré-escreve o comando; a execução passa pelo pipeline normal, que revalida
  identidade, permissão e contexto.
- Mensagem de grupo é pública: quem vê o card vê os nomes dos comandos (o mesmo
  que já acontecia no menu de texto).

---

## 7. O que foi testado aqui × o que depende do aparelho

**Testado em sandbox (`node --check`, `test/menuhtml.test.js` 16/16, auditoria
69/69, smoke 27/27, suíte completa 307 ✅):**

- padrão desligado quando a chave não existe;
- `on`/`off` salvando no banco e confirmando apenas após a gravação;
- persistência depois de reiniciar (lendo o banco em processo novo);
- dono altera / admin de grupo não altera / consulta liberada para todos;
- argumento inválido recusado sem alterar nada;
- prefixo dinâmico (`#` aparece nos exemplos e no rodapé quando configurado);
- templates de menu principal, admin, membros e categoria, todos gerados do
  registro (nenhuma lista paralela) e com nomes/aliases atuais;
- payload no formato correto (`richResponseMessage` → `unifiedResponse`,
  primitiva `GenAIaeacdsnwHtmlPrimitive`), dentro do teto de ~100 KB
  (menu principal: **91,5 KB**, 265 de 371 comandos, com aviso de corte);
- abas, busca e “voltar ao topo” presentes; um `<style>` e um `<script>`, sem
  recurso externo;
- comando só-de-grupo **sem** link, comando do privado **com** link do bot;
- escapagem de HTML malicioso vindo do registro;
- falha de envio → menu tradicional, com **uma** tentativa (sem duplicar);
- `!menu --texto` força o tradicional com o modo ligado;
- modo seguro tem precedência e explica o motivo;
- modo desligado não carrega `menus/html`.

**Depende do seu aparelho / do WhatsApp (não dá para verificar daqui):**

1. se a sua versão do WhatsApp **renderiza** o card (envio ≠ renderização);
2. se os cliques no `wa.me` abrem o privado do jeito esperado;
3. como o card se comporta em conversa de grupo grande, em aparelho antigo e
   com o WhatsApp Web;
4. velocidade de abertura em celular fraco (o card tem ~91 KB).

Se o card não aparecer bonito no seu aparelho: `!modohtml off` volta tudo ao
menu tradicional na hora — e `!menu --texto` é a saída por chamada, sem mexer
na configuração.

---

## 8. Relação com o freio e o modo seguro

- O envio do card passa pelo mesmo freio de envio (fila, atraso, limites) dos
  outros comandos: **nada de fura-fila**.
- Sua configuração atual é a padrão (HTML/cards liberados; freio só no
  volume). Se algum dia você ligar o modo seguro (`!freio seguro on`), os
  cards são bloqueados por segurança e o menu **volta sozinho** ao tradicional
  — o `!modohtml` continua marcado como ligado, e o próprio comando explica:
  “ligado, mas o MODO SEGURO bloqueia cards HTML”.
- Log de envio registra o formato usado e erro sem dados sensíveis.

---

## 9. Arquivos desta funcionalidade

**Novos**

| Arquivo | Papel |
|---|---|
| `utils/menuFormat.js` | decisão única do formato (ligado/desligado, modo seguro, `--texto`, fallback) |
| `menus/html/index.js` | monta e envia o documento; teto de tamanho e corte adaptativo |
| `menus/html/data.js` | categorias e comandos vindos do registro |
| `menus/html/templates.js` | templates: principal, admin, membros, categoria |
| `menus/html/components.js` | cartões, abas, seções, cabeçalho/rodapé, escapagem |
| `menus/html/styles.js` | CSS (usa as variáveis do tema atual do bot) |
| `menus/html/client.js` | JS do card: abas, busca, voltar ao topo |
| `commands/general/modohtml.js` | comando `!modohtml` |
| `test/menuhtml.test.js` | 16 verificações desta funcionalidade |

**Alterados (mudanças mínimas)**

| Arquivo | Mudança |
|---|---|
| `database/settings.js` | chave `menu_html` (padrão `false`) + leitura/gravação |
| `utils/buttons.js` | menu principal tenta o HTML primeiro (se ligado) |
| `utils/menu.js` | menus de categoria usam o HTML quando aplicável |
| `commands/general/menu.js` | `--texto` / `--tradicional` / `--antigo` |
| `commands/general/menus.js` | atalhos de categoria apontam para o card quando ligado |

Nenhuma dependência nova: o card usa o mesmo caminho de envio que já existia no
projeto. Nenhum comando, alias, permissão ou função antiga foi removido.

---

## 10. Verificação rápida (no seu aparelho)

```
!modohtml            → mostra “desligado (padrão)”
!modohtml on         → “Menus em HTML ATIVADOS”
!menu                → card com abas e busca
!menu --texto        → menu tradicional continua disponível
!modohtml off        → volta ao tradicional
!modohtml on         → liga de novo
# reinicie o bot
!modohtml            → continua ligado (persistiu)
```
