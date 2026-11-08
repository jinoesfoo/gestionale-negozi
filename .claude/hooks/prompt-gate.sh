#!/usr/bin/env bash
# UserPromptSubmit: le parole chiave dell'utente cambiano la fase del compito.
# Solo l'utente può far avanzare le fasi: Claude non può scrivere il file di stato.
source "$(dirname "$0")/common.sh"

input="$(cat)"
prompt="$(echo "$input" | jq -r '.prompt // ""')"
first_line="$(echo "$prompt" | head -n1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/[[:space:]][[:space:]]*/ /g')"
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
    # Due postazioni (docs/due-postazioni.md): il compito è di questa postazione e ciò da cui dipende è già su main
    me="$(postazione)"
    if [ -z "$me" ]; then
      say "Questa postazione non ha un nome: l'utente esegue una volta, nel terminale, 'bash .claude/hooks/imposta-postazione.sh yoo' (oppure joo). Il compito NON è iniziato."
      exit 0
    fi
    avviso=""
    aggiorna_main || avviso="Attenzione: git fetch non è riuscito, il controllo usa l'ultima copia nota di origin/main. "
    if ! ha_origin_main; then
      say "Manca origin/main: prima va fatto il passo 2 di AVVIO.md (repository su GitHub). Il compito NON è iniziato."
      exit 0
    fi
    riga="$(corsia_riga "$new_task")"
    if [ -z "$riga" ]; then
      say "$new_task non è nella tabella delle corsie (.claude/hooks/corsie.txt su main): un compito nuovo lo assegna prima l'utente a una postazione. Il compito NON è iniziato."
      exit 0
    fi
    id="$(echo "$riga" | cut -d'|' -f1)"; corsia="$(echo "$riga" | cut -d'|' -f2)"
    if [ "$corsia" != "$me" ]; then
      say "${avviso}$id è della postazione $corsia, non di questa ($me): qui non si inizia. Con /stato vedi il prossimo compito di $me. Il compito NON è iniziato."
      exit 0
    fi
    if sul_main "$id"; then
      say "${avviso}$id è già fatto: la sua casella è spuntata su main. Il compito NON è iniziato."
      exit 0
    fi
    mancano=""
    for p in $(compiti_prima "$id") $(echo "$riga" | cut -d'|' -f3 | tr ',' ' '); do
      sul_main "$p" || mancano="$mancano $p (postazione $(corsia_di "$p"))"
    done
    if [ -n "$mancano" ]; then
      say "${avviso}Non si può iniziare $id: questi compiti non sono ancora su main (pull request unita):$mancano. Il compito NON è iniziato. Con /stato vedi cosa fare nell'attesa."
      exit 0
    fi
    write_state "$id" "piano"
    say "${avviso}Compito $id iniziato sulla postazione $me. Fase: piano. Prima di tutto, con la cartella di lavoro pulita (a parte il registro di questa postazione): git switch --no-track -c $(echo "$id" | tr '[:upper:]' '[:lower:]') origin/main, poi pnpm install se esiste package.json. Poi leggi costituzione, docs/due-postazioni.md e area del compito, scrivi il piano e fermati per l'approvazione."
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
  "TORNA AL CODICE")
    if [ "$fase" = "chiusura" ]; then
      write_state "$task" "codice" "codice (torna dalla chiusura)"
      say "Ritorno alla fase codice per $task (per esempio per risolvere un conflitto con main): si corregge il codice, non i test. Dopo servono di nuovo APPROVO (revisione) e APPROVO (chiusura)."
    else
      say "TORNA AL CODICE vale solo in fase chiusura (fase attuale: $fase): in revisione il codice si corregge già."
    fi
    ;;
  CHIUSO)
    if [ "$fase" = "chiusura" ]; then
      avviso=""
      aggiorna_main || avviso="Attenzione: git fetch non è riuscito, il controllo usa l'ultima copia nota di origin/main. "
      if sul_main "$task"; then
        LOG_TASK="$task" write_state "" "nessuno" "nessuno (chiuso)"
        say "${avviso}Compito $task chiuso: è su main. Usa /stato per vedere il prossimo."
      else
        say "${avviso}CHIUSO si scrive dopo l'unione: la casella di $task non risulta ancora spuntata su main. Unisci la pull request su GitHub quando la CI è verde, poi scrivi di nuovo CHIUSO. Se la CI è rossa, scrivi TORNA AL CODICE. La fase NON è cambiata."
      fi
    else
      say "CHIUSO vale solo in fase chiusura (fase attuale: $fase)."
    fi
    ;;
  ABBANDONA)
    if [ -n "$task" ]; then
      LOG_TASK="$task" write_state "" "nessuno" "nessuno (abbandonato)"
      say "Compito $task abbandonato. Le modifiche restano nella cartella di lavoro, senza commit: decidi tu se tenerle. Finché il compito non è su main, i compiti che lo seguono restano bloccati."
    fi
    ;;
  APPROVO*|CHIUSO*|ABBANDONA*|"TORNA AI TEST"*|"TORNA AL PIANO"*|"TORNA AL CODICE"*)
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
