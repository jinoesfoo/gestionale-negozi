#!/usr/bin/env bash
# The AWS CLI remedy for empty S3 error messages (specs/08-operativita.md, OPS-T03, «Difetto del
# client S3»; aws/aws-cli#10161): checklist row A5 of docs/verifiche/ops-t03.md.
#
# It needs the real client /usr/local/bin/aws 2.39.4, installed on the yoo workstation in A2: it is
# not a CI test. It uses dummy keys and a local fake endpoint (server.py, 127.0.0.1 only), never a
# real key or the provider. It checks that:
# - the remedy's lines, between the «aws-cli-empty-message» markers, are the same byte for byte in
#   infra/scripts/check-bucket-isolation.sh and in the key terminal block of infra/README.md, and
#   are safe to paste (no tab, carriage return, trailing space or "!");
# - written by those lines, the remedy is read-only, and its startup check confirms it with the
#   real client, also from a folder and with a PYTHONPATH that hold a decoy module of the same
#   name; a client that ignores the configuration, a configuration that is not exported, an extra
#   file next to the module or an extra line in the configuration fails it;
# - the whole key terminal block of the README, sourced without a terminal, writes, exports and
#   confirms the remedy, and its s3 function sends nothing once the remedy has changed;
# - without the remedy the client still stops on an empty <Message> (exit status 255, "NoneType"):
#   when these cases turn red, the bug is fixed upstream, and the remedy goes away with a new task;
# - with the remedy, every refusal and every missing setting with an empty message shows its code
#   (exit status 254) for each operation of the README and of the I2 script; a message with text, a
#   HEAD error and the successes are unchanged; an empty code shows as (None).
# Every case name starts with the requirement it protects (OPS-004, OPS-005, OPS-007, OPS-008).
#
# Usage: bash tests/infra/aws-cli-empty-message/run.sh. Exit status: 0 every case as expected.
# CHECK_SCRIPT=<path> takes the remedy's lines from another copy of the script (mutation tests).
set -u -o pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
script=${CHECK_SCRIPT:-$root/infra/scripts/check-bucket-isolation.sh}
readme=$root/infra/README.md
client=/usr/local/bin/aws
work=$(mktemp -d "${TMPDIR:-/tmp}/aws-cli-empty-message.XXXXXX") || exit 1
server_pid=
cleanup() {
  [ -z "$server_pid" ] || kill "$server_pid" 2>/dev/null
  chmod -R u+w -- "$work" 2>/dev/null
  rm -rf -- "$work"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP # a Ctrl-C during a client call must stop the test, not only the call
mkdir -p -- "$work/home" "$work/server" "$work/decoy"

passed=0
failed=0
ok() { passed=$((passed + 1)); printf 'ok  %s\n' "$1"; }
no() {
  failed=$((failed + 1))
  printf 'NO  %s: %s\n' "$1" "$2"
  [ -z "${3:-}" ] || [ ! -s "$3" ] || sed 's/^/      | /' "$3" | tail -n 8
}
finish() {
  echo
  echo "Prove: $((passed + failed)), come attese: $passed, diverse: $failed"
  [ "$failed" -eq 0 ]
  exit
}

echo "Prova del correttivo del client (aws/aws-cli#10161; A5 di docs/verifiche/ops-t03.md)"

# extract <file> <output> <region start>: the lines from the «>>> aws-cli-empty-message» marker to
# the «<<< aws-cli-empty-message» one, both included. With a region start, only inside the fenced
# block that begins with that line. Fails with a message when they are not there exactly once.
extract() {
  python3 -I - "$@" <<'PY'
import sys
path, out, region = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path, encoding="utf-8").read().split("\n")
if region:
    starts = [i for i, line in enumerate(lines) if line.startswith(region)]
    if len(starts) != 1:
        sys.exit("la riga «%s» non c'è una volta sola" % region)
    end = next((i for i in range(starts[0], len(lines)) if lines[i].startswith("```")), len(lines))
    lines = lines[starts[0]:end]
first = [i for i, line in enumerate(lines) if line.startswith("# >>> aws-cli-empty-message")]
last = [i for i, line in enumerate(lines) if line == "# <<< aws-cli-empty-message"]
if len(first) != 1 or len(last) != 1 or last[0] < first[0]:
    sys.exit("i segni «aws-cli-empty-message» non ci sono una volta sola, nell'ordine")
open(out, "w", encoding="utf-8").write("\n".join(lines[first[0]:last[0] + 1]) + "\n")
PY
}

