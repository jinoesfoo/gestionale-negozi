#!/usr/bin/env bash
# SessionStart: ricorda a Claude la postazione e la fase corrente all'apertura della sessione.
source "$(dirname "$0")/common.sh"
cat >/dev/null
task="$(current_task)"; fase="$(current_phase)"; me="$(postazione)"
if git_cambiata; then
  alterati=".git (la cartella del repository non è quella registrata con imposta-postazione.sh) "
else
  alterati="$(metodo_modificato | tr '\n' ' ')"
  registro_alterato && alterati="$alterati$LOG_REL "
fi
[ -n "${alterati// /}" ] && echo "[Metodo] Attenzione: i file del metodo non sono quelli del commit corrente: $alterati. Dillo subito all'utente: finché non tornano a posto, nessuna fase può cambiare."
if [ -z "$me" ]; then
  echo "[Metodo] Questa postazione non ha un nome: finché l'utente non esegue 'bash .claude/hooks/imposta-postazione.sh yoo' (oppure joo) nel suo terminale, INIZIA viene rifiutato."
elif [ -n "$task" ] && [ "$fase" != "nessuno" ]; then
  echo "[Metodo] Postazione $me. Compito aperto: $task, fase: $fase. Leggi CLAUDE.md sezioni 1 e 6 e riprendi da questa fase."
else
  echo "[Metodo] Postazione $me. Nessun compito aperto. Proponi il prossimo con /stato; l'utente lo apre con INIZIA <ID>."
fi
# pnpm 12 prende il blocco dello store in /run/user/<uid>: la cartella deve esistere prima dei comandi nella sandbox
mkdir -p "/run/user/$(id -u)/pnpm-store-operation-locks-$(id -u)" 2>/dev/null && chmod 700 "/run/user/$(id -u)/pnpm-store-operation-locks-$(id -u)" 2>/dev/null || true
exit 0
