#!/usr/bin/env bash
# Dry runs of infra/scripts/check-bucket-isolation.sh (OPS-007, OPS-008) against a fake AWS CLI
# (fake-aws, next to this file). No network and no real key: each scenario builds a fake world,
# runs the script and checks its exit status and its messages, and that no fake key ever shows:
# - not in the script's output or terminal transcript (FAKEID and fakeSecret mark every fake key;
#   each key also ends with a 4-character code found nowhere else, which is searched too);
# - not on the command line of a program the script starts: the script's PATH holds only "spies"
#   of the programs it may use, which log a violation when an argument holds a key, and traps for
#   every other program name, which log a violation and refuse to run; a static check makes sure
#   the script starts no program by an absolute path, outside the PATH;
# - not in the environment of the client outside the AWS_* variables of its own call, and not in
#   any file under the script's HOME, TMPDIR and working folder (the fake client checks these at
#   every call, and run.sh after the run);
# - not on the screen during a terminal run, and not in the input left pending on the terminal
#   when the script ends (pty-run scenarios, with a job-control shell like the user's).
# The client remedy for empty error messages (aws/aws-cli#10161, specs/08 OPS-T03): the fake client
# checks it at every call; the scenarios after «client-assente» check that the script stops before
# the keys when the remedy is not loaded, the client is not 2.39.4 or the temporary folder cannot
# hold it, and refuses every call once its module or configuration has changed. The remedy itself,
# with the real client: tests/infra/aws-cli-empty-message/run.sh.
#
# Every scenario name starts with the requirement it protects: OPS-007 for all of them (the script
# is the acceptance test of OPS-007), and also OPS-008 where the scenario's own expected messages
# check the mirror rule of OPS-008 (the production keys refused on the mirror). The rest of the
# name, its last word, is the scenario's key: for --show, --only and its folders.
#
# Usage: bash tests/infra/check-bucket-isolation/run.sh [--show <scenario>] [--only <scenario,...>]
#   --show prints the whole output of one scenario, given by its key (for example: oggi, corretto);
#   --only runs only the listed scenarios, given by their keys.
# CHECK_SCRIPT=<path> runs the scenarios against another copy of the script (mutation tests).
# Needs bash, python3 and openssl. Exit status: 0 every scenario as expected, 1 otherwise.
set -u -o pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
script=${CHECK_SCRIPT:-$root/infra/scripts/check-bucket-isolation.sh}
case $script in /*) ;; *) script=$PWD/$script ;; esac
fake="$here/fake-aws"
ptyrun="$here/pty-run"
show=
only=
while [ "$#" -gt 0 ]; do
  case $1 in
    --show) show=${2:-}; shift 2 ;;
    --only) only=",${2:-},"; shift 2 ;;
    *) echo "uso: run.sh [--show <scenario>] [--only <scenario,...>]" >&2; exit 2 ;;
  esac
done
selected() { [ -z "$only" ] || [[ $only == *",$1,"* ]]; }
BASH_BIN=$(command -v bash)
PY_BIN=$(command -v python3)

work=$(mktemp -d "${TMPDIR:-/tmp}/check-bucket-isolation-dryrun.XXXXXX") || exit 1
trap 'chmod -R u+w -- "$work" 2>/dev/null; rm -rf -- "$work"' EXIT # the remedy's files are read-only
spylog="$work/spie.log"

# Spies and traps: the script's PATH holds only these. The log path is written into them, so a
# program started with an emptied environment still reports.
ALLOWED=(openssl cmp mktemp paste date grep sed head tail tr sort rm stty cat env python3 mkdir chmod)
mkdir -p "$work/shims" "$work/real"
{
  printf '#!%s\nlog=%q\n' "$BASH_BIN" "$spylog"
  cat <<'SPY'
name=${0##*/}
for a in "$@"; do
  case $a in
    *FAKEID* | *fakeSecret*) printf '{"violation": "key on the command line of %s"}\n' "$name" >>"$log" ;;
  esac
done
exec "$(<"${0%/shims/*}/real/$name")" "$@"
SPY
} >"$work/spy"
{
  printf '#!%s\nlog=%q\n' "$BASH_BIN" "$spylog"
  cat <<'TRAP'
printf '{"violation": "program not on the list of the dry run: %s"}\n' "${0##*/}" >>"$log"
exit 127
TRAP
} >"$work/trap"
chmod +x "$work/spy" "$work/trap"
for cmd in "${ALLOWED[@]}"; do
  command -v "$cmd" >"$work/real/$cmd" || { echo "manca il programma $cmd" >&2; exit 1; }
  ln -s ../spy "$work/shims/$cmd"
done
{ compgen -c; printf '%s\n' aws curl wget logger nc ssh; } | sort -u | "$PY_BIN" -I -c '
import os, shutil, sys
shims = sys.argv[1]
for name in sys.stdin.read().split():
    path = os.path.join(shims, name)
    if "/" in name or name in (".", "..") or os.path.lexists(path):
        continue
    if shutil.which(name) or name in ("aws", "curl", "wget", "logger", "nc", "ssh"):
        os.symlink("../trap", path)
' "$work/shims"