# paste_safe <file>: no tab, carriage return, trailing space or "!" (a pasted block must arrive as
# written, with history expansion on or off).
paste_safe() {
  python3 -I - "$1" <<'PY'
import sys
for n, line in enumerate(open(sys.argv[1], encoding="utf-8").read().split("\n"), 1):
    for bad, name in (("\t", "una tabulazione"), ("\r", "un ritorno a capo"), ("!", "un «!»")):
        if bad in line:
            sys.exit("riga %d: %s" % (n, name))
    if line != line.rstrip(" "):
        sys.exit("riga %d: spazi in fondo" % n)
PY
}

# 1. The same lines in the script and in the README, safe to paste.
if extract "$script" "$work/snippet.sh" "" 2>"$work/err"; then
  ok "OPS-007 correttivo: le righe ci sono una volta sola nello script"
else
  no "OPS-007 correttivo: le righe ci sono una volta sola nello script" "$(cat "$work/err")"
  finish
fi
if paste_safe "$work/snippet.sh" 2>"$work/err"; then
  ok "OPS-007 correttivo: le righe dello script si possono incollare"
else
  no "OPS-007 correttivo: le righe dello script si possono incollare" "$(cat "$work/err")"
fi
if ! extract "$readme" "$work/snippet-readme.sh" '# Terminale delle chiavi (infra/README.md' 2>"$work/err"; then
  no "OPS-007 correttivo: le stesse righe nel blocco del terminale delle chiavi del README" "$(cat "$work/err")"
elif ! cmp -s -- "$work/snippet.sh" "$work/snippet-readme.sh"; then
  diff -- "$work/snippet.sh" "$work/snippet-readme.sh" >"$work/diff"
  no "OPS-007 correttivo: le stesse righe nel blocco del terminale delle chiavi del README" "diverse da quelle dello script" "$work/diff"
else
  ok "OPS-007 correttivo: le stesse righe nel blocco del terminale delle chiavi del README"
fi

# 2. The real client, 2.39.4.
if ! [ -x "$client" ]; then
  no "OPS-007 client: $client 2.39.4" "il client non c'è (A2): questa prova gira solo dove è installato"
  finish
fi
version=$(env -i HOME="$work/home" PATH=/usr/bin:/bin AWS_CONFIG_FILE=/dev/null "$client" --version 2>&1)
case $version in
  "aws-cli/2.39.4 "*) ok "OPS-007 client: $version" ;;
  *) no "OPS-007 client: $client 2.39.4" "il client risponde «$version»: il correttivo è provato solo con la 2.39.4"; finish ;;
esac

# in_snippet <base folder> <bash code...>: runs the code in a clean bash where the remedy's lines
# have been sourced with that base folder, as the README block and the script do.
in_snippet() {
  local base=$1
  shift
  env -i HOME="$work/home" PATH=/usr/bin:/bin bash -c 'AWS_CLI_BASE=$1; source "$2"; shift 2; eval "$*"' \
    _ "$base" "$work/snippet.sh" "$@"
}

# 3. The remedy written by its lines: read-only, confirmed by the startup check.
mkdir -m 700 -- "$work/base"
if in_snippet "$work/base" 'aws_cli_plugin_write && export AWS_CONFIG_FILE=$AWS_CLI_CONFIG && aws_cli_plugin_intact' 2>"$work/err"; then
  modes=$(stat -c %a -- "$work/base/aws-cli-plugin" "$work/base/aws-cli-plugin/foondaco_empty_message.py" "$work/base/aws-config" | paste -s -d ' ' -)
  if [ "$modes" = "500 400 400" ]; then
    ok "OPS-007 correttivo: scritto in sola lettura (500 400 400)"
  else
    no "OPS-007 correttivo: scritto in sola lettura (500 400 400)" "permessi $modes"
  fi
