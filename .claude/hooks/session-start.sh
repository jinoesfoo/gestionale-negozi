#!/usr/bin/env bash
# SessionStart: ricorda a Claude la postazione e la fase corrente all'apertura della sessione.
source "$(dirname "$0")/common.sh"
cat >/dev/null
task="$(current_task)"; fase="$(current_phase)"; me="$(postazione)"
if [ -z "$me" ]; then
  echo "[Metodo] Questa postazione non ha un nome: finché l'utente non esegue 'bash .claude/hooks/imposta-postazione.sh yoo' (oppure joo), INIZIA viene rifiutato."
elif [ -n "$task" ] && [ "$fase" != "nessuno" ]; then
  echo "[Metodo] Postazione $me. Compito aperto: $task, fase: $fase. Leggi CLAUDE.md sezioni 1 e 6 e riprendi da questa fase."
else
  echo "[Metodo] Postazione $me. Nessun compito aperto. Proponi il prossimo con /stato; l'utente lo apre con INIZIA <ID>."
fi
exit 0
