#!/usr/bin/env bash
# The Docker test of OPS-T01a (specs/08-operativita.md: OPS-001, OPS-002, OPS-003, §pgBackRest and the plan notes of
# OPS-T01a, «Prove»; specs/01-fondamenta.md, §Servizi, the outcome of the [VERIFICA] on the TLS entry of the S3
# emulator; 00 §4.2): rows A2 and C5 of the checklist docs/verifiche/ops-t01a.md.
#
# The user runs it from the repository root, in their own terminal, with Docker (it takes a few minutes):
#
#   bash tests/infra/pgbackrest/run.sh
#
# It builds the PostgreSQL image of infra/postgres/ as ops-t01a-prova-postgres:locale; with
# PROVA_IMMAGINE=<image already on this computer> it tests that image instead, under the same local name (row C5). It
# pulls chrislusf/seaweedfs:4.53 and caddy:2.11.9 when they are missing. Everything runs in a separate Compose project,
# ops-t01a-prova (compose.yml of this folder, always through dc, the local stand-in for /srv/app/dc): the S3 emulator
# with the bucket pgbackrest-prova; a TLS proxy in front of it (Caddy with tls internal, Caddyfile of this folder),
# whose JSON access log counts the requests by host name, s3-tls for postgres and s3-tls-init for pgbackrest-init; the
# image's postgres and pgbackrest-init; a fake migrate that prints its arguments and exits with MIGRATE_FINTO_EXIT (64
# when unset). No published port, only named volumes and tmpfs, project files mounted read-only, test values only:
# every test secret starts with VALORE-PROVA-SEGRETO.
#
# Cases, in this order (names in Italian; each starts with its id, and the P cases with the requirements they protect):
# - S1-S3, the harness: the emulator and the bucket are ready; the proxy answers on s3-tls-init and the count of its
#   access log sees the request; the fake migrate prints its arguments and exits with the chosen code (64, then 1);
# - P1-P11, pgBackRest, with infra/scripts/backup.sh run as the timers run it (DC=<this folder>/dc): postgres healthy
#   with archive_mode on; the first pgbackrest-init (info: stanza 1, stanza-create, check, the indicator file written
#   through a temporary file); <redacted> and no test secret in its output; a WAL archived within 120 s of an insert,
#   with pg_stat_archiver.failed_count unchanged; the second pgbackrest-init (only the indicator line, exit 0 within
#   20 s, no request to s3-tls-init); without the indicator file, info (stanza 2) and check again, with requests, and
#   the file rewritten; backup.sh diff without a full makes a full (ops:record-backup gets --kind full --ok, exit 64 of
#   the fake: record skipped with the warning); backup.sh diff with a full makes a diff; ops:record-backup exiting
#   with 1 makes backup.sh full exit with 1; <redacted> in the outputs of backup.sh and no test secret in any output
#   nor in the logs of postgres and of the proxy; postgres stopped: backup.sh diff exits 0 with its message, with no
#   record and no request to the bucket.
# In the test phase S1-S3 are as expected and P1-P11 differ: the image has no pgBackRest yet (archive_mode off, no
# pgbackrest-init, pgbackrest-summary or pgbackrest) and infra/scripts/backup.sh does not exist. In the code phase
# every case is as expected. When a case differs the script prints why (expected and found), keeps going without
# waiting for what cannot come, and at the end prints the last lines of the logs of postgres and of the proxy and of
# the captured outputs (test values only).
#
# It leaves nothing behind: it starts from a clean project (down -v) and at the end, also after Ctrl-C, removes the
# project's containers, volumes and network, the local image ops-t01a-prova-postgres:locale (with PROVA_IMMAGINE only
# that name goes, not the image) and its temporary folder (mktemp, outside the project). The pulled images and Docker's
# build cache stay, as after any pull or build. PROVA_KEEP=1 keeps the project, the image and the captured outputs,
# and prints how to remove them.
#
# Exit status: 0 when every case is as expected. The last line is «Prove: N, come attese: M, diverse: K». A missing
# prerequisite (docker, timeout, the image) stops it earlier with a message and exit status 1.
set -u -o pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(cd "$here/../../.." && pwd)
dc=$here/dc
image=ops-t01a-prova-postgres:locale
indicator=/var/lib/postgresql/.pgbackrest-stanza-ok
indicator_line='pgbackrest-init: file indicatore presente: nessuna chiamata al bucket'
no_full_line='backup.sh: nessun backup completo nel repository: eseguo un backup completo al posto del differenziale'
warning_64='backup.sh: avviso: ops:record-backup non ancora disponibile (codice 64): registrazione saltata'
# Every test secret of compose.yml (S3 key and secret, repo1-cipher-pass, PostgreSQL password) starts with this text.
secret=VALORE-PROVA-SEGRETO
cd "$root" || exit 1

