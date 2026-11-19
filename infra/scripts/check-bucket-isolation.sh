#!/usr/bin/env bash
# check-bucket-isolation.sh: isolation test of the S3 storage units
# (specs/08-operativita.md, OPS-007 and OPS-008; task OPS-T03).
#
# Every key must work in its own bucket and be refused on every other bucket: list, read, write
# and delete. The only declared exception is the read-only key of the mirror (MIRROR_SRC): it
# lists and reads the production backup bucket, while writing, deleting and changing the bucket
# policy there are refused. Requests without a key must be refused on every bucket.
# Only AccessDenied counts as a refusal: any other error (wrong key, missing bucket, network)
# fails the check, because it proves nothing about permissions.
#
# The user runs it from their own terminal (AVVIO.md, «Fuori da GitHub»): Claude never has the
# keys, and no server has all of them. How to run it: infra/README.md, «Archivi S3 (OPS-T03)».
#
# Input, from the environment:
#   <UNIT>_BUCKET, <UNIT>_ENDPOINT, <UNIT>_REGION (not secret) for the bucket units
#     FILE_PROD, BACKUP_PROD, FILE_TEST, BACKUP_TEST and MIRROR_DST;
#   <UNIT>_ACCESS_KEY_ID and <UNIT>_SECRET_ACCESS_KEY for the same units and for MIRROR_SRC,
#     whose project has no bucket. A key part that is not in the environment is asked on the
#     terminal. On a terminal, echo stays off from the start to the end of the run; anything
#     pasted before the first question is discarded; a wrong paste (empty, with spaces, or equal
#     to a part already given) is asked again instead of stopping the script; Ctrl-Z is ignored (a
#     suspended script would come back with echo on); and any input left pending is discarded at
#     exit, so that a key can never reach the screen, the user's shell or its history.
# Options: --aws <path> runs that client instead of "aws" (AWS CLI v2); --help.
# Exit status: 0 every check passed, 1 at least one check failed, 2 usage or configuration error,
# 130 interrupted.
#
# Keys are never printed, written to a file or put on a command line: each AWS CLI call gets one
# key pair through its own environment, with no configuration or credentials file. The bucket
# policy read for the policy probe stays in memory (with the per-key form it holds an Access key).
# Test objects live under check-bucket-isolation/<run>/ and are deleted at the end. In the
# versioned buckets the deletion leaves hidden versions, which the lifecycle rules remove after
# 30 days (file buckets) or 45 days (mirror, where Object Lock keeps them until then).

set +x +v
set -u -o pipefail
umask 077
ulimit -c 0 2>/dev/null || true

BUCKET_UNITS=(FILE_PROD BACKUP_PROD FILE_TEST BACKUP_TEST MIRROR_DST)
KEY_UNITS=(FILE_PROD BACKUP_PROD FILE_TEST BACKUP_TEST MIRROR_DST MIRROR_SRC)
READ_ONLY_KEY=MIRROR_SRC     # the declared exception of OPS-007...
READ_ONLY_BUCKET=BACKUP_PROD # ...which lists and reads this bucket only
declare -A LABEL=(
  [FILE_PROD]='file di produzione'
  [BACKUP_PROD]='backup di produzione'
  [FILE_TEST]='file di test'
  [BACKUP_TEST]='backup di test'
  [MIRROR_DST]='specchio'
  [MIRROR_SRC]='sola lettura dello specchio'
  [ANONYMOUS]='nessuna chiave'
)
declare -A SENTINEL_MD5=() WRITTEN=() WRITE_LEAKED=()
# Key variables that the user may have exported reach no program started by the script: each
# AWS CLI call gets its own key pair, and only that, as AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.
for u in "${KEY_UNITS[@]}"; do export -n "${u}_ACCESS_KEY_ID" "${u}_SECRET_ACCESS_KEY"; done
CLIENT_BIN=aws
SECRETS=()
SECRET_VARS=()
TOTAL=0
FAILED=0
FAILURES=()
CALL_RESULT=
CALL_DETAIL=
TMP_DIR=
PREFIX=
TTY_STATE=
KEY_PHASE=