UNITS=(FILE_PROD BACKUP_PROD FILE_TEST BACKUP_TEST MIRROR_DST MIRROR_SRC)
declare -A KEY_ID=(
  [FILE_PROD]=FAKEIDFILEPRODJX1Z [BACKUP_PROD]=FAKEIDBACKUPPRODJX2Z [FILE_TEST]=FAKEIDFILETESTJX3Z
  [BACKUP_TEST]=FAKEIDBACKUPTESTJX4Z [MIRROR_DST]=FAKEIDMIRRORDSTJX5Z [MIRROR_SRC]=FAKEIDMIRRORSRCJX6Z
)
declare -A KEY_SECRET=(
  [FILE_PROD]=fakeSecretFileProd/AAAAAAAAAAAAAAAAAAWV1Q [BACKUP_PROD]=fakeSecretBackupProd+BBBBBBBBBBBBBBBWV2Q
  [FILE_TEST]=fakeSecretFileTest/CCCCCCCCCCCCCCCCCCWV3Q [BACKUP_TEST]=fakeSecretBackupTest+DDDDDDDDDDDDDDDWV4Q
  [MIRROR_DST]=fakeSecretMirrorDst/EEEEEEEEEEEEEEEEEWV5Q [MIRROR_SRC]=fakeSecretMirrorSrc+FFFFFFFFFFFFFFFFFWV6Q
)
FSN=https://fsn1.your-objectstorage.com
HEL=https://hel1.your-objectstorage.com
NONSECRET_ENV=(
  FILE_PROD_BUCKET=foondaco-file FILE_PROD_ENDPOINT=$FSN FILE_PROD_REGION=fsn1
  BACKUP_PROD_BUCKET=foondaco-backup BACKUP_PROD_ENDPOINT=$FSN BACKUP_PROD_REGION=fsn1
  FILE_TEST_BUCKET=foondaco-file-test FILE_TEST_ENDPOINT=$FSN FILE_TEST_REGION=fsn1
  BACKUP_TEST_BUCKET=foondaco-backup-test BACKUP_TEST_ENDPOINT=$FSN BACKUP_TEST_REGION=fsn1
  MIRROR_DST_BUCKET=foondaco-specchio MIRROR_DST_ENDPOINT=$HEL/ MIRROR_DST_REGION=hel1
)
KEY_ENV=()
KEY_TAILS=()
for u in "${UNITS[@]}"; do
  KEY_ENV+=("${u}_ACCESS_KEY_ID=${KEY_ID[$u]}" "${u}_SECRET_ACCESS_KEY=${KEY_SECRET[$u]}")
  KEY_TAILS+=("${KEY_ID[$u]: -4}" "${KEY_SECRET[$u]: -4}")
done

make_world() { # <scenario> <output file>
  local ids=() secrets=() u
  for u in "${UNITS[@]}"; do ids+=("${KEY_ID[$u]}"); secrets+=("${KEY_SECRET[$u]}"); done
  "$PY_BIN" -I - "$1" "$2" "$FSN" "$HEL" "${ids[@]}" "${secrets[@]}" <<'PY'
import json, sys
scenario, out, fsn, hel = sys.argv[1:5]
ids, secrets = sys.argv[5:11], sys.argv[11:17]
units = ["FILE_PROD", "BACKUP_PROD", "FILE_TEST", "BACKUP_TEST", "MIRROR_DST", "MIRROR_SRC"]
project = dict(zip(units, ["1001", "1002", "1003", "1004", "1005", "1006"]))
keys = {ids[i]: {"secret": secrets[i], "unit": u, "project": project[u]} for i, u in enumerate(units)}

def policy(principal):
    return {"Version": "2012-10-17", "Statement": [{
        "Sid": "MirrorReadOnly", "Effect": "Allow", "Principal": {"AWS": [principal]},
        "Action": ["s3:ListBucket", "s3:GetObject"],
        "Resource": ["arn:aws:s3:::foondaco-backup", "arn:aws:s3:::foondaco-backup/*"]}]}

buckets = {
    "foondaco-file": {"project": "1001", "endpoint": fsn, "region": "fsn1", "versioning": True},
    "foondaco-backup": {"project": "1002", "endpoint": fsn, "region": "fsn1", "policy": policy("arn:aws:iam:::user/p1006:" + ids[5])},
    "foondaco-file-test": {"project": "1003", "endpoint": fsn, "region": "fsn1", "versioning": True},
    "foondaco-backup-test": {"project": "1004", "endpoint": fsn, "region": "fsn1"},
    "foondaco-specchio": {"project": "1005", "endpoint": hel, "region": "hel1", "object_lock": True},
}
world = {"keys": keys, "buckets": buckets}
if scenario == "oggi":
    world = {"keys": {}, "buckets": {}}
elif scenario == "corretto":
    pass
elif scenario == "corretto-formato-vecchio":
    world.update(error_format="old", empty_text="None")
elif scenario == "corretto-policy-per-progetto":
    buckets["foondaco-backup"]["policy"] = policy("arn:aws:iam:::user/p1006")
elif scenario == "policy-larga":
    buckets["foondaco-backup"]["policy"]["Statement"][0]["Action"] = ["s3:*"]
elif scenario == "policy-assente":
    buckets["foondaco-backup"]["policy"] = None
elif scenario == "progetto-condiviso":
    buckets["foondaco-file-test"]["project"] = "1001"
    keys[ids[2]]["project"] = "1001"
elif scenario == "sola-lettura-nel-progetto-dei-backup":
    keys[ids[5]]["project"] = "1002"
elif scenario == "lettura-incrociata":
    world["leaks"] = [{"key_unit": "FILE_TEST", "bucket": "foondaco-file", "actions": ["s3:ListBucket", "s3:GetObject"]}]
elif scenario == "produzione-scrive-nello-specchio":
    world["leaks"] = [{"key_unit": "BACKUP_PROD", "bucket": "foondaco-specchio", "actions": ["s3:PutObject"]}]
elif scenario == "bucket-pubblico":
    buckets["foondaco-file"]["public_read"] = True
elif scenario == "scrittura-anonima":
    buckets["foondaco-backup-test"]["public_write"] = True
elif scenario == "codice-diverso":
    world["denied_code"] = "NoSuchBucket"
elif scenario == "cancellazione-che-mente":
    world["delete_lies"] = [{"key_unit": "FILE_TEST", "bucket": "foondaco-file"}]
elif scenario == "cancellazione-finta":
    world["delete_noop_ok"] = [{"key_unit": "MIRROR_SRC", "bucket": "foondaco-backup"}]
elif scenario == "scrittura-che-mente":
    world["write_lies"] = [{"key_unit": "FILE_TEST", "bucket": "foondaco-file"}]
elif scenario == "errore-con-chiave":
    world["stderr_key_on"] = {"unit": "FILE_TEST", "op": "list-buckets"}
elif scenario == "attesa-nella-prova":
    world["hang"] = {"unit": "FILE_PROD", "op": "list-objects-v2", "bucket": "foondaco-backup"}
elif scenario == "attesa-nella-policy":
    world["hang"] = {"unit": "MIRROR_SRC", "op": "put-bucket-policy", "bucket": "foondaco-backup"}
elif scenario == "correttivo-non-caricato":
    world["plugin_not_loaded"] = True
elif scenario == "client-di-altra-versione":
    world["client_version"] = "2.40.0"
elif scenario == "correttivo-alterato":
    world["tamper_plugin_on"] = {"unit": "FILE_TEST", "op": "list-buckets", "file": "module"}
elif scenario == "correttivo-configurazione-alterata":
    world["tamper_plugin_on"] = {"unit": "FILE_TEST", "op": "list-buckets", "file": "config"}
elif scenario == "client-2.39.40":
    world["client_version"] = "2.39.40"
else:
    sys.exit("unknown scenario " + scenario)
json.dump(world, open(out, "w"), indent=1)
PY
}

