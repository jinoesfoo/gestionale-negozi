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

# I file del metodo e il registro devono essere quelli del commit: altrimenti nessuna fase cambia.
# Se la cartella .git non è più quella registrata, git non si usa nemmeno per controllare.
if git_cambiata; then
  alterati=".git (la cartella del repository non è quella registrata con imposta-postazione.sh) "
else
  alterati="$(metodo_modificato | tr '\n' ' ')"
  registro_alterato && alterati="$alterati$LOG_REL (diverso dalla copia degli hook in $LOG_COPY) "
fi
fermo_se_alterato() {
  [ -z "${alterati// /}" ] && return 0
  say "I file del metodo non sono quelli del commit corrente: $alterati. Finché non tornano a posto la fase NON cambia. Li rimette a posto l'utente, nel suo terminale: un file tracciato con git checkout -- <file>; un file nuovo (CLAUDE.local.md, .mcp.json, un CLAUDE.md in una sottocartella) cancellandolo; un collegamento simbolico a una cartella togliendolo (il progetto non ne usa); in .claude/settings.local.json restano solo le approvazioni (permissions con allow, deny e ask), le altre chiavi si tolgono; il registro si ricopia dalla copia degli hook; per la cartella .git, AVVIO.md, passo 4."
  exit 0
}
# Il fermo dei rilasci lo usano solo i compiti di yoo, uno alla volta (docs/due-postazioni.md, «Il server di test condiviso»):
# dopo CHIUSO o ABBANDONA su yoo non lo usa più nessuno; su joo può servire al compito di yoo ancora aperto, oppure
# essere rimasto da un compito di yoo chiuso o abbandonato.
avviso_fermo() {
  fermo_attivo || return 0
  if [ "$(postazione)" = yoo ]; then
    say "Attenzione: il fermo dei rilasci (TEST_DEPLOY_HOLD) è ancora attivo, e su yoo non resta nessun compito aperto: va tolto adesso, e il rilascio di main va rilanciato con l'avvio a mano. Dillo all'utente: lo toglie dal sito di GitHub, oppure ti chiede di farlo (gh variable set TEST_DEPLOY_HOLD --body 0, poi l'avvio a mano di deploy-test.yml su main). Finché resta, le unioni non arrivano sul server di test (docs/due-postazioni.md, «Il server di test condiviso»)."
  else
    say "Attenzione: il fermo dei rilasci (TEST_DEPLOY_HOLD) è attivo. L'ha attivato un compito di yoo, e da questa postazione non si tocca. Se l'ha attivato il compito aperto adesso su yoo, lo toglie quel compito dopo la sua unione; se invece l'ha lasciato un compito di yoo già chiuso o abbandonato, l'utente lo toglie dal sito di GitHub e rilancia il rilascio di main. Intanto le unioni non arrivano sul server di test: le porta il rilascio di main che parte quando il fermo viene tolto (docs/due-postazioni.md, «Il server di test condiviso»)."
  fi
}

