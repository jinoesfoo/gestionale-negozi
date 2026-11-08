#!/usr/bin/env bash
# Funzioni comuni agli hook del metodo di lavoro.
# Richiede: jq (sudo apt install jq)

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATE_FILE="$PROJECT_DIR/.claude/compito-corrente.json"
POSTAZIONE_FILE="$PROJECT_DIR/.claude/postazione"           # yoo o joo, scritto dall'utente con imposta-postazione.sh
CORSIE_FILE="$(dirname "${BASH_SOURCE[0]}")/corsie.txt"      # quale postazione fa ogni compito, e in che ordine

if ! command -v jq >/dev/null 2>&1; then
  echo "Hook del metodo: manca 'jq'. Installalo con: sudo apt install jq (Windows: winget install jqlang.jq, poi riavvia VS Code)" >&2
  exit 2
fi

postazione() { [ -f "$POSTAZIONE_FILE" ] && tr -d '[:space:]' < "$POSTAZIONE_FILE" | tr '[:upper:]' '[:lower:]'; }
# Un registro per postazione: due computer che scrivono lo stesso file andrebbero in conflitto a ogni unione
_POSTAZIONE="$(postazione)"
LOG_FILE="$PROJECT_DIR/.claude/registro-compiti${_POSTAZIONE:+-$_POSTAZIONE}.log"

current_task() { [ -f "$STATE_FILE" ] && jq -r '.task // ""' "$STATE_FILE" 2>/dev/null || echo ""; }
current_phase() { [ -f "$STATE_FILE" ] && jq -r '.fase // "nessuno"' "$STATE_FILE" 2>/dev/null || echo "nessuno"; }

write_state() { # $1 task, $2 fase, $3 voce del registro (facoltativa, altrimenti la fase)
  local now; now="$(date -Iseconds)"
  jq -n --arg t "$1" --arg f "$2" --arg d "$now" '{task:$t, fase:$f, aggiornato:$d}' > "$STATE_FILE"
  echo "$now  ${LOG_TASK:-${1:-—}}  -> ${3:-$2}" >> "$LOG_FILE"
}

# Tabella delle corsie: righe "ID|postazione|prerequisiti dell'altra postazione separati da virgole".
# L'ordine delle righe di una postazione è l'ordine in cui la postazione esegue i suoi compiti.
# Vale la tabella su origin/main, uguale per le due postazioni; la copia locale solo se main non c'è.
# (cd e MSYS_NO_PATHCONV: su Windows Git Bash storpierebbe "origin/main:percorso" credendolo un elenco di percorsi)
corsie() { (cd "$PROJECT_DIR" 2>/dev/null && MSYS_NO_PATHCONV=1 git show origin/main:.claude/hooks/corsie.txt 2>/dev/null) || cat "$CORSIE_FILE" 2>/dev/null; }
corsie_pulite() { # senza commenti (anche in coda alla riga), senza spazi, senza righe vuote
  corsie | awk '{ sub(/#.*/, ""); gsub(/[[:space:]]/, ""); if ($0 != "") print }'
}
corsia_riga() { # $1 ID senza distinguere maiuscole -> prima riga della tabella con quell'ID
  corsie_pulite | awk -F'|' -v id="$1" 'BEGIN { id = toupper(id) } toupper($1) == id { print; exit }'
}
corsia_di() { corsia_riga "$1" | cut -d'|' -f2; }
compiti_prima() { # $1 ID -> compiti della stessa postazione che lo precedono
  corsie_pulite | awk -F'|' -v id="$1" 'BEGIN { id = toupper(id) }
    { lane[NR] = $2; ids[NR] = $1; if (toupper($1) == id && !me) { me = NR } }
    END { if (me) for (i = 1; i < me; i++) if (lane[i] == lane[me]) print ids[i] }'
}
aggiorna_main() { GIT_TERMINAL_PROMPT=0 timeout 30 git -C "$PROJECT_DIR" fetch -q origin main >/dev/null 2>&1; }
ha_origin_main() { git -C "$PROJECT_DIR" rev-parse -q --verify origin/main >/dev/null 2>&1; }
sul_main() { # $1 ID -> vero se la sua casella è spuntata nelle specifiche di origin/main (pull request unita)
  git -C "$PROJECT_DIR" grep -q -i -F -e "- [x] **$1**" origin/main -- specs >/dev/null 2>&1
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

# Risolve ".", ".." e le barre doppie senza toccare il disco: "specs/../.claude/postazione"
# non deve sembrare un file di specs/. Un ".." che resta (percorso relativo) lo blocca file-guard.
norm_path() {
  local p="$1" lead="" seg parts out=()
  case "$p" in
    [a-zA-Z]:/*) lead="${p:0:3}"; p="${p:3}" ;;
    /*) lead="/" ;;
  esac
  IFS=/ read -ra parts <<< "$p"
  for seg in "${parts[@]}"; do
    case "$seg" in
      ''|.) ;;
      ..) if [ "${#out[@]}" -gt 0 ] && [ "${out[-1]}" != ".." ]; then out=("${out[@]:0:${#out[@]}-1}")
          elif [ -z "$lead" ]; then out+=(".."); fi ;;
      *) out+=("$seg") ;;
    esac
  done
  local IFS=/; printf '%s%s' "$lead" "${out[*]}"
}
# Forma canonica: su Linux realpath -m risolve anche i collegamenti simbolici (docs/src -> ../src)
canon_path() {
  local p; p="$(to_slash "$1")"
  if [ "$ON_WINDOWS" = 0 ] && command -v realpath >/dev/null 2>&1; then
    realpath -m -- "$p" 2>/dev/null || norm_path "$p"
  else
    norm_path "$p"
  fi
}
PROJECT_DIR_SLASH="$(canon_path "$PROJECT_DIR")"

# Percorso relativo alla radice del progetto
rel_path() {
  local p; p="$(canon_path "$1")"
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