command -v docker >/dev/null 2>&1 || { echo 'docker non trovato'; exit 1; }
docker compose version >/dev/null 2>&1 || { echo 'docker compose non disponibile'; exit 1; }
command -v timeout >/dev/null 2>&1 || { echo 'timeout non trovato (coreutils)'; exit 1; }
[ -x "$dc" ] || { echo "$dc non è eseguibile (chmod 755): backup.sh lo lancia come programma"; exit 1; }
work=$(mktemp -d "${TMPDIR:-/tmp}/ops-t01a-prova.XXXXXX") || exit 1

cleaned=
cleanup() {
  [ -z "$cleaned" ] || return 0
  cleaned=1
  if [ "${PROVA_KEEP:-}" = 1 ]; then
    echo "PROVA_KEEP=1: restano il progetto Compose ops-t01a-prova (container, volumi e rete), l'immagine $image"
    echo "e le uscite in $work. Per toglierli:"
    echo "  bash tests/infra/pgbackrest/dc down -v --remove-orphans; docker image rm $image; rm -rf $work"
    return 0
  fi
  if ! timeout --foreground -k 10 300 "$dc" down -v --remove-orphans >"$work/cleanup-down.log" 2>&1 </dev/null; then
    echo 'AVVISO: la pulizia del progetto Compose ops-t01a-prova non è riuscita; ultime righe:'
    tail -n 5 "$work/cleanup-down.log"
    echo 'Per riprovare: bash tests/infra/pgbackrest/dc down -v --remove-orphans'
  fi
  if docker image inspect "$image" >/dev/null 2>&1 && ! docker image rm "$image" >/dev/null 2>&1; then
    echo "AVVISO: l'immagine $image non si toglie; per riprovare: docker image rm $image"
  fi
  rm -rf -- "$work"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP # a Ctrl-C must stop the test and clean up, not only stop the current command

total=0
same=0
reasons=()

# differs <expected> <found>: notes a difference of the current case.
differs() { reasons+=("attesa: $1; trovata: $2"); }

# check <case>: the result of the current case, from the differences noted since the previous check.
check() {
  total=$((total + 1))
  if [ "${#reasons[@]}" -eq 0 ]; then
    same=$((same + 1))
    printf 'ok       %s\n' "$1"
  else
    printf 'DIVERSA  %s\n' "$1"
    printf '         %s\n' "${reasons[@]}"
  fi
  reasons=()
}

# brief: the non-empty lines of the standard input on one line, separated by « | », at most 400 characters;
# «(nessuna riga)» when there are none.
brief() {
  awk 'NF { s = s (n++ ? " | " : "") $0 } END { print (n ? substr(s, 1, 400) : "(nessuna riga)") }'
}

# last_of <file>...: the last non-empty line of the first file that has one, at most 200 characters.
last_of() {
  local f line
  for f in "$@"; do
    line=$(awk 'NF { last = $0 } END { print substr(last, 1, 200) }' "$f" 2>/dev/null)
    if [ -n "$line" ]; then
      printf '%s' "$line"
      return 0
    fi
  done
}

# expect_code <what> <expected> <found> <file>...: the exit status of a command; when it differs, the reason shows the
# last line of the first of the files (stderr, then stdout) that has one.
expect_code() {
  local what=$1 expected=$2 found=$3 line
  shift 3
  [ "$found" = "$expected" ] && return 0
  line=$(last_of "$@")
  differs "$what con codice $expected" "codice $found${line:+ ($line)}"
}

# expect_line <file> <line>: the file has exactly this line.
expect_line() { grep -qxF -- "$2" "$1" 2>/dev/null || differs "la riga «$2»" 'assente'; }

# expect_no_line <file> <line>: the file does not have this line.
expect_no_line() { if grep -qxF -- "$2" "$1" 2>/dev/null; then differs "nessuna riga «$2»" 'presente'; fi; }

# expect_only <file> <line>: the file is exactly this one line.
expect_only() {
  [ "$(cat -- "$1" 2>/dev/null)" = "$2" ] || differs "solo la riga «$2»" "$(brief <"$1")"
}

# expect_own_lines <file> <line>...: the lines of pgbackrest-init itself, those that start with «pgbackrest-init: »,
# are exactly these, in this order; the lines of pgBackRest pass through in between and are left out.
expect_own_lines() {
  local file=$1 found
  shift
  found=$(grep '^pgbackrest-init: ' "$file" 2>/dev/null)
  [ "$found" = "$(printf '%s\n' "$@")" ] ||
    differs "le righe $(printf '%s\n' "$@" | brief)" "$(printf '%s\n' "$found" | brief)"
}

# expect_migrate <file> <extended regular expression> <expected line, readable>: the fake migrate printed a line that
# matches (it prints «migrate finto:» and the arguments that backup.sh gave to ops:record-backup).
expect_migrate() {
  grep -qE -- "$2" "$1" 2>/dev/null && return 0
  differs "la riga «$3»" "$(grep '^migrate finto' "$1" 2>/dev/null | brief)"
}

# expect_no_secret <file>...: no test secret in the files; the reason names the files, never the content.
expect_no_secret() {
  local f leaks=
  for f in "$@"; do
    if grep -qsF -- "$secret" "$f"; then leaks="$leaks ${f##*/}"; fi
  done
  [ -z "$leaks" ] || differs "nessun segreto di prova ($secret…)" "presente in:$leaks"
}

# in_time <seconds> <command>...: the command with a time limit (exit status 124 when it runs out) and no standard
# input. In the foreground, so that Ctrl-C reaches it; docker, whose output never goes to a terminal here, stops its
# compose plugin on the SIGTERM of the time limit.
in_time() { timeout --foreground -k 10 "$@" </dev/null; }

# requests [<host>]: the requests in the access log of the TLS proxy (lines with "msg":"handled request"); with a host,
# only those whose Host header starts with it (pgBackRest sends the name without the port, curl with it). «errore»
# when the log cannot be read.
requests() {
  local log n
  log=$(in_time 60 "$dc" logs --no-color --no-log-prefix proxy 2>/dev/null) || {
    echo errore
    return 0
  }
  if [ -n "${1:-}" ]; then
    n=$(printf '%s\n' "$log" | grep -F '"msg":"handled request"' | grep -cF "\"host\":\"$1")
  else
    n=$(printf '%s\n' "$log" | grep -cF '"msg":"handled request"')
  fi
  case $n in
    '' | *[!0-9]*) echo errore ;;
    *) echo "$n" ;;
  esac
}

