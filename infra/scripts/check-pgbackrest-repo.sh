#!/usr/bin/env bash
# check-pgbackrest-repo.sh: test of the pgBackRest repository (the backup bucket) from a server
# (specs/08-operativita.md, OPS-001; task OPS-T01a, plan notes, «Prova del bucket sui server»).
#
# It runs pgbackrest-summary once, in a one-off container of the pgbackrest-init service started
# without its dependencies (postgres may be stopped, as it is until FON-T07b):
#   "$DC" run --rm --no-deps -T pgbackrest-init pgbackrest-summary
# A stanza code read from the bucket proves together the variables of postgres.env, the CA
# certificates of the image, the key, the region and the bucket. Expected before FON-T07b: stanza
# absent (code 1).
#
# It is installed on both servers with infra/ (/srv/app/infra/scripts/) and runs there. Claude
# launches it with "ssh test bash /srv/app/infra/scripts/check-pgbackrest-repo.sh" (on prod only after
# the user confirms the command). DC is the Compose wrapper, /srv/app/dc when unset or empty; the unit
# test (tests/unit/infra/check-pgbackrest-repo.test.ts) points it to a fake.
#
# Output, on stdout only: one line "riuscito: …" (stanza code 0, 1 or 2) or "fallito: …" (any other
# stanza code, with the error type in brackets when the summary gives one, as for code 99; an answer
# that is not recognised; an exit status of pgbackrest-summary or Compose other than 0). With exit
# status 2 (a variable missing, empty, with CAMBIA, or an endpoint with ://) the lines
# "pgbackrest-summary: <variable>: <problem>" come first: they name a variable, never a value.
# Nothing else is ever printed, on stdout or stderr: the other lines of the summary, the messages of
# pgBackRest and the errors of Compose can carry host names, bucket names and error details, so they
# are captured (stderr in a temporary file, removed at exit) and dropped.
# Exit status: 0 bucket reachable (stanza code 0, 1 or 2), 1 any other result, 130 interrupted.

set +x +v
set -u -o pipefail
umask 077
# Only the fixed lines below reach the caller: the shell's own messages (a missing "$DC", a null byte
# in the captured output) are dropped as well.
exec 2>/dev/null
# Byte-wise matching: [0-9] and [A-Za-z] stand for ASCII digits and letters only.
export LC_ALL=C

DC="${DC:-/srv/app/dc}"
STANZA_RE='^stanza ([0-9]+)( \[[A-Za-z]+\])?$'
ERR_FILE=""

cleanup() {
  if [ -n "$ERR_FILE" ]; then
    rm -f -- "$ERR_FILE"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# A line of pgbackrest-summary that names one of its six variables and the problem found: fixed texts,
# compared as whole lines, so that nothing else of the captured stderr can be printed.
is_variable_problem() {
  local name problem
  for name in S3_ENDPOINT S3_BUCKET S3_REGION S3_KEY S3_KEY_SECRET CIPHER_PASS; do
    for problem in 'manca o è vuota' 'contiene CAMBIA' 'contiene ://'; do
      if [ "$1" = "pgbackrest-summary: PGBACKREST_REPO1_$name: $problem" ]; then
        return 0
      fi
    done
  done
  return 1
}

ERR_FILE="$(mktemp)" || exit 1
# stdin from /dev/null: the one-off container reads nothing, and nothing of the ssh session is consumed.
summary="$("$DC" run --rm --no-deps -T pgbackrest-init pgbackrest-summary 2>"$ERR_FILE" </dev/null)"
status=$?

case "$status" in
  0)
    first_line="${summary%%$'\n'*}"
    case "$first_line" in
      'stanza 0')
        echo 'riuscito: bucket raggiungibile, stanza con backup (codice 0)'
        exit 0
        ;;
      'stanza 1')
        echo 'riuscito: bucket raggiungibile, stanza assente (codice 1)'
        exit 0
        ;;
      'stanza 2')
        echo 'riuscito: bucket raggiungibile, stanza senza backup (codice 2)'
        exit 0
        ;;
    esac
    if [[ $first_line =~ $STANZA_RE ]]; then
      echo "fallito: stanza con codice ${BASH_REMATCH[1]}${BASH_REMATCH[2]-}"
    else
      echo 'fallito: risposta di pgbackrest-summary non riconosciuta'
    fi
    exit 1
    ;;
  2)
    while IFS= read -r line || [ -n "$line" ]; do
      if is_variable_problem "$line"; then
        printf '%s\n' "$line"
      fi
    done <"$ERR_FILE"
    echo 'fallito: configurazione di pgBackRest non valida in postgres.env'
    exit 1
    ;;
  *)
    echo "fallito: pgbackrest-summary o docker compose terminato con codice $status"
    exit 1
    ;;
esac
