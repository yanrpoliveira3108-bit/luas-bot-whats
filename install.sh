#!/usr/bin/env bash
# ============================================================
#  install.sh — instalador profissional do Lua Bot
#  Compatível com Termux (Android) e Linux
#
#  Fluxo oficial de instalação limpa:
#    git clone https://github.com/yanrpoliveira3108-bit/luas-bot-whats.git ~/lua
#    cd ~/lua
#    chmod +x update.sh start.sh
#    ./update.sh
#    ./start.sh
#
#  Este install.sh é um atalho que:
#    - Detecta se está em pasta vazia e tenta extrair zip de Downloads
#    - Cria diretórios, .env, instala dependências
#    - Compila better-sqlite3 se necessário (Android)
#    - Valida integridade
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
info() { echo -e "${YELLOW}ℹ${NC} $1"; }
err()  { echo -e "${RED}❌${NC} $1" >&2; }
step() { echo -e "${BLUE}▶${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "🌙 Lua Bot — instalador"
echo "======================="
echo "📁 $SCRIPT_DIR"

# ---- Termux fix ----
termux_gyp_fix() {
  if [ "$(uname -o 2>/dev/null)" = "Android" ] || [ -n "${TERMUX_VERSION:-}" ]; then
    export GYP_DEFINES="android_ndk_path=''"
    mkdir -p ~/.gyp
    echo "{'variables':{'android_ndk_path':''}}" > ~/.gyp/include.gypi
    echo "🔧 Termux detectado — correção node-gyp aplicada."
  fi
}

pin_better_sqlite3() {
  if [ -f package.json ] && grep -qE '"better-sqlite3": *"\^11\.' package.json; then
    sed -i -E 's/"better-sqlite3": *"\^11\.[0-9.]+"/"better-sqlite3": "^13.0.3"/' package.json
    sed -i -E 's/"node": *">=20(\.0\.0)?"/"node": ">=22.0.0"/' package.json
    echo "🔧 package.json atualizado: better-sqlite3 → ^13.0.3 (Node ≥22)"
  fi
}

fix_permissions() {
  chmod +x install.sh start.sh update.sh scripts/*.sh 2>/dev/null || true
}

ensure_sqlite_binary() {
  if node -e "const D=require('better-sqlite3'); new D(':memory:').close();" >/dev/null 2>&1; then
    return 0
  fi
  echo "🔨 better-sqlite3: binário nativo ausente (Android sem pré-compilado) — compilando..."
  local need=""
  { command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; } || need="python "
  command -v make >/dev/null 2>&1 || need="${need}make "
  { command -v clang >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1 || command -v cc >/dev/null 2>&1; } || need="${need}clang/gcc"
  if [ -n "$need" ]; then
    err "Faltam ferramentas de compilação: $need"
    err "Termux: pkg install python make clang"
    err "Linux: sudo apt install build-essential python3"
    exit 1
  fi
  termux_gyp_fix
  (cd node_modules/better-sqlite3 && npm run build-release) || {
    err "Falha ao compilar better-sqlite3"
    err "Tente: cd node_modules/better-sqlite3 && npm run build-release"
    exit 1
  }
  if node -e "const D=require('better-sqlite3'); new D(':memory:').close();" >/dev/null 2>&1; then
    ok "better-sqlite3 compilado e funcionando"
  else
    err "better-sqlite3 ainda não carrega após compilação"
    exit 1
  fi
}

# ---- primeiro uso: se pasta vazia, procura zip em Downloads ----
if [ ! -f package.json ] && [ ! -f index.js ]; then
  FOUND=()
  for f in "$HOME/storage/downloads"/lua*.zip "$HOME/storage/downloads"/lua*.tar.gz \
           "$HOME/storage/shared/Download"/lua*.zip "$HOME/storage/shared/Download"/lua*.tar.gz \
           "$HOME/downloads"/lua*.zip "$HOME/downloads"/lua*.tar.gz \
           "$HOME/Downloads"/lua*.zip "$HOME/Downloads"/lua*.tar.gz; do
    [ -f "$f" ] && FOUND+=("$f")
  done

  PKG=""
  [ ${#FOUND[@]} -gt 0 ] && PKG=$(ls -t "${FOUND[@]}" 2>/dev/null | head -1)

  if [ -n "$PKG" ]; then
    echo "📥 Pacote encontrado em Downloads: $PKG"
    case "$PKG" in
      *.zip)
        if ! command -v unzip >/dev/null 2>&1; then
          err "Instale unzip: pkg install unzip"
          exit 1
        fi
        unzip -q "$PKG" -d .
        ;;
      *.tar.gz|*.tgz)
        tar -xzf "$PKG" -C .
        ;;
    esac
    # achata subpasta única (ex.: lua-main/)
    for d in */; do
      if [ -f "$d/package.json" ] && [ -f "$d/index.js" ]; then
        mv "$d"/* . 2>/dev/null || true
        mv "$d"/.[!.]* . 2>/dev/null || true
        rmdir "$d" 2>/dev/null || true
        break
      fi
    done
    ok "Projeto extraído em $(pwd)"
  else
    err "Pasta vazia e nenhum pacote lua*.zip encontrado em Downloads."
    err "Para instalação via Git (recomendado):"
    err "  git clone https://github.com/yanrpoliveira3108-bit/luas-bot-whats.git ~/lua"
    err "  cd ~/lua && chmod +x update.sh start.sh && ./update.sh && ./start.sh"
    exit 1
  fi
fi

# ---- 1) Node ----
if ! command -v node >/dev/null 2>&1; then
  err "Node.js não encontrado."
  err "Termux: pkg install nodejs-lts"
  err "Linux: Node 22+ via https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])" 2>/dev/null || echo "0")
if [ "$NODE_MAJOR" -lt 22 ]; then
  err "Node $(node -v) detectado. Lua requer Node 22+."
  err "Termux: pkg install nodejs-lts && hash -r"
  exit 1
fi
ok "Node $(node -v)"

# ---- 2) npm ----
if ! command -v npm >/dev/null 2>&1; then
  err "npm não encontrado."
  exit 1
fi
ok "npm $(npm -v)"

# ---- 3) diretórios ----
step "Criando diretórios..."
mkdir -p session tmp database logs backup assets
[ -f tmp/.gitkeep ] || touch tmp/.gitkeep
ok "Diretórios criados"

# ---- 4) .env ----
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    ok ".env criado a partir de .env.example — EDITE o OWNER_NUMBER!"
  else
    err ".env.example não encontrado. Crie .env manualmente."
    exit 1
  fi
else
  info ".env já existe (mantido)"
fi

# ---- 5) dependências ----
termux_gyp_fix
pin_better_sqlite3

step "Instalando dependências..."
INSTALL_FLAGS="--legacy-peer-deps --no-audit --no-fund"
if [ "$(uname -o 2>/dev/null)" = "Android" ] || [ -n "${TERMUX_VERSION:-}" ]; then
  INSTALL_FLAGS="$INSTALL_FLAGS --ignore-scripts"
  info "Termux: scripts nativos ignorados (motor é JS puro)"
fi
# shellcheck disable=SC2086
npm install $INSTALL_FLAGS
ok "Dependências instaladas"

ensure_sqlite_binary

# ---- 6) deps de sistema ----
echo ""
echo "🔧 Dependências de sistema (recomendadas):"
if command -v ffmpeg >/dev/null 2>&1; then
  ok "ffmpeg instalado"
else
  echo "⚠️  ffmpeg NÃO encontrado — stickers de vídeo/GIF não funcionarão"
  echo "   Termux: pkg install ffmpeg"
  echo "   Linux: sudo apt install ffmpeg"
fi

if command -v yt-dlp >/dev/null 2>&1; then
  ok "yt-dlp instalado (motor principal de YouTube)"
else
  echo "⚠️  yt-dlp NÃO encontrado — YouTube usará ytdl-core (menos estável)"
  echo "   Termux: pkg install python ffmpeg && pip install -U yt-dlp"
  echo "   Linux: pip install yt-dlp ou apt install yt-dlp"
fi

# ---- 7) banco ----
step "Preparando banco de dados..."
if node -e "const c=require('./config');c.helpers.ensureDirs();const d=require('./database/database');d.open();console.log('✅ Banco pronto');d.close();" 2>&1; then
  ok "Banco pronto"
else
  err "Falha ao preparar banco"
  exit 1
fi

# ---- 8) permissões ----
fix_permissions
ok "Permissões aplicadas"

# ---- 9) auditoria ----
step "Validando integridade..."
mkdir -p tmp
if node scripts/audit.js >tmp/lua_audit.log 2>&1; then
  ok "Auditoria: OK"
else
  err "Auditoria falhou:"
  tail -n 20 tmp/lua_audit.log
  err "Rode: node scripts/audit.js"
  exit 1
fi
rm -f tmp/lua_audit.log

echo ""
echo "=================================="
ok "Instalação concluída!"
echo ""
echo "Próximos passos:"
echo "  1. Edite .env e defina OWNER_NUMBER (ex.: 5511999999999)"
echo "     e, opcionalmente, PAIRING_NUMBER"
echo "  2. Inicie: ./start.sh   (ou npm start)"
echo "  3. No terminal aparecerá o pairing code. No celular:"
echo "     WhatsApp → Aparelhos conectados → Conectar com número"
echo "=================================="
echo ""
echo "Atualização futura:"
echo "  cd ~/lua && ./update.sh --delete-source && ./start.sh"
echo ""
