#!/usr/bin/env bash
# Da eseguire a mano, nel proprio terminale (non da Claude), una volta sola per computer:
#   bash .claude/hooks/imposta-postazione.sh yoo     (oppure joo)
# Scrive il nome nella cartella di stato degli hook, fuori dal progetto (~/.local/state/gestionale-negozi/...):
# da lì gli hook sanno quali compiti spettano a questo computer, e i comandi di Claude, nella sandbox, non possono cambiarlo.
CLAUDE_PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
export CLAUDE_PROJECT_DIR
source "$(dirname "$0")/common.sh" || exit 1
# Su Windows gli hook ricevono il percorso nella forma C:\...: la cartella di stato deve essere la stessa
if [ "$ON_WINDOWS" = 1 ] && command -v cygpath >/dev/null 2>&1; then
  CLAUDE_PROJECT_DIR="$(cygpath -w "$CLAUDE_PROJECT_DIR")"; source "$(dirname "$0")/common.sh" || exit 1
fi
nome="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
case "$nome" in
  yoo|joo) ;;
  *) echo "Uso: bash .claude/hooks/imposta-postazione.sh yoo|joo" >&2; exit 1 ;;
esac
attuale="$(postazione)"
if [ -n "$attuale" ] && [ "$attuale" != "$nome" ]; then
  echo "Questa cartella è già la postazione $attuale. Per cambiarla cancella prima, a mano, il file $POSTAZIONE_FILE." >&2
  exit 1
fi
mkdir -p "$STATE_DIR" && printf '%s\n' "$nome" > "$POSTAZIONE_FILE" || exit 1
echo "Postazione impostata: $nome (in $POSTAZIONE_FILE)"