# requests_after <host> <count before>: the count of the requests to the host, read again for up to 5 seconds until
# it is above the count before (Caddy writes the line once it has answered, and docker logs may lag a little).
requests_after() {
  local i=0 n
  while :; do
    n=$(requests "$1")
    if [ "$n" != errore ] && [ "$2" != errore ] && [ "$n" -gt "$2" ]; then break; fi
    [ "$i" -ge 5 ] && break
    i=$((i + 1))
    sleep 1
  done
  echo "$n"
}

# expect_more_requests <host> <count before> <count after> [<note for the reason>]
expect_more_requests() {
  if [ "$2" = errore ] || [ "$3" = errore ] || [ "$3" -le "$2" ]; then
    differs "richieste a $1 nel registro del proxy (prima: $2)" "dopo: $3${4:+ ($4)}"
  fi
}

# expect_same_requests <what> <count before> <count after>
expect_same_requests() {
  if [ "$2" = errore ] || [ "$3" != "$2" ]; then
    differs "nessuna richiesta $1 nel registro del proxy (prima: $2)" "dopo: $3"
  fi
}

# sql <statement>: psql in the postgres container, as postgres, on the database app; the unaligned result on stdout.
sql() {
  in_time 60 "$dc" exec -T -u postgres postgres psql -X -q -t -A -v ON_ERROR_STOP=1 -d app -c "$1" 2>>"$work/sql.err"
}