say() { printf '%s\n' "$*"; }

# --- Terminal and exit ------------------------------------------------------------------------

flush_tty() { # discards terminal input not yet read, a line without Enter included
  local junk
  if command -v python3 >/dev/null 2>&1; then
    python3 -I -c 'import termios; termios.tcflush(0, termios.TCIFLUSH)' 2>/dev/null
  fi
  while IFS= read -r -s -t 0.05 -n 4096 junk; do :; done
  return 0
}
restore_tty() {
  [ -n "$TTY_STATE" ] || return 0
  flush_tty
  stty "$TTY_STATE" 2>/dev/null || stty echo 2>/dev/null
  TTY_STATE=
  return 0
}
warn_stop() {
  printf '\n%s\n%s\n' \
    "ATTENZIONE: lo script si è fermato mentre chiedeva le chiavi." \
    "Non incollare altre chiavi in questo terminale: chiudilo e aprine uno nuovo (infra/README.md)." >&2
}
# Every way out ignores further INT, TERM and HUP first: a second Ctrl-C must not cut short the
# terminal restore. Ctrl-Z is ignored for the whole run, by the script and by the programs it starts.
on_exit() {
  trap '' INT TERM HUP
  restore_tty
  [ -z "$TMP_DIR" ] || rm -rf -- "$TMP_DIR"
}
on_interrupt() {
  trap '' INT TERM HUP
  local bu written=
  [ -z "$KEY_PHASE" ] || warn_stop
  for bu in "${BUCKET_UNITS[@]}"; do
    [ -z "${WRITTEN[$bu]:-}" ] || written="$written $(bucket_of "$bu")"
  done
  if [ -n "$written" ]; then
    printf '\nInterrotto: gli oggetti di prova restano sotto %s nei bucket:%s\n' "$PREFIX" "$written" >&2
  else
    printf '\nInterrotto.\n' >&2
  fi
  exit 130
}
trap on_exit EXIT
trap on_interrupt INT TERM HUP
trap '' TSTP

# On a terminal, echo stays off from here to the end of the run (restored, with pending input
# discarded, by on_exit): nothing pasted at the wrong moment can appear on the screen.
if [ -t 0 ] && TTY_STATE=$(stty -g 2>/dev/null); then stty -echo 2>/dev/null; else TTY_STATE=; fi

config_error() {
  trap '' INT TERM HUP
  printf 'ERRORE DI CONFIGURAZIONE: %s\n' "$*" >&2
  [ -z "$KEY_PHASE" ] || warn_stop
  exit 2
}

usage() {
  cat <<'EOF'
Uso: bash infra/scripts/check-bucket-isolation.sh [--aws <client>]

Prova l'isolamento delle unità di archivio S3 (OPS-007, OPS-008): ogni chiave lavora
nel suo bucket ed è rifiutata negli altri; l'unica eccezione è la chiave di sola
lettura dello specchio, che elenca e legge il bucket dei backup di produzione.

Prima di lanciarlo imposta le variabili non segrete con il blocco di infra/README.md,
«Archivi S3 (OPS-T03)». Le chiavi le chiede lo script, senza mostrarle.

Esce con 0 se tutti i controlli riescono, 1 se almeno uno fallisce, 2 per un errore
di configurazione, 130 se viene interrotto.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --aws)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then config_error "dopo --aws serve il percorso del client"; fi
      CLIENT_BIN=$2
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) config_error "argomento non previsto: lo script accetta solo --aws <client> e --help" ;;
  esac
done

for tool in openssl cmp mktemp paste; do
  command -v "$tool" >/dev/null 2>&1 || config_error "manca il programma $tool"
done
command -v "$CLIENT_BIN" >/dev/null 2>&1 ||
  config_error "client S3 non trovato ($CLIENT_BIN): installalo come dice infra/README.md"

