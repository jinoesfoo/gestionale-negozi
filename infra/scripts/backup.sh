#!/usr/bin/env bash
# backup.sh: the nightly backup of PostgreSQL with pgBackRest (specs/08-operativita.md, OPS-002 and OPS-003,
# §pgBackRest «Pianificazione», and the plan notes of OPS-T01a, «backup.sh»). The systemd user timers of deploy run it
# (infra/systemd/: backup@full.service on Sundays, backup@diff.service on the other nights, at 3:30 Europe/Rome):
#
#   bash /srv/app/infra/scripts/backup.sh full|diff
#
# Compose goes through "$DC" (default /srv/app/dc; in the local Docker test, tests/infra/pgbackrest/dc).
# - With the postgres service not running (as on the servers until FON-T07b) it writes a message and ends with 0,
#   without pgBackRest and without recording anything: an outage is still reported by /api/health/deep (OPS-010).
# - diff: first it reads the state of the stanza with pgbackrest-summary. With code 0 or 2 and no full backup in the
#   repository (first install, stanza created again, restore on a new volume) it makes a full backup instead. With
#   any other code, or a failed summary, it records a failed diff and makes no backup: a passing error of the bucket
#   must not turn a differential into a full one.
# - The backup runs inside the postgres container under `timeout 330m` (5 hours 30 minutes; GNU timeout takes one
#   number with one unit, not "5h30m"): the limit of the systemd unit stops the Compose client but not a process
#   started with exec, which would stay alive holding the lock of the stanza.
# - After a successful backup, kind and size come from the last backup line of the summary (pgBackRest itself can turn
#   a diff into a full, for example after a stanza-upgrade).
# - Every outcome is recorded in ops_backup_runs with `node dist/cli.js ops:record-backup` (OPS-003). Until OPS-T01b
#   writes that command, the placeholder of FON-T06 ends with the reserved status 64: the record is then skipped with a
#   warning. Any other status other than 0 is a failed record.
# The output of the backup and of the record passes through to the journal of the timer; the values of postgres.env
# never pass here.
#
# Exit status: 0 backup made and recorded (or record skipped with 64), or postgres not running; 1 backup not made, or
# record failed, or Compose unreachable; 2 wrong argument.
set -u -o pipefail

DC="${DC:-/srv/app/dc}"

if [ "$#" -ne 1 ] || { [ "$1" != full ] && [ "$1" != diff ]; }; then
  echo 'backup.sh: uso: backup.sh full|diff' >&2
  exit 2
fi
requested=$1

code=0
services=$("$DC" ps --status running --services </dev/null) || code=$?
if [ "$code" -ne 0 ]; then
  echo "backup.sh: errore: docker compose ps terminato con codice $code" >&2
  exit 1
fi
if ! printf '%s\n' "$services" | grep -qx postgres; then
  echo 'backup.sh: il servizio postgres non è in esecuzione: backup saltato'
  exit 0
fi

start=$SECONDS
record_failed=0

# record <kind> --ok <bytes> | record <kind> --failed <message>: one row in ops_backup_runs, with the seconds since
# the start of the backup.
record() {
  local kind=$1 outcome=$2 value=$3 duration=$((SECONDS - start)) code=0
  if [ "$outcome" = --ok ]; then
    "$DC" run --rm -T migrate node dist/cli.js ops:record-backup --kind "$kind" --ok --duration-s "$duration" \
      --size-bytes "$value" </dev/null || code=$?
  else
    "$DC" run --rm -T migrate node dist/cli.js ops:record-backup --kind "$kind" --failed --duration-s "$duration" \
      --message "$value" </dev/null || code=$?
  fi
  case $code in
    0) ;;
    64) echo 'backup.sh: avviso: ops:record-backup non ancora disponibile (codice 64): registrazione saltata' ;;
    *)
      echo "backup.sh: errore: ops:record-backup terminato con codice $code" >&2
      record_failed=1
      ;;
  esac
}

# fail <kind> <message>: records the failure and ends with 1.
fail() {
  echo "backup.sh: errore: $2" >&2
  record "$1" --failed "$2"
  exit 1
}

kind=$requested
if [ "$requested" = diff ]; then
  code=0
  before=$("$DC" exec -T -u postgres postgres pgbackrest-summary </dev/null) || code=$?
  if [ "$code" -ne 0 ]; then
    fail diff "pgbackrest-summary terminato con codice $code"
  fi
  first=${before%%$'\n'*}
  if ! [[ $first =~ ^stanza\ (0|2)($|\ ) ]]; then
    fail diff "pgbackrest info: $first"
  fi
  if ! printf '%s\n' "$before" | grep -qE '^backup [^ ]+ full [0-9]+$'; then
    kind=full
    echo 'backup.sh: nessun backup completo nel repository: eseguo un backup completo al posto del differenziale'
  fi
fi

code=0
"$DC" exec -T -u postgres postgres timeout 330m pgbackrest --stanza=main --type="$kind" --log-level-console=info \
  backup </dev/null || code=$?
if [ "$code" -eq 124 ]; then
  fail "$kind" 'pgbackrest backup interrotto dopo 5h30m (codice 124)'
elif [ "$code" -ne 0 ]; then
  fail "$kind" "pgbackrest backup terminato con codice $code"
fi

code=0
after=$("$DC" exec -T -u postgres postgres pgbackrest-summary </dev/null) || code=$?
if [ "$code" -ne 0 ]; then
  fail "$kind" "backup riuscito, dimensione non letta: pgbackrest-summary terminato con codice $code"
fi
last=$(printf '%s\n' "$after" | grep '^backup ' | tail -n 1)
if [ -z "$last" ]; then
  fail "$kind" 'backup riuscito, dimensione non letta: nessun backup nel riassunto'
fi
read -r _ label done_kind bytes <<<"$last"
record "$done_kind" --ok "$bytes"
echo "backup.sh: backup $done_kind riuscito ($label): $bytes byte nel repository, $((SECONDS - start)) s"
exit "$record_failed"