# archive_max: the newest WAL segment of the archive according to pgbackrest info, empty when the archive has none.
# The JSON is the last non-empty line of the output of pgBackRest (its warnings come before it). The exit status is
# pgBackRest's, then jq's.
archive_max_script='out=$(pgbackrest --stanza=main --output=json info) || exit
printf "%s\n" "$out" | awk "NF { last = \$0 } END { print last }" | jq -r ".[0].archive[0].max // empty"'
archive_max() {
  in_time 60 "$dc" exec -T -u postgres postgres sh -c "$archive_max_script" 2>>"$work/p4-info.err"
}

# home_files: the regular files directly in /var/lib/postgresql, the folder of the indicator file, sorted.
home_files() {
  in_time 60 "$dc" exec -T postgres find /var/lib/postgresql -maxdepth 1 -type f 2>/dev/null | sort
}

# expect_indicator: the indicator file is on the volume pgdata, and it is the only regular file that its folder did not
# have before the first run (pgbackrest-init writes it through a temporary file renamed onto it: 08, plan notes of
# OPS-T01a).
expect_indicator() {
  local now
  if ! in_time 60 "$dc" exec -T postgres test -f "$indicator" >/dev/null 2>&1; then
    differs "il file indicatore $indicator sul volume pgdata" 'assente'
    return 0
  fi
  now=$(home_files)
  [ "$now" = "$(printf '%s\n%s\n' "$baseline" "$indicator" | sed '/^$/d' | sort)" ] ||
    differs "accanto al file indicatore nessun file nuovo in /var/lib/postgresql" "$(printf '%s\n' "$now" | brief)"
}

# run_init <name> <seconds>: pgbackrest-init as Compose runs it on the servers, without starting postgres again;
# stdout in <name>.out, stderr in <name>.err, the exit status in code.
run_init() {
  code=0
  in_time "$2" "$dc" run --rm -T --no-deps pgbackrest-init >"$work/$1.out" 2>"$work/$1.err" || code=$?
}

# run_backup <name> <full|diff> <MIGRATE_FINTO_EXIT>: infra/scripts/backup.sh as the timers run it, with
# DC=<this folder>/dc and the exit status of the fake migrate; stdout in <name>.out, stderr in <name>.err, the exit
# status in code. Not in the foreground: when the time runs out, the whole process group goes (bash, docker and its
# compose plugin), and a Ctrl-C waits for the end of the backup, a few seconds.
run_backup() {
  code=0
  MIGRATE_FINTO_EXIT=$3 DC=$dc timeout -k 10 900 bash infra/scripts/backup.sh "$2" \
    >"$work/$1.out" 2>"$work/$1.err" </dev/null || code=$?
}

# summary <name>: pgbackrest-summary in the postgres container, as postgres; stdout in <name>.out, stderr in
# <name>.err, the exit status in summary_code.
summary() {
  summary_code=0
  in_time 120 "$dc" exec -T -u postgres postgres pgbackrest-summary >"$work/$1.out" 2>"$work/$1.err" ||
    summary_code=$?
}