else
  no "OPS-007 correttivo: scritto e integro" "aws_cli_plugin_write o aws_cli_plugin_intact non riusciti" "$work/err"
  finish
fi
conf=$work/base/aws-config
# as the README block calls it, after exporting the remedy's configuration
check='export AWS_CONFIG_FILE=$AWS_CLI_CONFIG; aws_cli_plugin_check env HOME="$HOME" PATH=/usr/local/bin aws'
if out=$(in_snippet "$work/base" "$check" 2>&1) && [[ $out == "aws-cli/2.39.4 "* ]]; then
  ok "OPS-007 correttivo: il controllo all'avvio lo conferma ($out)"
else
  no "OPS-007 correttivo: il controllo all'avvio lo conferma" "risposta «$out»"
fi
if out=$(in_snippet "$work/base" 'export AWS_CONFIG_FILE=/dev/null; aws_cli_plugin_check env HOME="$HOME" PATH=/usr/local/bin aws' 2>&1); then
  no "OPS-007 correttivo: senza l'export della sua configurazione il controllo all'avvio fallisce" "è riuscito: «$out»"
else
  ok "OPS-007 correttivo: senza l'export della sua configurazione il controllo all'avvio fallisce"
fi
cat >"$work/decoy/foondaco_empty_message.py" <<'PY'
import sys
sys.stderr.write("DECOY\n")


def awscli_initialize(event_hooks):
    pass
PY
out=$(cd -- "$work/decoy" && in_snippet "$work/base" "export PYTHONPATH=$(printf %q "$work/decoy"); $check" 2>&1)
rc=$?
out2=$(cd -- "$work/decoy" && env -i HOME="$work/home" PATH=/usr/local/bin PYTHONPATH="$work/decoy" \
  FOONDACO_AWS_CLI_PLUGIN_CHECK=1 AWS_CONFIG_FILE="$conf" "$client" --version 2>&1)
if [ "$rc" = 0 ] && [[ $out == "aws-cli/2.39.4 "* ]] && [[ $out2 != *DECOY* ]] &&
  [[ $out2 == *"foondaco_empty_message: loaded"* ]]; then
  ok "OPS-007 correttivo: un modulo omonimo nella cartella di lavoro o in PYTHONPATH non lo sostituisce"
else
  no "OPS-007 correttivo: un modulo omonimo nella cartella di lavoro o in PYTHONPATH non lo sostituisce" "risposte «$out» e «$out2»"
fi
if out=$(env -i HOME="$work/home" PATH=/usr/local/bin FOONDACO_AWS_CLI_PLUGIN_CHECK=1 \
  AWS_CONFIG_FILE="$work/non-esiste" "$client" --version 2>&1) && [[ $out != *"foondaco_empty_message: loaded"* ]]; then
  ok "OPS-007 correttivo: senza configurazione il client non dà la conferma (per questo il controllo la chiede)"
else
  no "OPS-007 correttivo: senza configurazione il client non dà la conferma" "risposta «$out»"
fi
chmod 700 -- "$work/base/aws-cli-plugin"
mkdir -- "$work/base/aws-cli-plugin/__pycache__"
chmod 500 -- "$work/base/aws-cli-plugin"
if in_snippet "$work/base" "$check" >/dev/null 2>&1; then
  no "OPS-007 correttivo: una cartella in più accanto al modulo lo rende alterato" "il controllo è riuscito lo stesso"
else
  ok "OPS-007 correttivo: una cartella in più accanto al modulo lo rende alterato"
fi
chmod 700 -- "$work/base/aws-cli-plugin"
rmdir -- "$work/base/aws-cli-plugin/__pycache__"
chmod 500 -- "$work/base/aws-cli-plugin"
cp -p -- "$conf" "$work/aws-config.saved"
chmod 600 -- "$conf"
printf '%s\n' 'other_plugin = other_plugin' >>"$conf"
chmod 400 -- "$conf"
if in_snippet "$work/base" "$check" >/dev/null 2>&1; then
  no "OPS-007 correttivo: una riga in più nella sua configurazione lo rende alterato" "il controllo è riuscito lo stesso"
else
  ok "OPS-007 correttivo: una riga in più nella sua configurazione lo rende alterato"