passed=0
failed=0
ok() { passed=$((passed + 1)); printf 'ok  %s\n' "$1"; }
no() {
  failed=$((failed + 1))
  printf 'NO  %s: %s\n' "$1" "$2"
  [ ! -s "$3" ] || tr -d '\r' <"$3" | sed 's/^/      | /' | tail -n 25
}

# prepare <key> <world scenario>: the scenario's folders and world; sets the d_* variables.
prepare() {
  d_out="$work/$1.out" d_log="$work/$1.log" d_state="$work/$1.state" d_world="$work/$1.world.json"
  d_home="$work/$1.home" d_tmp="$work/$1.tmp" d_cwd="$work/$1.cwd"
  mkdir -p -- "$d_state" "$d_home" "$d_tmp" "$d_cwd/infra/scripts"
  cp -- "$script" "$d_cwd/infra/scripts/check-bucket-isolation.sh"
  : >"$d_log"
  : >"$spylog"
  make_world "$2" "$d_world"
}

# verify <name> <expected status> <status> <expected messages...>: the checks common to all runs.
# A message written as "=N:<text>" must appear exactly N times. With NO_CALLS set, the client must
# never have been called with a key.
verify() {
  local name=$1 want=$2 rc=$3 a t
  shift 3
  [ "$show" != "${name##* }" ] || tr -d '\r' <"$d_out"
  if grep -F violation -- "$d_log" "$spylog" >/dev/null; then
    no "$name" "violazione: $(grep -h -F violation -- "$d_log" "$spylog" | head -n 1)" "$d_out"; return
  fi
  if grep -a -F -e FAKEID -e fakeSecret -- "$d_out" >/dev/null; then
    no "$name" "una chiave compare nell'uscita" "$d_out"; return
  fi
  for t in "${KEY_TAILS[@]}"; do
    if grep -a -F -e "$t" -- "$d_out" >/dev/null; then no "$name" "la fine di una chiave compare nell'uscita" "$d_out"; return; fi
  done
  if [ "$rc" != "$want" ]; then no "$name" "uscita $rc, attesa $want" "$d_out"; return; fi
  if [ -n "${NO_CALLS:-}" ] && [ -s "$d_log" ]; then
    no "$name" "il client è stato chiamato con le chiavi" "$d_out"; return
  fi
  if grep -r -a -l -F -e FAKEID -e fakeSecret -- "$d_home" "$d_tmp" "$d_cwd" >/dev/null 2>&1; then
    no "$name" "una chiave è rimasta in un file" "$d_out"; return
  fi
  if [ -n "$(find "$d_tmp" "$d_home" "$d_cwd" -mindepth 1 ! -type d ! -path "$d_cwd/infra/scripts/check-bucket-isolation.sh" 2>/dev/null)" ]; then
    no "$name" "lo script ha lasciato file nella cartella temporanea, nella casa o in quella di lavoro" "$d_out"; return
  fi
  for a in "$@"; do
    if [[ $a =~ ^=([0-9]+):(.*)$ ]]; then
      if [ "$(tr -d '\r' <"$d_out" | grep -c -F -e "${BASH_REMATCH[2]}")" != "${BASH_REMATCH[1]}" ]; then
        no "$name" "il messaggio «${BASH_REMATCH[2]}» non compare esattamente ${BASH_REMATCH[1]} volte" "$d_out"; return
      fi
    elif ! tr -d '\r' <"$d_out" | grep -F -e "$a" >/dev/null; then
      no "$name" "manca il messaggio «$a»" "$d_out"; return
    fi
  done
  ok "$name"
}