echo 'Prova con Docker di OPS-T01a: progetto Compose ops-t01a-prova (tests/infra/pgbackrest)'

# A clean project: nothing left from an interrupted run or from PROVA_KEEP=1.
if ! in_time 300 "$dc" down -v --remove-orphans >"$work/start-down.log" 2>&1; then
  echo 'ERRORE: docker compose down del progetto ops-t01a-prova non riuscito; ultime righe:'
  tail -n 10 "$work/start-down.log"
  exit 1
fi

if [ -n "${PROVA_IMMAGINE:-}" ]; then
  if ! docker image inspect "$PROVA_IMMAGINE" >/dev/null 2>&1; then
    echo "ERRORE: l'immagine $PROVA_IMMAGINE (PROVA_IMMAGINE) non c'è su questo computer"
    exit 1
  fi
  if ! docker tag "$PROVA_IMMAGINE" "$image"; then
    echo "ERRORE: docker tag $PROVA_IMMAGINE $image non riuscito"
    exit 1
  fi
  origin="$PROVA_IMMAGINE (PROVA_IMMAGINE)"
else
  echo "Costruzione dell'immagine $image da infra/postgres..."
  if ! in_time 1800 "$dc" build postgres >"$work/build.log" 2>&1; then
    echo "ERRORE: la costruzione dell'immagine da infra/postgres non è riuscita; ultime righe:"
    tail -n 30 "$work/build.log"
    exit 1
  fi
  origin=infra/postgres
fi
echo "Immagine: $image, da $origin, $(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null)"
echo

# S1. The emulator and the bucket of the test.
code=0
in_time 300 "$dc" up -d s3 >"$work/s1-up.out" 2>&1 || code=$?
expect_code 'avvio di s3' 0 "$code" "$work/s1-up.out"
if [ "$code" -eq 0 ]; then
  code=0
  in_time 300 "$dc" run --rm -T s3-init >"$work/s1-s3-init.out" 2>"$work/s1-s3-init.err" || code=$?
  expect_code 's3-init' 0 "$code" "$work/s1-s3-init.err" "$work/s1-s3-init.out"
fi
check 'S1 prova di servizio: emulatore S3 avviato e bucket pgbackrest-prova pronto (s3-init termina con 0)'

# S2. The TLS proxy and the count of its access log. Caddy needs a moment for its internal certificates: up to 10
# attempts. Any HTTP status will do (the emulator refuses a request without signature): the log line is what counts.
code=0
in_time 300 "$dc" up -d proxy >"$work/s2-up.out" 2>&1 || code=$?
expect_code 'avvio del proxy' 0 "$code" "$work/s2-up.out"
if [ "$code" -eq 0 ]; then
  before=$(requests s3-tls-init)
  status=
  i=0
  while :; do
    code=0
    status=$(in_time 30 "$dc" exec -T s3 curl -sSk -o /dev/null -w '%{http_code}' https://s3-tls-init:8443/ \
      2>>"$work/s2-curl.err") || code=$?
    if [ "$code" -eq 0 ] || [ "$i" -ge 9 ]; then break; fi
    i=$((i + 1))
    sleep 1
  done
  expect_code 'curl verso https://s3-tls-init:8443/ dal container s3' 0 "$code" "$work/s2-curl.err"
  after=$(requests_after s3-tls-init "$before")
  expect_more_requests s3-tls-init "$before" "$after" "risposta HTTP: ${status:-nessuna}"
fi
check 'S2 prova di servizio: il proxy TLS risponde su s3-tls-init e il conteggio del suo registro vede la richiesta'

