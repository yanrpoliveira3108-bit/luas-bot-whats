#!/usr/bin/env bash
# ============================================================
#  update.sh — atualização SEGURA e PROFISSIONAL do Lua Bot
#
#  Fluxo oficial (GitHub como fonte da verdade):
#    cd ~/lua && ./update.sh --delete-source
#    ./start.sh
#
#  O que faz:
#    1. Entra na raiz do projeto (onde este script está)
#    2. Valida que é um repositório Git
#    3. Valida remote origin (deve apontar para luas-bot-whats)
#    4. Faz fetch do GitHub
#    5. Detecta alterações locais em arquivos versionados e ABORTA
#       se houver risco de sobrescrever sem aviso
#    6. Faz pull seguro (--ff-only) da branch principal
#    7. Preserva arquivos locais: .env, session/, database/*.db,
#       backup/, logs/, assets/menu.jpg etc. (protegidos por .gitignore)
#    8. Atualiza dependências se package.json mudou
#    9. Executa validações (audit + smoke)
#    10. Mostra o que foi atualizado
#    11. Retorna código de erro apropriado se falhar
#
#  Idempotente: rodar 2x seguidas não corrompe nem duplica.
#
#  --delete-source:
#    Remove APENAS arquivos temporários e descartáveis definidos
#    explicitamente neste script. NUNCA apaga:
#      .env, session/, database/, backup/, logs/, assets/, .git/
#    Definição de "source" temporário:
#      - tmp/* (exceto tmp/.gitkeep)
#      - *.log na raiz
#      - *-player-script.js e 1788*.js (gerados por ytdl)
#      - .gyp/ (cache do node-gyp no Termux)
#      - card-*.jpg, welcome-preview.jpg, tigrinho-preview.html
#      - backups pre-update com mais de 30 dias (opcional)
#
#  Uso:
#    ./update.sh                          → git pull seguro
#    ./update.sh --delete-source          → git pull + limpeza segura
#    ./update.sh --help                   → ajuda
#    ./update.sh pacote.zip               → (legado) extrai pacote por cima
#    ./update.sh pacote.zip --delete-source → extrai e apaga pacote
#
#  Compatibilidade: Termux (Android), Linux, macOS — bash
# ============================================================
set -euo pipefail

# ---- cores ----
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
info() { echo -e "${YELLOW}ℹ${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}❌${NC} $1" >&2; }
step() { echo -e "${BLUE}▶${NC} $1"; }

# ---- entra na raiz do projeto ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
ROOT="$SCRIPT_DIR"

# ---- parse de argumentos ----
DELETE_SOURCE=0
ARCHIVE=""
SHOW_HELP=0

for arg in "$@"; do
  case "$arg" in
    --delete-source|--rm-source)
      DELETE_SOURCE=1
      ;;
    --help|-h)
      SHOW_HELP=1
      ;;
    *.zip|*.tar.gz|*.tgz)
      if [ -f "$arg" ]; then
        ARCHIVE="$arg"
      else
        err "Arquivo não encontrado: $arg"
        exit 1
      fi
      ;;
    *)
      # ignora argumentos desconhecidos com aviso
      if [ -n "$arg" ]; then
        warn "Argumento desconhecido ignorado: $arg"
      fi
      ;;
  esac
done

if [ "$SHOW_HELP" -eq 1 ]; then
  cat <<'EOF'
Uso: ./update.sh [opções] [arquivo.zip]

