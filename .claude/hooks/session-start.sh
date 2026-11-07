#!/usr/bin/env bash
# SessionStart: ricorda a Claude la fase corrente all'apertura della sessione.
source "$(dirname "$0")/common.sh"
cat >/dev/null
task="$(current_task)"; fase="$(current_phase)"
if [ -n "$task" ] && [ "$fase" != "nessuno" ]; then
  echo "[Metodo] Compito aperto: $task, fase: $fase. Leggi CLAUDE.md sezione 1 e riprendi da questa fase."
else
  echo "[Metodo] Nessun compito aperto. Proponi il prossimo con /stato; l'utente lo apre con INIZIA <ID>."
fi
exit 0
