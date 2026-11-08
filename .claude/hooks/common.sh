#!/usr/bin/env bash
# Funzioni comuni agli hook del metodo di lavoro.
# Richiede: jq (sudo apt install jq)

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HOOKS_DIR="$(dirname "${BASH_SOURCE[0]}")"
CORSIE_FILE="$HOOKS_DIR/corsie.txt"      # quale postazione fa ogni compito, e in che ordine

if ! command -v jq >/dev/null 2>&1; then
  echo "Hook del metodo: manca 'jq'. Installalo con: sudo apt install jq (Windows: winget install jqlang.jq, poi riavvia VS Code)" >&2
  exit 2
fi

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
HOME_SLASH="$(canon_path "$HOME")"

# Fase, postazione e copia del registro stanno FUORI dalla cartella del progetto: i comandi di Claude
# girano nella sandbox, che lì non può scrivere (docs/due-postazioni.md, «Protezione del metodo»).
STATE_ROOT="${GESTIONALE_STATO_DIR:-$HOME/.local/state/gestionale-negozi}"
STATE_ROOT_SLASH="$(canon_path "$STATE_ROOT")"
_ID_PROGETTO="$PROJECT_DIR_SLASH"; [ "$ON_WINDOWS" = 1 ] && _ID_PROGETTO="${_ID_PROGETTO,,}"
STATE_DIR="$STATE_ROOT/$(printf '%s' "$_ID_PROGETTO" | sha1sum | cut -c1-16)"
STATE_FILE="$STATE_DIR/compito-corrente.json"
POSTAZIONE_FILE="$STATE_DIR/postazione"     # yoo o joo, scritto dall'utente con imposta-postazione.sh
LOG_COPY="$STATE_DIR/registro.log"          # copia del registro, per accorgersi se quello nel progetto cambia

postazione() { [ -f "$POSTAZIONE_FILE" ] && tr -d '[:space:]' < "$POSTAZIONE_FILE" | tr '[:upper:]' '[:lower:]'; }
# Un registro per postazione: due computer che scrivono lo stesso file andrebbero in conflitto a ogni unione
_POSTAZIONE="$(postazione)"
LOG_FILE="$PROJECT_DIR/.claude/registro-compiti${_POSTAZIONE:+-$_POSTAZIONE}.log"

current_task() { [ -f "$STATE_FILE" ] && jq -r '.task // ""' "$STATE_FILE" 2>/dev/null || echo ""; }
current_phase() { [ -f "$STATE_FILE" ] && jq -r '.fase // "nessuno"' "$STATE_FILE" 2>/dev/null || echo "nessuno"; }

write_state() { # $1 task, $2 fase, $3 voce del registro (facoltativa, altrimenti la fase)
  local now riga; now="$(date -Iseconds)"
  mkdir -p "$STATE_DIR"
  jq -n --arg t "$1" --arg f "$2" --arg d "$now" '{task:$t, fase:$f, aggiornato:$d}' > "$STATE_FILE"
  [ -f "$LOG_COPY" ] || { [ -f "$LOG_FILE" ] && cp "$LOG_FILE" "$LOG_COPY" || : > "$LOG_COPY"; }
  riga="$now  ${LOG_TASK:-${1:-—}}  -> ${3:-$2}"
  echo "$riga" >> "$LOG_FILE"; echo "$riga" >> "$LOG_COPY"
}

# Tabella delle corsie: righe "ID|postazione|prerequisiti dell'altra postazione separati da virgole".
# L'ordine delle righe di una postazione è l'ordine in cui la postazione esegue i suoi compiti.
# Vale la tabella su origin/main, uguale per le due postazioni; la copia locale solo se main non c'è.
# (cd e MSYS_NO_PATHCONV: su Windows Git Bash storpierebbe "origin/main:percorso" credendolo un elenco di percorsi)
corsie() { (cd "$PROJECT_DIR" 2>/dev/null && MSYS_NO_PATHCONV=1 git show origin/main:.claude/hooks/corsie.txt 2>/dev/null) || cat "$CORSIE_FILE" 2>/dev/null; }
corsie_pulite() { # senza commenti (anche in coda alla riga), senza spazi, senza righe vuote
  corsie | awk '{ sub(/#.*/, ""); gsub(/[[:space:]]/, ""); if ($0 != "") print }'
}
corsie_doppie() { corsie_pulite | cut -d'|' -f1 | tr '[:lower:]' '[:upper:]' | sort | uniq -d | tr '\n' ' '; }
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
uguale_a_main() { # $1 percorso relativo: esiste su origin/main con lo stesso contenuto della cartella di lavoro
  (cd "$PROJECT_DIR" 2>/dev/null && MSYS_NO_PATHCONV=1 git cat-file -e "origin/main:$1" 2>/dev/null && git diff --quiet origin/main -- "$1" 2>/dev/null)
}

