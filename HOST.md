# 🌙 LUA — Instalação em HOST (VPS / servidor Linux)

Guia rápido para colocar o Lua num VPS (Ubuntu/Debian). Este pacote é o
projeto **completo** — não inclui `.env`, sessão nem banco (você cria os seus).

---

## 1. Requisitos do host

- **Node.js 22+ (recomendado 24)** e npm
- Linux x64 **ou** ARM64 (glibc) — o único módulo nativo (`better-sqlite3`)
  já vem pré-compilado para essas plataformas; não precisa compilar nada.
- **ffmpeg** (opcional, mas recomendado → stickers de vídeo/GIF)
- ~1 GB de RAM livre (sobra para o WhatsApp + banco)

### Instalar Node 24 (Ubuntu/Debian, via NodeSource)

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
sudo apt-get install -y ffmpeg unzip
node -v   # deve mostrar v24.x
```

(Alternativa com nvm: `nvm install 24`.)

---

## 2. Subir o projeto

```bash
# 1) envie o zip para o host e extraia
mkdir -p ~/lua && cd ~/lua
unzip lua-host-v1.0.0.zip

# 2) instale (cria .env a partir do exemplo e roda npm install)
bash install.sh

# 3) configure o DONO (obrigatório!)
nano .env
#   OWNER_NUMBER=5511999999999        ← número do dono (só dígitos + DDI)
#   PAIRING_NUMBER=5511999999999      ← opcional: número p/ parear por código
#   BOT_PREFIX=!                      ← prefixo dos comandos
```

> ⚠️ Sem `OWNER_NUMBER` no `.env`, o bot **não** reconhece o dono e os
> comandos de administração não funcionam.

---

## 3. Iniciar

```bash
./start.sh
```

Na primeira execução, se você definiu `PAIRING_NUMBER`, o terminal mostra o
**código de pareamento** — digite-o no WhatsApp (Dispositivos conectados →
Conectar dispositivo). Depois de pareado, a sessão fica salva em `session/`
e os próximos inícios não pedem código de novo.

### Rodar em segundo plano (recomendado)

**Com pm2:**

```bash
npm install -g pm2
pm2 start start.sh --name lua
pm2 save && pm2 startup   # reinicia com o servidor
pm2 logs lua              # ver logs
```

**Com systemd** (opcional): criar `/etc/systemd/system/lua.service` apontando
para `/home/<user>/lua/start.sh`.

---

## 4. Manutenção / atualização

```bash
cd ~/lua
# rode ./update.sh apontando para um pacote novo (lua-update-*.zip)
# seus dados (session/, database/, .env) são preservados
```

---

## 5. Segurança

- **Nunca compartilhe** `session/`, `database/*.db` nem `.env` — eles contêm
  a sessão do seu número e credenciais.
- Este pacote **não** inclui esses arquivos por padrão.
- Use `LOG_LEVEL` e `DEBUG` no `.env` para controlar o volume de logs.
- Recomendado: rode com um usuário dedicado (`adduser lua`) e sem sudo.

---

## 6. Se algo falhar

- `./start.sh` exige Node 22+ e dependências instaladas — rode `bash install.sh`
  primeiro.
- Auditoria de integridade: `node scripts/audit.js` (deve terminar com
  `0 falha(s)`).
- Diagnóstico: `node scripts/diagnose.js`.
- Logs: `logs/lua-<data>.log` (ou `pm2 logs lua`).
