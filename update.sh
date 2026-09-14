#!/usr/bin/env bash
# ============================================================
#  update.sh — atualização SEGURA do Lua.
#
#  Permite colar a versão nova por cima de ~/lua SEM apagar os
#  dados importantes (.env, session, banco, backup, logs, menu).
#
#  Uso:
#    ./update.sh                      → procura o pacote mais recente na
#                                       pasta Downloads e extrai dentro de ~/lua
#    ./update.sh pacote.zip           → usa o pacote informado
#    ./update.sh pacote.tar.gz        → idem (tar.gz)
#    ./update.sh --delete-source      → igual ao primeiro, mas APAGA o pacote
#                                       da pasta Downloads após extrair
#
#  Pastas de download verificadas automaticamente:
#    ~/storage/downloads  (Termux)   ~/storage/shared/Download
#    ~/downloads                      ~/Downloads
#
#  O que é SEMPRE preservado (dados do usuário):
#    .env            → configurações e dono
#    session/        → credenciais do WhatsApp (não refaz pairing)
#    database/*.db   → usuários, RPG, grupos, X9, quiz...
#    backup/         → backups anteriores
#    logs/           → histórico de logs
#    assets/menu.jpg → imagem do menu (se personalizada)
# ============================================================
set -e
cd "$(dirname "$0")"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
info() { echo -e "${YELLOW}ℹ${NC} $1"; }
err()  { echo -e "${RED}❌${NC} $1"; }

# ── Termux: corrige o bug do node-gyp (android_ndk_path) ───────────────
termux_gyp_fix() {
  if [ "$(uname -o 2>/dev/null)" = "Android" ] || [ -n "$TERMUX_VERSION" ]; then
    export GYP_DEFINES="android_ndk_path=''"
    mkdir -p ~/.gyp
    echo "{'variables':{'android_ndk_path':''}}" > ~/.gyp/include.gypi
    info "Termux detectado — correção do node-gyp (android_ndk_path) aplicada."
  fi
}

# ── garante better-sqlite3 13+ (compatível com Node 22/24/26) ──────────
pin_better_sqlite3() {
  if [ -f package.json ] && grep -qE '"better-sqlite3": *"\^11\.' package.json; then
    sed -i -E 's/"better-sqlite3": *"\^11\.[0-9.]+"/"better-sqlite3": "^13.0.3"/' package.json
    sed -i -E 's/"node": *">=20(\.0\.0)?"/"node": ">=22.0.0"/' package.json
    info "package.json atualizado: better-sqlite3 → ^13.0.3 (Node ≥ 22)"
  fi
}