# Percorso relativo alla radice del progetto ("." per la radice stessa)
rel_path() {
  local p; p="$(canon_path "$1")"
  case "$p" in
    "$PROJECT_DIR_SLASH") echo "." ;;
    "$PROJECT_DIR_SLASH"/*) echo "${p:${#PROJECT_DIR_SLASH}+1}" ;;
    /*|[a-z]:/*) echo "$p" ;;
    *) echo "${p#./}" ;;
  esac
}

is_test_file() {
  case "$1" in
    tests|tests/*|*.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|infra/scripts/check-*|scripts/check-*|infra/check-*) return 0 ;;
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
    specs|specs/*|docs|docs/*) return 0 ;;
  esac
  return 1
}

# File del metodo: li cambia solo l'utente. $1 è il percorso relativo (o assoluto, se fuori dal progetto).
protetto() {
  case "$1" in
    .claude|.claude/*|CLAUDE.md) return 0 ;;
    */.claude/settings*.json|*/.claude/CLAUDE.md|*/.claude/hooks|*/.claude/hooks/*|*/.claude/skills|*/.claude/skills/*|*/.claude.json) return 0 ;;
    "$STATE_ROOT_SLASH"|"$STATE_ROOT_SLASH"/*) return 0 ;;
  esac
  return 1
}
# Un percorso che CONTIENE i file del metodo (la radice del progetto, la casa, /): spostarlo o cancellarlo li colpisce
antenato_protetto() { # $1 percorso canonico assoluto
  local a="${1%/}" r
  [ -z "$a" ] && a="/"
  for r in "$PROJECT_DIR_SLASH/.claude" "$PROJECT_DIR_SLASH/CLAUDE.md" "$STATE_ROOT_SLASH" "$HOME_SLASH/.claude"; do
    [ "$a" = "/" ] && return 0
    [[ "$r" == "$a"/* ]] && return 0
  done
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

# --- Controlli sul contenuto: si accorgono di una modifica qualunque sia il comando che l'ha fatta ---

# File del metodo diversi dal commit corrente, o nuovi e non tracciati
metodo_modificato() {
  (cd "$PROJECT_DIR" 2>/dev/null && git rev-parse -q --verify HEAD >/dev/null 2>&1 && {
    git diff --name-only HEAD -- .claude/hooks .claude/settings.json .claude/skills CLAUDE.md 2>/dev/null
    git ls-files --others --exclude-standard -- .claude/hooks .claude/skills 2>/dev/null
  } | sort -u)
  # nelle impostazioni locali Claude Code salva da sé le approvazioni; queste chiavi invece spegnerebbero il metodo
  if [ -f "$PROJECT_DIR/.claude/settings.local.json" ] && jq -e '
       (.disableAllHooks // false) or has("hooks") or has("sandbox") or has("env") or has("apiKeyHelper")
       or has("statusLine") or ((.permissions.defaultMode // "") != "")
       or ((.permissions.additionalDirectories // []) | length > 0)' \
       "$PROJECT_DIR/.claude/settings.local.json" >/dev/null 2>&1; then
    echo ".claude/settings.local.json"
  fi
}

# Impronta dei file di test: "hash  percorso", una riga per file (tracciati e nuovi)
manifesto_test() {
  (cd "$PROJECT_DIR" 2>/dev/null && { git ls-files; git ls-files --others --exclude-standard; } 2>/dev/null | sort -u | \
    while IFS= read -r f; do is_test_file "$f" && [ -f "$f" ] && printf '%s\n' "$f"; done | \
    while IFS= read -r f; do printf '%s  %s\n' "$(git hash-object -- "$f")" "$f"; done)
}
# Alla fine della fase test (APPROVO test -> codice) si salva l'impronta e la versione di main di quel momento
salva_manifesto_test() {
  mkdir -p "$STATE_DIR"
  manifesto_test > "$STATE_DIR/manifesto-test"
  git -C "$PROJECT_DIR" rev-parse -q --verify origin/main > "$STATE_DIR/manifesto-main" 2>/dev/null || : > "$STATE_DIR/manifesto-main"
}
cancella_manifesto_test() { rm -f "$STATE_DIR/manifesto-test" "$STATE_DIR/manifesto-main"; }
# File di test cambiati dopo la fase test. Non conta un file che ora è identico alla versione di main,
# se main l'ha cambiato dopo l'impronta: è arrivato con l'allineamento, non l'ha scritto questo compito.
test_cambiati() {
  [ -f "$STATE_DIR/manifesto-test" ] || return 0
  local base f; base="$(cat "$STATE_DIR/manifesto-main" 2>/dev/null)"
  diff <(cat "$STATE_DIR/manifesto-test") <(manifesto_test) | sed -n -E 's/^[<>] [0-9a-f]+  //p' | sort -u | \
  while IFS= read -r f; do
    if [ -n "$base" ] && (cd "$PROJECT_DIR" && ! MSYS_NO_PATHCONV=1 git diff --quiet "$base" origin/main -- "$f" 2>/dev/null); then
      if [ -e "$PROJECT_DIR/$f" ]; then uguale_a_main "$f" && continue
      else (cd "$PROJECT_DIR" && ! MSYS_NO_PATHCONV=1 git cat-file -e "origin/main:$f" 2>/dev/null) && continue; fi
    fi
    echo "$f"
  done
}
# Il registro nel progetto deve essere uguale alla copia tenuta dagli hook
registro_alterato() { [ -f "$LOG_COPY" ] && [ -f "$LOG_FILE" ] && ! cmp -s "$LOG_FILE" "$LOG_COPY"; }