# run_case <name> <world scenario> <expected status> <env changes ...> -- <script arguments ...>
#   -- <expected messages ...>. The keys come from the environment; stdin is not a terminal.
run_case() {
  local name=$1 key=${1##* } scenario=$2 want=$3
  selected "$key" || return 0
  shift 3
  local envs=() args=() expects=() section=env a rc
  for a in "$@"; do
    if [ "$a" = -- ]; then
      if [ "$section" = env ]; then section=args; else section=expects; fi
      continue
    fi
    case $section in env) envs+=("$a") ;; args) args+=("$a") ;; expects) expects+=("$a") ;; esac
  done
  prepare "$key" "$scenario" || { no "$name" "mondo finto non creato" /dev/null; return; }
  (
    cd -- "$d_cwd" &&
      exec env -i PATH="$work/shims" HOME="$d_home" TMPDIR="$d_tmp" LANG=C.UTF-8 \
        FAKE_AWS_WORLD="$d_world" FAKE_AWS_STATE="$d_state" FAKE_AWS_LOG="$d_log" FAKE_AWS_CWD="$d_cwd" \
        "${NONSECRET_ENV[@]}" "${KEY_ENV[@]}" ${envs[@]+"${envs[@]}"} \
        "$BASH_BIN" ${BASH_FLAGS:-} infra/scripts/check-bucket-isolation.sh --aws "$fake" ${args[@]+"${args[@]}"}
  ) </dev/null >"$d_out" 2>&1
  rc=$?
  if [ "$want" = 2 ]; then
    NO_CALLS=1 verify "$name" "$want" "$rc" ${expects[@]+"${expects[@]}"}
  else
    verify "$name" "$want" "$rc" ${expects[@]+"${expects[@]}"}
  fi
}

# In a pty, under an interactive shell with job control like the user's (bash -i, no startup
# files, no history file): the script runs as a foreground job in its own process group, so
# Ctrl-Z would really stop it. Afterwards: is echo back on, and did any input stay pending?
WRAPPER='"$@"; rc=$?
case " $(stty -a | tr "\n;" "  ") " in *" -echo "*) printf "ECO-SPENTO\n" ;; *) printf "ECO-ACCESO\n" ;; esac
resto=
while IFS= read -r -t 1 -n 4096 resto || [ -n "$resto" ]; do printf "RESTO<%s>\n" "$resto"; resto=; done
exit "$rc"'

# run_pty_case <name> <world scenario> <expected status> <plan additions (JSON)> <expected messages ...>
#   The keys are pasted at the prompts by pty-run, as by the user; no key is in the environment.
run_pty_case() {
  local name=$1 key=${1##* } scenario=$2 want=$3 extra=$4 answers=() u rc plan result
  plan="$work/$key.plan.json" result="$work/$key.result.json"
  selected "$key" || return 0
  shift 4
  prepare "$key" "$scenario" || { no "$name" "mondo finto non creato" /dev/null; return; }
  for u in "${UNITS[@]}"; do
    answers+=("${u}_ACCESS_KEY_ID" "${KEY_ID[$u]}" "${u}_SECRET_ACCESS_KEY" "${KEY_SECRET[$u]}")
  done
  "$PY_BIN" -I -c 'import json, sys
a = sys.argv[3:]
plan = {"answers": dict(zip(a[0::2], a[1::2]))}
plan.update(json.loads(sys.argv[2]))
json.dump(plan, open(sys.argv[1], "w"))' "$plan" "$extra" "${answers[@]}"
  (
    cd -- "$d_cwd" &&
      exec "$PY_BIN" -I "$ptyrun" "$plan" "$d_out" "$result" -- \
        env -i PATH="$work/shims" HOME="$d_home" TMPDIR="$d_tmp" LANG=C.UTF-8 \
        FAKE_AWS_WORLD="$d_world" FAKE_AWS_STATE="$d_state" FAKE_AWS_LOG="$d_log" FAKE_AWS_CWD="$d_cwd" \
        FAKE_AWS_TTY=1 HISTFILE= "${NONSECRET_ENV[@]}" \
        "$BASH_BIN" --norc --noprofile -i -c "$WRAPPER" wrapper "$BASH_BIN" infra/scripts/check-bucket-isolation.sh --aws "$fake"
  )
  rc=$("$PY_BIN" -I -c 'import json, sys
r = json.load(open(sys.argv[1]))
planned = len(json.load(open(sys.argv[2])).get("strays") or [])
if r["echo_on_at"]:
    print("eco:" + r["echo_on_at"][0])
elif r["timeout"]:
    print("tempo")
elif r["strays_sent"] != planned:
    print("strays:%d/%d" % (r["strays_sent"], planned))
else:
    print(r["exit"])' "$result" "$plan")
  case $rc in
    eco:*) no "$name" "il terminale mostra quello che si incolla (${rc#eco:})" "$d_out"; return ;;
    tempo) no "$name" "lo script non ha finito in tempo" "$d_out"; return ;;
    strays:*) no "$name" "incolli fuori posto mandati: ${rc#strays:} (un testo atteso non è comparso)" "$d_out"; return ;;
  esac
  if grep -a -F 'RESTO<' -- "$d_out" >/dev/null; then
    no "$name" "è rimasto testo incollato in attesa nel terminale dopo lo script" "$d_out"; return
  fi
  verify "$name" "$want" "$rc" "ECO-ACCESO" "$@"
}