# S3. The fake migrate, with the default code of ops:record-backup not yet available and with an error.
for want in 64 1; do
  code=0
  in_time 120 env MIGRATE_FINTO_EXIT="$want" "$dc" run --rm -T migrate node dist/cli.js ops:record-backup \
    --kind full --ok >"$work/s3-migrate-$want.out" 2>"$work/s3-migrate-$want.err" || code=$?
  expect_code "migrate finto con MIGRATE_FINTO_EXIT=$want" "$want" "$code" "$work/s3-migrate-$want.err"
  expect_only "$work/s3-migrate-$want.out" 'migrate finto: node dist/cli.js ops:record-backup --kind full --ok'
done
check 'S3 prova di servizio: il migrate finto stampa i suoi argomenti ed esce con il codice scelto (64, poi 1)'

# P1. PostgreSQL started as on the servers.
code=0
in_time 300 "$dc" up -d --no-build --wait --wait-timeout 180 postgres >"$work/p1-up.out" 2>&1 || code=$?
expect_code 'avvio di postgres fino alla salute' 0 "$code" "$work/p1-up.out"
mode=$(sql 'show archive_mode')
[ "$mode" = on ] || differs 'archive_mode on' "${mode:-nessuna risposta}"
# The files of the folder of the indicator file before the first pgbackrest-init.
baseline=$(home_files)
check 'P1 OPS-001: postgres in salute, con archive_mode on'

# P2. The first pgbackrest-init: the bucket is empty, so the stanza is missing (code 1).
run_init p2-init 420
expect_code 'pgbackrest-init' 0 "$code" "$work/p2-init.err" "$work/p2-init.out"
expect_own_lines "$work/p2-init.out" 'pgbackrest-init: info: stanza 1' 'pgbackrest-init: stanza-create' \
  'pgbackrest-init: check' 'pgbackrest-init: file indicatore scritto'
expect_indicator
check 'P2 OPS-001: prima esecuzione: info: stanza 1, stanza-create, check; file indicatore sul volume, senza temporanei'

# P3. The lines of pgBackRest (stanza-create and check with --log-level-console=info) show <redacted> in place of key,
# secret and repo1-cipher-pass.
grep -qsF '<redacted>' "$work/p2-init.out" "$work/p2-init.err" ||
  differs '«<redacted>» nelle righe di pgBackRest (stanza-create e check)' 'assente'
expect_no_secret "$work/p2-init.out" "$work/p2-init.err"
check "P3 OPS-001, 00§4.2: l'uscita della prima esecuzione mostra <redacted> e nessun segreto di prova"

# P4. WAL archiving: after an insert and a WAL switch, pgbackrest info shows a newer archived segment within 120 s
# (polled every 5 s), and failed_count stays as it was after pgbackrest-init (before the stanza the attempts fail by
# construction). When pgbackrest info fails, the polling stops at once.
f0=$(sql 'select failed_count from pg_stat_archiver')
info_code=0
a0=$(archive_max) || info_code=$?
if [ "$info_code" -ne 0 ]; then
  differs 'pgbackrest info con codice 0' "codice $info_code ($(last_of "$work/p4-info.err"))"
elif ! [[ $f0 =~ ^[0-9]+$ ]]; then
  differs 'failed_count letto da pg_stat_archiver' "${f0:-nessuna risposta} ($(last_of "$work/sql.err"))"
elif ! sql 'create table if not exists prova_wal (n integer); insert into prova_wal values (1)' >/dev/null ||
  ! sql 'select pg_switch_wal()' >/dev/null; then
  differs "l'inserimento e pg_switch_wal()" "non riusciti ($(last_of "$work/sql.err"))"
else
  a=$a0
  deadline=$((SECONDS + 120))
  while [ "$SECONDS" -lt "$deadline" ]; do
    sleep 5
    info_code=0
    a=$(archive_max) || info_code=$?
    if [ "$info_code" -ne 0 ]; then
      differs 'pgbackrest info con codice 0' "codice $info_code ($(last_of "$work/p4-info.err"))"
      break
    fi
    [[ $a > $a0 ]] && break
  done
  if [ "$info_code" -eq 0 ] && ! [[ $a > $a0 ]]; then
    differs "entro 120 s un WAL archiviato più recente di ${a0:-nessuno}" "${a:-nessuno}"
  fi
  f=$(sql 'select failed_count from pg_stat_archiver')
  [ "$f" = "$f0" ] || differs "failed_count $f0, come dopo pgbackrest-init" "${f:-nessuna risposta}"
