#!/usr/bin/env bash
# ============================================================
#  start.sh — inicia o Lua Bot com reinício automático e
#  verificações de pré-voo profissionais.
#
#  Uso:
#    ./start.sh              → inicia com auto-restart
#    ./start.sh --no-restart → inicia uma única vez (sem loop)
#
#  O script verifica:
#    - Node.js ≥22, npm
#    - .env existe e OWNER_NUMBER configurado
#    - node_modules e better-sqlite3
#    - diretórios essenciais
#    - permissões básicas
#    - estado do projeto (package.json, index.js)
#
#  Retorna código de erro quando não consegue iniciar.
#  Para de reiniciar quando o dono usa !shutdown (flag .shutdown)
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
info() { echo -e "${YELLOW}ℹ${NC} $1"; }
err()  { echo -e "${RED}❌${NC} $1" >&2; }
step() { echo -e "${BLUE}▶${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

NO_RESTART=0
for arg in "$@"; do
  case "$arg" in
    --no-restart) NO_RESTART=1 ;;
    --help|-h)
      echo "Uso: ./start.sh [--no-restart]"
      echo "  --no-restart  Não reinicia automaticamente em caso de erro"
      exit 0
      ;;
  esac
done

echo ""
echo "🌙 Lua Bot — inicialização"
echo "=========================="
echo "📁 $SCRIPT_DIR"

# ---- 1) Node ----
if ! command -v node >/dev/null 2>&1; then
  err "Node.js não encontrado."
  err "Termux: pkg install nodejs-lts"
  err "Linux: https://nodejs.org (Node 22+)"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])" 2>/dev/null || echo "0")
if [ "$NODE_MAJOR" -lt 22 ]; then
  err "Node $(node -v) detectado. Lua requer Node 22+."
  err "Termux: pkg install nodejs-lts && hash -r"
  err "Linux: instale Node 22+ via NodeSource ou nvm"
  exit 1
fi
ok "Node $(node -v)"

# ---- 2) npm ----
if ! command -v npm >/dev/null 2>&1; then
  err "npm não encontrado."
  exit 1
fi
ok "npm $(npm -v)"

# ---- 3) arquivos essenciais ----
for f in package.json index.js config.js; do
  if [ ! -f "$f" ]; then
    err "Arquivo essencial ausente: $f"
    err "Verifique se está na raiz correta (onde está o package.json)."
    err "Para instalação limpa: git clone https://github.com/yanrpoliveira3108-bit/luas-bot-whats.git ~/lua && cd ~/lua && ./update.sh"
    exit 1
  fi
done
ok "Arquivos essenciais presentes"

# ---- 4) .env ----
if [ ! -f .env ]; then
  err ".env não encontrado."
  if [ -f .env.example ]; then
    err "Crie a partir do exemplo: cp .env.example .env e edite OWNER_NUMBER"
  fi
  exit 1
fi

# verifica OWNER_NUMBER configurado (não imprime o número)
if ! grep -qE "^OWNER_NUMBER=.*[0-9]{8,}" .env && ! grep -qE "^OWNER_NUMBERS=.*[0-9]{8,}" .env; then
  err "OWNER_NUMBER não configurado no .env"
  err "Edite .env e defina OWNER_NUMBER=5511999999999 (DDI+DDD+número)"
  exit 1
fi
ok ".env configurado"

# ---- 5) diretórios ----
mkdir -p session tmp database logs backup assets
[ -f tmp/.gitkeep ] || touch tmp/.gitkeep
ok "Diretórios garantidos"

# ---- 6) node_modules ----
if [ ! -d node_modules ] || [ ! -f node_modules/dotenv/package.json ]; then
  err "Dependências não instaladas (node_modules ausente ou incompleto)."
  err "Rode: ./update.sh  (ou: npm install --legacy-peer-deps)"
  exit 1
fi
ok "node_modules presente"

# ---- 7) better-sqlite3 ----
if ! node -e "const D=require('better-sqlite3'); new D(':memory:').close();" >/dev/null 2>&1; then
  err "Módulo nativo better-sqlite3 não carrega (não compilado)."
  err "No Android ele precisa ser compilado uma vez."
  err "Rode: ./update.sh  (ou bash install.sh)"
  err "Ou manualmente:"
  err "  pkg install python make clang"
  err "  cd node_modules/better-sqlite3 && npm run build-release && cd -"
  exit 1
fi
ok "better-sqlite3 OK"

# ---- 8) permissões ----
chmod +x start.sh update.sh install.sh scripts/*.sh 2>/dev/null || true

# ---- 9) verifica se .env.example está atualizado ----
# (apenas aviso, não bloqueia)
if [ -f .env.example ] && [ -f .env ]; then
  # conta chaves no example que não estão no .env
  # "|| true" é obrigatório aqui: com set -euo pipefail, o "head -n 5" fecha o
  # pipe antes do while terminar de escrever → SIGPIPE (exit 141) derrubava o
  # start.sh ANTES de iniciar o bot em toda instalação limpa (.env novo tem
  # muito mais chaves faltando do que 5).
  MISSING_KEYS=$(grep -E "^[A-Z_]+=" .env.example | cut -d= -f1 | while read -r key; do
    grep -qE "^$key=" .env || echo "$key"
  done | head -n 5 || true)
  if [ -n "$MISSING_KEYS" ]; then
    info "Novas chaves no .env.example que não estão no seu .env: $MISSING_KEYS"
    info "Considere atualizar seu .env com base no .env.example"
  fi
fi

# ---- 10) limpa flag de shutdown anterior ----
rm -f .shutdown

echo ""
echo "🌙 Iniciando o Lua..."
echo "   (Ctrl+C para parar, !shutdown no WhatsApp para desligar com flag)"
echo ""

# ---- loop de reinício ----
EXIT_CODE=0

if [ "$NO_RESTART" -eq 1 ]; then
  # modo sem restart (útil para debug / pm2 / systemd)
  node index.js
  EXIT_CODE=$?
  if [ "$EXIT_CODE" -ne 0 ]; then
    err "Bot encerrou com erro (código $EXIT_CODE)"
  fi
  exit $EXIT_CODE
else
  # modo com auto-restart
  while [ ! -f .shutdown ]; do
    node index.js
    EXIT_CODE=$?
    echo ""
    if [ -f .shutdown ]; then
      echo "🛑 Desligamento solicitado pelo dono (!shutdown). Até logo!"
      break
    fi
    if [ "$EXIT_CODE" -eq 0 ]; then
      echo "👋 Encerrado normalmente (código 0)."
      echo "   Para iniciar novamente, rode: ./start.sh"
      break
    fi
    echo "⚠️  O bot encerrou com erro (código $EXIT_CODE)."
    echo "🔄 Reiniciando em 3 segundos... (Ctrl+C para parar)"
    sleep 3
  done
fi

exit $EXIT_CODE
