#!/usr/bin/env bash
# PreToolUse su Read/Edit/Write/MultiEdit/NotebookEdit: applica le regole della fase.
# Uscita 2 = azione bloccata, il messaggio torna a Claude.
source "$(dirname "$0")/common.sh"

input="$(cat)"
tool="$(echo "$input" | jq -r '.tool_name // ""')"
path="$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""')"
[ -z "$path" ] && exit 0
rel="$(rel_path "$path")"

block() { echo "BLOCCATO dal metodo di lavoro: $*" >&2; exit 2; }

# 0. Un ".." rimasto dopo la normalizzazione è un percorso relativo che esce dalla cartella: niente scorciatoie
case "$rel" in
  ..|../*|*/../*|*/..) block "il percorso '$path' contiene '..': usa il percorso diretto del file." ;;
esac

# 1. Segreti: mai leggere o scrivere i file di ambiente reali
if is_secret_file "$rel"; then
  block "'$rel' contiene segreti e non si legge né si modifica. Usa il file *.example corrispondente."
fi

# Le letture sono sempre permesse (tranne i segreti)
[ "$tool" = "Read" ] && exit 0

# 2. Il file di stato lo cambia solo l'utente con le parole chiave
case "$rel" in
  .claude/compito-corrente.json|.claude/hooks/*|.claude/settings.json|.claude/postazione|.claude/registro-compiti*)
    block "'$rel' fa parte del metodo e non si modifica. La fase cambia solo con le parole chiave dell'utente (INIZIA <ID>, APPROVO, TORNA AI TEST, TORNA AL PIANO, TORNA AL CODICE, CHIUSO, ABBANDONA); postazione, corsie e registro li cambia solo l'utente."
    ;;
esac

# 3. Specifiche e documenti: sempre modificabili
is_free_file "$rel" && exit 0

fase="$(current_phase)"
task="$(current_task)"

case "$fase" in
  nessuno)
    block "nessun compito aperto. Chiedi all'utente di scrivere INIZIA <ID> (vedi /stato) prima di modificare '$rel'." ;;
  piano)
    block "fase piano di $task: si scrive il piano, non i file. Chiedi all'utente di approvare il piano (APPROVO)." ;;
  test)
    is_test_file "$rel" && exit 0
    is_test_tooling_file "$rel" && exit 0
    block "fase test di $task: si scrivono solo i test (tests/, *.test.ts, script check-*) e la configurazione che serve a eseguirli (package.json, tsconfig, vitest, playwright, workflow CI). '$rel' si modifica in fase codice, dopo APPROVO." ;;
  codice|revisione)
    if is_test_file "$rel"; then
      block "fase $fase di $task: i test non si modificano per farli passare. Se un test è sbagliato rispetto alla specifica, spiegalo all'utente e chiedi TORNA AI TEST."
    fi
    exit 0 ;;
  chiusura)
    block "fase chiusura di $task: si chiudono i controlli, si spunta la specifica e si fa commit. Per altre modifiche (anche per risolvere un conflitto con main) l'utente scrive TORNA AL CODICE." ;;
  *)
    block "fase sconosciuta '$fase'. Chiedi all'utente di scrivere ABBANDONA e poi INIZIA <ID>." ;;
esac