# static_check <name> <message> <extended regex>: the script's lines after the shebang, comments
# excluded, must not match. Line numbers in the message are the script's own.
static_check() {
  local name=$1 message=$2 hits
  selected "${name##* }" || return 0
  hits=$(grep -n -E -- "$3" "$script" | grep -v -E '^1:|^[0-9]+:[[:space:]]*#')
  if [ -n "$hits" ]; then
    no "$name" "$message: $(head -n 1 <<<"$hits")" /dev/null
  else
    ok "$name"
  fi
}

echo "Prove a secco di infra/scripts/check-bucket-isolation.sh (OPS-007, OPS-008)"

# Static checks: every program through the PATH, so the spies see it; every client call with its
# redirections on a subshell, so a Ctrl-C trap runs with the terminal; no fixed temporary path.
static_check "OPS-007 programmi-solo-dal-path" "lo script avvia programmi fuori dal PATH" \
  '/(usr|bin|sbin|opt|snap|nix|lib|lib64)/|(^|[^[:alnum:]_])PATH\+?=|hash[[:space:]]+-p|exec[[:space:]]+-[[:alnum:]]|command[[:space:]]+-[[:alnum:]]*p|"\$BASH"|\$\{?BASH\}?[[:space:]]+-c'
static_check "OPS-007 chiamate-al-client-in-una-subshell" "una chiamata ad aws_run non è dentro ( … ) o \$( … )" \
  '(^|[^(])aws_run([[:space:]]|$)'
static_check "OPS-007 nessun-percorso-temporaneo-fisso" "lo script scrive in un percorso temporaneo fisso" \
  '/var/tmp|/dev/shm|[^-]/tmp/'

# Units that do not exist yet: the state before the user creates them.
run_case "OPS-007 oggi" oggi 1 -- -- \
  "«file di produzione»: elenco dei bucket del suo progetto, chiesto a fsn1, non riuscito: InvalidAccessKeyId" \
  "«sola lettura dello specchio»: elenco dei bucket del suo progetto, chiesto a hel1, non riuscito: InvalidAccessKeyId" \
  "le prove fra le unità non partono" "Nessun oggetto di prova da cancellare." "FALLITO: 7 controlli, 7 falliti"

# Isolation as planned.
run_case "OPS-007 OPS-008 corretto" corretto 0 -- -- \
  "Client: aws-cli/2.39.4 Python/3.14.8 Linux/7.0.0 exe/x86_64.fake" \
  "Correttivo del client: caricato (aws/aws-cli#10161)" \
  "«file di produzione»: l'elenco dei bucket del suo progetto, chiesto a fsn1, contiene solo foondaco-file" \
  "«sola lettura dello specchio»: l'elenco dei bucket del suo progetto, chiesto a fsn1, è vuoto" \
  "«sola lettura dello specchio»: l'elenco dei bucket del suo progetto, chiesto a hel1, è vuoto" \
  "«sola lettura dello specchio» → foondaco-backup: lista degli oggetti riuscita" \
  "«sola lettura dello specchio» → foondaco-backup: lettura riuscita" \
  "«sola lettura dello specchio» → foondaco-backup: scrittura rifiutata" \
  "«sola lettura dello specchio» → foondaco-backup: cancellazione rifiutata (l'oggetto di prova c'è ancora)" \
  "«sola lettura dello specchio» → foondaco-backup: modifica della policy rifiutata" \
  "«backup di produzione» → foondaco-specchio: lista degli oggetti rifiutata" \
  "«file di produzione» → foondaco-specchio: scrittura rifiutata" \
  "«nessuna chiave» → foondaco-file: lettura rifiutata" \
  "«nessuna chiave» → foondaco-specchio: scrittura rifiutata" \
  "«nessuna chiave» → foondaco-backup: cancellazione rifiutata (l'oggetto di prova c'è ancora)" \
  "«specchio» → foondaco-specchio: oggetti di prova cancellati (1)" \
  "RIUSCITO: 148 controlli, nessuno fallito."
run_case "OPS-007 corretto-formato-vecchio" corretto-formato-vecchio 0 -- -- "RIUSCITO: 148 controlli, nessuno fallito."
run_case "OPS-007 corretto-policy-per-progetto" corretto-policy-per-progetto 0 -- -- "RIUSCITO: 148 controlli, nessuno fallito."
BASH_FLAGS=-x run_case "OPS-007 lanciato-con-bash-x" corretto 0 -- -- "RIUSCITO: 148 controlli, nessuno fallito."
run_case "OPS-007 terminale-con-variabili-aws" corretto 0 \
  "AWS_ACCESS_KEY_ID=${KEY_ID[FILE_PROD]}" "AWS_SECRET_ACCESS_KEY=${KEY_SECRET[FILE_PROD]}" \
  AWS_SESSION_TOKEN=x AWS_SECURITY_TOKEN=x AWS_PROFILE=x AWS_DEFAULT_PROFILE=x \
  AWS_ENDPOINT_URL=https://nbg1.your-objectstorage.com AWS_ENDPOINT_URL_S3=https://nbg1.your-objectstorage.com \
  AWS_REGION=nbg1 AWS_DEFAULT_REGION=nbg1 AWS_CLI_ERROR_FORMAT=json AWS_PAGER=less AWS_CONFIG_FILE=/x \
  AWS_CA_BUNDLE=/x AWS_STS_REGIONAL_ENDPOINTS=legacy AWS_SDK_LOAD_CONFIG=1 AWS_MAX_ATTEMPTS=1 \
  AWS_USE_FIPS_ENDPOINT=true AWS_S3_ADDRESSING_STYLE=virtual \
  -- -- "RIUSCITO: 148 controlli, nessuno fallito."

