#!/usr/bin/env bash
# PreToolUse su Read/Grep/Edit/Write/MultiEdit/NotebookEdit: applica le regole della fase.
# Uscita 2 = azione bloccata, il messaggio torna a Claude.
source "$(dirname "$0")/common.sh"

input="$(cat)"
tool="$(echo "$input" | jq -r '.tool_name // ""')"
path="$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // .tool_input.path // ""')"

block() { echo "BLOCCATO dal metodo di lavoro: $*" >&2; exit 2; }

# Grep con un filtro sui nomi che prende i file di ambiente reali
if [ "$tool" = "Grep" ]; then
  g="$(echo "$input" | jq -r '.tool_input.glob // ""')"
  case "$g" in
    *.example*) ;;
    *.env*|*env/*) block "Grep sui file di ambiente reali non è permesso ('$g'): contengono segreti. Usa i file *.example." ;;
  esac
fi
[ -z "$path" ] && exit 0
rel="$(rel_path "$path")"

# 0. Un ".." rimasto dopo la normalizzazione è un percorso relativo che esce dalla cartella: niente scorciatoie
case "$rel" in
  ..|../*|*/../*|*/..) block "il percorso '$path' contiene '..': usa il percorso diretto del file." ;;
esac

# 1. Segreti: mai leggere o scrivere i file di ambiente reali
if is_secret_file "$rel"; then
  block "'$rel' contiene segreti e non si legge né si modifica. Usa il file *.example corrispondente."
fi

# 1b. Le sessioni salvate delle prove e le credenziali di questo computer (common.sh, tocca_credenziali)
case "$rel" in
  playwright/.auth|playwright/.auth/*) block "'$rel' è una sessione salvata delle prove: è una credenziale, la usano solo i test nella gabbia, e non si legge né si modifica." ;;
esac
modo=""; [ "$tool" = Grep ] && modo=contiene
tocca_credenziali "$(canon_path "$path")" "$modo" && \
  block "'$path' contiene credenziali di questo computer (chiavi SSH e GPG, accessi di Docker, GitHub e Stripe, portachiavi, profili dei browser, accesso di Claude Code): non si legge né si modifica."

# Le letture sono sempre permesse (tranne i segreti e le credenziali)
case "$tool" in Read|Grep) exit 0 ;; esac

# 2. I file del metodo (tutta .claude/, CLAUDE.md, AVVIO.md, docs/metodo.md, docs/due-postazioni.md, il registro,
#    .git, le impostazioni di Claude Code, la cartella di stato) li cambia solo l'utente
if protetto "$rel"; then
  block "'$rel' fa parte del metodo e non si modifica. La fase cambia solo con le parole chiave dell'utente (INIZIA <ID>, APPROVO, TORNA AI TEST, TORNA AL PIANO, TORNA AL CODICE, CHIUSO, ABBANDONA); hook, impostazioni, istruzioni, postazione, corsie e registro li cambia solo l'utente."
fi

fase="$(current_phase)"
task="$(current_task)"

case "$fase" in
  nessuno|piano|chiusura)
    # specifiche e documenti sono liberi; le liste di controllo dei compiti sono test, e si scrivono in fase test
    is_test_file "$rel" && block "fase $fase: '$rel' è un test o una lista di controllo, e si scrive in fase test. L'esito di una verifica va in docs/verifiche/<id>-esito.md."
    is_free_file "$rel" && exit 0
    case "$fase" in
      nessuno) block "nessun compito aperto. Chiedi all'utente di scrivere INIZIA <ID> (vedi /stato) prima di modificare '$rel'." ;;
      piano)   block "fase piano di $task: si scrive il piano, non i file. Chiedi all'utente di approvare il piano (APPROVO)." ;;
      *)       block "fase chiusura di $task: si chiudono i controlli, si spunta la specifica e si fa commit. Per altre modifiche (anche per risolvere un conflitto con main) l'utente scrive TORNA AL CODICE." ;;
    esac ;;
  test)
    { is_test_file "$rel" || is_test_tooling_file "$rel" || is_free_file "$rel"; } && exit 0
    block "fase test di $task: si scrivono solo i test (tests/, *.test.ts, script check-*, liste di controllo in docs/verifiche/) e la configurazione che serve a eseguirli (package.json, tsconfig, vitest, playwright, eslint, .npmrc, workflow CI). '$rel' si modifica in fase codice, dopo APPROVO." ;;
  codice|revisione)
    is_test_file "$rel" && block "fase $fase di $task: i test non si modificano per farli passare. Se un test è sbagliato rispetto alla specifica, spiegalo all'utente e chiedi TORNA AI TEST."
    is_check_config "$rel" && block "fase $fase di $task: la configurazione dei controlli ('$rel') resta ferma come i test. Se va cambiata, spiegalo all'utente e chiedi TORNA AI TEST."
    exit 0 ;;
  *)
    block "fase sconosciuta '$fase'. Chiedi all'utente di scrivere ABBANDONA e poi INIZIA <ID>." ;;
esac
