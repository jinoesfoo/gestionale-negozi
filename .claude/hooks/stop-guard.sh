#!/usr/bin/env bash
# Stop: in fase codice, revisione e chiusura Claude non può chiudere la risposta con controlli rossi.
# I controlli eseguono il codice del progetto e i test, scritti da Claude: girano nella gabbia (common.sh),
# non con i permessi pieni degli hook.
# HOOK_STOP: un errore d'installazione qui lascia passare (un blocco dello Stop non si supererebbe mai);
# gli altri hook fermano già tutto.
HOOK_STOP=1
source "$(dirname "$0")/common.sh"

input="$(cat)"
# Evita un ciclo infinito: se Claude sta già rispondendo a un blocco precedente, lascia passare
[ "$(echo "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

fase="$(current_phase)"
case "$fase" in codice|revisione|chiusura) ;; *) exit 0 ;; esac

cd "$PROJECT_DIR" || exit 0
[ -f package.json ] || exit 0
command -v pnpm >/dev/null 2>&1 || { echo "pnpm non trovato: impossibile verificare i controlli." >&2; exit 2; }

out="$(mktemp)"
fail=""
prima="$(impronta_gabbia)"
for step in lint typecheck test; do
  if jq -e --arg s "$step" '.scripts[$s]' package.json >/dev/null 2>&1; then
    gabbia pnpm -s "$step" >"$out" 2>&1; rc=$?
    if ! msg="$(controllo_dopo_gabbia "$prima")"; then echo "$msg" >&2; rm -f "$out"; exit 2; fi
    if [ "$rc" = 125 ]; then
      echo "I controlli non si possono eseguire: $(tail -n 1 "$out"). Dillo all'utente." >&2
      rm -f "$out"; exit 2
    fi
    if [ "$rc" != 0 ]; then fail="$step"; break; fi
  fi
done

if [ -n "$fail" ]; then
  {
    echo "Controllo '$fail' fallito in fase $fase di $(current_task). Non concludere la risposta: correggi il codice (non i test) e rilancia i controlli."
    echo "--- ultime righe ---"
    tail -n 40 "$out"
  } >&2
  rm -f "$out"
  exit 2
fi
rm -f "$out"
exit 0
