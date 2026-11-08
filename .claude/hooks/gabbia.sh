#!/usr/bin/env bash
# I comandi del progetto che usano il database, il server di sviluppo o il browser non funzionano nella sandbox
# di Claude Code: lì localhost è privato, e PostgreSQL non c'è. Girano fuori dalla sandbox, ma dentro la gabbia
# di common.sh: rete e progetto liberi; file del metodo, .git, registro e resto del computer in sola lettura;
# niente chiavi SSH, credenziali di GitHub, Docker e portachiavi.
# Uso, dalla cartella del progetto, da solo nella riga (è un comando escluso dalla sandbox, settings.json):
#   bash .claude/hooks/gabbia.sh test|test:int|test:e2e|dev|worker|db:migrate|cli [argomenti]
#   (test: i test unitari, quando hanno bisogno di un file di ambiente, che la sandbox non lascia leggere)
#   bash .claude/hooks/gabbia.sh --prova      (AVVIO.md, passo 6: controlla che la gabbia tenga)
CLAUDE_PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
export CLAUDE_PROJECT_DIR
source "$(dirname "$0")/common.sh" || exit 1

prova_gabbia() {
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
    if [ -n "$(ls -A "$HOME/.ssh" 2>/dev/null)" ]; then echo "ERRORE: nella gabbia si vedono le chiavi SSH"; esito=1; else echo "ok: nella gabbia non ci sono le chiavi SSH"; fi
    if [ -n "$(ls -A "$HOME/.config/gh" 2>/dev/null)" ]; then echo "ERRORE: nella gabbia si vedono le credenziali di GitHub"; esito=1; else echo "ok: nella gabbia non ci sono le credenziali di GitHub"; fi
    exit $esito
  ' prova "$PROJECT_DIR" "$STATE_DIR"
}

case "${1:-}" in
  test|test:int|test:e2e|dev|worker|db:migrate|cli) cd "$PROJECT_DIR" || exit 1; gabbia pnpm "$@"; exit $? ;;
  --prova) mkdir -p "$STATE_DIR"; prova_gabbia; exit $? ;;
  *) echo "Uso: bash .claude/hooks/gabbia.sh test|test:int|test:e2e|dev|worker|db:migrate|cli [argomenti], oppure --prova" >&2; exit 64 ;;
esac