# ── devolve o bit de execução aos scripts (zip remove permissões) ──────
fix_permissions() {
  chmod +x install.sh start.sh update.sh scripts/*.sh 2>/dev/null || true
}

# ── compila o módulo nativo do banco, se necessário ────────────────────
# O better-sqlite3@13 NÃO tem script de instalação automática e não traz
# binário pré-compilado para Android (só Linux/macOS/Windows). Em Termux,
# o build/Release/better_sqlite3.node precisa ser gerado do código-fonte.
# O teste real é "o módulo carrega?" — cobre pré-compilado e compilado.
ensure_sqlite_binary() {
  if node -e "const D=require('better-sqlite3'); new D(':memory:').close();" >/dev/null 2>&1; then
    return 0
  fi

  info "better-sqlite3: binário nativo ausente (Android não tem pré-compilado)."
  info "Compilando do código-fonte..."

  local need=""
  { command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; } || need="python "
  command -v make >/dev/null 2>&1 || need="${need}make "
  { command -v clang >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1 || command -v cc >/dev/null 2>&1; } || need="${need}clang/gcc"
  if [ -n "$need" ]; then
    err "Faltam ferramentas de compilação: $need"
    err "Termux:  pkg install python make clang"
    err "Linux:   sudo apt install build-essential python3"
    err "Depois rode novamente:  bash update.sh"
    exit 1
  fi

  termux_gyp_fix
  (cd node_modules/better-sqlite3 && npm run build-release) || {
    err "Falha ao compilar o better-sqlite3. Veja o erro acima."
    exit 1
  }
  if node -e "const D=require('better-sqlite3'); new D(':memory:').close();" >/dev/null 2>&1; then
    ok "better-sqlite3 compilado e funcionando."
  else
    err "better-sqlite3 ainda não carrega após a compilação."
    exit 1
  fi
}

# ── localiza o pacote mais recente nas pastas de download ──────────────
find_downloaded_package() {
  local dirs=("$HOME/storage/downloads" "$HOME/storage/shared/Download" "$HOME/downloads" "$HOME/Downloads" "$PWD")
  local found=() f
  for d in "${dirs[@]}"; do
    [ -d "$d" ] || continue
    for f in "$d"/lua-update-*.zip "$d"/lua-update-*.tar.gz "$d"/lua*.zip "$d"/lua*.tar.gz; do
      [ -f "$f" ] && found+=("$f")
    done
  done
  [ ${#found[@]} -eq 0 ] && { echo ""; return; }
  ls -t "${found[@]}" 2>/dev/null | head -1
}

# ── achata uma subpasta única (ex.: lua-main/ de download do GitHub) ────
flatten_wrapper() {
  local d="$1" sub
  for sub in "$d"/*/; do
    [ -d "$sub" ] || continue
    if [ -f "$sub/package.json" ] && [ -f "$sub/index.js" ]; then
      mv "$sub"/* "$d"/ 2>/dev/null || true
      mv "$sub"/.[!.]* "$d"/ 2>/dev/null || true
      rmdir "$sub" 2>/dev/null || true
      return 0
    fi
  done
  return 1
}

# ── extrai um pacote (zip/tar.gz) por cima do diretório atual ──────────
extract_archive() {
  local ARCHIVE="$1" TMPX
  TMPX=$(mktemp -d)
  info "Extraindo $ARCHIVE ..."
  case "$ARCHIVE" in
    *.zip)
      if ! command -v unzip >/dev/null 2>&1; then err "Instale o unzip: pkg install unzip"; exit 1; fi
      unzip -q "$ARCHIVE" -d "$TMPX"
      ;;
    *.tar.gz|*.tgz)
      tar -xzf "$ARCHIVE" -C "$TMPX"
      ;;
    *)
      err "Formato não suportado. Use .zip ou .tar.gz"; exit 1
      ;;
  esac
  flatten_wrapper "$TMPX" || true
  cp -a "$TMPX"/. .
  rm -rf "$TMPX"
  ok "Arquivos novos copiados por cima de $(pwd)"
}

echo ""
echo "🌙 Lua — atualização segura"
echo "============================="

# 1. Node/npm
if ! command -v node >/dev/null 2>&1; then err "Node.js não encontrado (Termux: pkg install nodejs-lts)"; exit 1; fi
if ! command -v npm  >/dev/null 2>&1; then err "npm não encontrado"; exit 1; fi
ok "Node $(node -v) / npm $(npm -v)"

# 2. Snapshot de segurança (antes de qualquer alteração)
SNAP="backup/pre-update-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$SNAP/database" "$SNAP/assets"
for f in .env; do
  [ -f "$f" ] && cp -a "$f" "$SNAP/" 2>/dev/null || true
done
[ -f assets/menu.jpg ] && cp -a assets/menu.jpg "$SNAP/assets/" 2>/dev/null || true
[ -d session ] && [ -n "$(ls -A session 2>/dev/null)" ] && cp -a session "$SNAP/session" 2>/dev/null || true
[ -d logs ] && cp -a logs "$SNAP/logs" 2>/dev/null || true
cp -a database/*.db* "$SNAP/database/" 2>/dev/null || true
ok "Snapshot de segurança criado em $SNAP"

# 3. Restaura dados preservados no snapshot (só o que existir)
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
  if [ -d "$src/logs" ]; then mkdir -p logs; cp -a "$src/logs"/. logs/; ok "logs preservados"; fi
}

# 4. Escolhe a origem da atualização
DELETE_SOURCE=0
if [ "$1" = "--delete-source" ] || [ "$1" = "--rm-source" ]; then
  DELETE_SOURCE=1
  shift
fi
ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ]; then
  ARCHIVE=$(find_downloaded_package)
  if [ -n "$ARCHIVE" ]; then
    info "Pacote encontrado na pasta Downloads:"
    info "   $ARCHIVE"
    if [ -t 0 ]; then
      read -r -p "Extrair na pasta atual ($(pwd))? [S/n]: " ans
      case "$ans" in [nN]*) ARCHIVE="" ;; esac
    fi
  fi
fi

if [ -n "$ARCHIVE" ]; then
  [ -f "$ARCHIVE" ] || { err "Arquivo não encontrado: $ARCHIVE"; exit 1; }
  extract_archive "$ARCHIVE"
  restore_data "$SNAP"
  if [ "$DELETE_SOURCE" -eq 1 ]; then
    rm -f "$ARCHIVE"
    ok "Pacote removido da pasta Downloads: $ARCHIVE"
  fi
else
  info "Sem pacote informado/encontrado: assumindo que os arquivos novos já foram colados por cima."
fi

# 5. Garantir diretórios
mkdir -p session tmp database logs backup assets
ok "Diretórios garantidos"

# 6. Garantir .env (nunca sobrescreve um existente)
if [ ! -f .env ]; then
  cp .env.example .env
  ok ".env criado a partir do .env.example — EDITE o OWNER_NUMBER"
else
  info ".env mantido (não alterado)"
fi

# 7. Instalar/atualizar dependências
#    Correções automáticas antes de instalar:
termux_gyp_fix
pin_better_sqlite3

info "Instalando dependências..."
INSTALL_FLAGS="--legacy-peer-deps --no-audit --no-fund"
if [ "$(uname -o 2>/dev/null)" = "Android" ] || [ -n "$TERMUX_VERSION" ]; then
  # o motor vendored (boruto-vk7-baileys + libsignal-node) é JS puro, sem
  # binários nativos — ignoramos os scripts de build nativo (não usados).
  # O better-sqlite3 é compilado por ensure_sqlite_binary.
  INSTALL_FLAGS="$INSTALL_FLAGS --ignore-scripts"
fi
npm install $INSTALL_FLAGS

# Compila o módulo nativo do banco, se necessário (Android sem pré-compilado)
ensure_sqlite_binary

# 8. Verificar integridade
info "Verificando integridade do projeto..."
mkdir -p tmp
if node scripts/audit.js >tmp/lua_audit.log 2>&1; then
  ok "Auditoria: OK"
else
  err "Auditoria falhou. Últimas linhas do erro:"
  tail -n 15 tmp/lua_audit.log
  err "Rode 'node scripts/audit.js' para ver o erro completo."
  exit 1
fi
rm -f tmp/lua_audit.log
if node test/smoke.js >tmp/lua_smoke.log 2>&1; then
  ok "Smoke test: OK"
else
  err "Smoke test falhou. Últimas linhas do erro:"
  tail -n 20 tmp/lua_smoke.log
  err "Rode 'node test/smoke.js' para ver o erro completo."
  exit 1
fi
rm -f tmp/lua_smoke.log

# 9. Resumo final
fix_permissions
ok "Permissões de execução aplicadas (./start.sh, ./update.sh...)."
echo ""
echo "============================="
ok "Atualização concluída com segurança!"
echo ""
echo "Dados preservados (não foram apagados):"
echo "  • .env"
echo "  • session/ (credenciais do WhatsApp)"
echo "  • database/*.db (banco)"
echo "  • backup/ (incluindo o snapshot de hoje: $SNAP)"
echo "  • logs/"
echo "  • assets/menu.jpg"
echo ""
echo "Se algo der errado, restaure o snapshot com:"
echo "  cp -a $SNAP/. ."
echo ""
echo "Inicie o bot:  ./start.sh   (ou npm start)"