fi
check 'P4 OPS-001: entro 120 s da un inserimento, pgbackrest info mostra un WAL più recente; failed_count non aumenta'

# P5. The second pgbackrest-init: the indicator file is there, so no request to the bucket.
before=$(requests s3-tls-init)
start=$SECONDS
run_init p5-init 120
elapsed=$((SECONDS - start))
expect_code 'pgbackrest-init' 0 "$code" "$work/p5-init.err" "$work/p5-init.out"
expect_only "$work/p5-init.out" "$indicator_line"
[ "$elapsed" -le 20 ] || differs 'al più 20 s' "$elapsed s"
sleep 2
expect_same_requests 'a s3-tls-init' "$before" "$(requests s3-tls-init)"
check 'P5 OPS-001: seconda esecuzione: solo la riga del file indicatore, in al più 20 s, nessuna richiesta al bucket'

# P6. Without the indicator file (as after a restore on a new volume): info and check again, the file rewritten.
code=0
in_time 60 "$dc" exec -T -u postgres postgres rm -f "$indicator" >"$work/p6-rm.out" 2>"$work/p6-rm.err" || code=$?
expect_code 'rm del file indicatore' 0 "$code" "$work/p6-rm.err"
before=$(requests s3-tls-init)
run_init p6-init 420
expect_code 'pgbackrest-init' 0 "$code" "$work/p6-init.err" "$work/p6-init.out"
expect_own_lines "$work/p6-init.out" 'pgbackrest-init: info: stanza 2' 'pgbackrest-init: check' \
  'pgbackrest-init: file indicatore scritto'
expect_more_requests s3-tls-init "$before" "$(requests_after s3-tls-init "$before")"
expect_indicator
check 'P6 OPS-001: senza il file indicatore rifà info (stanza 2) e check, senza stanza-create, e lo riscrive'

# P7. backup.sh diff on a stanza without a full backup.
run_backup p7 diff 64
expect_code 'backup.sh diff' 0 "$code" "$work/p7.err" "$work/p7.out"
expect_line "$work/p7.out" "$no_full_line"
expect_migrate "$work/p7.out" \
  '^migrate finto: node dist/cli\.js ops:record-backup --kind full --ok --duration-s [0-9]+ --size-bytes [1-9][0-9]*$' \
  'migrate finto: node dist/cli.js ops:record-backup --kind full --ok --duration-s <secondi> --size-bytes <byte>'
expect_line "$work/p7.out" "$warning_64"
summary p7-summary
expect_code 'pgbackrest-summary' 0 "$summary_code" "$work/p7-summary.err"
grep -qE '^backup [^ ]+ full [0-9]+$' "$work/p7-summary.out" 2>/dev/null ||
  differs 'nel riassunto una riga «backup <etichetta> full <byte>»' "$(brief <"$work/p7-summary.out")"
check 'P7 OPS-002, OPS-003: diff senza un completo fa un completo (--kind full --ok); codice 64: avviso e uscita 0'

# P8. backup.sh diff with a full backup in the repository.
run_backup p8 diff 64
expect_code 'backup.sh diff' 0 "$code" "$work/p8.err" "$work/p8.out"
expect_no_line "$work/p8.out" "$no_full_line"
expect_migrate "$work/p8.out" \
  '^migrate finto: node dist/cli\.js ops:record-backup --kind diff --ok --duration-s [0-9]+ --size-bytes [0-9]+$' \
  'migrate finto: node dist/cli.js ops:record-backup --kind diff --ok --duration-s <secondi> --size-bytes <byte>'
