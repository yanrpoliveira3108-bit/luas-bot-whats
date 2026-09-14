#!/usr/bin/env bash
# ============================================================
#  update.sh — atualização SEGURA e PROFISSIONAL do Lua Bot
#
#  Fluxo oficial (GitHub como fonte da verdade):
#    cd ~/lua && ./update.sh --delete-source
#    ./start.sh
#
#  Idempotente, preserva .env/session/database/backup/logs/assets
#  Detecta alterações locais e aborta (use --force para stash auto)
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
info() { echo -e "${YELLOW}ℹ${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}❌${NC} $1" >&2; }
step() { echo -e "${BLUE}▶${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
ROOT="$SCRIPT_DIR"
ALL_BRANCHES_REFSPEC='+refs/heads/*:refs/remotes/origin/*'

DELETE_SOURCE=0
FORCE=0
ARCHIVE=""
SHOW_HELP=0

for arg in "$@"; do
  case "$arg" in
    --delete-source|--rm-source) DELETE_SOURCE=1 ;;
    --force|-f) FORCE=1 ;;
    --help|-h) SHOW_HELP=1 ;;
    *.zip|*.tar.gz|*.tgz)
      if [ -f "$arg" ]; then ARCHIVE="$arg"; else err "Arquivo não encontrado: $arg"; exit 1; fi ;;
    *) if [ -n "$arg" ]; then warn "Argumento desconhecido ignorado: $arg"; fi ;;
  esac
done

if [ "$SHOW_HELP" -eq 1 ]; then
  cat <<'EOF'
Uso: ./update.sh [opções] [arquivo.zip]

Opções:
  --delete-source   Limpeza segura de arquivos temporários APÓS atualizar
  --force, -f       Stash automático se houver alterações locais + reset com confirmação se divergiu
  --help, -h        Mostra esta ajuda

Exemplos:
  cd ~/lua && ./update.sh --delete-source && ./start.sh
  cd ~/lua && ./update.sh --force && ./start.sh
EOF
  exit 0
fi

echo ""
echo "🌙 Lua — atualização segura"
echo "============================="
echo "📁 Raiz: $ROOT"

if ! command -v git >/dev/null 2>&1; then err "git não encontrado. pkg install git"; exit 1; fi
if ! command -v node >/dev/null 2>&1; then err "Node.js não encontrado. pkg install nodejs-lts"; exit 1; fi
if ! command -v npm >/dev/null 2>&1; then err "npm não encontrado."; exit 1; fi

ok "Node $(node -v) / npm $(npm -v) / git $(git --version | awk '{print $3}')"

termux_gyp_fix() {
  if [ "$(uname -o 2>/dev/null)" = "Android" ] || [ -n "${TERMUX_VERSION:-}" ]; then
    export GYP_DEFINES="android_ndk_path=''"
    mkdir -p ~/.gyp
    echo "{'variables':{'android_ndk_path':''}}" > ~/.gyp/include.gypi
    info "Termux detectado — correção node-gyp aplicada."
  fi
}
termux_gyp_fix

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
  if [ -d "$src/session" ] && [ -n "$(ls -A "$src/session" 2>/dev/null)" ]; then rm -rf session; cp -a "$src/session" session; ok "session/ preservada"; fi
  [ -f "$src/assets/menu.jpg" ] && mkdir -p assets && cp -a "$src/assets/menu.jpg" assets/menu.jpg && ok "assets/menu.jpg preservado"
  if [ -d "$src/database" ] && [ -n "$(ls -A "$src/database" 2>/dev/null)" ]; then mkdir -p database; cp -a "$src/database"/. database/; ok "database preservado"; fi
  if [ -d "$src/logs" ]; then mkdir -p logs; cp -a "$src/logs"/. logs/ 2>/dev/null || true; fi
}