# The AWS CLI must see only the key pair of each call and the settings below: every AWS_* variable
# inherited from the user's shell (a key exported for an earlier command, a profile, a session
# token, an endpoint, a region, an error format) is removed first.
for var in $(compgen -e); do
  case $var in AWS_*) unset "$var" ;; esac
done
export AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_PAGER= \
  AWS_DEFAULT_OUTPUT=json AWS_CLI_AUTO_PROMPT=off AWS_EC2_METADATA_DISABLED=true \
  AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=4 \
  AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

# --- Configuration (not secret) ---------------------------------------------------------------

bucket_re='^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'
endpoint_re='^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$'
region_re='^[a-z0-9][a-z0-9-]*$'
missing=()
for u in "${BUCKET_UNITS[@]}"; do
  for field in BUCKET ENDPOINT REGION; do
    var="${u}_${field}"
    [ -n "${!var:-}" ] || missing+=("$var")
  done
done
if [ "${#missing[@]}" -eq 1 ]; then
  config_error "manca la variabile ${missing[*]} (blocco in infra/README.md, «Archivi S3 (OPS-T03)»)"
elif [ "${#missing[@]}" -gt 1 ]; then
  config_error "mancano le variabili ${missing[*]} (blocco in infra/README.md, «Archivi S3 (OPS-T03)»)"
fi
for u in "${BUCKET_UNITS[@]}"; do
  b="${u}_BUCKET" e="${u}_ENDPOINT" r="${u}_REGION"
  printf -v "$e" '%s' "${!e%/}"
  [[ ${!b} =~ $bucket_re ]] || config_error "$b non è un nome di bucket valido"
  [[ ${!e} =~ $endpoint_re ]] || config_error "$e deve essere un indirizzo https:// senza percorso"
  [[ ${!r} =~ $region_re ]] || config_error "$r non è una regione valida"