summary p8-summary
expect_code 'pgbackrest-summary' 0 "$summary_code" "$work/p8-summary.err"
last=$(grep '^backup ' "$work/p8-summary.out" 2>/dev/null | tail -n 1)
[ "$(printf '%s\n' "$last" | awk '{ print $3 }')" = diff ] ||
  differs "l'ultima riga backup del riassunto di tipo diff" "${last:-nessuna riga backup}"
check 'P8 OPS-002: backup.sh diff con un completo fa un differenziale (--kind diff --ok; ultimo backup di tipo diff)'

# P9. ops:record-backup fails with 1: the backup succeeds, backup.sh fails.
run_backup p9 full 1
expect_code 'backup.sh full' 1 "$code" "$work/p9.err" "$work/p9.out"
expect_migrate "$work/p9.out" \
  '^migrate finto: node dist/cli\.js ops:record-backup --kind full --ok --duration-s [0-9]+ --size-bytes [1-9][0-9]*$' \
  'migrate finto: node dist/cli.js ops:record-backup --kind full --ok --duration-s <secondi> --size-bytes <byte>'
expect_line "$work/p9.err" 'backup.sh: errore: ops:record-backup terminato con codice 1'
check 'P9 OPS-003: ops:record-backup che esce con 1: backup.sh full (--kind full --ok) termina con 1 e il suo errore'

# P10. The option lines of pgBackRest (the start of each backup, with --log-level-console=info) show <redacted>, and no
# test secret appears in any captured output nor in the logs of postgres and of the proxy.
in_time 60 "$dc" logs --no-color postgres >"$work/log-postgres.txt" 2>&1
in_time 60 "$dc" logs --no-color proxy >"$work/log-proxy.txt" 2>&1
missing=
for name in p7 p8 p9; do
  grep -qsF '<redacted>' "$work/$name.out" "$work/$name.err" || missing="$missing ${name^^}"
done
[ -z "$missing" ] ||
  differs '«<redacted>» nelle uscite di backup.sh (righe di inizio dei backup)' "assente in:$missing"
expect_no_secret "$work"/*
check 'P10 OPS-001, 00§4.2: <redacted> nelle uscite di backup.sh; nessun segreto di prova nelle uscite e nei log'

# P11. postgres stopped, as on the servers until FON-T07b: backup.sh skips the backup, with no record and no request.
code=0
in_time 120 "$dc" stop postgres >"$work/p11-stop.out" 2>&1 || code=$?
expect_code 'docker compose stop postgres' 0 "$code" "$work/p11-stop.out"
sleep 2 # the last WAL archived at shutdown is in the log
before=$(requests)
run_backup p11 diff 1
expect_code 'backup.sh diff' 0 "$code" "$work/p11.err" "$work/p11.out"
expect_line "$work/p11.out" 'backup.sh: il servizio postgres non è in esecuzione: backup saltato'
if grep -qs '^migrate finto' "$work/p11.out" "$work/p11.err"; then
  differs 'nessuna riga del migrate finto (nessuna registrazione)' 'presente'
fi
sleep 2
expect_same_requests 'al bucket' "$before" "$(requests)"
check 'P11 OPS-002: postgres fermo: backup.sh diff esce con 0 e il messaggio, senza registrazione né richieste'

if [ "$same" -ne "$total" ]; then
  # Only test values: compose.yml has no real key, secret or password.
  echo
  echo 'Ultime 30 righe dei log di postgres e del proxy e delle uscite catturate (solo valori di prova):'
  for service in postgres proxy; do
    echo "--- log di $service"
    in_time 60 "$dc" logs --no-color --no-log-prefix "$service" 2>&1 | tail -n 30
  done
  for file in "$work"/*; do
    case $file in *.out | *.err) ;; *) continue ;; esac
    [ -s "$file" ] || continue
    echo "--- ${file##*/}"
    tail -n 30 -- "$file"
  done
fi
echo
cleanup
echo "Prove: $total, come attese: $same, diverse: $((total - same))"
[ "$same" -eq "$total" ]