# Wrong setups: each one must make the script fail, naming the leak.
run_case "OPS-007 policy-larga" policy-larga 1 -- -- \
  "«sola lettura dello specchio» → foondaco-backup: scrittura PERMESSA, doveva essere rifiutata" \
  "«sola lettura dello specchio» → foondaco-backup: cancellazione PERMESSA, doveva essere rifiutata" \
  "«sola lettura dello specchio» → foondaco-backup: modifica della policy PERMESSA, doveva essere rifiutata" \
  "FALLITO: 148 controlli, 3 falliti"
run_case "OPS-007 policy-assente" policy-assente 1 -- -- \
  "«sola lettura dello specchio» → foondaco-backup: lista degli oggetti non riuscita: AccessDenied" \
  "«sola lettura dello specchio» → foondaco-backup: lettura non riuscita: AccessDenied" \
  "modifica della policy non provata, perché il proprietario non riesce a leggerla: NoSuchBucketPolicy" \
  "FALLITO: 148 controlli, 3 falliti"
run_case "OPS-007 progetto-condiviso" progetto-condiviso 1 -- -- \
  "«file di produzione»: l'elenco dei bucket del suo progetto, chiesto a fsn1, contiene «foondaco-file foondaco-file-test», atteso solo foondaco-file" \
  "le prove fra le unità non partono"
run_case "OPS-007 sola-lettura-nel-progetto-dei-backup" sola-lettura-nel-progetto-dei-backup 1 -- -- \
  "«sola lettura dello specchio»: l'elenco dei bucket del suo progetto, chiesto a fsn1, contiene «foondaco-backup», atteso vuoto" \
  "le prove fra le unità non partono"
run_case "OPS-007 lettura-incrociata" lettura-incrociata 1 -- -- \
  "«file di test» → foondaco-file: lista degli oggetti PERMESSA, doveva essere rifiutata" \
  "«file di test» → foondaco-file: lettura PERMESSA, doveva essere rifiutata" \
  "FALLITO: 148 controlli, 2 falliti"
run_case "OPS-007 OPS-008 produzione-scrive-nello-specchio" produzione-scrive-nello-specchio 1 -- -- \
  "«backup di produzione» → foondaco-specchio: scrittura PERMESSA, doveva essere rifiutata" \
  "«specchio» → foondaco-specchio: oggetti di prova cancellati (2)" \
  "FALLITO: 148 controlli, 1 fallito:"
run_case "OPS-007 bucket-pubblico" bucket-pubblico 1 -- -- \
  "«nessuna chiave» → foondaco-file: lista degli oggetti rifiutata" \
  "«nessuna chiave» → foondaco-file: lettura PERMESSA, doveva essere rifiutata" \
  "FALLITO: 148 controlli, 1 fallito:"
run_case "OPS-007 scrittura-anonima" scrittura-anonima 1 -- -- \
  "«nessuna chiave» → foondaco-backup-test: scrittura PERMESSA, doveva essere rifiutata" \
  "«nessuna chiave» → foondaco-backup-test: cancellazione PERMESSA, doveva essere rifiutata (l'oggetto di prova è sparito)" \
  "«backup di test» → foondaco-backup-test: oggetti di prova cancellati (2)" \
  "FALLITO: 148 controlli, 2 falliti"
run_case "OPS-007 OPS-008 codice-diverso" codice-diverso 1 -- -- \
  "«file di produzione» → foondaco-backup: lettura, risposta inattesa NoSuchBucket (attesa AccessDenied)" \
  "«backup di produzione» → foondaco-specchio: lista degli oggetti, risposta inattesa NoSuchBucket (attesa AccessDenied)" \
  "«backup di produzione» → foondaco-specchio: scrittura, risposta inattesa NoSuchBucket (attesa AccessDenied)" \
  "«backup di produzione» → foondaco-specchio: cancellazione, risposta inattesa NoSuchBucket (attesa AccessDenied)" \
  "«sola lettura dello specchio» → foondaco-backup: modifica della policy, risposta inattesa NoSuchBucket (attesa AccessDenied)" \
  "«nessuna chiave» → foondaco-file: scrittura, risposta inattesa NoSuchBucket (attesa AccessDenied)" \
  "«sola lettura dello specchio» → foondaco-backup: lettura riuscita" \
  "FALLITO: 148 controlli, 119 falliti"
run_case "OPS-007 cancellazione-che-mente" cancellazione-che-mente 1 -- -- \
  "«file di test» → foondaco-file: cancellazione con risposta AccessDenied, ma l'oggetto di prova è sparito" \
  "«sola lettura dello specchio» → foondaco-file: lettura rifiutata" "FALLITO: 148 controlli, 1 fallito:"