done
for ((i = 0; i < ${#BUCKET_UNITS[@]}; i++)); do
  for ((j = i + 1; j < ${#BUCKET_UNITS[@]}; j++)); do
    bi="${BUCKET_UNITS[i]}_BUCKET" bj="${BUCKET_UNITS[j]}_BUCKET"
    [ "${!bi}" != "${!bj}" ] || config_error "$bi e $bj indicano lo stesso bucket"
  done
done

bucket_of() { local v="${1}_BUCKET"; printf '%s' "${!v}"; }
region_of() { local v="${1}_REGION"; printf '%s' "${!v}"; }

say ""
say "check-bucket-isolation.sh: isolamento delle unità di archivio S3 (OPS-007, OPS-008)"
say "Client: $("$CLIENT_BIN" --version 2>&1 </dev/null | head -n 1)"
say "Unità:"
for u in "${BUCKET_UNITS[@]}"; do
  e="${u}_ENDPOINT"
  say "  «${LABEL[$u]}»: bucket $(bucket_of "$u"), ${!e}, regione $(region_of "$u")"
done
say "  «${LABEL[$READ_ONLY_KEY]}»: nessun bucket; legge solo $(bucket_of "$READ_ONLY_BUCKET")"

# --- Keys (secret) ----------------------------------------------------------------------------

# read_secret <variable> <prompt>: takes the value from the environment, or asks it on the
# terminal until it is acceptable. Afterwards the variable is no longer exported, so no child
# process receives it.
read_secret() {
  local var=$1 value=${!1:-} from_env=1 problem i
  if [ -z "$value" ]; then
    from_env=
    [ -t 0 ] || config_error "manca $var e il terminale non è interattivo"
  fi
  while :; do
    if [ -z "$from_env" ]; then
      printf '%s: ' "$2" >&2
      if ! IFS= read -r -s value; then
        printf '\n' >&2
        config_error "lettura di $var interrotta (fine dell'input)"
      fi
      printf '\n' >&2
    fi
    value=${value//$'\r'/}
    value=${value#"${value%%[![:space:]]*}"}
    value=${value%"${value##*[![:space:]]}"}
    problem=
    if [[ $value == *[[:space:]]* ]]; then
      problem='contiene spazi'
    else
      value=${value//[[:cntrl:]]/}
      [ -n "$value" ] || problem='è vuota'
    fi
    if [ -z "$problem" ]; then
      for i in "${!SECRETS[@]}"; do
        [ "${SECRETS[i]}" != "$value" ] || problem="è uguale a ${SECRET_VARS[i]}"
      done
    fi
    [ -n "$problem" ] || break
    [ -z "$from_env" ] || config_error "$var $problem"
    printf '  %s: incollala di nuovo dal gestore di password\n' "$problem" >&2
  done
  printf -v "$var" '%s' "$value"
  export -n "$var"
  SECRETS+=("$value")
  SECRET_VARS+=("$var")
  [ -n "$from_env" ] || printf '  ricevuta\n' >&2
}

asked=
for u in "${KEY_UNITS[@]}"; do
  for field in ACCESS_KEY_ID SECRET_ACCESS_KEY; do
    var="${u}_${field}"
    if [ -z "${!var:-}" ] && [ -z "$asked" ] && [ -t 0 ]; then
      flush_tty # anything pasted before the first question is thrown away, not taken as a key
      KEY_PHASE=1
      say ""
      say "Incolla ogni parte dal gestore di password e premi Invio: sullo schermo non compare."
      say "Dopo ogni parte compare «ricevuta». Se una parte è vuota, contiene spazi o è già stata data,"
      say "lo script la chiede di nuovo; una chiave sbagliata la segnala la prova."
      say "Ctrl-Z non ferma lo script: per fermarlo, Ctrl-C."
      asked=1
    fi
    if [ "$field" = ACCESS_KEY_ID ]; then part='Access key'; else part='Secret key'; fi
    read_secret "$var" "Chiave «${LABEL[$u]}», $part ($var)"
  done
done
KEY_PHASE=
[ -z "$asked" ] || say "Chiavi ricevute: non incollare altro in questo terminale fino alla fine della prova."

# --- Run setup --------------------------------------------------------------------------------

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/check-bucket-isolation.XXXXXX") ||
  config_error "non riesco a creare una cartella temporanea"
PREFIX="check-bucket-isolation/$RUN_ID/"
SENTINEL="${PREFIX}sentinella.txt"

md5_base64() { openssl dgst -md5 -binary "$1" | openssl base64 -A; }
md5_re='^[A-Za-z0-9+/]{22}==$'
for u in "${BUCKET_UNITS[@]}"; do
  printf 'check-bucket-isolation %s %s\n' "$RUN_ID" "$(bucket_of "$u")" >"$TMP_DIR/sentinel.$u"
  SENTINEL_MD5[$u]=$(md5_base64 "$TMP_DIR/sentinel.$u")
  [[ ${SENTINEL_MD5[$u]} =~ $md5_re ]] || config_error "openssl non calcola l'MD5 dei file di prova"
done
printf 'check-bucket-isolation %s: scrittura che deve essere rifiutata\n' "$RUN_ID" >"$TMP_DIR/probe"
PROBE_MD5=$(md5_base64 "$TMP_DIR/probe")
[[ $PROBE_MD5 =~ $md5_re ]] || config_error "openssl non calcola l'MD5 dei file di prova"

# --- Calls and checks -------------------------------------------------------------------------

# error_line: last line of the client's error output, without keys and control characters.
error_line() {
  local line s
  line=$(grep -v '^[[:space:]]*$' "$TMP_DIR/err" | tail -n 1)
  for s in "${SECRETS[@]}"; do line=${line//"$s"/[chiave]}; done
  line=${line//[[:cntrl:]]/}
  printf '%s' "${line:0:200}"
}

# aws_run <key unit | ANONYMOUS> <bucket unit> <aws arguments...>: one AWS CLI call with that key,
# against the endpoint and region of the bucket unit. The key pair reaches the client only
# through the environment of this call. The caller puts input and output redirections on a
# subshell around the call, never on the function call itself: a trap (Ctrl-C during the call)
# then runs with the script's own input and output, the terminal, and can restore it.
aws_run() {
  local key_unit=$1 bucket_unit=$2
  shift 2
  local endpoint_var="${bucket_unit}_ENDPOINT" region_var="${bucket_unit}_REGION"
  (
    if [ "$key_unit" = ANONYMOUS ]; then
      exec "$CLIENT_BIN" --no-sign-request --endpoint-url "${!endpoint_var}" --region "${!region_var}" \
        --cli-connect-timeout 15 --cli-read-timeout 60 "$@"
    fi
    id_var="${key_unit}_ACCESS_KEY_ID" secret_var="${key_unit}_SECRET_ACCESS_KEY"
    export AWS_ACCESS_KEY_ID="${!id_var}" AWS_SECRET_ACCESS_KEY="${!secret_var}"
    exec "$CLIENT_BIN" --endpoint-url "${!endpoint_var}" --region "${!region_var}" \
      --cli-connect-timeout 15 --cli-read-timeout 60 "$@"
  )
}

# classify <exit status>: sets CALL_RESULT to ok, denied (only for AccessDenied) or error, with
# the error code in CALL_DETAIL, from the exit status and the error output in $TMP_DIR/err.
classify() {
  CALL_DETAIL=
  if [ "$1" -eq 0 ]; then
    CALL_RESULT=ok
  elif grep -F 'An error occurred (AccessDenied)' "$TMP_DIR/err" >/dev/null; then
    CALL_RESULT=denied
    CALL_DETAIL=AccessDenied
  else
    CALL_RESULT=error
    CALL_DETAIL=$(sed -n 's/.*An error occurred (\([A-Za-z0-9._-]*\)).*/\1/p' "$TMP_DIR/err" | head -n 1)
    [ -n "$CALL_DETAIL" ] || CALL_DETAIL="codice di uscita $1: $(error_line)"
  fi
}

# aws_as: the usual call, without input; the output stays in $TMP_DIR/out.
aws_as() {
  (aws_run "$@") </dev/null >"$TMP_DIR/out" 2>"$TMP_DIR/err"
  classify $?
}

pass() { TOTAL=$((TOTAL + 1)); printf '  OK  %s\n' "$1"; }
fail() { TOTAL=$((TOTAL + 1)); FAILED=$((FAILED + 1)); FAILURES+=("$1"); printf '  NO  %s\n' "$1"; }

# expect_denied <who> <operation>: passes only if the last call ended with AccessDenied.
# Every operation name is feminine (lista, lettura, scrittura, cancellazione, modifica).
expect_denied() {
  case $CALL_RESULT in
    denied) pass "$1: $2 rifiutata" ;;
    ok) fail "$1: $2 PERMESSA, doveva essere rifiutata" ;;
    *) fail "$1: $2, risposta inattesa $CALL_DETAIL (attesa AccessDenied)" ;;
  esac
}

# words <file>: the words of an AWS CLI text output, sorted, without the "None" of empty results.
words() { tr -s '[:space:]' '\n' <"$1" | grep -v -x -e '' -e None | sort -u | paste -s -d ' ' -; }

# has_word <file> <word>
has_word() { tr -s '[:space:]' '\n' <"$1" | grep -x -F -e "$2" >/dev/null; }

check_list() { # <key unit | ANONYMOUS> <bucket unit> <allowed | denied>
  local k=$1 bu=$2 b who
  b=$(bucket_of "$bu")
  who="«${LABEL[$k]}» → $b"
  aws_as "$k" "$bu" s3api list-objects-v2 --bucket "$b" --prefix "$PREFIX" --query 'Contents[].Key' --output text
  if [ "$3" = denied ]; then
    expect_denied "$who" "lista degli oggetti"
  elif [ "$CALL_RESULT" != ok ]; then
    fail "$who: lista degli oggetti non riuscita: $CALL_DETAIL"
  elif has_word "$TMP_DIR/out" "$SENTINEL"; then
    pass "$who: lista degli oggetti riuscita"
  else
    fail "$who: lista degli oggetti riuscita, ma senza l'oggetto di prova"
  fi
}

check_read() { # <key unit | ANONYMOUS> <bucket unit> <allowed | denied>
  local k=$1 bu=$2 b who
  b=$(bucket_of "$bu")
  who="«${LABEL[$k]}» → $b"
  rm -f -- "$TMP_DIR/got"
  aws_as "$k" "$bu" s3api get-object --bucket "$b" --key "$SENTINEL" "$TMP_DIR/got"
  if [ "$3" = denied ]; then
    expect_denied "$who" lettura
  elif [ "$CALL_RESULT" != ok ]; then
    fail "$who: lettura non riuscita: $CALL_DETAIL"
  elif cmp -s -- "$TMP_DIR/got" "$TMP_DIR/sentinel.$bu"; then
    pass "$who: lettura riuscita"
  else
    fail "$who: lettura riuscita, ma il contenuto non è quello dell'oggetto di prova"
  fi
}

check_write() { # <key unit | ANONYMOUS> <bucket unit>: always expected to be refused; the cleanup
  local k=$1 bu=$2 b  # then checks that no refused write left an object behind
  b=$(bucket_of "$bu")
  aws_as "$k" "$bu" s3api put-object --bucket "$b" --key "${PREFIX}scrittura-${k}.txt" \
    --body "$TMP_DIR/probe" --content-md5 "$PROBE_MD5"
  [ "$CALL_RESULT" != ok ] || WRITE_LEAKED[$bu:$k]=1
  expect_denied "«${LABEL[$k]}» → $b" scrittura
}

put_sentinel() { # <bucket unit>: the owner writes (or writes again) the test object
  local bu=$1
  aws_as "$bu" "$bu" s3api put-object --bucket "$(bucket_of "$bu")" --key "$SENTINEL" \
    --body "$TMP_DIR/sentinel.$bu" --content-md5 "${SENTINEL_MD5[$bu]}"
}

check_delete() { # <key unit | ANONYMOUS> <bucket unit>: always expected to be refused; the owner
  local k=$1 bu=$2 b who result detail # then checks that the test object is really still there
  b=$(bucket_of "$bu")
  who="«${LABEL[$k]}» → $b"
  aws_as "$k" "$bu" s3api delete-object --bucket "$b" --key "$SENTINEL"
  result=$CALL_RESULT detail=$CALL_DETAIL
  aws_as "$bu" "$bu" s3api head-object --bucket "$b" --key "$SENTINEL"
  if [ "$CALL_RESULT" = ok ]; then
    case $result in
      denied) pass "$who: cancellazione rifiutata (l'oggetto di prova c'è ancora)" ;;
      ok) fail "$who: cancellazione PERMESSA, doveva essere rifiutata" ;;
      *) fail "$who: cancellazione, risposta inattesa $detail (attesa AccessDenied)" ;;
    esac
    return
  fi
  if [ "$CALL_DETAIL" != 404 ]; then
    fail "$who: cancellazione con risposta ${detail:-di riuscita}, ma il proprietario non riesce a verificare l'oggetto di prova: $CALL_DETAIL"
    return
  fi
  case $result in
    ok) fail "$who: cancellazione PERMESSA, doveva essere rifiutata (l'oggetto di prova è sparito)" ;;
    *) fail "$who: cancellazione con risposta $detail, ma l'oggetto di prova è sparito" ;;
  esac
  put_sentinel "$bu"
  [ "$CALL_RESULT" = ok ] ||
    fail "«${LABEL[$bu]}» → $b: il proprietario non riesce a riscrivere l'oggetto di prova: $CALL_DETAIL"
}

check_policy_change() { # <key unit> <bucket unit>: refused; the probe sends the identical policy
  local k=$1 bu=$2 b who policy
  b=$(bucket_of "$bu")
  who="«${LABEL[$k]}» → $b"
  policy=$(aws_run "$bu" "$bu" s3api get-bucket-policy --bucket "$b" --query Policy --output text \
    </dev/null 2>"$TMP_DIR/err")
  classify $?
  if [ "$CALL_RESULT" != ok ] || [ -z "$policy" ]; then
    fail "$who: modifica della policy non provata, perché il proprietario non riesce a leggerla: ${CALL_DETAIL:-policy vuota}"
    return
  fi
  (aws_run "$k" "$bu" s3api put-bucket-policy --bucket "$b" --policy file:///dev/stdin) \
    < <(printf '%s\n' "$policy") >"$TMP_DIR/out" 2>"$TMP_DIR/err"
  classify $?
  expect_denied "$who" "modifica della policy"
}

cleanup() {
  local bu b n leftover errors unexpected key name writer keys=()
  say ""
  say "4. Pulizia degli oggetti di prova"
  for bu in "${BUCKET_UNITS[@]}"; do
    [ -n "${WRITTEN[$bu]:-}" ] || continue
    b=$(bucket_of "$bu")
    aws_as "$bu" "$bu" s3api list-objects-v2 --bucket "$b" --prefix "$PREFIX" --query 'Contents[].Key' --output text
    if [ "$CALL_RESULT" != ok ]; then
      fail "«${LABEL[$bu]}» → $b: pulizia non riuscita, lista degli oggetti: $CALL_DETAIL"
      continue
    fi
    read -r -a keys <<<"$(words "$TMP_DIR/out")"
    n=0 errors= unexpected=
    for key in "${keys[@]}"; do
      name=${key#"$PREFIX"}
      case $name in
        sentinella.txt) ;;
        scrittura-*.txt)
          writer=${name#scrittura-}
          writer=${writer%.txt}
          [ -n "${WRITE_LEAKED[$bu:$writer]:-}" ] || unexpected="$unexpected $name"
          ;;
        *) unexpected="$unexpected $name" ;;
      esac
      aws_as "$bu" "$bu" s3api delete-object --bucket "$b" --key "$key"
      if [ "$CALL_RESULT" = ok ]; then n=$((n + 1)); else errors="$errors $name ($CALL_DETAIL)"; fi
    done
    [ -z "$unexpected" ] ||
      fail "«${LABEL[$bu]}» → $b: c'erano oggetti che una scrittura rifiutata non doveva lasciare:$unexpected"
    aws_as "$bu" "$bu" s3api list-objects-v2 --bucket "$b" --prefix "$PREFIX" --query 'Contents[].Key' --output text
    leftover=$(words "$TMP_DIR/out")
    if [ "$CALL_RESULT" != ok ]; then
      fail "«${LABEL[$bu]}» → $b: pulizia non verificata, lista degli oggetti: $CALL_DETAIL"
    elif [ -n "$errors" ] || [ -n "$leftover" ]; then
      fail "«${LABEL[$bu]}» → $b: pulizia incompleta, restano oggetti sotto $PREFIX${errors:+ (errori:$errors)}"
    else
      pass "«${LABEL[$bu]}» → $b: oggetti di prova cancellati ($n)"
    fi
  done
  [ "${#WRITTEN[@]}" -gt 0 ] || say "  Nessun oggetto di prova da cancellare."
  if [ -n "${WRITTEN[MIRROR_DST]:-}" ]; then
    say "  Nello specchio le versioni degli oggetti di prova restano bloccate (Object Lock), nascoste da"
    say "  un delete marker: il ciclo di vita le toglie dopo 45 giorni."
  fi
}

finish() {
  trap '' INT TERM HUP
  say ""
  if [ "$FAILED" -eq 0 ]; then
    printf 'RIUSCITO: %d controlli, nessuno fallito.\n' "$TOTAL"
    exit 0
  fi
  if [ "$FAILED" -eq 1 ]; then
    printf 'FALLITO: %d controlli, 1 fallito:\n' "$TOTAL"
  else
    printf 'FALLITO: %d controlli, %d falliti:\n' "$TOTAL" "$FAILED"
  fi
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
}

# --- Run --------------------------------------------------------------------------------------

say ""
say "Esecuzione: $RUN_ID (ora UTC); oggetti di prova sotto $PREFIX"

say ""
say "1. Ogni chiave nel proprio bucket"
for u in "${KEY_UNITS[@]}"; do
  if [ "$u" = "$READ_ONLY_KEY" ]; then
    # The read-only key must sit in a project without buckets: asked at every location in use.
    seen=
    for bu in "${BUCKET_UNITS[@]}"; do
      e="${bu}_ENDPOINT"
      case " $seen " in *" ${!e} "*) continue ;; esac
      seen="$seen ${!e}"
      aws_as "$u" "$bu" s3api list-buckets --query 'Buckets[].Name' --output text
      if [ "$CALL_RESULT" != ok ]; then
        fail "«${LABEL[$u]}»: elenco dei bucket del suo progetto, chiesto a $(region_of "$bu"), non riuscito: $CALL_DETAIL"
        continue
      fi
      found=$(words "$TMP_DIR/out")
      if [ -z "$found" ]; then
        pass "«${LABEL[$u]}»: l'elenco dei bucket del suo progetto, chiesto a $(region_of "$bu"), è vuoto"
      else
        fail "«${LABEL[$u]}»: l'elenco dei bucket del suo progetto, chiesto a $(region_of "$bu"), contiene «$found», atteso vuoto"
      fi
    done
    continue
  fi
  b=$(bucket_of "$u")
  aws_as "$u" "$u" s3api list-buckets --query 'Buckets[].Name' --output text
  if [ "$CALL_RESULT" != ok ]; then
    fail "«${LABEL[$u]}»: elenco dei bucket del suo progetto, chiesto a $(region_of "$u"), non riuscito: $CALL_DETAIL"
    continue
  fi
  found=$(words "$TMP_DIR/out")
  if [ "$found" = "$b" ]; then
    pass "«${LABEL[$u]}»: l'elenco dei bucket del suo progetto, chiesto a $(region_of "$u"), contiene solo $b"
  else
    fail "«${LABEL[$u]}»: l'elenco dei bucket del suo progetto, chiesto a $(region_of "$u"), contiene «${found:-nessun bucket}», atteso solo $b"
  fi
  put_sentinel "$u"
  if [ "$CALL_RESULT" != ok ]; then
    fail "«${LABEL[$u]}» → $b: scrittura non riuscita: $CALL_DETAIL"
    continue
  fi
  WRITTEN[$u]=1
  pass "«${LABEL[$u]}» → $b: scrittura riuscita"
  check_read "$u" "$u" allowed
  check_list "$u" "$u" allowed
done
if [ "$FAILED" -gt 0 ]; then
  say ""
  say "Le chiavi o i bucket non sono pronti: le prove fra le unità non partono."
  cleanup
  finish
fi

say ""
say "2. Ogni chiave nei bucket delle altre unità"
for k in "${KEY_UNITS[@]}"; do
  for bu in "${BUCKET_UNITS[@]}"; do
    [ "$k" != "$bu" ] || continue
    if [ "$k" = "$READ_ONLY_KEY" ] && [ "$bu" = "$READ_ONLY_BUCKET" ]; then
      check_list "$k" "$bu" allowed
      check_read "$k" "$bu" allowed
      check_write "$k" "$bu"
      check_delete "$k" "$bu"
      check_policy_change "$k" "$bu"
    else
      check_list "$k" "$bu" denied
      check_read "$k" "$bu" denied
      check_write "$k" "$bu"
      check_delete "$k" "$bu"
    fi
  done
done

say ""
say "3. Richieste senza chiave"
for bu in "${BUCKET_UNITS[@]}"; do
  check_list ANONYMOUS "$bu" denied
  check_read ANONYMOUS "$bu" denied
  check_write ANONYMOUS "$bu"
  check_delete ANONYMOUS "$bu"
done

cleanup
finish
