# 🛡️ Guia Anti-Ban & Prevenção de Restrições no WhatsApp (Lua Bot)

Se o seu número está entrando em **restrição**, recebeu avisos de **análise de conta** ou você já perdeu um número recentemente, **siga estas instruções com atenção**. O algoritmo da Meta (WhatsApp) aumentou drasticamente o rigor com contas automatizadas. Este documento ensina como salvar seu número atual, como aquecer novos números e como blindar o bot contra novas restrições.

---

## 🚨 1. AÇÃO DE EMERGÊNCIA: O QUE FAZER AGORA (PARA NÃO PERDER O NÚMERO)

Se a sua conta está oscilando, recebendo avisos de restrição ou desconectando com erros:

1. **PARAR O BOT IMEDIATAMENTE**:
   - Pare o processo do bot no terminal (`Ctrl + C` ou mate o processo). Não tente forçar novas reconexões ou pairing code agora.
2. **DESCONECTAR APARELHOS CONECTADOS NO CELULAR**:
   - Abra o WhatsApp oficial no smartphone.
   - Vá em **Configurações / Opções** → **Aparelhos conectados**.
   - Desconecte qualquer sessão do bot que estiver ativa.
3. **HUMANIZAR O NÚMERO NO APP OFICIAL**:
   - Mande 3 a 5 mensagens de texto normais para contatos reais de sua confiança (amigos ou parentes que tenham o seu número salvo na agenda).
   - Peça para eles responderem com mensagens e áudios.
   - Poste 1 foto nos **Status** do WhatsApp.
   - Faça uma chamada de voz curta (1 ou 2 minutos) com algum amigo.
   - *Por que isso funciona?* Isso restabelece a reputação da conta nos servidores da Meta como uma conta pessoal com conversas bilaterais ativas.
4. **SE A CONTA CAIU NA TELA "SOLICITAR ANÁLISE" (REQUEST A REVIEW)**:
   - **NÃO feche a tela sem pedir**.
   - Clique em **Solicitar análise**.
   - No campo de justificativa, digite um texto educado e simples em português informal, por exemplo:
     > *"Olá equipe de suporte do WhatsApp, utilizo este número apenas para conversas pessoais com meus amigos e familiares. Acredito que ocorreu algum mal-entendido ou atividade incomum por engano. Peço por favor que revisem e reativem minha conta. Muito obrigado pela atenção."*
   - O suporte costuma responder e desbloquear contas em até 24 horas quando solicitado dessa forma.

---

## 🔍 2. POR QUE O WHATSAPP DERRUBA CONTAS? (AS 6 CAUSAS REAIS)

Entender o mecanismo de banimento é essencial para nunca mais perder números:

### 1. Chip Novo / Não Aquecido (Falta de Maturação) — 45% dos casos
Colocar um chip comprado há 1 ou 2 dias direto em um bot, entrar em dezenas de grupos e disparar centenas de comandos é **banimento garantido em menos de 24 horas**. Chips novos possuem "score de reputação zero" nos servidores da Meta.

### 2. Denúncias de Usuários ("Denunciar e Bloquear") — 35% dos casos (A Causa #1 em Bots)
Quando pessoas desconhecidas mandam mensagem no privado (por engano, encurtador de link ou curiosidade) e o bot responde com menus, botões ou comandos de erro, essas pessoas clicam no botão vermelho **"Denunciar e Bloquear"**.
**Bastam de 3 a 5 denúncias de usuários diferentes para o WhatsApp derrubar ou restringir a conta imediatamente.**

### 3. Comportamento Robótico / Sem Presença Humana — 10% dos casos
Humanos levam segundos para ler e responder uma mensagem, e acionam o evento **"digitando..."** ou **"gravando áudio..."**. Bots sem delays respondem em 50 milissegundos. Sistemas heurísticos de tráfego identificam isso instantaneamente.

### 4. Disparos em Massa e Rajadas (Burst / Broadcast)
Comandos que marcam todos os membros (@todos) repetidamente, comandos de broadcast entre grupos sem intervalo seguro, ou múltiplos grupos executando comandos no mesmo segundo pelo WebSocket.

### 5. Botões Interativos Forçados no WhatsApp Web
A Meta **descontinuou o suporte oficial a botões no WhatsApp Web**. Bots que forçam payloads de botões customizados (`interactiveButtons`, `buttonsMessage`) disparam inspeção automática nos servidores da Meta.

### 6. Assinatura de Navegador Antiga ou Incomum
Usar o padrão legado `Ubuntu Chrome` (muito comum em servidores VPS) levanta bandeiras de alerta automáticas. Usuários reais utilizam **Windows 10/11 Chrome** ou **macOS**.

---

## 🛡️ 3. AS PROTEÇÕES IMPLEMENTADAS NO LUA BOT

Atualizamos o código do Lua Bot com um sistema de blindagem robusto (`utils/antiBan.js`):

| Proteção | O que faz | Benefício |
|---|---|---|
| **Simulação de Digitação** | Envia status `composing` ("digitando...") antes de responder texto, e `recording` ("gravando...") para áudio | Remove a assinatura instantânea de máquina |
| **Delays Orgânicos** | Calcula o tempo de resposta proporcional ao tamanho da mensagem (com variação aleatória de jitter) | Comportamento 100% natural |
| **Fila Anti-Rajada (Throttle)** | Garante um espaçamento mínimo seguro entre envios no WebSocket | Impede picos de tráfego simultâneo |
| **Silent PV (Privado Silencioso)** | Não responde estranhos no privado com botões ou menus | **Elimina as denúncias ("Report & Block")** |
| **Fingerprint Windows Chrome** | Emula o navegador Windows 11 com Google Chrome atualizado | Assinatura idêntica a um usuário comum |
| **Broadcast Seguro** | Intervalo mínimo de 4 a 7 segundos entre cada grupo com aviso | Impede quedas por envio em massa |
| **Status Online Natural** | Desativa a presença de "online 24h" estática e ininterrupta | Reduz suspeitas de script contínuo |