fi
chmod 600 -- "$conf"
cp -- "$work/aws-config.saved" "$conf"
chmod 400 -- "$conf"

# 4. The whole key terminal block of the README, sourced in a clean bash without a terminal: the
# remedy is written, exported and confirmed («correttivo del client: attivo (aws-cli/2.39.4 …)»),
# and once its module has changed the s3 function sends nothing («correttivo del client
# alterato», exit status 3), with a dummy key loaded. No request can leave the computer: the
# check comes first, and a closed local proxy would stop any request that got past it.
if python3 -I - "$readme" "$work/block.sh" <<'PY' 2>"$work/err"; then
import sys
lines = open(sys.argv[1], encoding="utf-8").read().split("\n")
starts = [i for i, line in enumerate(lines) if line.startswith("# Terminale delle chiavi (infra/README.md")]
if len(starts) != 1:
    sys.exit("la prima riga del blocco del terminale delle chiavi non c'è una volta sola")
end = next(i for i in range(starts[0], len(lines)) if lines[i].startswith("```"))
open(sys.argv[2], "w", encoding="utf-8").write("\n".join(lines[starts[0]:end]) + "\n")
PY
  mkdir -p -- "$work/home-block"
  out=$(cd -- "$work/home-block" && env -i HOME="$work/home-block" PATH=/usr/bin:/bin \
    HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 bash -c '
    source "$1"
    [ "$AWS_CONFIG_FILE" = "${AWS_CLI_CONFIG-}" ] && echo "configurazione esportata: sì"
    load_key prova-finta <<<"AKIDUMMYFOONDACO0003
dummySecretFoondaco0000000000000000000003"
    use_key prova-finta
    chmod 700 -- "$AWS_CLI_PLUGIN_DIR"
    chmod 600 -- "$AWS_CLI_PLUGIN_DIR/foondaco_empty_message.py"
    printf "%s\n" "# changed by another program" >>"$AWS_CLI_PLUGIN_DIR/foondaco_empty_message.py"
    chmod 400 -- "$AWS_CLI_PLUGIN_DIR/foondaco_empty_message.py"
    chmod 500 -- "$AWS_CLI_PLUGIN_DIR"
    s3 fsn1 list-buckets
    echo "s3 dopo la modifica: $?"' _ "$work/block.sh" 2>&1 </dev/null)
  printf '%s\n' "$out" >"$work/block.out"
  if [[ $out == *$'\ncorrettivo del client: attivo (aws-cli/2.39.4 '* ]] &&
    [[ $out == *"configurazione esportata: sì"* ]] &&
    [[ $out == *"correttivo del client alterato"* ]] &&
    [[ $out == *"s3 dopo la modifica: 3"* ]] && [[ $out != *"proxy"* ]] &&
    [[ $out != *"Could not connect"* ]] && [[ $out != *"AKIDUMMY"* ]] && [[ $out != *"dummySecret"* ]]; then
    ok "OPS-007 correttivo: il blocco del README lo scrive, lo conferma e, se cambia, non manda il comando"
  else
    no "OPS-007 correttivo: il blocco del README lo scrive, lo conferma e, se cambia, non manda il comando" "uscita inattesa" "$work/block.out"
  fi
else
  no "OPS-007 correttivo: il blocco del README lo scrive, lo conferma e, se cambia, non manda il comando" "$(cat "$work/err")"
fi

# 5. The fake endpoint.
python3 -I "$here/server.py" "$work/server/port" "$work/server/mode" "$$" &
server_pid=$!
for _ in $(seq 50); do [ -s "$work/server/port" ] && break; sleep 0.1; done
if ! [ -s "$work/server/port" ]; then
  no "endpoint finto" "non è partito"
  finish
fi
endpoint=http://127.0.0.1:$(cat "$work/server/port")
printf '%s' data >"$work/body"
md5=$(openssl dgst -md5 -binary "$work/body" | openssl base64 -A)
policy='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam:::user/p1"},"Action":["s3:ListBucket"],"Resource":["arn:aws:s3:::denied-empty"]}]}'

# run_aws <config file | /dev/null> <sign | anonymous> <aws arguments...>: one call, with the same
# AWS_* settings as the README block and the I2 script, dummy keys, the fake endpoint, and the
# script's timeouts; output in $work/out and $work/err, exit status in $rc. The ListBuckets answer
# comes from $mode.
mode=ok
run_aws() {
  local config=$1 sign=$2 keys=()
  shift 2
  printf '%s' "$mode" >"$work/server/mode"
  [ "$sign" = anonymous ] || keys=(AWS_ACCESS_KEY_ID=AKIDUMMYFOONDACO0001 AWS_SECRET_ACCESS_KEY=dummySecretFoondaco0000000000000000000001)
  [ "$sign" != anonymous ] || set -- --no-sign-request "$@"
  env -i HOME="$work/home" PATH=/usr/local/bin AWS_CONFIG_FILE="$config" AWS_SHARED_CREDENTIALS_FILE=/dev/null \
    AWS_PAGER= AWS_DEFAULT_OUTPUT=json AWS_CLI_AUTO_PROMPT=off AWS_EC2_METADATA_DISABLED=true \
    AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=4 AWS_CLI_SESSION_ID_DISABLED=true \
    AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    ${keys[@]+"${keys[@]}"} \
    "$client" --endpoint-url "$endpoint" --region fsn1 --cli-connect-timeout 15 --cli-read-timeout 60 "$@" \
    </dev/null >"$work/out" 2>"$work/err"
  rc=$?
}
last_error_line() { grep -v '^[[:space:]]*$' "$work/err" | tail -n 1; }

# shows_code <name> <code shown> <operation> <text after the colon: regex> <sign> <aws arguments...>
shows_code() {
  local name=$1 code=$2 op=$3 text=$4 sign=$5 line re
  shift 5
  run_aws "$conf" "$sign" "$@"
  line=$(last_error_line)
  re="^aws: \[ERROR\]: An error occurred \($code\) when calling the $op operation( \(reached max retries: [0-9]+\))?:$text\$"
  if [ "$rc" = 254 ] && [[ $line =~ $re ]] && ! grep -q NoneType "$work/err"; then
    ok "$name"
  else
    no "$name" "codice di uscita $rc, ultima riga «$line»" "$work/err"
  fi
}
# stops <name> <config> <aws arguments...>: the client stops on the empty message (the bug).
stops() {
  local name=$1 config=$2
  shift 2
  run_aws "$config" sign "$@"
  if [ "$rc" = 255 ] && grep -q "argument of type 'NoneType' is not a container or iterable" "$work/err"; then
    ok "$name"
  else
    no "$name" "codice di uscita $rc, ultima riga «$(last_error_line)» (il difetto è corretto? allora il correttivo si toglie, con un compito nuovo)" "$work/err"
  fi
}
# succeeds <name> <expected stdout> <aws arguments...>
succeeds() {
  local name=$1 want=$2
  shift 2
  run_aws "$conf" sign "$@"
  if [ "$rc" = 0 ] && [ "$(cat "$work/out")" = "$want" ]; then
    ok "$name"
  else
    no "$name" "codice di uscita $rc, uscita «$(cat "$work/out")»" "$work/err"
  fi
}

# 6. Without the remedy: the bug is still there.
stops "OPS-007 senza correttivo: AccessDenied con messaggio vuoto ferma il client" /dev/null \
  s3api get-object --bucket denied-empty --key k "$work/got"
stops "OPS-005 senza correttivo: NoSuchLifecycleConfiguration con messaggio vuoto ferma il client" /dev/null \
  s3api get-bucket-lifecycle-configuration --bucket nolifecycle-empty
stops "OPS-007 con un file di configurazione che non c'è il client si ferma ancora" "$work/non-esiste" \
  s3api get-object --bucket denied-empty --key k "$work/got"

# 7. With the remedy: the code shows, for every operation of the README and of the I2 script.
E= # an empty message: nothing after the colon
shows_code "OPS-007 AccessDenied GetObject (I2, F)" AccessDenied GetObject "$E" sign \
  s3api get-object --bucket denied-empty --key k "$work/got"
shows_code "OPS-007 AccessDenied GetObject senza chiave (I2, parte 3)" AccessDenied GetObject "$E" anonymous \
  s3api get-object --bucket denied-empty --key k "$work/got"
shows_code "OPS-007 AccessDenied PutObject con Content-MD5 (I2, F2, J2)" AccessDenied PutObject "$E" sign \
  s3api put-object --bucket denied-empty --key k --body "$work/body" --content-md5 "$md5"
shows_code "OPS-007 AccessDenied PutObject senza chiave (I2, parte 3)" AccessDenied PutObject "$E" anonymous \
  s3api put-object --bucket denied-empty --key k --body "$work/body" --content-md5 "$md5"
shows_code "OPS-007 AccessDenied DeleteObject (I2)" AccessDenied DeleteObject "$E" sign \
  s3api delete-object --bucket denied-empty --key k
shows_code "OPS-007 AccessDenied ListObjectsV2 con --query e --output text (I2, F1)" AccessDenied ListObjectsV2 "$E" sign \
  s3api list-objects-v2 --bucket denied-empty --prefix p --query 'Contents[].Key' --output text
mode=denied-empty
shows_code "OPS-007 AccessDenied ListBuckets (I2, F, put_policy_keys)" AccessDenied ListBuckets "$E" sign \
  s3api list-buckets --query 'Buckets[].Name' --output text
mode=ok
shows_code "OPS-007 AccessDenied GetBucketPolicy (I2, E7)" AccessDenied GetBucketPolicy "$E" sign \
  s3api get-bucket-policy --bucket denied-empty --query Policy --output text
printf '%s\n' "$policy" >"$work/policy.json"
run_policy_probe() { # the I2 probe sends the policy from a pipe: --policy file:///dev/stdin
  local line re="^aws: \[ERROR\]: An error occurred \(AccessDenied\) when calling the PutBucketPolicy operation( \(reached max retries: [0-9]+\))?:\$"
  env -i HOME="$work/home" PATH=/usr/local/bin AWS_CONFIG_FILE="$conf" AWS_SHARED_CREDENTIALS_FILE=/dev/null \
    AWS_PAGER= AWS_DEFAULT_OUTPUT=json AWS_CLI_AUTO_PROMPT=off AWS_EC2_METADATA_DISABLED=true \
    AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=4 AWS_CLI_SESSION_ID_DISABLED=true \
    AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    AWS_ACCESS_KEY_ID=AKIDUMMYFOONDACO0001 AWS_SECRET_ACCESS_KEY=dummySecretFoondaco0000000000000000000001 \
    "$client" --endpoint-url "$endpoint" --region fsn1 --cli-connect-timeout 15 --cli-read-timeout 60 \
    s3api put-bucket-policy --bucket denied-empty --policy file:///dev/stdin \
    < <(cat "$work/policy.json") >"$work/out" 2>"$work/err"
  rc=$?
  line=$(last_error_line)
  if [ "$rc" = 254 ] && [[ $line =~ $re ]]; then
    ok "OPS-007 AccessDenied PutBucketPolicy da una pipe (I2, modifica della policy)"
  else
    no "OPS-007 AccessDenied PutBucketPolicy da una pipe (I2, modifica della policy)" "codice di uscita $rc, ultima riga «$line»" "$work/err"
  fi
}
run_policy_probe
shows_code "OPS-007 AccessDenied PutBucketPolicy (D5, F, J2, J6)" AccessDenied PutBucketPolicy "$E" sign \
  s3api put-bucket-policy --bucket denied-empty --policy "file://$work/policy.json"
shows_code "OPS-007 NoSuchBucketPolicy con il testo resta com'era (E8)" NoSuchBucketPolicy GetBucketPolicy \
  ' The bucket policy does not exist' sign s3api get-bucket-policy --bucket policy-text --query Policy --output text
shows_code "OPS-007 HEAD rifiutata (senza corpo) resta com'era (I2, controllo della cancellazione)" 403 HeadObject \
  ' Forbidden' sign s3api head-object --bucket denied-empty --key k
shows_code "OPS-008 AccessDenied DeleteObject con --version-id (H3)" AccessDenied DeleteObject "$E" sign \
  s3api delete-object --bucket denied-empty --key k --version-id=v1
shows_code "OPS-008 AccessDenied PutObjectRetention (H4)" AccessDenied PutObjectRetention "$E" sign \
  s3api put-object-retention --bucket denied-empty --key k --version-id=v1 \
  --retention Mode=COMPLIANCE,RetainUntilDate=2030-01-01T00:00:00Z
shows_code "OPS-008 AccessDenied GetObjectRetention (H2, H6)" AccessDenied GetObjectRetention "$E" sign \
  s3api get-object-retention --bucket denied-empty --key k --version-id=v1
shows_code "OPS-008 AccessDenied ListObjectVersions (H3, G2)" AccessDenied ListObjectVersions "$E" sign \
  s3api list-object-versions --bucket denied-empty --prefix k
shows_code "OPS-008 ObjectLockConfigurationNotFoundError (E6, D3)" ObjectLockConfigurationNotFoundError \
  GetObjectLockConfiguration "$E" sign s3api get-object-lock-configuration --bucket nolock-empty
shows_code "OPS-008 AccessDenied PutObjectLockConfiguration (D3)" AccessDenied PutObjectLockConfiguration "$E" sign \
  s3api put-object-lock-configuration --bucket denied-empty \
  --object-lock-configuration '{"ObjectLockEnabled":"Enabled","Rule":{"DefaultRetention":{"Mode":"COMPLIANCE","Days":45}}}'
shows_code "OPS-005 NoSuchLifecycleConfiguration (E4)" NoSuchLifecycleConfiguration \
  GetBucketLifecycleConfiguration "$E" sign s3api get-bucket-lifecycle-configuration --bucket nolifecycle-empty
shows_code "OPS-005 AccessDenied PutBucketLifecycleConfiguration (D2, D4)" AccessDenied \
  PutBucketLifecycleConfiguration "$E" sign s3api put-bucket-lifecycle-configuration --bucket denied-empty \
  --lifecycle-configuration '{"Rules":[{"ID":"versioni-precedenti","Status":"Enabled","Prefix":"","NoncurrentVersionExpiration":{"NoncurrentDays":30}}]}'
shows_code "OPS-005 AccessDenied GetBucketVersioning (E1)" AccessDenied GetBucketVersioning "$E" sign \
  s3api get-bucket-versioning --bucket denied-empty
shows_code "OPS-005 AccessDenied PutBucketVersioning (D1)" AccessDenied PutBucketVersioning "$E" sign \
  s3api put-bucket-versioning --bucket denied-empty --versioning-configuration Status=Enabled
shows_code "OPS-005 AccessDenied CopyObject (G4)" AccessDenied CopyObject "$E" sign \
  s3api copy-object --bucket denied-empty --key k --copy-source 'denied-empty/k?versionId=v1'
shows_code "OPS-004 InvalidAccessKeyId ListObjectsV2 con --max-items (J4)" InvalidAccessKeyId ListObjectsV2 "$E" sign \
  s3api list-objects-v2 --bucket invalidkey-empty --max-items 5
mode=signature-empty
shows_code "OPS-004 SignatureDoesNotMatch ListBuckets (chiave incollata male)" SignatureDoesNotMatch ListBuckets "$E" sign \
  s3api list-buckets --query 'Buckets[].Name' --output text
mode=ok
shows_code "OPS-007 codice vuoto: si vede (None), non un esito" None GetObject "$E" sign \
  s3api get-object --bucket nocode-empty --key k "$work/got"
succeeds "OPS-007 risposta riuscita invariata: ListBuckets" ok s3api list-buckets --query 'Buckets[].Name' --output text
succeeds "OPS-007 risposta riuscita invariata: ListObjectsV2" k \
  s3api list-objects-v2 --bucket ok --prefix k --query 'Contents[].Key' --output text
rm -f -- "$work/got"
run_aws "$conf" sign s3api get-object --bucket ok --key k "$work/got"
if [ "$rc" = 0 ] && [ "$(cat "$work/got" 2>/dev/null)" = data ]; then
  ok "OPS-007 risposta riuscita invariata: GetObject scrive il file"
else
  no "OPS-007 risposta riuscita invariata: GetObject scrive il file" "codice di uscita $rc" "$work/err"
fi

finish
