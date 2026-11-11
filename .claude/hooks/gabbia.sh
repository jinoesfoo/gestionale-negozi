#!/usr/bin/env bash
# I comandi del progetto che usano il database, il server di sviluppo o il browser non funzionano nella sandbox
# di Claude Code: lì localhost è privato, e PostgreSQL non c'è. Girano fuori dalla sandbox, ma dentro la gabbia
# di common.sh: rete e progetto liberi; file del metodo, .git, registro e resto del computer in sola lettura;
# niente credenziali di questo computer (chiavi SSH e GPG, accessi di Docker, GitHub e della Stripe CLI, portachiavi e password di pass, profili dei browser e della posta, file di credenziali di git, curl e PostgreSQL, accesso di Claude Code,
# e ~/.config/gh), niente agenti SSH e GPG, e solo i suoi processi.
# Uso, dalla cartella del progetto, da solo nella riga (è un comando escluso dalla sandbox, settings.json):
#   bash .claude/hooks/gabbia.sh test|test:int|test:e2e|dev|worker|db:migrate|cli [argomenti]
#   (test: i test unitari, quando hanno bisogno di un file di ambiente, che la sandbox non lascia leggere)
#   bash .claude/hooks/gabbia.sh --prova      (AVVIO.md, passo 6: controlla che la gabbia tenga)
CLAUDE_PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
export CLAUDE_PROJECT_DIR
source "$(dirname "$0")/common.sh" || exit 1

prova_gabbia() {
  local ns; ns="$(readlink /proc/self/ns/pid 2>/dev/null)"   # lo spazio dei PID del computer: nella gabbia dev'essere un altro
  gabbia bash -c '
    esito=0
    prova() { # $1 si|no, $2 percorso: si aggiunge niente in fondo, e un file nuovo si toglie subito
      local nuovo=0; [ -e "$2" ] || nuovo=1
      if ( : >> "$2" ) 2>/dev/null; then
        [ "$nuovo" = 1 ] && rm -f "$2"
        if [ "$1" = si ]; then echo "ok: nella gabbia si scrive in $2"; else echo "ERRORE: la gabbia lascia scrivere in $2"; esito=1; fi
      else
        if [ "$1" = no ]; then echo "ok: nella gabbia non si scrive in $2"; else echo "ERRORE: nella gabbia non si scrive in $2"; esito=1; fi
      fi
    }
    prova si "$1/.prova-gabbia"
    prova no "$1/.claude/.prova-gabbia"
    prova no "$1/CLAUDE.md"
    prova no "$1/.git/.prova-gabbia"
    prova no "$HOME/.prova-gabbia"
    prova no "$2/.prova-gabbia"
    if mv "$1/docs" "$1/.prova-docs" 2>/dev/null; then mv "$1/.prova-docs" "$1/docs"; echo "ERRORE: la gabbia lascia rinominare docs"; esito=1; else echo "ok: nella gabbia docs non si rinomina"; fi
    ns_fuori="$3"; shift 3; v=""   # le credenziali di questo computer (CRED_LOCALI di common.sh): cartelle vuote e file vuoti
    for c in "$@"; do p="$HOME/$c"; if [ -d "$p" ]; then [ -n "$(ls -A "$p" 2>/dev/null)" ] && v="$v ~/$c"; elif [ -s "$p" ]; then v="$v ~/$c"; fi; done
    if [ -n "$v" ]; then echo "ERRORE: nella gabbia si vedono$v"; esito=1; else echo "ok: nella gabbia non si vedono le credenziali di questo computer ($# voci: chiavi SSH e GPG, accessi di Docker, GitHub e della Stripe CLI, portachiavi e password di pass, profili dei browser e della posta, file di credenziali di git, curl e PostgreSQL, accesso di Claude Code)"; fi
    if [ -n "${SSH_AUTH_SOCK:-}" ] || { [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -n "$(ls -A "$XDG_RUNTIME_DIR" 2>/dev/null)" ]; }; then echo "ERRORE: nella gabbia si raggiungono gli agenti SSH e GPG"; esito=1; else echo "ok: nella gabbia non si raggiungono gli agenti SSH e GPG"; fi
    if [ -S /run/docker.sock ] || [ -S /var/run/docker.sock ]; then echo "ERRORE: nella gabbia si raggiunge il socket di Docker"; esito=1; else echo "ok: nella gabbia non si raggiunge il socket di Docker"; fi
    if [ -z "$ns_fuori" ] || [ "$(readlink /proc/self/ns/pid 2>/dev/null)" = "$ns_fuori" ]; then echo "ERRORE: nella gabbia si vedono i processi del computer (lo spazio dei PID è lo stesso)"; esito=1; else echo "ok: nella gabbia si vedono solo i suoi processi"; fi
    exit $esito
  ' prova "$PROJECT_DIR" "$STATE_DIR" "$ns" "${CRED_LOCALI[@]}"
}

case "${1:-}" in
  test|test:int|test:e2e|dev|worker|db:migrate|cli)
    cd "$PROJECT_DIR" || exit 1; prima="$(impronta_gabbia)"; gabbia pnpm "$@"; rc=$?
    controllo_dopo_gabbia "$prima" >&2 || exit 2   # il codice non deve aver toccato i file del metodo né .vscode/.idea
    exit $rc ;;
  --prova) mkdir -p "$STATE_DIR"; prova_gabbia; exit $? ;;
  *) echo "Uso: bash .claude/hooks/gabbia.sh test|test:int|test:e2e|dev|worker|db:migrate|cli [argomenti], oppure --prova" >&2; exit 64 ;;
esac