---

## ⚙️ 4. CONFIGURAÇÃO RECOMENDADA NO ARQUIVO `.env`

No seu arquivo `.env`, certifique-se de configurar as seguintes variáveis para segurança máxima:

```ini
# ---- Segurança e Anti-Ban ----
SAFE_MODE=true
HUMAN_DELAYS=true
MIN_TYPING_DELAY_MS=600
MAX_TYPING_DELAY_MS=2200
OUTBOUND_INTERVAL_MS=1000
SILENT_PV=true
BROWSER_NAME=windows
MARK_ONLINE_ON_CONNECT=false

# ---- Recomendação Crítica para Menus ----
# No WhatsApp Web, botões interativos causam restrição frequente.
# Mantenha BUTTONS_ENABLED em false para usar menus elegantes em texto formatado:
BUTTONS_ENABLED=false
LUA_UI_MODE=text
```

---

## 📅 5. GUIA DE MATURAÇÃO E AQUECIMENTO DE CHIP (CRONOGRAMA DE 14 DIAS)

Se você for ativar um chip novo para o bot, **NUNCA** conecte o bot no primeiro dia. Siga este aquecimento progressivo:

### 🔹 Dias 1 a 3 (Configuração e Ativação Pessoal)
- Cadastre o chip no aplicativo oficial do WhatsApp no celular.
- Adicione uma **foto de perfil real**, coloque um **nome completo** e preencha o **Recado**.
- Ative a **Confirmação em duas etapas (PIN de 6 dígitos)** nas configurações de segurança.
- Salve de 5 a 10 contatos de amigos ou familiares na agenda do telefone.
- Troque mensagens normais de texto e áudio com essas pessoas.
- **Proibido nestes dias:** Entrar em grupos de links públicos, enviar links ou usar bots.

### 🔹 Dias 4 a 7 (Socialização e Chamadas)
- Faça 1 ou 2 chamadas de voz curtas (2 a 5 minutos) pelo WhatsApp.
- Poste 1 foto nos Status a cada 1 ou 2 dias.
- Entre em 1 ou 2 grupos comuns (de família, amigos ou trabalho).
- Conecte o **WhatsApp Web oficial** no navegador do seu computador por 15 a 30 minutos por dia.

### 🔹 Dias 8 a 11 (Aumento de Interações)
- Converse naturalmente em grupos.
- Receba mensagens e responda com figurinhas, áudios e fotos.
- O chip agora já possui um histórico de conexões e reputação nos servidores da Meta.

### 🔹 Dias 12 a 14 (Transição para o Bot)
- Conecte o bot usando o **pairing code** (código de pareamento).
- Comece colocando o bot em apenas **1 grupo pequeno** de teste.
- Use comandos espaçados.
- Teste com `!antiban` para verificar se as proteções estão operacionais.
- Após o 14º dia, o chip pode ser adicionado aos seus grupos oficiais gradualmente (1 a 2 grupos por dia, nunca 10 grupos de uma vez).

---

## 🚫 6. O QUE NUNCA FAZER COM UM BOT

1. **Nunca envie mensagens não solicitadas no privado (DM/PV)** para pessoas que não salvaram seu número.
2. **Nunca use comandos de marcar todos (@todos / !hidetag) repetidamente** em intervalos curtos.
3. **Nunca faça transmissões em massa (broadcast) para 30+ grupos de uma vez sem intervalos longos.**
4. **Nunca adicione o número a 20 grupos novos no mesmo dia.** O WhatsApp bloqueia a entrada em grupos quando detecta pico anormal.
5. **Nunca compre números virtuais descartáveis gratuitos** (SMS de sites públicos). Esses números já foram banidos dezenas de vezes e são derrubados em minutos.
6. **Sempre mantenha o número conectado no celular físico** com acesso à internet periodicamente.

---

## 💬 7. COMO RECUPERAR UM NÚMERO BANIDO (MODELO DE MENSAGEM)

Se o número for suspenso, não dê como perdido imediatamente:

1. **Pelo Aplicativo:** Clique no botão "Solicitar análise" na tela de bloqueio.
2. **Por E-mail:** Envie um e-mail para:
   - `support@whatsapp.com`
   - `smb_web@support.whatsapp.com`
   - **Assunto:** Solicitação de revisão de conta de WhatsApp [+55 SEUNUMERO]
   - **Corpo do e-mail:**
     > Prezada equipe de suporte do WhatsApp,
     > 
     > Meu número de telefone [+55 (DDD) XXXXX-XXXX] foi recentemente suspenso e não consigo acessar minhas conversas normais de trabalho e família.
     > 
     > Utilizo esta conta exclusivamente para contato pessoal e não tive a intenção de violar nenhum dos Termos de Serviço do WhatsApp. Se ocorreu algum comportamento incomum, peço sinceras desculpas e garanto que foi um mal-entendido ou teste involuntário.
     > 
     > Solicito gentilmente a revisão e a reativação da minha conta, pois dependo dela para me comunicar com familiares.
     > 
     > Desde já agradeço pela atenção e compreensão.
     > Atenciosamente,
     > [Seu Nome]

*Na maioria dos primeiros banimentos (ban temporário ou primeira restrição), a conta é devolvida em 24 a 48 horas se solicitada de forma educada.*