# Allowlist ESTRITA do --delete-source (briefing 30): só estes alvos podem ser
# removidos. Nada de glob amplo sobre a raiz (já apagou tmp/.lock e arquivos do
# usuário no passado). Adicionar alvo aqui = decisão explícita e documentada.
DELETE_SOURCE_TARGETS=(
  'tmp/*.log'
  'player-scripts'
  '.gyp'
  'cards'
)

clean_temp_source() {
  step "Limpando arquivos temporários seguros (--delete-source)..."
  local alvo f removidos=0
  for alvo in "${DELETE_SOURCE_TARGETS[@]}"; do
    case "$alvo" in
      tmp/*.log)
        shopt -s nullglob
        for f in tmp/*.log; do
          rm -f -- "$f" && echo "  removido: $f" && removidos=$((removidos + 1))
        done
        shopt -u nullglob
        ;;
      *)
        if [ -e "$alvo" ]; then
          rm -rf -- "$alvo" && echo "  removido: $alvo/" && removidos=$((removidos + 1))
        fi
        ;;
    esac
  done
  if [ "$removidos" -eq 0 ]; then info "Nada para limpar (allowlist: ${DELETE_SOURCE_TARGETS[*]})"; fi
  echo ""
  echo "🛡️  Protegidos: .env, session/, database/, backup/, logs/, assets/, .git/, tmp/ (exceto *.log)"
}

if [ -n "$ARCHIVE" ]; then
  step "Modo arquivo (legado) — extraindo $ARCHIVE"
  TMPX=$(mktemp -d)
  trap 'rm -rf "$TMPX"' EXIT
  info "Extraindo $ARCHIVE ..."
  case "$ARCHIVE" in
    *.zip) command -v unzip >/dev/null 2>&1 || { err "Instale unzip: pkg install unzip"; exit 1; }; unzip -q "$ARCHIVE" -d "$TMPX" ;;
    *.tar.gz|*.tgz) tar -xzf "$ARCHIVE" -C "$TMPX" ;;
    *) err "Formato não suportado"; exit 1 ;;
  esac
  for sub in "$TMPX"/*/; do [ -d "$sub" ] || continue; if [ -f "$sub/package.json" ] && [ -f "$sub/index.js" ]; then mv "$sub"/* "$TMPX"/ 2>/dev/null || true; mv "$sub"/.[!.]* "$TMPX"/ 2>/dev/null || true; rmdir "$sub" 2>/dev/null || true; break; fi; done
  cp -a "$TMPX"/. .
  rm -rf "$TMPX"; trap - EXIT
  ok "Arquivos copiados"
  restore_data "$SNAP"
  if [ "$DELETE_SOURCE" -eq 1 ]; then
    case "$ARCHIVE" in
      *"/storage/downloads/"*|*"/storage/shared/Download"*|*"/downloads/"*|*"/Downloads/"*|*"/tmp/"*) rm -f "$ARCHIVE"; ok "Pacote removido: $ARCHIVE" ;;
      *) warn "Pacote NÃO removido (fora de Downloads): $ARCHIVE" ;;
    esac
    clean_temp_source
  fi
else
  step "Modo Git — atualização via GitHub"
  if [ ! -d .git ]; then err ".git não encontrado. cd ~ && git clone https://github.com/yanrpoliveira3108-bit/luas-bot-whats.git lua && cd lua && ./update.sh"; exit 1; fi
  if ! git remote get-url origin >/dev/null 2>&1; then err "Remote origin não configurado"; exit 1; fi
  ORIGIN_URL=$(git remote get-url origin)
  info "Remote origin: $ORIGIN_URL"
  if ! echo "$ORIGIN_URL" | grep -qi "luas-bot-whats"; then
    warn "Remote NÃO parece oficial: $ORIGIN_URL"
    if [ -t 0 ]; then read -r -p "Continuar? [s/N]: " ans; case "$ans" in [sS]* ) ;; * ) err "Abortado"; exit 1 ;; esac; else err "Abortado"; exit 1; fi
  else ok "Remote validado"; fi

  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
  info "Branch atual: $CURRENT_BRANCH"

  IS_ARENA=0
  if echo "$CURRENT_BRANCH" | grep -q "^arena/"; then IS_ARENA=1; info "Branch arena detectada (dev)"; fi

  HAS_LOCAL_CHANGES=0
  if ! git diff --quiet || ! git diff --cached --quiet; then HAS_LOCAL_CHANGES=1; fi

  # arquivos não rastreados não bloqueiam (podem ser dados do usuário), mas
  # precisam ser mostrados: eles sobrevivem ao update e às vezes explicam um
  # comportamento estranho depois dele.
  UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null | head -n 10 || true)
  if [ -n "$UNTRACKED" ]; then
    UNTRACKED_TOTAL=$(git ls-files --others --exclude-standard 2>/dev/null | grep -c . || true)
    warn "Arquivos não rastreados presentes (${UNTRACKED_TOTAL:-0}) — serão preservados:"
    echo "$UNTRACKED" | sed 's/^/    /'
  fi

  if [ "$HAS_LOCAL_CHANGES" -eq 1 ]; then
    if [ "$FORCE" -eq 1 ]; then
      warn "Alterações locais detectadas — --force ativo, fazendo stash automático"
      STASH_NAME="lua-update-auto-$(date +%Y%m%d-%H%M%S)"
      if git stash push -m "$STASH_NAME" >/dev/null 2>&1; then
        ok "Alterações guardadas em stash: $STASH_NAME"
        info "Para recuperar: git stash list  →  git stash apply stash@{0}"
      else
        warn "git stash não guardou nada (nada para guardar?)"
      fi
    else
      err "Existem alterações locais em arquivos versionados."
      echo ""; git status --porcelain | head -n 50 || true; echo ""
      err "Opções: ./update.sh --force | git stash && ./update.sh && git stash pop"
      exit 1
    fi
  fi

  step "Buscando atualizações (git fetch)..."
  # Clone single-branch (git clone --single-branch / --branch) grava UM unico
  # refspec em remote.origin.fetch. Nesse caso "git fetch origin" termina com
  # sucesso trazendo so aquela branch — entao o fetch "completo" precisa ser
  # feito sempre, e nao apenas quando o primeiro falha. Ampliamos o refspec do
  # remote para todas as branches antes de buscar.
  if ! git config --get-all remote.origin.fetch 2>/dev/null | grep -qxF "$ALL_BRANCHES_REFSPEC"; then
    info "Clone single-branch detectado — habilitando busca de todas as branches"
    git remote set-branches origin '*' >/dev/null 2>&1 \
      || git config --replace-all remote.origin.fetch "$ALL_BRANCHES_REFSPEC" \
      || true
  fi
  FETCH_OK=0
  if git fetch origin --prune 2>/dev/null; then FETCH_OK=1; fi
  # sempre garante TODAS as branches (arena/* inclusive): com refspec de
  # single-branch o fetch acima "dá certo" sem trazer nada novo.
  if git fetch origin "$ALL_BRANCHES_REFSPEC" --prune 2>/dev/null; then FETCH_OK=1; fi
  if [ "$FETCH_OK" -eq 0 ]; then err "Falha no git fetch. Verifique internet"; exit 1; fi
  if ! git rev-parse --verify "origin/$CURRENT_BRANCH" >/dev/null 2>&1; then
    git fetch origin "$CURRENT_BRANCH":"refs/remotes/origin/$CURRENT_BRANCH" 2>/dev/null || true
  fi
  REMOTE_BRANCHES=$(git branch -r 2>/dev/null | grep -v -- '->' | grep -c 'origin/' || true)
  ok "Fetch concluído (${REMOTE_BRANCHES:-0} branch(es) remota(s))"

  if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
    # Pode existir mais de uma arena/*: escolha pela data do commit, nunca pela
    # ordem alfabética — a alfabética apontava para a branch MAIS ANTIGA.
    ARENA_REMOTE=$(git for-each-ref --sort=-committerdate refs/remotes/origin/arena/ \
      --format='%(refname:short)' 2>/dev/null | head -n 1 | sed 's|^origin/||' | xargs || true)
    if [ -z "$ARENA_REMOTE" ]; then
      ARENA_REMOTE=$(git branch -r | grep "origin/arena/" | head -n 1 | sed 's|.*origin/||' | xargs || true)
    fi
    if [ -n "$ARENA_REMOTE" ]; then
      ARENA_COUNT=$(git for-each-ref refs/remotes/origin/arena/ --format='%(refname:short)' 2>/dev/null | grep -c . || true)
      ARENA_SHA=$(git log -1 --format=%h "origin/$ARENA_REMOTE" 2>/dev/null || echo '?')
      info "Branch arena remota mais recente: $ARENA_REMOTE ($ARENA_SHA)"
      if [ "${ARENA_COUNT:-0}" -gt 1 ]; then info "Há ${ARENA_COUNT} branches arena/* — usando a do commit mais novo"; fi
      info "Para últimas melhorias: git checkout $ARENA_REMOTE && ./update.sh"
      echo ""
    fi
  fi

  UPSTREAM=""
  if [ "$IS_ARENA" -eq 1 ]; then
    for candidate in "origin/$CURRENT_BRANCH" "origin/main" "origin/master"; do
      if git rev-parse --verify "$candidate" >/dev/null 2>&1; then UPSTREAM="$candidate"; break; fi
    done
  else
    for candidate in "origin/main" "origin/master" "origin/$CURRENT_BRANCH"; do
      if git rev-parse --verify "$candidate" >/dev/null 2>&1; then UPSTREAM="$candidate"; break; fi
    done
  fi

  if [ -z "$UPSTREAM" ]; then err "Não encontrei branch remota"; exit 1; fi
  info "Upstream: $UPSTREAM"

  LOCAL_COMMIT=$(git rev-parse HEAD)
  REMOTE_COMMIT=$(git rev-parse "$UPSTREAM")

  if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
    ok "Já está atualizado (local = remoto: ${LOCAL_COMMIT:0:7})"
    if [ "$FORCE" -eq 1 ] && git stash list | grep -qE "lua-update-auto-|auto-stash before update"; then
      info "Restaurando stash..."
      git stash pop || warn "Conflito ao restaurar stash — resolva manualmente: git stash pop"
    fi
  else
    BEHIND=$(git rev-list --count HEAD.."$UPSTREAM" 2>/dev/null || echo "?")
    AHEAD=$(git rev-list --count "$UPSTREAM"..HEAD 2>/dev/null || echo "?")
    info "Local está $BEHIND atrás e $AHEAD à frente de $UPSTREAM"

    RESET_DONE=0
    if [ "$BEHIND" = "0" ] && [ "$AHEAD" != "0" ] && [ "$AHEAD" != "?" ]; then
      warn "Seu branch local está $AHEAD commit(s) à frente de $UPSTREAM (commits locais)"
      echo ""; echo "Commits locais:"; git log --oneline "$UPSTREAM"..HEAD | head -n 20 || true; echo ""
      if [ "$FORCE" -eq 1 ]; then
        warn "--force ativo: fazendo reset --hard para $UPSTREAM para alinhar com GitHub"
        if [ -t 0 ]; then
          read -r -p "Confirmar reset --hard $UPSTREAM? [s/N]: " ans
          case "$ans" in
            [sS]* )
              BEFORE_SHA="$LOCAL_COMMIT"
              git reset --hard "$UPSTREAM"
              AFTER_SHA=$(git rev-parse HEAD)
              ok "Reset feito — alinhado com $UPSTREAM (${BEFORE_SHA:0:7} → ${AFTER_SHA:0:7})"
              RESET_DONE=1
              ;;
            * ) err "Abortado. Para manter commits locais, faça push ou crie branch"; exit 1 ;;
          esac
        else
          err "Sem TTY — abortado. Rode: git reset --hard $UPSTREAM ou git push"
          exit 1
        fi
      else
        err "Resolva divergência: git reset --hard $UPSTREAM (APAGA locais) | git push origin $CURRENT_BRANCH | ./update.sh --force"
        exit 1
      fi
    fi

    if [ "$RESET_DONE" -eq 0 ]; then
      BEFORE_SHA=$(git rev-parse HEAD)
      step "Atualizando (git pull --ff-only $UPSTREAM)..."
      PULLED=0
      if git pull --ff-only origin "$CURRENT_BRANCH" 2>/dev/null; then
        PULLED=1
      elif [ "$IS_ARENA" -eq 1 ]; then
        warn "Pull de $CURRENT_BRANCH falhou, tentando $UPSTREAM..."
        if git merge --ff-only "$UPSTREAM" 2>/dev/null; then
          PULLED=1
        elif git pull --ff-only origin main 2>/dev/null; then
          PULLED=1
        fi
      else
        if git pull --ff-only origin main 2>/dev/null; then PULLED=1
        elif git pull --ff-only origin master 2>/dev/null; then PULLED=1
        fi
      fi

      if [ "$PULLED" -eq 0 ]; then
        err "git pull --ff-only falhou (branch divergiu)."
        echo "  git log --oneline HEAD..$UPSTREAM | head -20"
        echo "  git log --oneline $UPSTREAM..HEAD | head -20"
        echo "  ./update.sh --force | git reset --hard $UPSTREAM (perigoso, backup em $SNAP)"
        if [ "$FORCE" -eq 1 ] && [ -t 0 ]; then
          read -r -p "Fazer git reset --hard $UPSTREAM? [s/N]: " ans
          case "$ans" in
            [sS]* ) git reset --hard "$UPSTREAM" && PULLED=1 && ok "Reset feito" ;;
            * ) err "Abortado"; exit 1 ;;
          esac
        else
          exit 1
        fi
      fi

      AFTER_SHA=$(git rev-parse HEAD)
      if [ "$BEFORE_SHA" != "$AFTER_SHA" ]; then
        ok "Atualizado: ${BEFORE_SHA:0:7} → ${AFTER_SHA:0:7}"
        # "|| true": com pipefail, o SIGPIPE do head em listas longas (exit 141)
        # abortaria o script no meio da atualização.
        echo ""; echo "📦 Alterações:"; git log --oneline "$BEFORE_SHA".."$AFTER_SHA" | head -n 20 || true
        echo ""; echo "📄 Arquivos alterados:"; git diff --name-status "$BEFORE_SHA".."$AFTER_SHA" | head -n 50 || true
      else
        ok "Já estava atualizado após pull (sem novos commits)"
      fi

      if [ "$FORCE" -eq 1 ] && git stash list | grep -qE "lua-update-auto-|auto-stash before update"; then
        echo ""; info "Restaurando stash..."
        if ! git stash pop; then
          warn "Conflito ao restaurar stash — resolva manualmente: git stash list / git stash pop"
        else
          ok "Stash restaurado"
        fi
      fi
    fi
  fi

  if [ "$DELETE_SOURCE" -eq 1 ]; then echo ""; clean_temp_source; fi
fi

mkdir -p session tmp database logs backup assets
[ -f tmp/.gitkeep ] || touch tmp/.gitkeep
ok "Diretórios garantidos"

if [ ! -f .env ]; then
  if [ -f .env.example ]; then cp .env.example .env; warn ".env criado a partir de .env.example — EDITE OWNER_NUMBER!"; else err ".env não encontrado"; exit 1; fi
else info ".env mantido"; fi

NEED_INSTALL=0
if [ -n "${BEFORE_SHA:-}" ] && [ -n "${AFTER_SHA:-}" ]; then
  # aspas simples: o padrao chega ao grep exatamente como escrito (sem a
  # armadilha do escape duplo dentro de aspas duplas)
  if git diff --name-only "$BEFORE_SHA".."$AFTER_SHA" | grep -qE 'package\.json|package-lock\.json|vendor/'; then NEED_INSTALL=1; info "package.json mudou — precisa npm install"; fi
else
  if [ ! -d node_modules ] || [ ! -f node_modules/dotenv/package.json ]; then NEED_INSTALL=1; fi
fi

# Aspas simples SEM \" escapado: as barras invertidas antes de " chegavam ao
# grep (aviso "stray \ before \"" em algumas builds) e o \\^ exigia uma barra
# invertida literal antes do ^11 — o padrão nunca casava e a migração nunca
# rodava em hosts antigos.
if [ -f package.json ] && grep -qE '"better-sqlite3": *"\^11\.' package.json; then
  sed -i -E 's/"better-sqlite3": *"\^11\.[0-9.]+"/"better-sqlite3": "^13.0.3"/' package.json
  sed -i -E 's/"node": *">=20(\.0\.0)?"/"node": ">=22.0.0"/' package.json
  info "package.json atualizado: better-sqlite3 → ^13.0.3, node → >=22"
  NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
  step "Instalando dependências..."
  INSTALL_FLAGS="--legacy-peer-deps --no-audit --no-fund"
  if [ "$(uname -o 2>/dev/null)" = "Android" ] || [ -n "${TERMUX_VERSION:-}" ]; then INSTALL_FLAGS="$INSTALL_FLAGS --ignore-scripts"; info "Termux: ignore-scripts"; fi
  if ! npm install $INSTALL_FLAGS; then err "npm install falhou"; exit 1; fi
  ok "Dependências instaladas"
else ok "Dependências já atualizadas"; fi

ensure_sqlite_binary() {
  if node -e "const D=require('better-sqlite3'); new D(':memory:').close();" >/dev/null 2>&1; then return 0; fi
  warn "better-sqlite3 binário ausente — compilando..."
  local need=""; { command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; } || need="python "; command -v make >/dev/null 2>&1 || need="${need}make "; { command -v clang >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1 || command -v cc >/dev/null 2>&1; } || need="${need}clang/gcc"
  if [ -n "$need" ]; then err "Faltam: $need — pkg install python make clang"; exit 1; fi
  (cd node_modules/better-sqlite3 && npm run build-release) || { err "Falha ao compilar"; exit 1; }
  if node -e "const D=require('better-sqlite3'); new D(':memory:').close();" >/dev/null 2>&1; then ok "better-sqlite3 compilado"; else err "better-sqlite3 ainda não carrega"; exit 1; fi
}
ensure_sqlite_binary

chmod +x install.sh start.sh update.sh scripts/*.sh 2>/dev/null || true
ok "Permissões aplicadas"

step "Verificando integridade..."
mkdir -p tmp
if node scripts/audit.js >tmp/lua_audit.log 2>&1; then ok "Auditoria: OK"; else err "Auditoria falhou:"; tail -n 20 tmp/lua_audit.log; exit 1; fi
rm -f tmp/lua_audit.log
if node test/smoke.js >tmp/lua_smoke.log 2>&1; then ok "Smoke test: OK"; else err "Smoke falhou:"; tail -n 20 tmp/lua_smoke.log; exit 1; fi
rm -f tmp/lua_smoke.log

echo ""; echo "============================="; ok "Atualização concluída!"
echo ""; echo "📁 Dados preservados: .env, session/, database/, backup/, logs/, assets/"
if [ -n "${BEFORE_SHA:-}" ] && [ -n "${AFTER_SHA:-}" ] && [ "$BEFORE_SHA" != "$AFTER_SHA" ]; then echo "🔄 Atualizado: ${BEFORE_SHA:0:7} → ${AFTER_SHA:0:7} ($BEHIND novos)"; fi
echo "📦 Snapshot: $SNAP"
echo "🚀 Inicie: ./start.sh"
echo "============================="; echo ""
exit 0
