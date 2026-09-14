# 🌙 Lua — Instalação em HOST (VPS / Linux)

Guia para instalar o Lua em VPS Ubuntu/Debian ou qualquer servidor Linux. O projeto **não inclui** `.env`, `session/` nem `database/` — você cria os seus (protegidos por `.gitignore`).

---

## 1. Requisitos

- **Node.js 22+** (recomendado 24) e npm
- Linux x64 ou ARM64 (glibc) — `better-sqlite3` já vem pré-compilado para essas plataformas
- **ffmpeg** opcional, recomendado (stickers vídeo/GIF + YouTube vídeo)
- **yt-dlp** opcional, recomendado (YouTube mais estável)
- ~1 GB RAM livre

### Instalar Node 22/24 (Ubuntu/Debian via NodeSource)

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential ffmpeg git unzip
node -v  # deve mostrar v24.x
# opcional: yt-dlp
sudo apt install -y yt-dlp || pip install yt-dlp
```

Alternativa com nvm: `nvm install 24`.

---

## 2. Instalação oficial (via Git — recomendado)

```bash
git clone https://github.com/yanrpoliveira3108-bit/luas-bot-whats.git ~/lua
cd ~/lua
chmod +x update.sh start.sh
./update.sh
nano .env
#   OWNER_NUMBER=5511999999999
#   BOT_PREFIX=!
./start.sh
```

**O que cada comando faz:**

- `git clone ... ~/lua` — baixa código oficial para `~/lua`
- `chmod +x` — garante permissão de execução
- `./update.sh` — valida Git, faz pull, cria snapshot, instala dependências, roda auditoria
- `nano .env` — configura dono (obrigatório)
- `./start.sh` — inicia com auto-restart e verificações de pré-voo

### Instalação via pacote (legado)

Se você recebeu um `lua-host-*.zip`:

```bash
mkdir -p ~/lua && cd ~/lua
unzip lua-host-v1.0.0.zip
bash install.sh
nano .env
./start.sh
```

---

## 3. Iniciar

```bash
./start.sh              # com auto-restart
./start.sh --no-restart # uma vez (para pm2/systemd)
```

Na primeira execução, se `PAIRING_NUMBER` estiver no `.env`, o terminal mostra o **código de pareamento** — digite no WhatsApp (Aparelhos conectados → Conectar com número). Depois, sessão fica em `session/` e próximos inícios não pedem código.

### Rodar em segundo plano

**pm2 (recomendado):**

```bash
npm install -g pm2
pm2 start start.sh --name lua
pm2 save && pm2 startup
pm2 logs lua
```

**systemd (opcional):** crie `/etc/systemd/system/lua.service`:

```ini
[Unit]
Description=Lua Bot
After=network.target

[Service]
User=lua
WorkingDirectory=/home/lua/lua
ExecStart=/home/lua/lua/start.sh --no-restart
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable lua
sudo systemctl start lua
sudo journalctl -u lua -f
```

---

## 4. Atualização

```bash
cd ~/lua
./update.sh --delete-source
./start.sh
```

- `./update.sh` — git fetch + pull seguro, preserva `.env`, `session/`, `database/`, `backup/`, `logs/`
- `--delete-source` — limpa temporários seguros (`tmp/*`, `*-player-script.js`, `.gyp/`, previews, backups +30d)
- Nunca apaga dados do usuário

Veja `README.md` para detalhes completos do fluxo de atualização.

---

## 5. Segurança

- **Nunca compartilhe** `session/`, `database/*.db`, `.env` — contêm sessão do seu número
- Este pacote não inclui esses arquivos
- Use `LOG_LEVEL` e `DEBUG` no `.env` para controlar logs
- Rode com usuário dedicado (`adduser lua`), sem sudo
- `!eval` desabilitado por padrão (`ENABLE_EVAL=false`)

---

## 6. Troubleshooting

- `./start.sh` exige Node 22+ e dependências — rode `./update.sh` ou `bash install.sh`
- Auditoria: `node scripts/audit.js` (deve terminar com `0 falha(s)`)
- Diagnóstico: `node scripts/diagnose.js`
- Logs: `logs/lua-YYYY-MM-DD.log` ou `pm2 logs lua`
- Se algo der errado após update: `cp -a backup/pre-update-*/. .`

---

## 7. Estrutura de dados (preservados)

| Item | Descrição |
|------|-----------|
| `.env` | configurações |
| `session/` | credenciais WhatsApp |
| `database/*.db` | usuários, economia, grupos |
| `backup/` | snapshots |
| `logs/` | histórico |

Todos protegidos por `.gitignore` — `git pull` nunca apaga.
