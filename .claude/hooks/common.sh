#!/usr/bin/env bash
# Funzioni comuni agli hook del metodo di lavoro.
# Richiede: jq (sudo apt install jq)

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATE_FILE="$PROJECT_DIR/.claude/compito-corrente.json"
LOG_FILE="$PROJECT_DIR/.claude/registro-compiti.log"

if ! command -v jq >/dev/null 2>&1; then
  echo "Hook del metodo: manca 'jq'. Installalo con: sudo apt install jq (Windows: winget install jqlang.jq, poi riavvia VS Code)" >&2
  exit 2
fi

current_task() { [ -f "$STATE_FILE" ] && jq -r '.task // ""' "$STATE_FILE" 2>/dev/null || echo ""; }
current_phase() { [ -f "$STATE_FILE" ] && jq -r '.fase // "nessuno"' "$STATE_FILE" 2>/dev/null || echo "nessuno"; }

write_state() { # $1 task, $2 fase
  local now; now="$(date -Iseconds)"
  jq -n --arg t "$1" --arg f "$2" --arg d "$now" '{task:$t, fase:$f, aggiornato:$d}' > "$STATE_FILE"
  echo "$now  ${1:-—}  -> ${2}" >> "$LOG_FILE"
}

# Su Windows (Git Bash) i percorsi arrivano come C:\..., c:/... o /c/... e il file system
# non distingue le maiuscole: si portano tutti alla forma C:/... e si confrontano senza maiuscole.
case "$OSTYPE" in
  msys*|cygwin*) ON_WINDOWS=1; shopt -s nocasematch ;;
  *) ON_WINDOWS=0 ;;
esac

to_slash() {
  local p="$1"
  if [ "$ON_WINDOWS" = 1 ]; then
    p="${p//\\//}"
    case "$p" in /[a-z]/*) p="${p:1:1}:${p:2}" ;; esac
  fi
  printf '%s' "$p"
}
PROJECT_DIR_SLASH="$(to_slash "$PROJECT_DIR")"

# Percorso relativo alla radice del progetto
rel_path() {
  local p; p="$(to_slash "$1")"
  case "$p" in
    "$PROJECT_DIR_SLASH"/*) echo "${p:${#PROJECT_DIR_SLASH}+1}" ;;
    /*|[a-z]:/*) echo "$p" ;;
    *) echo "${p#./}" ;;
  esac
}

is_test_file() {
  case "$1" in
    tests/*|*.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|infra/scripts/check-*|scripts/check-*|infra/check-*) return 0 ;;
  esac
  return 1
}

is_test_tooling_file() { # file necessari per far girare i test, modificabili anche in fase test
  case "$1" in
    package.json|pnpm-lock.yaml|tsconfig*.json|vitest.config.*|vitest.*.config.*|playwright.config.*|.github/workflows/*) return 0 ;;
  esac
  return 1
}

is_free_file() { # file modificabili in ogni fase
  case "$1" in
    specs/*|docs/*) return 0 ;;
  esac
  return 1
}

is_secret_file() {
  case "$1" in
    *..*) ;;                                     # con ".." l'eccezione qui sotto non vale
    env.example/*|*/env.example/*) return 1 ;;  # file di ambiente fittizi (infra/env.example/, FON-T06)
  esac
  local base; base="$(basename "$1")"
  case "$base" in
    *.example|*.example.*) return 1 ;;
    .env|.env.*|*.env) return 0 ;;
  esac
  case "$1" in
    */env/*.env|/srv/app/env/*) return 0 ;;
  esac
  return 1
}
