#!/usr/bin/env bash
# Funzioni comuni agli hook del metodo di lavoro.
# Richiede: jq (sudo apt install jq) e, su Linux, bubblewrap (la gabbia, vedi sotto)

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HOOKS_DIR="$(dirname "${BASH_SOURCE[0]}")"
CORSIE_FILE="$HOOKS_DIR/corsie.txt"      # quale postazione fa ogni compito, e in che ordine

# Un errore di installazione ferma l'azione. Lo Stop (HOOK_STOP=1) invece lascia passare: un blocco
# lì non si potrebbe mai superare, e gli altri hook fermano già tutto.
fatale() { echo "Hook del metodo: $*" >&2; [ -n "${HOOK_STOP:-}" ] && exit 0; exit 2; }

command -v jq >/dev/null 2>&1 || fatale "manca 'jq'. Installalo con: sudo apt install jq (Windows: winget install jqlang.jq, poi riavvia VS Code)"

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
# GESTIONALE_STATO_DIR serve al collaudo degli hook: non deve portare lo stato dove la sandbox scrive
case "$STATE_ROOT_SLASH/" in
  "$PROJECT_DIR_SLASH"/*|"$HOME_SLASH"/.cache/*|"$HOME_SLASH"/.local/share/pnpm/*|"$HOME_SLASH"/.local/state/pnpm/*|/tmp/*)
    fatale "la cartella di stato ($STATE_ROOT) sta dove i comandi di Claude possono scrivere: togli la variabile GESTIONALE_STATO_DIR." ;;
esac
_ID_PROGETTO="$PROJECT_DIR_SLASH"; [ "$ON_WINDOWS" = 1 ] && _ID_PROGETTO="${_ID_PROGETTO,,}"
STATE_DIR="$STATE_ROOT/$(printf '%s' "$_ID_PROGETTO" | sha1sum | cut -c1-16)"
STATE_FILE="$STATE_DIR/compito-corrente.json"
POSTAZIONE_FILE="$STATE_DIR/postazione"     # yoo o joo, scritto dall'utente con imposta-postazione.sh
LOG_COPY="$STATE_DIR/registro.log"          # copia del registro, per accorgersi se quello nel progetto cambia
GITDIR_FILE="$STATE_DIR/cartella-git"       # impronta della cartella .git, scritta da imposta-postazione.sh

postazione() { [ -f "$POSTAZIONE_FILE" ] && tr -d '[:space:]' < "$POSTAZIONE_FILE" | tr '[:upper:]' '[:lower:]'; }
# Un registro per postazione: due computer che scrivono lo stesso file andrebbero in conflitto a ogni unione.
# Sta in registro/, fuori da .claude/: così git, che gira nella sandbox, può unire quello dell'altra postazione.
_POSTAZIONE="$(postazione)"
LOG_REL="registro/compiti${_POSTAZIONE:+-$_POSTAZIONE}.log"
LOG_FILE="$PROJECT_DIR/$LOG_REL"

current_task() { [ -f "$STATE_FILE" ] && jq -r '.task // ""' "$STATE_FILE" 2>/dev/null || echo ""; }
current_phase() { [ -f "$STATE_FILE" ] && jq -r '.fase // "nessuno"' "$STATE_FILE" 2>/dev/null || echo "nessuno"; }

write_state() { # $1 task, $2 fase, $3 voce del registro (facoltativa, altrimenti la fase)
  local now riga; now="$(date -Iseconds)"
  mkdir -p "$STATE_DIR" "$PROJECT_DIR/registro"
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
    docs/verifiche/[A-Za-z][A-Za-z][A-Za-z]-[Tt][0-9][0-9]*-esito.md) return 1 ;;   # l'esito si annota in ogni fase
    tests|tests/*|*.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|infra/scripts/check-*|scripts/check-*|infra/check-*) return 0 ;;
    docs/verifiche/[A-Za-z][A-Za-z][A-Za-z]-[Tt][0-9][0-9]*.md) return 0 ;;          # la lista di controllo di un compito senza test automatici
  esac
  return 1
}

# Configurazione dei controlli: decide quali test girano e come. Si scrive in fase test, poi resta ferma come i test.
# Degli script di package.json contano solo quelli dei controlli (impronta_qui, "package.json#scripts").
is_check_config() {
  case "$1" in
    tsconfig*.json|vitest.config.*|vitest.*.config.*|vitest.workspace.*|vite.config.*|playwright.config.*|eslint.config.*|.eslintrc*|.npmrc|.github/workflows/ci.yml) return 0 ;;
  esac
  return 1
}

is_test_tooling_file() { # modificabili in fase test, oltre ai test
  is_check_config "$1" && return 0
  case "$1" in
    package.json|pnpm-lock.yaml|.github/workflows/*) return 0 ;;
  esac
  return 1
}

is_free_file() { # file modificabili in ogni fase (tranne le liste di controllo, che sono test, e i file del metodo)
  case "$1" in
    specs|specs/*|docs|docs/*) return 0 ;;
  esac
  return 1
}

# File del metodo: li cambia solo l'utente, nel suo terminale, con un commit. Lo stesso elenco sta nei divieti
# di .claude/settings.json (denyWrite della sandbox). Come pathspec di git, "*" attraversa anche le "/".
METODO_PATHSPEC=('*.claude/*' '*CLAUDE.md' '*CLAUDE.local.md' .mcp.json AVVIO.md docs/metodo.md docs/due-postazioni.md)
# $1 è il percorso relativo (o assoluto, se fuori dal progetto).
protetto() {
  case "$1" in
    /*|[a-zA-Z]:/*)   # fuori dal progetto: impostazioni e istruzioni di Claude Code (non la memoria), la cartella di stato
      case "$1" in
        */.claude/settings*.json|*/.claude/hooks|*/.claude/hooks/*|*/.claude/skills|*/.claude/skills/*|\
        */.claude/agents|*/.claude/agents/*|*/.claude/commands|*/.claude/commands/*|*/.claude/rules|*/.claude/rules/*|\
        */.claude/plugins|*/.claude/plugins/*|*/.claude.json|*/CLAUDE.md|*/CLAUDE.local.md) return 0 ;;
        "$STATE_ROOT_SLASH"|"$STATE_ROOT_SLASH"/*) return 0 ;;
      esac
      return 1 ;;
  esac
  case "$1" in      # nel progetto
    .claude|.claude/*|*/.claude|*/.claude/*|.mcp.json|.gitmodules) return 0 ;;
    CLAUDE.md|*/CLAUDE.md|CLAUDE.local.md|*/CLAUDE.local.md|AVVIO.md|docs/metodo.md|docs/due-postazioni.md) return 0 ;;
    registro|registro/*|.git|.git/*|.vscode|.vscode/*) return 0 ;;   # il registro e il repository li scrivono gli hook e git
  esac
  return 1
}
# Un percorso che CONTIENE i file del metodo (la radice del progetto, docs/, la casa, /): spostarlo o cancellarlo li colpisce
antenato_protetto() { # $1 percorso canonico assoluto
  local a="${1%/}" r
  [ -z "$a" ] && a="/"
  [ "$a" = "/" ] && return 0
  for r in "$PROJECT_DIR_SLASH/.claude" "$PROJECT_DIR_SLASH/CLAUDE.md" "$PROJECT_DIR_SLASH/.git" "$PROJECT_DIR_SLASH/registro" \
           "$PROJECT_DIR_SLASH/docs/metodo.md" "$STATE_ROOT_SLASH" "$HOME_SLASH/.claude"; do
    [[ "$r" == "$a"/* ]] && return 0
  done
  return 1
}

is_secret_file() {
  case "$1" in
    *..*) ;;                                     # con ".." le eccezioni qui sotto non valgono
    env.example/*|*/env.example/*) return 1 ;;  # file di ambiente fittizi (infra/env.example/, FON-T06)
    /srv/app/.env) return 1 ;;                   # sul server contiene solo i tag delle immagini (01 §CI/CD)
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

# La cartella .git deve restare quella di quando l'utente ha dato il nome alla postazione: una cartella
# sostituita porterebbe una configurazione di git nuova, che git (anche negli hook) eseguirebbe.
impronta_git() {
  [ -d "$PROJECT_DIR/.git" ] && [ ! -L "$PROJECT_DIR/.git" ] && [ ! -e "$PROJECT_DIR/.git/commondir" ] && \
    stat -c '%d:%i' "$PROJECT_DIR/.git" 2>/dev/null
}
git_cambiata() { [ -f "$GITDIR_FILE" ] && [ "$(impronta_git)" != "$(cat "$GITDIR_FILE" 2>/dev/null)" ]; }

# File del metodo diversi dal commit corrente, o nuovi e non tracciati
metodo_modificato() {
  (cd "$PROJECT_DIR" 2>/dev/null && git rev-parse -q --verify HEAD >/dev/null 2>&1 && {
    git diff --no-ext-diff --name-only HEAD -- "${METODO_PATHSPEC[@]}" 2>/dev/null
    git ls-files --others --exclude-standard -- "${METODO_PATHSPEC[@]}" 2>/dev/null
  } | sort -u)
  # nelle impostazioni locali Claude Code salva da sé le approvazioni (permissions: allow, deny, ask); ogni altra chiave
  # potrebbe spegnere il metodo (hook, sandbox, cartelle in più, server MCP, plugin, comandi da eseguire)
  if [ -f "$PROJECT_DIR/.claude/settings.local.json" ] && ! jq -e '
       ((keys - ["permissions", "$schema"]) | length == 0)
       and (((.permissions // {}) | keys - ["allow", "deny", "ask"]) | length == 0)' \
       "$PROJECT_DIR/.claude/settings.local.json" >/dev/null 2>&1; then
    echo ".claude/settings.local.json"
  fi
}

# Impronta (sha256) di un percorso: nella cartella di lavoro o in un commit. "assente" se manca.
# "package.json#scripts" sono i soli script dei controlli: lint, typecheck, test e varianti, con pre/post.
_sha() { sha256sum | cut -c1-64; }
_scripts_controlli() { jq -S '(.scripts // {}) | with_entries(select(.key | test("^(pre|post)?(lint|typecheck|test)(:.*)?$")))' 2>/dev/null; }
impronta_qui() { # $1 percorso relativo
  local f="${1%#scripts}"
  [ -f "$PROJECT_DIR/$f" ] || { echo assente; return; }
  if [ "$1" = "package.json#scripts" ]; then _scripts_controlli < "$PROJECT_DIR/$f" | _sha; else _sha < "$PROJECT_DIR/$f"; fi
}
impronta_in() { # $1 commit, $2 percorso relativo
  local f="${2%#scripts}"
  (cd "$PROJECT_DIR" 2>/dev/null && MSYS_NO_PATHCONV=1 git cat-file -e "$1:$f" 2>/dev/null) || { echo assente; return; }
  if [ "$2" = "package.json#scripts" ]; then (cd "$PROJECT_DIR" && MSYS_NO_PATHCONV=1 git cat-file blob "$1:$f") | _scripts_controlli | _sha
  else (cd "$PROJECT_DIR" && MSYS_NO_PATHCONV=1 git cat-file blob "$1:$f") | _sha; fi
}
uguale_a_main() { [ "$(impronta_qui "$1")" = "$(impronta_in origin/main "$1")" ]; }   # anche: assente in tutti e due

# Impronta dei test e della configurazione dei controlli: "impronta  percorso", una riga per file (tracciati e nuovi)
manifesto_test() {
  {
    (cd "$PROJECT_DIR" 2>/dev/null && { git ls-files; git ls-files --others --exclude-standard; } 2>/dev/null | sort -u | \
      while IFS= read -r f; do { is_test_file "$f" || is_check_config "$f"; } && [ -f "$f" ] && printf '%s\n' "$f"; done)
    [ -f "$PROJECT_DIR/package.json" ] && echo "package.json#scripts"
  } | while IFS= read -r f; do printf '%s  %s\n' "$(impronta_qui "$f")" "$f"; done
}
# Alla fine della fase test (APPROVO test -> codice) si salva l'impronta e la versione di main di quel momento
salva_manifesto_test() {
  mkdir -p "$STATE_DIR"
  manifesto_test > "$STATE_DIR/manifesto-test"
  git -C "$PROJECT_DIR" rev-parse -q --verify origin/main > "$STATE_DIR/manifesto-main" 2>/dev/null || : > "$STATE_DIR/manifesto-main"
}
cancella_manifesto_test() { rm -f "$STATE_DIR/manifesto-test" "$STATE_DIR/manifesto-main"; }
# Test (o configurazione dei controlli) cambiati dopo la fase test. Non conta un file che ora è identico alla
# versione di main, se main l'ha cambiato dopo l'impronta: è arrivato con l'allineamento, non da questo compito.
test_cambiati() {
  [ -f "$STATE_DIR/manifesto-test" ] || return 0
  local base f m; base="$(cat "$STATE_DIR/manifesto-main" 2>/dev/null)"
  diff <(cat "$STATE_DIR/manifesto-test") <(manifesto_test) | sed -n -E 's/^[<>] [0-9a-z]+  //p' | sort -u | \
  while IFS= read -r f; do
    if [ -n "$base" ]; then
      m="$(impronta_in origin/main "$f")"
      [ "$(impronta_in "$base" "$f")" != "$m" ] && [ "$(impronta_qui "$f")" = "$m" ] && continue
    fi
    echo "$f"
  done
}
# Il registro nel progetto deve essere uguale alla copia tenuta dagli hook
registro_alterato() { [ -f "$LOG_COPY" ] && [ -f "$LOG_FILE" ] && ! cmp -s "$LOG_FILE" "$LOG_COPY"; }

# --- La gabbia ------------------------------------------------------------------------------------------
# Il codice del progetto che gira fuori dalla sandbox di Claude Code (i controlli dello Stop e, con gabbia.sh,
# test di integrazione, end-to-end, server di sviluppo, worker, migrazioni, CLI) gira in una gabbia di bubblewrap:
# rete e progetto liberi, ma file del metodo, .git e registro in sola lettura, il resto del computer in sola lettura,
# senza chiavi SSH, credenziali di GitHub, Docker e portachiavi. Uscita 125: la gabbia non parte.
gabbia() {
  command -v bwrap >/dev/null 2>&1 || { echo "manca bubblewrap (bwrap): sudo apt install bubblewrap (AVVIO.md, passo 1)" >&2; return 125; }
  local p; local -a a=(--ro-bind / / --dev-bind /dev /dev --proc /proc --tmpfs /tmp --bind "$PROJECT_DIR" "$PROJECT_DIR")
  for p in .claude .git registro CLAUDE.md CLAUDE.local.md .mcp.json .vscode .gitmodules AVVIO.md docs/metodo.md docs/due-postazioni.md; do
    [ -e "$PROJECT_DIR/$p" ] && a+=(--ro-bind "$PROJECT_DIR/$p" "$PROJECT_DIR/$p")
  done
  for p in "$HOME/.cache/pnpm" "$HOME/.local/state/pnpm"; do [ -d "$p" ] && a+=(--bind "$p" "$p"); done
  for p in "$HOME/.ssh" "$HOME/.config/gh" "$HOME/.docker" "$HOME/.config/stripe" "$HOME/.gnupg" "$HOME/.local/share/keyrings" "${XDG_RUNTIME_DIR:-}"; do
    [ -n "$p" ] && [ -d "$p" ] && a+=(--tmpfs "$p")
  done
  for p in /run/docker.sock /var/run/docker.sock; do [ -S "$p" ] && a+=(--ro-bind /dev/null "$p"); done
  bwrap "${a[@]}" --new-session --die-with-parent --unsetenv SSH_AUTH_SOCK --unsetenv DOCKER_HOST \
    --unsetenv GH_TOKEN --unsetenv GITHUB_TOKEN --setenv NEXT_TELEMETRY_DISABLED 1 --chdir "$PROJECT_DIR" -- "$@"
  local rc=$?
  [ "$rc" = 1 ] && ! bwrap --ro-bind / / --dev /dev true >/dev/null 2>&1 && { echo "la gabbia (bubblewrap) non parte: su Ubuntu 24.04 serve il profilo AppArmor di AVVIO.md, passo 1" >&2; return 125; }
  return "$rc"
}