Opções:
  --delete-source   Limpeza segura de arquivos temporários APÓS atualizar
                    (tmp/*, logs antigos, player-scripts, .gyp, previews)
                    NUNCA apaga .env, session/, database/, backup/, logs/ recentes.
  --help, -h        Mostra esta ajuda

Modos:
  1) Git (recomendado, padrão):
     ./update.sh
     → faz git fetch + pull seguro do GitHub, preservando dados locais

  2) Arquivo (legado, para instalação manual via Downloads):
     ./update.sh ~/storage/downloads/lua-update-*.zip
     → extrai por cima, preservando .env, session/, database/ etc.

Exemplos:
  cd ~/lua && ./update.sh --delete-source
  ./start.sh

  cd ~/lua && ./update.sh
  ./start.sh
EOF
  exit 0
fi

echo ""
echo "🌙 Lua — atualização segura"
echo "============================="
echo "📁 Raiz: $ROOT"

# ---- validações básicas ----
if ! command -v git >/dev/null 2>&1; then
  err "git não encontrado. Instale: pkg install git (Termux) ou apt install git"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  err "Node.js não encontrado. Termux: pkg install nodejs-lts"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  err "npm não encontrado."
  exit 1
fi

ok "Node $(node -v) / npm $(npm -v) / git $(git --version | awk '{print $3}')"

# ---- Termux: correção node-gyp ----
termux_gyp_fix() {
  if [ "$(uname -o 2>/dev/null)" = "Android" ] || [ -n "${TERMUX_VERSION:-}" ]; then
    export GYP_DEFINES="android_ndk_path=''"
    mkdir -p ~/.gyp
    echo "{'variables':{'android_ndk_path':''}}" > ~/.gyp/include.gypi
    info "Termux detectado — correção node-gyp aplicada."
  fi
}
termux_gyp_fix

# ---- snapshot de segurança (antes de qualquer alteração) ----
SNAP="backup/pre-update-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$SNAP/database" "$SNAP/assets" "$SNAP/session" 2>/dev/null || true
[ -f .env ] && cp -a .env "$SNAP/" 2>/dev/null || true
[ -f assets/menu.jpg ] && cp -a assets/menu.jpg "$SNAP/assets/" 2>/dev/null || true
[ -d session ] && [ -n "$(ls -A session 2>/dev/null)" ] && cp -a session "$SNAP/session" 2>/dev/null || true
[ -d logs ] && cp -a logs "$SNAP/logs" 2>/dev/null || true
cp -a database/*.db* "$SNAP/database/" 2>/dev/null || true
ok "Snapshot de segurança criado em $SNAP"

restore_data() {
  local src="$1"
  [ -f "$src/.env" ] && cp -a "$src/.env" .env && ok ".env preservado"
  if [ -d "$src/session" ] && [ -n "$(ls -A "$src/session" 2>/dev/null)" ]; then
    rm -rf session; cp -a "$src/session" session; ok "session/ preservada (sem novo pairing)"
  fi
  [ -f "$src/assets/menu.jpg" ] && mkdir -p assets && cp -a "$src/assets/menu.jpg" assets/menu.jpg && ok "assets/menu.jpg preservado"
  if [ -d "$src/database" ] && [ -n "$(ls -A "$src/database" 2>/dev/null)" ]; then
    mkdir -p database; cp -a "$src/database"/. database/; ok "database preservado"
  fi
  if [ -d "$src/logs" ]; then mkdir -p logs; cp -a "$src/logs"/. logs/ 2>/dev/null || true; fi
}

# ---- funções de limpeza segura (--delete-source) ----
clean_temp_source() {
  step "Limpando arquivos temporários seguros (--delete-source)..."

  # tmp/* exceto .gitkeep
  if [ -d tmp ]; then
    find tmp -type f ! -name ".gitkeep" -delete 2>/dev/null || true
    ok "tmp/ limpo (mantido .gitkeep)"
  fi

  # *.log na raiz (não em logs/)
  for f in ./*.log; do
    [ -f "$f" ] && rm -f "$f" && echo "  removido: $f"
  done

  # player scripts temporários
  for f in ./*-player-script.js ./1788*.js; do
    [ -f "$f" ] && rm -f "$f" && echo "  removido: $f"
  done

  # .gyp cache
  if [ -d .gyp ]; then
    rm -rf .gyp
    ok ".gyp/ removido (cache Termux)"
  fi

  # previews gerados que não devem estar no repo
  for f in ./card-*.jpg ./card-*.png ./welcome-preview.jpg ./welcome-preview.png ./tigrinho-preview.html ./preview-*.jpg ./preview-*.png; do
    [ -f "$f" ] && rm -f "$f" && echo "  removido: $f"
  done

  # backups antigos (>30 dias)
  if [ -d backup ]; then
    find backup -type d -name "pre-update-*" -mtime +30 -exec rm -rf {} + 2>/dev/null || true
    ok "backups antigos (>30d) limpos"
  fi

  # NUNCA apaga: .env, session/, database/, backup/ recente, logs/, assets/, .git/
  echo ""
  echo "🛡️  Protegidos (NUNCA apagados por --delete-source):"
  echo "   • .env"
  echo "   • session/ (credenciais WhatsApp)"
  echo "   • database/*.db (usuários, economia, grupos)"
  echo "   • backup/ (exceto pre-update >30d)"
  echo "   • logs/ (logs recentes mantidos)"
  echo "   • assets/ (imagens do bot)"
  echo "   • .git/ (histórico)"
}

# ---- modo arquivo (legado) ----
if [ -n "$ARCHIVE" ]; then
  step "Modo arquivo (legado) — extraindo $ARCHIVE"

  if [ ! -f "$ARCHIVE" ]; then
    err "Arquivo não encontrado: $ARCHIVE"
    exit 1
  fi

  TMPX=$(mktemp -d)
  trap 'rm -rf "$TMPX"' EXIT

  info "Extraindo $ARCHIVE ..."
  case "$ARCHIVE" in
    *.zip)
      if ! command -v unzip >/dev/null 2>&1; then err "Instale unzip: pkg install unzip"; exit 1; fi
      unzip -q "$ARCHIVE" -d "$TMPX"
      ;;
    *.tar.gz|*.tgz)
      tar -xzf "$ARCHIVE" -C "$TMPX"
      ;;
    *)
      err "Formato não suportado. Use .zip ou .tar.gz"
      exit 1
      ;;
  esac

  # achata subpasta única (ex.: lua-main/)
  for sub in "$TMPX"/*/; do
    [ -d "$sub" ] || continue
    if [ -f "$sub/package.json" ] && [ -f "$sub/index.js" ]; then
      mv "$sub"/* "$TMPX"/ 2>/dev/null || true
      mv "$sub"/.[!.]* "$TMPX"/ 2>/dev/null || true
      rmdir "$sub" 2>/dev/null || true
      break
    fi
  done

  cp -a "$TMPX"/. .
  rm -rf "$TMPX"
  trap - EXIT
  ok "Arquivos novos copiados por cima de $(pwd)"

  restore_data "$SNAP"

  if [ "$DELETE_SOURCE" -eq 1 ]; then
    # só apaga se o arquivo estiver em pasta de Downloads ou tmp (segurança)
    case "$ARCHIVE" in
      *"/storage/downloads/"*|*"/storage/shared/Download"*|*"/downloads/"*|*"/Downloads/"*|*"/tmp/"*)
        rm -f "$ARCHIVE"
        ok "Pacote removido: $ARCHIVE"
        ;;
      *)
        warn "Pacote NÃO removido (fora de pasta de Downloads): $ARCHIVE"
        warn "Para remover, mova para ~/storage/downloads/ ou apague manualmente."
        ;;
    esac
    clean_temp_source
  fi

  # continua para atualização de dependências e validações abaixo
else
  # ---- modo Git (oficial) ----
  step "Modo Git — atualização via GitHub"

  if [ ! -d .git ]; then
    err "Esta pasta não é um repositório Git (.git não encontrado)."
    err "Para instalação limpa:"
    err "  cd ~ && rm -rf lua && git clone https://github.com/yanrpoliveira3108-bit/luas-bot-whats.git lua && cd lua && ./update.sh"
    exit 1
  fi

  # valida remote origin
  if ! git remote get-url origin >/dev/null 2>&1; then
    err "Remote 'origin' não configurado."
    err "Configure: git remote add origin https://github.com/yanrpoliveira3108-bit/luas-bot-whats.git"
    exit 1
  fi

  ORIGIN_URL=$(git remote get-url origin)
  info "Remote origin: $ORIGIN_URL"

  # valida que é o repo esperado (aceita https e ssh)
  if ! echo "$ORIGIN_URL" | grep -qi "luas-bot-whats"; then
    warn "Remote origin NÃO parece ser o repositório oficial luas-bot-whats"
    warn "Oficial: https://github.com/yanrpoliveira3108-bit/luas-bot-whats.git"
    warn "Atual: $ORIGIN_URL"
    if [ -t 0 ]; then
      read -r -p "Continuar mesmo assim? [s/N]: " ans
      case "$ans" in
        [sS]* ) ;;
        * ) err "Abortado. Corrija o remote origin."; exit 1 ;;
      esac
    else
      err "Abortado por segurança (remote inesperado). Use --help para mais info."
      exit 1
    fi
  else
    ok "Remote origin validado"
  fi

  # detecta branch atual
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
  info "Branch atual: $CURRENT_BRANCH"

  # detecta alterações locais em arquivos versionados
  if ! git diff --quiet || ! git diff --cached --quiet; then
    err "Existem alterações locais em arquivos versionados."
    echo ""
    git status --porcelain | head -n 50
    echo ""
    err "O update.sh NÃO sobrescreve alterações locais silenciosamente."
    err "Opções:"
    err "  1) git stash && ./update.sh && git stash pop   (guarda e restaura)"
    err "  2) git diff > /tmp/minhas-alteracoes.patch && git checkout -- . && ./update.sh"
    err "  3) commite suas alterações: git add -A && git commit -m 'minhas alterações'"
    exit 1
  fi

  # fetch
  step "Buscando atualizações do GitHub (git fetch)..."
  if ! git fetch origin --prune; then
    err "Falha no git fetch. Verifique internet e acesso ao GitHub."
    exit 1
  fi
  ok "Fetch concluído"

  # verifica se há atualizações
  # tenta origin/<current_branch>, senão origin/main, senão origin/master
  UPSTREAM=""
  for candidate in "origin/$CURRENT_BRANCH" "origin/main" "origin/master"; do
    if git rev-parse --verify "$candidate" >/dev/null 2>&1; then
      UPSTREAM="$candidate"
      break
    fi
  done

  if [ -z "$UPSTREAM" ]; then
    err "Não encontrei branch remota (origin/main, origin/master, origin/$CURRENT_BRANCH)"
    exit 1
  fi

  info "Upstream: $UPSTREAM"

  LOCAL_COMMIT=$(git rev-parse HEAD)
  REMOTE_COMMIT=$(git rev-parse "$UPSTREAM")

  if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
    ok "Já está atualizado (local = remoto: ${LOCAL_COMMIT:0:7})"
  else
    # quantos commits atrás/frente
    BEHIND=$(git rev-list --count HEAD.."$UPSTREAM" 2>/dev/null || echo "?")
    AHEAD=$(git rev-list --count "$UPSTREAM"..HEAD 2>/dev/null || echo "?")
    info "Local está $BEHIND commits atrás e $AHEAD à frente de $UPSTREAM"

    # salva hash antes do pull para mostrar o que mudou
    BEFORE_SHA=$(git rev-parse HEAD)

    # pull seguro --ff-only (não cria merge commit, não destrói histórico)
    step "Atualizando (git pull --ff-only $UPSTREAM)..."
    if ! git pull --ff-only origin "$CURRENT_BRANCH" 2>/dev/null; then
      # tenta main se current_branch falhar
      if [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "master" ]; then
        warn "Pull de $CURRENT_BRANCH falhou, tentando main..."
        if ! git pull --ff-only origin main 2>/dev/null; then
          if ! git pull --ff-only origin master 2>/dev/null; then
            err "git pull --ff-only falhou (branch divergiu)."
            echo ""
            echo "Isso acontece quando há commits locais que não estão no remoto."
            echo "Soluções:"
            echo "  git log --oneline HEAD..$UPSTREAM   # ver o que falta"
            echo "  git log --oneline $UPSTREAM..HEAD   # ver commits locais"
            echo "  git reset --hard $UPSTREAM  # APAGA commits locais (perigoso, faça backup)"
            echo "  git rebase $UPSTREAM        # tenta re-aplicar commits locais"
            exit 1
          fi
        fi
      else
        err "git pull --ff-only falhou. Branch divergiu."
        exit 1
      fi
    fi

    AFTER_SHA=$(git rev-parse HEAD)
    ok "Atualizado: ${BEFORE_SHA:0:7} → ${AFTER_SHA:0:7}"

    echo ""
    echo "📦 Alterações:"
    git log --oneline "$BEFORE_SHA".."$AFTER_SHA" | head -n 20
    echo ""
    echo "📄 Arquivos alterados:"
    git diff --name-status "$BEFORE_SHA".."$AFTER_SHA" | head -n 50
  fi

  # limpeza segura se solicitado
  if [ "$DELETE_SOURCE" -eq 1 ]; then
    echo ""
    clean_temp_source
  fi
fi

# ---- garantir diretórios ----
mkdir -p session tmp database logs backup assets
[ -f tmp/.gitkeep ] || touch tmp/.gitkeep
ok "Diretórios garantidos"

# ---- garantir .env ----
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    warn ".env criado a partir de .env.example — EDITE o OWNER_NUMBER!"
  else
    err ".env não encontrado e .env.example ausente"
    exit 1
  fi
else
  info ".env mantido (não alterado)"
fi

# ---- atualizar dependências se package.json mudou ----
NEED_INSTALL=0
if [ -n "${BEFORE_SHA:-}" ] && [ -n "${AFTER_SHA:-}" ]; then
  if git diff --name-only "$BEFORE_SHA".."$AFTER_SHA" | grep -qE "package\.json|package-lock\.json|vendor/"; then
    NEED_INSTALL=1
    info "package.json ou vendor/ mudou — dependências precisam atualizar"
  fi
else
  # modo arquivo ou primeira instalação: sempre verifica
  if [ ! -d node_modules ] || [ ! -f node_modules/dotenv/package.json ]; then
    NEED_INSTALL=1
  fi
fi

# garante better-sqlite3 13+ (compat Node 22+)
if [ -f package.json ] && grep -qE '"better-sqlite3": *"\^11\.' package.json; then
  sed -i -E 's/"better-sqlite3": *"\^11\.[0-9.]+"/"better-sqlite3": "^13.0.3"/' package.json
  sed -i -E 's/"node": *">=20(\.0\.0)?"/"node": ">=22.0.0"/' package.json
  info "package.json atualizado: better-sqlite3 → ^13.0.3 (Node ≥22)"
  NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
  step "Instalando/atualizando dependências..."
  INSTALL_FLAGS="--legacy-peer-deps --no-audit --no-fund"
  if [ "$(uname -o 2>/dev/null)" = "Android" ] || [ -n "${TERMUX_VERSION:-}" ]; then
    INSTALL_FLAGS="$INSTALL_FLAGS --ignore-scripts"
    info "Termux: scripts nativos ignorados (motor é JS puro, better-sqlite3 será compilado depois)"
  fi
  # shellcheck disable=SC2086
  if ! npm install $INSTALL_FLAGS; then
    err "npm install falhou"
    exit 1
  fi
  ok "Dependências instaladas"
else
  ok "Dependências já atualizadas (sem mudanças em package.json)"
fi

# ---- compila better-sqlite3 se necessário (Android) ----
ensure_sqlite_binary() {
  if node -e "const D=require('better-sqlite3'); new D(':memory:').close();" >/dev/null 2>&1; then
    return 0
  fi
  warn "better-sqlite3 binário nativo ausente (Android sem pré-compilado) — compilando..."
  local need=""
  { command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; } || need="python "
  command -v make >/dev/null 2>&1 || need="${need}make "
  { command -v clang >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1 || command -v cc >/dev/null 2>&1; } || need="${need}clang/gcc"
  if [ -n "$need" ]; then
    err "Faltam ferramentas: $need"
    err "Termux: pkg install python make clang"
    err "Linux: sudo apt install build-essential python3"
    exit 1
  fi
  (cd node_modules/better-sqlite3 && npm run build-release) || {
    err "Falha ao compilar better-sqlite3"
    exit 1
  }
  if node -e "const D=require('better-sqlite3'); new D(':memory:').close();" >/dev/null 2>&1; then
    ok "better-sqlite3 compilado e funcionando"
  else
    err "better-sqlite3 ainda não carrega após compilação"
    exit 1
  fi
}
ensure_sqlite_binary

# ---- permissões ----
chmod +x install.sh start.sh update.sh scripts/*.sh 2>/dev/null || true
ok "Permissões de execução aplicadas"

# ---- validações ----
step "Verificando integridade do projeto..."

mkdir -p tmp
if node scripts/audit.js >tmp/lua_audit.log 2>&1; then
  ok "Auditoria: OK"
else
  err "Auditoria falhou. Últimas linhas:"
  tail -n 20 tmp/lua_audit.log
  err "Rode 'node scripts/audit.js' para ver completo"
  exit 1
fi
rm -f tmp/lua_audit.log

if node test/smoke.js >tmp/lua_smoke.log 2>&1; then
  ok "Smoke test: OK"
else
  err "Smoke test falhou. Últimas linhas:"
  tail -n 20 tmp/lua_smoke.log
  err "Rode 'node test/smoke.js' para ver completo"
  exit 1
fi
rm -f tmp/lua_smoke.log

# ---- resumo final ----
echo ""
echo "============================="
ok "Atualização concluída com segurança!"
echo ""
echo "📁 Dados preservados (NUNCA apagados):"
echo "   • .env"
echo "   • session/ (credenciais WhatsApp)"
echo "   • database/*.db (banco)"
echo "   • backup/ (snapshots)"
echo "   • logs/ (histórico)"
echo "   • assets/ (imagens)"
echo ""
if [ -n "${BEFORE_SHA:-}" ] && [ -n "${AFTER_SHA:-}" ] && [ "$BEFORE_SHA" != "$AFTER_SHA" ]; then
  echo "🔄 Atualizado: ${BEFORE_SHA:0:7} → ${AFTER_SHA:0:7}"
  echo "   $BEHIND commits novos do GitHub"
fi
echo "📦 Snapshot de segurança: $SNAP"
echo "   Para restaurar: cp -a $SNAP/. ."
echo ""
echo "🚀 Inicie o bot: ./start.sh   (ou npm start)"
echo "============================="
echo ""

exit 0