case "$upper" in
  INIZIA\ *)
    fermo_se_alterato
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
    doppie="$(corsie_doppie)"
    if [ -n "$doppie" ]; then
      say "Nella tabella delle corsie su main questi compiti compaiono più di una volta: $doppie. L'utente la corregge prima di iniziare. Il compito NON è iniziato."
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
    cancella_manifesto_test
    write_state "$id" "piano"
    esiste=""
    git -C "$PROJECT_DIR" rev-parse -q --verify "refs/heads/$(echo "$id" | tr '[:upper:]' '[:lower:]')" >/dev/null 2>&1 && \
      esiste=" Il ramo $(echo "$id" | tr '[:upper:]' '[:lower:]') esiste già, da un compito abbandonato: quel primo passo lo esegue l'utente nel suo terminale, come dice docs/due-postazioni.md («Se qualcosa va storto», «Un compito abbandonato»)."
    say "${avviso}Compito $id iniziato sulla postazione $me. Fase: piano. Prima di tutto, senza altre modifiche nella cartella di lavoro (possono restare il registro di questa postazione e i file di docs/ dei suoi compiti, nuovi o modificati): git switch --no-track -c $(echo "$id" | tr '[:upper:]' '[:lower:]') origin/main, poi pnpm install se esiste package.json.$esiste Se l'hook dice che origin/main cambia i file del metodo, quel comando lo esegue l'utente nel suo terminale. Poi leggi costituzione, docs/due-postazioni.md e area del compito, scrivi il piano e fermati per l'approvazione."
    ;;
  APPROVO)
    case "$fase" in piano|test|codice|revisione) fermo_se_alterato ;; esac
    case "$fase" in codice|revisione)
      cambiati="$(test_cambiati | tr '\n' ' ')"
      if [ -n "${cambiati// /}" ]; then
        say "I test sono cambiati dopo la fase test: $cambiati. In fase $fase i test e la configurazione dei controlli non si toccano: la fase NON è cambiata. Se un test va davvero corretto, o se è cambiato con l'allineamento a main perché l'avevano cambiato tutte e due le parti, l'utente scrive TORNA AI TEST e poi APPROVO; altrimenti l'utente lo rimette com'era nel suo terminale."
        exit 0
      fi ;;
    esac
    case "$fase" in
      piano)     write_state "$task" "test";      say "Piano approvato. Fase: test. Scrivi i test dai criteri di accettazione e mostra che falliscono (per COL-T01 no: le sue prove girano in produzione e in fase test si controllano solo con pnpm lint e pnpm typecheck, CLAUDE.md sezione 1)." ;;
      test)      aggiorna_main; write_state "$task" "codice"; salva_manifesto_test
                 say "Test approvati. Fase: codice. Scrivi il codice finché lint, typecheck e test sono verdi. I test non si modificano: da adesso gli hook ne tengono l'impronta." ;;
      codice)    write_state "$task" "revisione"; say "Codice approvato. Fase: revisione. Esegui /revisione." ;;
      revisione) write_state "$task" "chiusura";  say "Revisione approvata. Fase: chiusura. Esegui /chiudi-compito." ;;
      chiusura)  say "In fase chiusura si conclude con CHIUSO, dopo che la pull request è unita." ;;
      *)         say "Nessun compito aperto: non c'è nulla da approvare. Usa INIZIA <ID>." ;;
    esac
    ;;
  "TORNA AI TEST")
    if [ "$fase" = "codice" ] || [ "$fase" = "revisione" ]; then
      fermo_se_alterato
      cancella_manifesto_test
      write_state "$task" "test"; say "Ritorno alla fase test per $task: si possono modificare i test, non il codice."
    else
      say "TORNA AI TEST vale solo nelle fasi codice e revisione (fase attuale: $fase)."
    fi
    ;;
  "TORNA AL PIANO")
    if [ "$fase" = "test" ] || [ "$fase" = "codice" ] || [ "$fase" = "revisione" ]; then
      fermo_se_alterato
      cancella_manifesto_test
      write_state "$task" "piano"; say "Ritorno alla fase piano per $task: correggi la specifica e il piano, poi chiedi di nuovo APPROVO. Il lavoro già fatto resta nel ramo."
    else
      say "TORNA AL PIANO vale solo nelle fasi test, codice e revisione (fase attuale: $fase)."
    fi
    ;;
  "TORNA AL CODICE")
    if [ "$fase" = "chiusura" ]; then
      fermo_se_alterato
      write_state "$task" "codice" "codice (torna dalla chiusura)"
      say "Ritorno alla fase codice per $task (per esempio per risolvere un conflitto con main): si corregge il codice, non i test. Dopo servono di nuovo APPROVO (revisione) e APPROVO (chiusura)."
    else
      say "TORNA AL CODICE vale solo in fase chiusura (fase attuale: $fase): in revisione il codice si corregge già."
    fi
    ;;
  CHIUSO)
    if [ "$fase" = "chiusura" ]; then
      fermo_se_alterato
      avviso=""
      aggiorna_main || avviso="Attenzione: git fetch non è riuscito, il controllo usa l'ultima copia nota di origin/main. "
      if sul_main "$task"; then
        cancella_manifesto_test
        LOG_TASK="$task" write_state "" "nessuno" "nessuno (chiuso)"
        say "${avviso}Compito $task chiuso: è su main. Usa /stato per vedere il prossimo."
        avviso_fermo
      else
        say "${avviso}CHIUSO si scrive dopo l'unione: la casella di $task non risulta ancora spuntata su main. Unisci la pull request su GitHub quando la CI è verde, poi scrivi di nuovo CHIUSO. Se la CI è rossa, scrivi TORNA AL CODICE; se è rosso solo pnpm audit, per una vulnerabilità estranea al compito, o se il rosso dipende da un file dell'altra postazione, vale invece docs/due-postazioni.md («Pull request automatiche delle dipendenze» o «Se qualcosa va storto»). La fase NON è cambiata."
      fi
    else
      say "CHIUSO vale solo in fase chiusura (fase attuale: $fase)."
    fi
    ;;
  ABBANDONA)
    if [ -n "$task" ]; then
      cancella_manifesto_test
      LOG_TASK="$task" write_state "" "nessuno" "nessuno (abbandonato)"
      say "Compito $task abbandonato. Le modifiche restano nella cartella di lavoro: decidi tu se tenerle. Finché il compito non è su main, i compiti che lo seguono restano bloccati. Per rifarlo, il ramo del compito lo rimette a posto l'utente nel suo terminale, come dice docs/due-postazioni.md («Un compito abbandonato»)."
      avviso_fermo
    fi
    ;;
  APPROVO*|CHIUSO*|ABBANDONA*|"TORNA AI TEST"*|"TORNA AL PIANO"*|"TORNA AL CODICE"*)
    say "Parola chiave non riconosciuta: va scritta da sola sulla prima riga del messaggio (es. 'APPROVO' e poi, a capo, eventuali note). La fase NON è cambiata (compito: ${task:-nessuno}, fase: $fase). Se l'utente ha aggiunto richieste, eseguile restando nella fase attuale." ;;
  *)
    [ -n "${alterati// /}" ] && say "Attenzione: i file del metodo sono cambiati rispetto al commit corrente: $alterati. Dillo all'utente: finché non tornano come prima, nessuna fase può cambiare."
    if [ -n "$task" ] && [ "$fase" != "nessuno" ]; then
      say "Compito corrente: $task, fase: $fase."
    else
      say "Nessun compito aperto. Per lavorare sul codice serve INIZIA <ID>."
    fi
    ;;
esac
exit 0