run_case "OPS-007 cancellazione-finta" cancellazione-finta 1 -- -- \
  "«sola lettura dello specchio» → foondaco-backup: cancellazione PERMESSA, doveva essere rifiutata" \
  "FALLITO: 148 controlli, 1 fallito:"
run_case "OPS-007 scrittura-che-mente" scrittura-che-mente 1 -- -- \
  "«file di test» → foondaco-file: scrittura rifiutata" \
  "«file di produzione» → foondaco-file: c'erano oggetti che una scrittura rifiutata non doveva lasciare: scrittura-FILE_TEST.txt" \
  "FALLITO: 149 controlli, 1 fallito:"
run_case "OPS-007 errore-con-chiave" errore-con-chiave 1 -- -- \
  "«file di test»: elenco dei bucket del suo progetto, chiesto a fsn1, non riuscito: codice di uscita 255: Could not connect to the endpoint URL" \
  "id=[chiave]&secret=[chiave]" "le prove fra le unità non partono"

# Configuration errors: exit status 2, before any call with a key.
run_case "OPS-007 manca-una-variabile" corretto 2 FILE_TEST_REGION= -- -- "manca la variabile FILE_TEST_REGION"
run_case "OPS-007 mancano-due-variabili" corretto 2 FILE_TEST_REGION= MIRROR_DST_BUCKET= -- -- \
  "mancano le variabili FILE_TEST_REGION MIRROR_DST_BUCKET"
run_case "OPS-007 bucket-ripetuto" corretto 2 MIRROR_DST_BUCKET=foondaco-file -- -- \
  "FILE_PROD_BUCKET e MIRROR_DST_BUCKET indicano lo stesso bucket"
run_case "OPS-007 access-key-ripetuta" corretto 2 "MIRROR_SRC_ACCESS_KEY_ID=${KEY_ID[FILE_PROD]}" -- -- \
  "MIRROR_SRC_ACCESS_KEY_ID è uguale a FILE_PROD_ACCESS_KEY_ID"
run_case "OPS-007 chiave-con-spazi" corretto 2 "FILE_PROD_ACCESS_KEY_ID=${KEY_ID[FILE_PROD]} x" -- -- \
  "FILE_PROD_ACCESS_KEY_ID contiene spazi"
run_case "OPS-007 indirizzo-http" corretto 2 FILE_PROD_ENDPOINT=http://fsn1.your-objectstorage.com -- -- \
  "FILE_PROD_ENDPOINT deve essere un indirizzo https:// senza percorso"
run_case "OPS-007 chiave-mancante-senza-terminale" corretto 2 BACKUP_TEST_SECRET_ACCESS_KEY= -- -- \
  "manca BACKUP_TEST_SECRET_ACCESS_KEY e il terminale non è interattivo"
run_case "OPS-007 chiave-come-argomento" corretto 2 -- "${KEY_SECRET[FILE_PROD]}" -- \
  "argomento non previsto: lo script accetta solo --aws <client> e --help"
run_case "OPS-007 client-assente" corretto 2 -- --aws "$work/non-esiste" -- "client S3 non trovato"

# The client remedy (aws/aws-cli#10161): not loaded, or another client version, stops the script
# before any key; a temporary folder whose path holds ':' too (the client would split it); once the
# remedy changes during the run, no call is made any more.
run_case "OPS-007 correttivo-non-caricato" correttivo-non-caricato 2 -- -- \
  "il correttivo del client non risulta caricato, oppure il client non è aws-cli 2.39.4"
run_case "OPS-007 client-di-altra-versione" client-di-altra-versione 2 -- -- \
  "il correttivo del client non risulta caricato, oppure il client non è aws-cli 2.39.4" \
  "risposta del client: foondaco_empty_message: loaded aws-cli/2.40.0 Python/3.14.8"
run_case "OPS-007 client-2.39.40" client-2.39.40 2 -- -- \
  "il correttivo del client non risulta caricato, oppure il client non è aws-cli 2.39.4"
mkdir -p -- "$work/due:punti"
run_case "OPS-007 cartella-temporanea-con-due-punti" corretto 2 "TMPDIR=$work/due:punti" -- -- \
  "non riesco a scrivere il correttivo del client in"
if selected cartella-temporanea-con-due-punti-vuota; then
  if [ -z "$(cd -- "$work/due:punti" && shopt -s nullglob dotglob && printf '%s' *)" ]; then
    ok "OPS-007 cartella-temporanea-con-due-punti-vuota"
  else
    no "OPS-007 cartella-temporanea-con-due-punti-vuota" "lo script ha lasciato file nella cartella temporanea con «:»" /dev/null
  fi
fi
run_case "OPS-007 cartella-temporanea-relativa" corretto 2 "TMPDIR=." -- -- \
  "non riesco a scrivere il correttivo del client in ./check-bucket-isolation."
run_case "OPS-007 correttivo-alterato-durante-la-prova" correttivo-alterato 1 -- -- \
  "Correttivo del client: caricato (aws/aws-cli#10161)" \
  "«file di test» → foondaco-file-test: scrittura non riuscita: codice di uscita 3: correttivo del client alterato: chiamata non fatta" \
  "le prove fra le unità non partono"
run_case "OPS-007 configurazione-del-correttivo-alterata" correttivo-configurazione-alterata 1 -- -- \
  "«file di test» → foondaco-file-test: scrittura non riuscita: codice di uscita 3: correttivo del client alterato: chiamata non fatta" \
  "le prove fra le unità non partono"

