#!/usr/bin/env bash
# UserPromptSubmit: le parole chiave dell'utente cambiano la fase del compito.
# Solo l'utente può far avanzare le fasi: Claude non può scrivere il file di stato.
source "$(dirname "$0")/common.sh"

input="$(cat)"
prompt="$(echo "$input" | jq -r '.prompt // ""')"
first_line="$(echo "$prompt" | head -n1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
upper="$(echo "$first_line" | tr '[:lower:]' '[:upper:]')"

task="$(current_task)"
fase="$(current_phase)"

say() { echo "[Metodo] $*"; }   # su UserPromptSubmit l'output finisce nel contesto di Claude

case "$upper" in
  INIZIA\ *)
    new_task="$(echo "$upper" | awk '{print $2}')"
    if ! echo "$new_task" | grep -Eq '^[A-Z]{3}-T[0-9]{2}[AB]?$'; then
      say "ID del compito non valido: '$new_task'. Esempio: INIZIA FON-T01."
      exit 0
    fi
    if [ -n "$task" ] && [ "$fase" != "nessuno" ]; then
      say "C'è già un compito aperto ($task, fase $fase). Chiudilo con CHIUSO o abbandonalo con ABBANDONA prima di iniziarne un altro."
      exit 0
    fi
    write_state "$new_task" "piano"
    say "Compito $new_task iniziato. Fase: piano. Leggi costituzione e area del compito, scrivi il piano e fermati per l'approvazione."
    ;;
  APPROVO)
    case "$fase" in
      piano)     write_state "$task" "test";      say "Piano approvato. Fase: test. Scrivi i test dai criteri di accettazione e mostra che falliscono." ;;
      test)      write_state "$task" "codice";    say "Test approvati. Fase: codice. Scrivi il codice finché lint, typecheck e test sono verdi. I test non si modificano." ;;
      codice)    write_state "$task" "revisione"; say "Codice approvato. Fase: revisione. Esegui /revisione." ;;
      revisione) write_state "$task" "chiusura";  say "Revisione approvata. Fase: chiusura. Esegui /chiudi-compito." ;;
      chiusura)  say "In fase chiusura si conclude con CHIUSO, dopo che la pull request è aperta." ;;
      *)         say "Nessun compito aperto: non c'è nulla da approvare. Usa INIZIA <ID>." ;;
    esac
    ;;
  "TORNA AI TEST")
    if [ "$fase" = "codice" ] || [ "$fase" = "revisione" ]; then
      write_state "$task" "test"; say "Ritorno alla fase test per $task: si possono modificare i test, non il codice."
    else
      say "TORNA AI TEST vale solo nelle fasi codice e revisione (fase attuale: $fase)."
    fi
    ;;
  "TORNA AL PIANO")
    if [ "$fase" = "test" ] || [ "$fase" = "codice" ] || [ "$fase" = "revisione" ]; then
      write_state "$task" "piano"; say "Ritorno alla fase piano per $task: correggi la specifica e il piano, poi chiedi di nuovo APPROVO. Il lavoro già fatto resta nel ramo."
    else
      say "TORNA AL PIANO vale solo nelle fasi test, codice e revisione (fase attuale: $fase)."
    fi
    ;;
  CHIUSO)
    if [ "$fase" = "chiusura" ]; then
      write_state "" "nessuno"; say "Compito $task chiuso. Usa /stato per vedere il prossimo."
    else
      say "CHIUSO vale solo in fase chiusura (fase attuale: $fase)."
    fi
    ;;
  ABBANDONA)
    if [ -n "$task" ]; then
      write_state "" "nessuno"; say "Compito $task abbandonato. Le modifiche restano nel ramo: decidi tu se tenerle."
    fi
    ;;
  APPROVO*|CHIUSO*|ABBANDONA*|"TORNA AI TEST"*|"TORNA AL PIANO"*)
    say "Parola chiave non riconosciuta: va scritta da sola sulla prima riga del messaggio (es. 'APPROVO' e poi, a capo, eventuali note). La fase NON è cambiata (compito: ${task:-nessuno}, fase: $fase). Se l'utente ha aggiunto richieste, eseguile restando nella fase attuale." ;;
  *)
    if [ -n "$task" ] && [ "$fase" != "nessuno" ]; then
      say "Compito corrente: $task, fase: $fase."
    else
      say "Nessun compito aperto. Per lavorare sul codice serve INIZIA <ID>."
    fi
    ;;
esac
exit 0
