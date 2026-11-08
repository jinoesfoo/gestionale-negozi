#!/usr/bin/env bash
# Da eseguire a mano, una volta sola per computer, nella cartella del progetto:
#   bash .claude/hooks/imposta-postazione.sh yoo     (oppure joo)
# Scrive .claude/postazione (fuori da git): da lì gli hook sanno quali compiti spettano a questo computer.
set -eu
cd "$(dirname "$0")/../.."
nome="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
case "$nome" in
  yoo|joo) ;;
  *) echo "Uso: bash .claude/hooks/imposta-postazione.sh yoo|joo" >&2; exit 1 ;;
esac
if [ -f .claude/postazione ] && [ "$(tr -d '[:space:]' < .claude/postazione)" != "$nome" ]; then
  echo "Questa cartella è già la postazione $(cat .claude/postazione). Per cambiarla cancella prima, a mano, il file .claude/postazione." >&2
  exit 1
fi
printf '%s\n' "$nome" > .claude/postazione
echo "Postazione impostata: $nome"