# The keys pasted at the prompts, in a terminal, as the user will do (I2). Each part asked gets
# exactly one «ricevuta» line; a part asked again gets none.
run_pty_case "OPS-007 chiavi-dal-terminale" corretto 0 '{"pad": true}' \
  "Incolla ogni parte dal gestore di password" "=12:  ricevuta" \
  "Chiavi ricevute: non incollare altro in questo terminale fino alla fine della prova." \
  "RIUSCITO: 148 controlli, nessuno fallito."
run_pty_case "OPS-007 incolla-prima-della-domanda" corretto 0 \
  '{"strays": [{"after": "check-bucket-isolation.sh: isolamento delle unità di archivio S3", "text": "FAKEIDEARLYPASTEJX9Z\r"}]}' \
  "=12:  ricevuta" "RIUSCITO: 148 controlli, nessuno fallito."
run_pty_case "OPS-007 invio-in-piu" corretto 0 '{"extra_enter_after": "FILE_PROD_ACCESS_KEY_ID"}' \
  "=1:è vuota: incollala di nuovo dal gestore di password" "=12:  ricevuta" "RIUSCITO: 148 controlli, nessuno fallito."
run_pty_case "OPS-007 incollata-due-volte" corretto 0 '{"duplicate_at": "FILE_PROD_SECRET_ACCESS_KEY"}' \
  "=1:è uguale a FILE_PROD_ACCESS_KEY_ID: incollala di nuovo dal gestore di password" \
  "=12:  ricevuta" "RIUSCITO: 148 controlli, nessuno fallito."
run_pty_case "OPS-007 incollata-con-spazi" corretto 0 \
  '{"bad_paste_at": "FILE_PROD_ACCESS_KEY_ID", "bad": "FAKEIDWRONGPAIRJX7Z fakeSecretWrongPairPastedWV7Q"}' \
  "=1:contiene spazi: incollala di nuovo dal gestore di password" "=12:  ricevuta" \
  "RIUSCITO: 148 controlli, nessuno fallito."
run_pty_case "OPS-007 ctrl-z-alle-chiavi" corretto 0 '{"suspend_at": "FILE_PROD_ACCESS_KEY_ID"}' \
  "=12:  ricevuta" "RIUSCITO: 148 controlli, nessuno fallito."
run_pty_case "OPS-007 incolla-durante-la-prova" corretto 0 '{"strays": [
    {"after": "1. Ogni chiave nel proprio bucket", "text": "FAKEIDSTRAYONEJX8Z\r"},
    {"after": "2. Ogni chiave nei bucket delle altre unità", "text": "fakeSecretStrayWithoutEnterTwoWV8Q"},
    {"after": "3. Richieste senza chiave", "text": "FAKEIDSTRAYTHREEJX8Z\r"},
    {"after": "4. Pulizia degli oggetti di prova", "text": "fakeSecretStrayWithoutEnterFourWV8Q"}]}' \
  "=12:  ricevuta" "RIUSCITO: 148 controlli, nessuno fallito."
NO_CALLS=1 run_pty_case "OPS-007 correttivo-non-caricato-al-terminale" correttivo-non-caricato 2 '{}' \
  "il correttivo del client non risulta caricato" "=0:Incolla ogni parte dal gestore di password" "=0:  ricevuta"
NO_CALLS=1 run_pty_case "OPS-007 ctrl-d-alle-chiavi" corretto 2 '{"abort_at": {"var": "BACKUP_PROD_ACCESS_KEY_ID", "char": "\u0004"}}' \
  "lettura di BACKUP_PROD_ACCESS_KEY_ID interrotta" "=2:  ricevuta" \
  "Non incollare altre chiavi in questo terminale: chiudilo e aprine uno nuovo"
NO_CALLS=1 run_pty_case "OPS-007 ctrl-c-alle-chiavi" corretto 130 '{"abort_at": {"var": "BACKUP_PROD_ACCESS_KEY_ID", "char": "\u0003"}}' \
  "=1:ATTENZIONE: lo script si è fermato mentre chiedeva le chiavi." "=2:  ricevuta" "=1:Interrotto."
NO_CALLS=1 run_pty_case "OPS-007 doppio-ctrl-c-alle-chiavi" corretto 130 \
  '{"abort_at": {"var": "BACKUP_PROD_ACCESS_KEY_ID", "char": "\u0003", "again_after": "Interrotto."}}' \
  "=1:ATTENZIONE: lo script si è fermato mentre chiedeva le chiavi." "=2:  ricevuta" "=1:Interrotto."
run_pty_case "OPS-007 ctrl-c-durante-la-prova" attesa-nella-prova 130 \
  '{"strays": [{"after": "FAKE-AWS-IN-ATTESA", "text": "\u0003"}]}' \
  "=12:  ricevuta" "=1:Interrotto: gli oggetti di prova restano sotto check-bucket-isolation/"
run_pty_case "OPS-007 ctrl-c-durante-la-policy" attesa-nella-policy 130 \
  '{"strays": [{"after": "FAKE-AWS-IN-ATTESA", "text": "\u0003"}]}' \
  "=12:  ricevuta" "=1:Interrotto: gli oggetti di prova restano sotto check-bucket-isolation/"

echo
echo "Scenari: $((passed + failed)), come atteso: $passed, diversi: $failed"
[ "$failed" -eq 0 ]
