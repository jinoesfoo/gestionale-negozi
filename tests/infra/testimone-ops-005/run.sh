#!/usr/bin/env bash
# The lifecycle witness of OPS-005 (specs/08-operativita.md, OPS-005, «Testimone del ciclo di
# vita»): checklist row G6 of docs/verifiche/ops-t03.md, which also writes down the contract of the
# two blocks that this test checks (section G, «Il contratto dei due blocchi del passo 14»).
#
# It runs the two blocks of step 14 of infra/README.md, «Archivi S3 (OPS-T03)» («Scrittura» and
# «Verifica»), after the key terminal block of step 4, with a fake client (fake-s3.py) in place of
# aws: no real key, no network, no provider. The real client, where it is installed, only answers
# the startup check of the step 4 block (aws --version, without keys). Each block runs as top-level
# code of a script, as a paste runs it: a top-level return does not stop it, an exit ends the
# shell. It checks that:
# - step 14 is in the README, before «Valori letti», now step 15, with its two blocks once each;
#   the blocks are safe to paste (no tab, carriage return, other control character, trailing space
#   or "!"), keep the markers of A5 unique, load only the file-test key, once, of the step 4
#   functions call only s3 and _versions_of, never call aws directly, and neither trace the shell,
#   list its variables nor touch /dev/tty;
# - the Scrittura block writes testimone-ops-005.txt twice into an empty foondaco-file-test (the
#   control, then the witness, one line with the UTC time of the write) and shows the first and the
#   final list as the client prints them, with a line for every version; it writes nothing when the
#   file already has a version or a delete marker, when the first list fails or cannot be read,
#   without the key, or with the client remedy off or changed; it stops after a failed write; the
#   reason of every failure shows, and each message of G8 only in its case;
# - the Verifica block only reads: it shows each version and delete marker of the witness, or
#   that there are none, but never "none" when the list failed; it shows the text read only when
#   the read worked, without control characters; it shows the lifecycle rules;
# - both blocks show the list of the leftovers of I2 as the client prints it;
# - every block gets to its end within 60 seconds, reading nothing from the terminal but the two
#   answers, and leaves the shell as it was (options such as set -e or set -x, traps, exported
#   variables and the shell variables a terminal depends on, aliases, umask, the shell's input and
#   outputs, readline, every function of step 4), without clearing the screen, moving back over
#   what it printed or switching to another screen;
# - pasted into an interactive bash in a terminal, as in G8, each block asks exactly two questions,
#   for the file-test key, with the echo off, prints the same lines as in a script, and the prompt
#   comes back after it;
# - the Verifica prints, whole, the text that the Scrittura wrote, and never an outcome of its own
#   (the words of spec 08's outcomes, such as «atteso», «verifica riuscita», «non conclusiva»);
# - the client gets the key only in its environment, never on its command line, in another
#   variable or in a file it writes, and only for foondaco-file-test at fsn1; the fake keys never
#   show in any output or in any file of the terminal.
# Every case name starts with the requirement it protects (OPS-005).
#
# Usage: bash tests/infra/testimone-ops-005/run.sh. Exit status: 0 every case as expected.
# TESTIMONE_README=<path> takes the blocks from another copy of the README (mutation tests);
# TESTIMONE_KEEP=1 keeps the work folder, with the output of every case, and prints its path.
set -u -o pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
readme=${TESTIMONE_README:-$root/infra/README.md}
fake=$here/fake-s3.py
ptypaste=$here/pty-paste.py
py=$(command -v python3) || { echo 'python3 non trovato'; exit 1; }
work=$(mktemp -d "${TMPDIR:-/tmp}/testimone-ops-005.XXXXXX") || exit 1
case $work in /*) ;; *) work=$PWD/$work ;; esac # the cases change folder
cleanup() {
  [ -z "${input_holder:-}" ] || kill "$input_holder" 2>/dev/null
  if [ -n "${TESTIMONE_KEEP:-}" ]; then
    echo "Cartella di lavoro tenuta: $work"
    return
  fi
  chmod -R u+w -- "$work" 2>/dev/null
  rm -rf -- "$work"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

passed=0
failed=0
ok() { passed=$((passed + 1)); printf 'ok  %s\n' "$1"; }
no() {
  failed=$((failed + 1))
  printf 'NO  %s: %s\n' "$1" "$2"
  # the end of the case's output, with a final newline, so that the next verdict starts its own
  # line, and without control characters but tab and newline, C1 ones too (a block's escape
  # sequence must not clear the screen that shows the verdicts)
  [ -z "${3:-}" ] || [ ! -s "$3" ] || sed -e 's/^/      | /' -e '$a\' "$3" | "$py" -I -c 'import sys, unicodedata; t = sys.stdin.buffer.read().decode("utf-8", "replace"); sys.stdout.buffer.write("".join(c for c in t if c in "\t\n" or unicodedata.category(c) != "Cc").encode())' | tail -n 15
}
finish() {
  echo
  echo "Prove: $((passed + failed)), come attese: $passed, diverse: $failed"
  [ "$failed" -eq 0 ]
  exit
}

echo "Prova del testimone del ciclo di vita (OPS-005; G6 di docs/verifiche/ops-t03.md)"

KEY_ID=AKIDUMMYTESTIMONE0001
KEY_SECRET=dummySecretTestimone00000000000000000001
T=testimone-ops-005.txt
C=check-bucket-isolation/
WRITE_MARK='# Testimone del ciclo di vita (infra/README.md, passo 14): scrittura'
VERIFY_MARK='# Testimone del ciclo di vita (infra/README.md, passo 14): verifica'
STEP4_MARK='# Terminale delle chiavi (infra/README.md'

# 1. The README: step 14 and its two blocks, the step 4 block. One line per check: "OK|name" or
# "NO|name|reason". The blocks go to write.sh, verify.sh and step4.sh.
"$py" -I - "$readme" "$work" "$WRITE_MARK" "$VERIFY_MARK" "$STEP4_MARK" >"$work/static" 2>&1 <<'PY'
import re
import sys

path, work, write_mark, verify_mark, step4_mark = sys.argv[1:6]
lines = open(path, encoding="utf-8").read().split("\n")
out = []


def check(name, problem):
    out.append("NO|%s|%s" % (name, problem) if problem else "OK|%s" % name)


def section():
    starts = [i for i, l in enumerate(lines) if l == "## Archivi S3 (OPS-T03)"]
    if len(starts) != 1:
        return None, None, "il titolo «## Archivi S3 (OPS-T03)» non c'è una volta sola"
    end = next((i for i in range(starts[0] + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    return starts[0], end, ""


s0, s1, problem = section()
step14 = step15 = None
if not problem:
    sub = [(i, l) for i, l in enumerate(lines[s0:s1], s0) if l.startswith("### ")]
    h14 = [i for i, l in sub if l.startswith("### 14. Testimone del ciclo di vita")]
    h15 = [i for i, l in sub if l.startswith("### 15. Valori letti")]
    other14 = [l for i, l in sub if l.startswith("### 14.") and i not in h14]
    if len(h14) != 1:
        problem = "il titolo «### 14. Testimone del ciclo di vita …» non c'è una volta sola nella sezione"
    elif len(h15) != 1:
        problem = "il titolo «### 15. Valori letti» non c'è una volta sola nella sezione"
    elif other14:
        problem = "c'è ancora un altro passo 14: %s" % other14[0]
    elif not h14[0] < h15[0]:
        problem = "il passo 14 non viene prima del passo 15"
    else:
        step14 = (h14[0], next(i for i, _ in sub if i > h14[0]))
check("OPS-005 testimone: il passo 14 «Testimone del ciclo di vita» viene prima del passo 15 «Valori letti», "
      "nella sezione «Archivi S3 (OPS-T03)»", problem)


def block(mark, name, inside):
    """The fenced bash block whose first line starts with mark: written to work/name."""
    starts = [i for i, l in enumerate(lines) if l.startswith(mark)]
    if len(starts) != 1:
        return "la riga «%s…» c'è %d volte invece di una" % (mark, len(starts))
    i = starts[0]
    if i == 0 or lines[i - 1] != "```bash":
        return "la riga «%s…» non è la prima di un blocco ```bash" % mark
    end = next((j for j in range(i, len(lines)) if lines[j].startswith("```")), None)
    if end is None:
        return "il blocco che comincia con «%s…» non finisce" % mark
    if inside and not (inside[0] < i < inside[1]):
        return "il blocco non è nel passo 14"
    open("%s/%s" % (work, name), "w", encoding="utf-8").write("\n".join(lines[i:end]) + "\n")
    return ""


check("OPS-005 testimone: il blocco «Scrittura» c'è una volta sola, nel passo 14",
      block(write_mark, "write.sh", step14) or ("" if step14 else "manca il passo 14"))
check("OPS-005 testimone: il blocco «Verifica» c'è una volta sola, nel passo 14",
      block(verify_mark, "verify.sh", step14) or ("" if step14 else "manca il passo 14"))
check("OPS-005 testimone: il blocco del passo 4 (terminale delle chiavi) c'è una volta sola",
      block(step4_mark, "step4.sh", None))
for marker in ("# >>> aws-cli-empty-message", "# <<< aws-cli-empty-message"):
    n = sum(1 for l in lines if l.startswith(marker))
    check("OPS-005 testimone: nel README il segno «%s» del correttivo c'è una volta sola (A5)" % marker,
          "" if n == 1 else "c'è %d volte" % n)
print("\n".join(out))
PY
while IFS='|' read -r verdict name reason; do
  case $verdict in
    OK) ok "$name" ;;
    NO) no "$name" "$reason" ;;
    *) no "OPS-005 testimone: lettura del README" "$verdict${name:+|$name}${reason:+|$reason}" ;;
  esac
done <"$work/static"
if ! [ -s "$work/write.sh" ] || ! [ -s "$work/verify.sh" ] || ! [ -s "$work/step4.sh" ]; then
  finish
fi

# 2. The two blocks as text: safe to paste, one key (file-test), no direct client call; the
# Verifica block has no command that writes or deletes, the Scrittura block only its two writes.
# Code lines are the lines after the first that are not empty and not comments (a comment at the
# end of a code line is part of it).
"$py" -I - "$work/write.sh" "$work/verify.sh" "$work/step4.sh" >"$work/static2" 2>&1 <<'PY'
import re
import sys

blocks = {"Scrittura": open(sys.argv[1], encoding="utf-8").read().rstrip("\n").split("\n"),
          "Verifica": open(sys.argv[2], encoding="utf-8").read().rstrip("\n").split("\n")}
step4 = open(sys.argv[3], encoding="utf-8").read()
code = {b: [l for l in lines[1:] if l.strip() and not l.lstrip().startswith("#")] for b, lines in blocks.items()}
out = []


def check(name, problems):
    out.append("NO|%s|%s" % (name, "; ".join(problems)) if problems else "OK|%s" % name)


problems = []
for b, lines in blocks.items():
    for n, line in enumerate(lines, 1):
        for bad, what in (("\t", "una tabulazione"), ("\r", "un ritorno a capo"), ("!", "un «!»")):
            if bad in line:
                problems.append("%s, riga %d: %s" % (b, n, what))
        if any(ord(c) < 32 and c not in "\t\r" or 0x7F <= ord(c) <= 0x9F for c in line):
            problems.append("%s, riga %d: un carattere di controllo" % (b, n))
        if line != line.rstrip(" "):
            problems.append("%s, riga %d: spazi in fondo" % (b, n))
check("OPS-005 testimone: i due blocchi si possono incollare (niente tabulazioni, ritorni a capo, altri "
      "caratteri di controllo, spazi in fondo o «!»)", problems)

problems = []
for b, lines in blocks.items():
    for n, line in enumerate(lines, 1):
        if line.startswith("# Terminale delle chiavi (infra/README.md") or "aws-cli-empty-message" in line:
            problems.append("%s, riga %d" % (b, n))
check("OPS-005 testimone: nei due blocchi né la prima riga del blocco del passo 4 né i segni del correttivo, "
      "che A5 vuole una volta sola", problems)

problems = []
for b, lines in code.items():
    if [re.sub(r"\s+#.*$", "", l) for l in lines[:2]] != ["load_key file-test", "use_key file-test"]:
        problems.append("%s: non comincia con «load_key file-test» e «use_key file-test», su due righe" % b)
    text = "\n".join(lines[2:])
    words = ["load_key", "use_key", "compare_key", "put_policy_keys", "watch_revocation", "export",
             "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "KEY_ID", "KEY_SECRET", "CLIENT_READY"]
    # Of the step 4 functions (names read from the block) the blocks call only load_key and use_key,
    # in the first two lines, s3 and _versions_of: the others write, delete or print what they must not.
    words += [f for f in re.findall(r"^([A-Za-z_][A-Za-z0-9_]*)\(\)", step4, re.M)
              if f not in words + ["s3", "_versions_of"]]
    for word in words:
        if re.search(r"\b%s\b" % word, text):
            problems.append("%s: contiene «%s» dopo le prime due righe" % (b, word))
    # A trace of the shell or a list of its variables would put the key on the screen or in a file:
    # set, declare, typeset, readonly or local without names (options alone, a redirection, a
    # comment or the end of a command substitution may follow), declare -p, typeset -p.
    if re.search(r"\bBASH_XTRACEFD\b|\bxtrace\b|(^|[\s;&|(`\\])set\s+-[A-Za-z]*x|\b(declare|typeset)\s+-[A-Za-z]*p"
                 r"|(^|[\s;&|(`\\])(set|(declare|typeset|readonly|local)(\s+[-+][A-Za-z]+)*)"
                 r"\s*($|[;&|)`<>]|[0-9]+[<>]|(?<=\s)#)", text, re.M):
        problems.append("%s: contiene una traccia della shell (set -x, xtrace, BASH_XTRACEFD) o un elenco delle "
                        "variabili (set, declare, typeset, readonly o local senza nomi, declare -p, typeset -p)" % b)
    if re.search(r"(^|[\s;&|(`])read\s", text):
        problems.append("%s: contiene una lettura dal terminale («read»)" % b)
    if "/dev/tty" in text:
        problems.append("%s: legge o scrive /dev/tty" % b)
    if re.search(r"(^|[\s;&|(`])(aws|_aws|env)\s", text):
        problems.append("%s: chiama il client senza la funzione s3 (o nomina «aws», «_aws» o «env» come parola a sé)" % b)
check("OPS-005 chiavi: ogni blocco carica e usa solo la chiave file-test, una volta, manda le richieste solo con s3 "
      "(delle funzioni del passo 4 usa solo s3 e _versions_of), non traccia la shell, non elenca le variabili e non "
      "legge dal terminale", problems)

problems = []
verify = "\n".join(code["Verifica"])
for op in ("put-object", "delete-object", "delete-objects", "copy-object", "restore-object", "put-bucket",
           "delete-bucket", "put-object-retention", "put-object-legal-hold", "rm ", "mv "):
    if op in verify:
        problems.append("Verifica: contiene «%s»" % op.strip())
write = "\n".join(code["Scrittura"])
for op in ("delete-object", "copy-object", "restore-object", "put-bucket", "delete-bucket", "put-object-"):
    if op in write:
        problems.append("Scrittura: contiene «%s»" % op)
n = len(re.findall(r"\bput-object\b(?!-)", write))  # the word, in commands and messages alike
if n != 2:
    problems.append("Scrittura: la parola put-object %d volte invece di due, una per scrittura" % n)
check("OPS-005 testimone: la Verifica non scrive e non cancella; la Scrittura ha solo le sue due scritture",
      problems)
print("\n".join(out))
PY
while IFS='|' read -r verdict name reason; do
  case $verdict in
    OK) ok "$name" ;;
    NO) no "$name" "$reason" ;;
    *) no "OPS-005 testimone: lettura dei blocchi" "$verdict${name:+|$name}${reason:+|$reason}" ;;
  esac
done <"$work/static2"

# 3. The fake client, sourced after the step 4 block: a shell function named aws, which _aws runs
# with the key in the environment of that call. With "off" the startup check of the remedy is
# taken as failed; with "altered" the remedy's module changes after the startup check, as another
# program of the user could change it.
{
  printf '%s\n' '# The fake client in place of aws, after the key terminal block of step 4 (tests only).'
  printf '%s\n' 'FAKE_S3_STATE=$1'
  printf 'aws() { %q -I %q "$FAKE_S3_STATE" "$@"; }\n' "$py" "$fake"
  cat <<'EOF'
case $2 in
  ready) CLIENT_READY=1 ;;
  off) CLIENT_READY= ;;
  altered)
    CLIENT_READY=1
    chmod 700 -- "$AWS_CLI_PLUGIN_DIR"
    chmod 600 -- "$AWS_CLI_PLUGIN_DIR/foondaco_empty_message.py"
    printf '%s\n' '# changed by another program' >>"$AWS_CLI_PLUGIN_DIR/foondaco_empty_message.py"
    chmod 400 -- "$AWS_CLI_PLUGIN_DIR/foondaco_empty_message.py"
    chmod 500 -- "$AWS_CLI_PLUGIN_DIR" ;;
esac
EOF
} >"$work/setup.sh"

# The state of the shell that a block must leave as it found it: options ($- outside a command
# substitution, which would clear -e), shopt, traps, exported variables (PWD and OLDPWD among
# them), the shell variables that change how the shell or a terminal behaves and those of step 4
# (not the key ones, which the block changes by design), aliases, umask, where the shell's input
# and outputs go, every function that the step 4 block defines (names read from the block) and the
# fake client. A block may define helpers and variables of its own, with other names. declare -p
# of a variable that is not set prints nothing (its error, which would carry a line number, is
# dropped).
step4_functions=$(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)().*/\1/p' "$work/step4.sh" | sort -u | tr '\n' ' ')
STATE_SUM='"$(set -o)" "$(shopt -p)" "$(trap -p)" "$(export -p)" "$(declare -p IFS TMOUT PS0 PS1 PS2 PS3 PS4 PROMPT_COMMAND PROMPT_DIRTRIM HISTFILE HISTCONTROL HISTIGNORE HISTSIZE HISTFILESIZE HISTTIMEFORMAT IGNOREEOF CDPATH GLOBIGNORE FIGNORE EXECIGNORE TIMEFORMAT FUNCNEST POSIXLY_CORRECT LANG LC_ALL LC_CTYPE LC_COLLATE LC_MESSAGES LC_NUMERIC LC_TIME READ_PROJECT_ID BUCKET PLACE OWNER_KEY WORK AWS_CLI_BASE AWS_CLI_PLUGIN_TEXT AWS_CLI_PLUGIN_DIR AWS_CLI_CONFIG AWS_CLI_CONFIG_TEXT CLIENT_READY CLIENT_VERSION 2>/dev/null)" "$(alias -p)" "$(umask)" "$(readlink /proc/$$/fd/0 /proc/$$/fd/1 /proc/$$/fd/2)" "$(declare -f '"$step4_functions"'aws | cksum)"'
PROBE="printf '%s|' \"\$-\" $STATE_SUM | cksum"
STATE_WHAT="opzioni come set -e o set -x e quelle di shopt, trap, variabili esportate (anche PWD e OLDPWD, che un cd cambia) o della shell come IFS, TMOUT, LC_… e CDPATH (anche una che prima non c'era e ora c'è, vuota) o del passo 4 come BUCKET, PLACE e WORK, alias, umask, ingresso e uscite della shell, funzioni del passo 4"

# state <case dir> <objects JSON> [<failures JSON> [d2 | none]]: the world of the fake client, with
# the lifecycle rules of D2 unless "none".
state() {
  mkdir -p -- "$1/home" "$1/tmp"
  "$py" -I - "$1/state.json" "$2" "${3:-}" "${4:-d2}" "$KEY_ID" "$KEY_SECRET" <<'PY'
import json
import sys

path, objects, fail, lifecycle, key_id, secret = sys.argv[1:7]
d2 = [{"ID": "versioni-precedenti", "Status": "Enabled", "Prefix": "",
       "NoncurrentVersionExpiration": {"NoncurrentDays": 30},
       "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}},
      {"ID": "delete-marker-scaduti", "Status": "Enabled", "Prefix": "",
       "Expiration": {"ExpiredObjectDeleteMarker": True}}]
json.dump({"key_id": key_id, "secret": secret, "bucket": "foondaco-file-test", "place": "fsn1",
           "objects": json.loads(objects), "fail": json.loads(fail or "{}"),
           "lifecycle": d2 if lifecycle == "d2" else None,
           "expiration": 'expiry-date="Tue, 22 Dec 2026 00:00:00 GMT", rule-id="versioni-precedenti"',
           "next_id": 1, "clock": "2026-11-22T12:00:00+00:00"},
          open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
PY
}

# run <case dir> <block> <keys: ok | ok2 | none | swapped> <client: ready | off | altered> [<times>]:
# the step 4 block and the fake client, then the block <times> times in a row (once by default),
# as top-level code of a script, the way a paste runs it (aliases expanded), with the answers to
# the key questions on its input (ok2: the pair twice); after them a line that no question asks
# for, then the input stays open, as a terminal's, except with none (the questions interrupted).
# In a clean bash without a terminal, every signal at its default as in a new terminal, within 60
# seconds; what the block leaves running is killed after it. The state of the shell goes to
# probe-before and probe-after, around the blocks; the file end is written only if the shell gets
# past them. Output in <case dir>/out; then the facts of the fake, and the start and end times.
input_holder=
run() {
  local dir=$1 block=$2 keys=$3 client=$4 times=${5:-1} n rc=0 t0 input found rest
  for ((n = 0; n < times; n++)); do
    case $keys in
      ok) printf '%s\n%s\n' "$KEY_ID" "$KEY_SECRET" ;;
      ok2) printf '%s\n%s\n%s\n%s\n' "$KEY_ID" "$KEY_SECRET" "$KEY_ID" "$KEY_SECRET" ;;
      swapped) printf '%s\n%s\n' "$KEY_SECRET" "$KEY_ID" ;;
      none) : ;;
    esac
  done >"$dir/keys"
  {
    printf '%s\n' 'shopt -s expand_aliases'
    printf 'source %q >%q 2>&1\n' "$work/step4.sh" "$dir/step4.out"
    printf 'source %q %q %q\n' "$work/setup.sh" "$dir/state.json" "$client"
    printf '%s >%q\n' "$PROBE" "$dir/probe-before"
    for ((n = 0; n < times; n++)); do cat -- "$block"; done
    printf '%s >%q\n' "$PROBE" "$dir/probe-after"
    printf 'echo fine >%q\n' "$dir/end"
  } >"$dir/script.sh"
  if [ "$keys" = none ]; then
    exec {input}<"$dir/keys"
  else # a block that reads beyond the answers takes the line after them, or waits into the time limit
    exec {input}< <(cat -- "$dir/keys"; printf '%s\n' NON-LETTO; exec sleep 70)
    input_holder=$!
  fi
  t0=$(date -u +%s)
  # exec: timeout takes the subshell's place, so that a signal to run.sh never leaves the case
  # running; it puts the case in a process group of its own, whose number goes to case-pid.
  (cd -- "$dir/home" && echo "$BASHPID" >"$dir/case-pid" &&
    exec timeout -k 5 60 env -i --default-signal HOME="$dir/home" PATH=/usr/bin:/bin \
    TMPDIR="$dir/tmp" LANG=C.UTF-8 TZ=Europe/Rome TERM=xterm-256color HTTPS_PROXY=http://127.0.0.1:9 \
    HTTP_PROXY=http://127.0.0.1:9 bash "$dir/script.sh" <&"$input" {input}<&- >"$dir/out" 2>&1) || rc=$?
  kill -KILL -- "-$(cat -- "$dir/case-pid" 2>/dev/null)" 2>/dev/null # what ignored the time limit's TERM
  if [ "$keys" != none ]; then # answers that were never asked for may come before the line
    found=
    while IFS= read -r -t 10 -u "$input" rest; do [ "$rest" != NON-LETTO ] || { found=1; break; }; done
    [ -n "$found" ] || problems+=("il blocco legge dal terminale oltre le due risposte")
  fi
  exec {input}<&-
  [ -z "$input_holder" ] || kill "$input_holder" 2>/dev/null
  input_holder=
  facts "$dir"
  printf 'started=%s\nended=%s\n' "$t0" "$(date -u +%s)" >>"$dir/facts"
  case $rc in
    124 | 137) problems+=("il blocco non è finito entro 60 secondi (aspetta il terminale, o non finisce)") ;;
  esac
  if ! [ -f "$dir/end" ]; then
    problems+=("il blocco non arriva in fondo (exit, o set -e su un errore): incollato, chiuderebbe il terminale")
  elif ! cmp -s -- "$dir/probe-before" "$dir/probe-after"; then
    problems+=("il blocco cambia lo stato della shell ($STATE_WHAT)")
  fi
}

# facts <case dir>: what the fake client saw and holds, in <case dir>/facts, one "name=value" per
# line: calls (L list, P put, G get, C lifecycle, with the key or prefix; ? another operation),
# versions and markers of the witness file, its current entry and the others, the checks on the
# written texts, the UTC time in the witness text (seconds), violations.
facts() {
  "$py" -I - "$1/state.json" >"$1/facts" <<'PY'
import datetime as dt
import json
import re
import sys

s = json.load(open(sys.argv[1], encoding="utf-8"))
tags = {"list-object-versions": "L", "put-object": "P", "get-object": "G", "get-bucket-lifecycle-configuration": "C"}
calls = []
for c in s.get("calls", []):
    target = c.get("key") or c.get("prefix")
    calls.append(tags.get(c["op"], "?") + (":" + target if target else ""))
entries = s.get("objects", {}).get("testimone-ops-005.txt", [])
latest = entries[-1] if entries else None
older = [e for e in entries[:-1] if not e.get("delete_marker")]
body = (latest or {}).get("body", "")
when = re.search(r"\b(20[0-9]{2}-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9])Z\b", body)
try:
    epoch = str(int(dt.datetime.fromisoformat(when.group(1) + "+00:00").timestamp())) if when else ""
except ValueError:
    epoch = ""
print("calls=" + " ".join(calls))
print("versions=%d" % sum(1 for e in entries if not e.get("delete_marker")))
print("markers=%d" % sum(1 for e in entries if e.get("delete_marker")))
print("latest=" + ("" if not latest else ("delete-marker " if latest.get("delete_marker") else "versione ") + latest["VersionId"]))
print("latest_modified=" + ((latest or {}).get("LastModified") or ""))
print("older=" + " ".join(e["VersionId"] for e in older))
print("witness_text=" + ("yes" if latest and not latest.get("delete_marker") and "testimone" in body.lower()
                         and "OPS-005" in body and epoch and "confronto" not in body.lower()
                         and body.endswith("\n") and "\n" not in body[:-1] and "\r" not in body else "no"))
print("witness_epoch=" + epoch)
print("control_text=" + ("yes" if len(older) == 1 and "confronto" in older[0]["body"].lower()
                         and older[0]["body"] != body else "no"))
line = body.rstrip("\n")
print("witness_line=" + (line if "\n" not in line and "\r" not in line else "(più righe)"))
print("violations=%d" % len(s.get("violations", [])))
PY
}
fact() { sed -n "s/^$2=//p" "$1/facts"; }

# The checks of one case: want <what> <command...> adds <what> to the problems when the command
# fails; verdict <name> <case dir> reports the case.
problems=()
want() {
  local what=$1
  shift
  "$@" || problems+=("$what")
}
verdict() { # verdict <name> <case dir, or "" for a verdict across cases (no output shown)>
  if [ "${#problems[@]}" -eq 0 ]; then
    ok "$1"
  else
    no "$1" "$(IFS=';'; printf '%s' "${problems[*]}")" "${2:+$2/out}"
  fi
  problems=()
}
has() { grep -qF -- "$2" "$1/out"; }
hasnt() { ! grep -qF -- "$2" "$1/out"; }
# message <case dir> <message>: that message of G8 shows, and neither of the other two (G8: each
# in its case).
message() {
  local m
  has "$1" "$2" || return 1
  for m in 'Testimone non scritto: la prima lista' 'Testimone NON scritto' 'Scrittura del testimone interrotta'; do
    [[ $2 == "$m"* ]] || hasnt "$1" "$m" || return 1
  done
}
noline() { ! grep -qxF -- "$2" "$1/out"; }
count() { grep -cF -- "$2" "$1/out" || true; }
lines_like() { grep -cE -- "$2" "$1/out" || true; }
is() { [ "$(fact "$1" "$2")" = "$3" ]; }
witness_lines() { lines_like "$1" '^testimone: (versione|delete-marker) '; }
# leftovers_shown <case dir>: the list of the leftovers of I2, as the client prints it.
leftovers_shown() { has "$1" '"Prefix": "check-bucket-isolation/"' && has "$1" '"VersionId": "VersAvanzo01"' && has "$1" '"VersionId": "MarkerAvanzo02"'; }
# in_window <case dir>: the UTC time in the witness text is the time of the run, give or take 2 s.
in_window() {
  local t
  t=$(fact "$1" witness_epoch)
  [ -n "$t" ] && [ "$t" -ge $(($(fact "$1" started) - 2)) ] && [ "$t" -le $(($(fact "$1" ended) + 2)) ]
}
# reason <failure>: the start of the line that the client prints for it, as it prints it (a message
# of the block that only names the code does not count).
reason() {
  case $1 in
    network) echo 'Could not connect to the endpoint URL: "https://fsn1.your-objectstorage.com/' ;;
    *) echo "An error occurred ($1) when calling the" ;;
  esac
}

# Entries of the fake world: the control and the witness as the Scrittura block writes them, a
# delete marker over the witness, a hostile text (terminal controls, C1 controls, a line that
# looks like a list line), the leftovers of I2 under check-bucket-isolation/.
CONTROL='{"VersionId":"VersConfronto01","LastModified":"2026-11-22T12:00:01+00:00","body":"testimone del ciclo di vita (OPS-005), prima scrittura (confronto), 2026-11-22T12:00:01Z\n"}'
WITNESS='{"VersionId":"VersTestimone02","LastModified":"2026-11-22T12:00:02+00:00","body":"testimone del ciclo di vita (OPS-005), scritto il 2026-11-22T12:00:02Z\n"}'
MARKER='{"VersionId":"MarkerTestimone03","LastModified":"2026-12-20T08:00:00+00:00","delete_marker":true}'
HOSTILE='{"VersionId":"VersOstile04","LastModified":"2026-11-22T12:00:02+00:00","body":"testimone \u001b[2J\u001b]0;titolo\u0007 fine\u009b1A\u009b2K\u009d0;x\u009c\u0085\r\ntestimone: versione VersFalsa09 -\nseconda\triga è\n"}'
LEFT='"check-bucket-isolation/prova.txt":[{"VersionId":"VersAvanzo01","LastModified":"2026-11-21T22:36:00+00:00","body":"avanzo di I2\n"},{"VersionId":"MarkerAvanzo02","LastModified":"2026-11-21T22:36:05+00:00","delete_marker":true}]'
WRITTEN="{\"$T\":[$CONTROL,$WITNESS],$LEFT}"

# 4. The Scrittura block.
d=$work/w-vuoto
state "$d" "{$LEFT}"
run "$d" "$work/write.sh" ok ready
want "chiamate «$(fact "$d" calls)» invece di «L:$T P:$T P:$T L:$T L:$C»" is "$d" calls "L:$T P:$T P:$T L:$T L:$C"
want "versioni del testimone $(fact "$d" versions) invece di 2" is "$d" versions 2
want "delete marker $(fact "$d" markers) invece di 0" is "$d" markers 0
want "l'ultima scrittura non ha il testo del testimone (una riga sola con l'a capo in fondo, «testimone», «OPS-005», l'ora UTC con la Z, senza «confronto»)" is "$d" witness_text yes
want "l'ora nel testo del testimone non è l'ora UTC della scrittura" in_window "$d"
want "la prima scrittura non è il confronto (testo con «confronto», diverso dal testimone)" is "$d" control_text yes
want "manca la riga «testimone: $(fact "$d" latest) più-recente»" grep -qxF -- "testimone: $(fact "$d" latest) più-recente" "$d/out"
want "manca la riga «testimone: versione $(fact "$d" older) -»" grep -qxF -- "testimone: versione $(fact "$d" older) -" "$d/out"
want "righe «testimone: versione|delete-marker …» $(witness_lines "$d") invece di 2" [ "$(witness_lines "$d")" = 2 ]
want "manca la riga «testimone: il file scritto contiene «…»» con il testo del testimone, per G9" grep -qxF -- "testimone: il file scritto contiene «$(fact "$d" witness_line)»" "$d/out"
want "la prima lista e la lista finale non si vedono tutte e due (G8)" [ "$(count "$d" '"Prefix": "testimone-ops-005.txt"')" = 2 ]
want "manca il LastModified dell'ultima scrittura, dalla lista finale (G9)" has "$d" "\"LastModified\": \"$(fact "$d" latest_modified)\""
want "l'intestazione Expiration delle due scritture non si vede com'è" [ "$(lines_like "$d" 'expiry-date=.*Tue, 22 Dec 2026 00:00:00 GMT.*rule-id=.*versioni-precedenti')" -ge 2 ]
for v in $(fact "$d" older) $(fact "$d" latest | sed 's/^versione //'); do
  want "il VersionId $v non si vede due volte, nella risposta della sua scrittura e nella lista finale (G8)" [ "$(count "$d" "\"VersionId\": \"$v\"")" -ge 2 ]
done
want "un messaggio di testimone non scritto" hasnt "$d" "Testimone non scritto"
want "un messaggio di testimone non scritto" hasnt "$d" "Testimone NON scritto"
want "un messaggio di scrittura interrotta" hasnt "$d" "Scrittura del testimone interrotta"
want "la lista degli avanzi di I2 non si vede come la stampa il client" leftovers_shown "$d"
verdict "OPS-005 scrittura: nel bucket senza testimone scrive il confronto e poi il testimone, e ne mostra le versioni" "$d"

d=$work/w-rilancio
state "$d" "$WRITTEN"
run "$d" "$work/write.sh" ok ready
want "chiamate «$(fact "$d" calls)» invece di «L:$T L:$C»" is "$d" calls "L:$T L:$C"
want "versioni $(fact "$d" versions) invece di 2" is "$d" versions 2
want "manca «Testimone NON scritto», o c'è anche un altro dei tre messaggi di G8" message "$d" "Testimone NON scritto"
want "la prima lista non si vede (G8: Claude guarda la lista)" has "$d" '"VersionId": "VersTestimone02"'
want "righe «testimone: versione …» dopo un blocco che non ha scritto" [ "$(witness_lines "$d")" = 0 ]
verdict "OPS-005 scrittura: rilanciata dopo una scrittura riuscita non scrive di nuovo" "$d"

d=$work/w-marker
state "$d" "{\"$T\":[$MARKER],$LEFT}"
run "$d" "$work/write.sh" ok ready
want "chiamate «$(fact "$d" calls)» invece di «L:$T L:$C»" is "$d" calls "L:$T L:$C"
want "manca «Testimone NON scritto», o c'è anche un altro dei tre messaggi di G8" message "$d" "Testimone NON scritto"
want "la prima lista non si vede (G8: Claude guarda la lista)" has "$d" '"VersionId": "MarkerTestimone03"'
verdict "OPS-005 scrittura: con un delete marker sul file non scrive" "$d"

d=$work/w-una-versione
state "$d" "{\"$T\":[$CONTROL],$LEFT}"
run "$d" "$work/write.sh" ok ready
want "chiamate «$(fact "$d" calls)» invece di «L:$T L:$C»" is "$d" calls "L:$T L:$C"
want "versioni $(fact "$d" versions) invece di 1" is "$d" versions 1
want "manca «Testimone NON scritto», o c'è anche un altro dei tre messaggi di G8" message "$d" "Testimone NON scritto"
want "la prima lista non si vede (G8: Claude guarda la lista)" has "$d" '"VersionId": "VersConfronto01"'
verdict "OPS-005 scrittura: con la sola prima scrittura già fatta non scrive (la seconda la decide Claude)" "$d"

for f in network:'{"kind":"network"}' AccessDenied:'{"kind":"code","code":"AccessDenied"}' InvalidAccessKeyId:'{"kind":"code","code":"InvalidAccessKeyId"}'; do
  d=$work/w-lista-${f%%:*}
  state "$d" "{$LEFT}" "{\"list-object-versions#1\":${f#*:}}"
  run "$d" "$work/write.sh" ok ready
  want "chiamate «$(fact "$d" calls)» invece di «L:$T L:$C»" is "$d" calls "L:$T L:$C"
  want "manca «Testimone non scritto: la prima lista non è riuscita», o c'è anche un altro dei tre messaggi di G8" message "$d" "Testimone non scritto: la prima lista non è riuscita"
  want "la riga del client con il motivo («$(reason "${f%%:*}") …») non si vede" has "$d" "$(reason "${f%%:*}")"
  verdict "OPS-005 scrittura: con la prima lista non riuscita (${f%%:*}) non scrive, e se ne vede il motivo" "$d"
done

d=$work/w-lista-illeggibile
state "$d" "{$LEFT}" '{"list-object-versions#1":{"kind":"garbage"}}'
run "$d" "$work/write.sh" ok ready
want "chiamate «$(fact "$d" calls)» invece di «L:$T L:$C»" is "$d" calls "L:$T L:$C"
want "manca «Testimone NON scritto», o c'è anche un altro dei tre messaggi di G8" message "$d" "Testimone NON scritto"
want "la risposta che non si legge non si vede (G8: Claude guarda la lista)" has "$d" "502 Bad Gateway"
verdict "OPS-005 scrittura: con una lista che non si legge non scrive" "$d"

d=$work/w-prima-scrittura
state "$d" "{$LEFT}" '{"put-object#1":{"kind":"code","code":"SlowDown"}}'
run "$d" "$work/write.sh" ok ready
want "chiamate «$(fact "$d" calls)» invece di «L:$T P:$T L:$C»" is "$d" calls "L:$T P:$T L:$C"
want "manca «Scrittura del testimone interrotta», o c'è anche un altro dei tre messaggi di G8" message "$d" "Scrittura del testimone interrotta"
want "la riga del client con il motivo («$(reason SlowDown) …») non si vede" has "$d" "$(reason SlowDown)"
want "righe «testimone: versione …» dopo una scrittura non riuscita" [ "$(witness_lines "$d")" = 0 ]
want "il testo del testimone come se fosse scritto" hasnt "$d" "il file scritto contiene"
verdict "OPS-005 scrittura: se la prima scrittura non riesce si ferma, senza la seconda" "$d"

d=$work/w-prima-salvata
state "$d" "{$LEFT}" '{"put-object#1":{"kind":"network","after":true}}'
run "$d" "$work/write.sh" ok ready
want "chiamate «$(fact "$d" calls)» invece di «L:$T P:$T L:$C»" is "$d" calls "L:$T P:$T L:$C"
want "versioni $(fact "$d" versions) invece di 1" is "$d" versions 1
want "manca «Scrittura del testimone interrotta», o c'è anche un altro dei tre messaggi di G8" message "$d" "Scrittura del testimone interrotta"
want "la riga del client con il motivo («$(reason network) …») non si vede" has "$d" "$(reason network)"
want "il testo del testimone come se fosse scritto" hasnt "$d" "il file scritto contiene"
verdict "OPS-005 scrittura: se la risposta alla prima scrittura si perde si ferma, senza la seconda" "$d"

d=$work/w-seconda-scrittura
state "$d" "{$LEFT}" '{"put-object#2":{"kind":"network"}}'
run "$d" "$work/write.sh" ok ready
want "chiamate «$(fact "$d" calls)» invece di «L:$T P:$T P:$T L:$C»" is "$d" calls "L:$T P:$T P:$T L:$C"
want "versioni $(fact "$d" versions) invece di 1" is "$d" versions 1
want "manca «Scrittura del testimone interrotta», o c'è anche un altro dei tre messaggi di G8" message "$d" "Scrittura del testimone interrotta"
want "la riga del client con il motivo («$(reason network) …») non si vede" has "$d" "$(reason network)"
want "righe «testimone: versione …» dopo una scrittura non riuscita" [ "$(witness_lines "$d")" = 0 ]
want "il testo del testimone come se fosse scritto" hasnt "$d" "il file scritto contiene"
verdict "OPS-005 scrittura: se la seconda scrittura non riesce si ferma, con la sola prima scritta" "$d"

d=$work/w-lista-finale
state "$d" "{$LEFT}" '{"list-object-versions#2":{"kind":"network"}}'
run "$d" "$work/write.sh" ok ready
want "chiamate «$(fact "$d" calls)» invece di «L:$T P:$T P:$T L:$T L:$C»" is "$d" calls "L:$T P:$T P:$T L:$T L:$C"
want "versioni $(fact "$d" versions) invece di 2" is "$d" versions 2
want "manca la riga «testimone: il file scritto contiene «…»», che serve a G9 anche senza la lista finale" grep -qxF -- "testimone: il file scritto contiene «$(fact "$d" witness_line)»" "$d/out"
want "la riga del client con il motivo («$(reason network) …») non si vede" has "$d" "$(reason network)"
want "righe «testimone: versione …» senza la lista finale" [ "$(witness_lines "$d")" = 0 ]
verdict "OPS-005 scrittura: se la lista finale non riesce mostra il testo scritto, il motivo e nessuna versione" "$d"

d=$work/w-ripetuta
state "$d" "{$LEFT}" '{"put-object#1":{"kind":"repeated"}}'
run "$d" "$work/write.sh" ok ready
want "chiamate «$(fact "$d" calls)» invece di «L:$T P:$T P:$T L:$T L:$C»" is "$d" calls "L:$T P:$T P:$T L:$T L:$C"
want "versioni $(fact "$d" versions) invece di 3" is "$d" versions 3
want "manca la riga «testimone: $(fact "$d" latest) più-recente»" grep -qxF -- "testimone: $(fact "$d" latest) più-recente" "$d/out"
for v in $(fact "$d" older); do
  want "manca la riga «testimone: versione $v -»" grep -qxF -- "testimone: versione $v -" "$d/out"
done
want "righe «testimone: versione|delete-marker …» $(witness_lines "$d") invece di 3" [ "$(witness_lines "$d")" = 3 ]
verdict "OPS-005 scrittura: se il client ha ripetuto una scrittura mostra tutte le versioni della lista finale (G8)" "$d"

# The Scrittura and then the Verifica in the same shell, on the same bucket: the text that the
# Verifica prints is, whole, the one that the Scrittura wrote and printed (G9 and the months-later
# comparison with «Valori letti»).
d=$work/w-giro
cat -- "$work/write.sh" "$work/verify.sh" >"$work/giro.sh"
state "$d" "{$LEFT}"
run "$d" "$work/giro.sh" ok2 ready
want "chiamate «$(fact "$d" calls)» invece di «L:$T P:$T P:$T L:$T L:$C L:$T G:$T C L:$C»" is "$d" calls "L:$T P:$T P:$T L:$T L:$C L:$T G:$T C L:$C"
want "manca la riga «testimone: il file scritto contiene «…»» con il testo scritto" grep -qxF -- "testimone: il file scritto contiene «$(fact "$d" witness_line)»" "$d/out"
want "la Verifica non stampa, per intero, il testo che la Scrittura ha scritto («testimone: il file letto contiene «…»»)" grep -qxF -- "testimone: il file letto contiene «$(fact "$d" witness_line)»" "$d/out"
verdict "OPS-005 scrittura e verifica: la Verifica stampa, per intero, il testo che la Scrittura ha scritto (G9)" "$d"

d=$work/w-senza-chiave
state "$d" "{$LEFT}"
run "$d" "$work/write.sh" none ready
want "il client è stato chiamato: «$(fact "$d" calls)»" is "$d" calls ""
want "manca «Testimone non scritto: la prima lista non è riuscita», o c'è anche un altro dei tre messaggi di G8" message "$d" "Testimone non scritto: la prima lista non è riuscita"
verdict "OPS-005 chiavi: senza la chiave (domande interrotte) la Scrittura non chiama il client" "$d"

d=$work/w-parti-scambiate
state "$d" "{$LEFT}"
run "$d" "$work/write.sh" swapped ready
want "il client è stato chiamato: «$(fact "$d" calls)»" is "$d" calls ""
want "manca il rifiuto delle parti scambiate" has "$d" "sembrano scambiate"
want "manca «Testimone non scritto: la prima lista non è riuscita», o c'è anche un altro dei tre messaggi di G8" message "$d" "Testimone non scritto: la prima lista non è riuscita"
verdict "OPS-005 chiavi: con le parti scambiate la Scrittura non chiama il client" "$d"

d=$work/w-correttivo-spento
state "$d" "{$LEFT}"
run "$d" "$work/write.sh" ok off
want "il client è stato chiamato: «$(fact "$d" calls)»" is "$d" calls ""
want "manca «Correttivo del client non attivo»" has "$d" "Correttivo del client non attivo"
want "una parte di chiave è stata chiesta e ricevuta" hasnt "$d" "ricevuta"
want "manca «Testimone non scritto: la prima lista non è riuscita», o c'è anche un altro dei tre messaggi di G8" message "$d" "Testimone non scritto: la prima lista non è riuscita"
verdict "OPS-005 correttivo: non attivo, la Scrittura non chiede la chiave e non chiama il client" "$d"

d=$work/w-correttivo-cambiato
state "$d" "{$LEFT}"
run "$d" "$work/write.sh" ok altered
want "il client è stato chiamato: «$(fact "$d" calls)»" is "$d" calls ""
want "manca «correttivo del client alterato»" has "$d" "correttivo del client alterato o non attivo: comando non mandato"
want "manca «Testimone non scritto: la prima lista non è riuscita», o c'è anche un altro dei tre messaggi di G8" message "$d" "Testimone non scritto: la prima lista non è riuscita"
verdict "OPS-005 correttivo: cambiato dopo l'avvio, la Scrittura non manda nessuna richiesta" "$d"

# 5. The Verifica block.
d=$work/v-riuscita
state "$d" "{\"$T\":[$WITNESS],$LEFT}"
run "$d" "$work/verify.sh" ok ready
want "chiamate «$(fact "$d" calls)» invece di «L:$T G:$T C L:$C»" is "$d" calls "L:$T G:$T C L:$C"
want "manca la riga «testimone: versione VersTestimone02 più-recente»" grep -qxF -- "testimone: versione VersTestimone02 più-recente" "$d/out"
want "righe «testimone: versione|delete-marker …» $(witness_lines "$d") invece di 1" [ "$(witness_lines "$d")" = 1 ]
want "manca il testo letto del testimone" grep -qxF -- "testimone: il file letto contiene «$(fact "$d" witness_line)»" "$d/out"
want "la lista e la risposta della lettura non si vedono come le stampa il client (il VersionId nell'una e nell'altra)" [ "$(count "$d" '"VersionId": "VersTestimone02"')" -ge 2 ]
want "nella lista non si vede «\"IsLatest\": true» per VersTestimone02" [ "$(grep -A1 -F -- '"VersionId": "VersTestimone02",' "$d/out" | grep -cF '"IsLatest": true')" -ge 1 ]
want "non si vede l'intestazione Expiration della lettura" has "$d" "expiry-date="
want "mancano le regole del ciclo di vita" has "$d" '"ID": "delete-marker-scaduti"'
want "manca la regola versioni-precedenti" has "$d" '"ID": "versioni-precedenti"'
want "non si vedono i 30 giorni delle versioni precedenti" has "$d" '"NoncurrentDays": 30'
want "non si vedono i 7 giorni dei caricamenti incompleti" has "$d" '"DaysAfterInitiation": 7'
want "non si vede la regola dei delete marker scaduti" has "$d" '"ExpiredObjectDeleteMarker": true'
want "la lista degli avanzi di I2 non si vede come la stampa il client" leftovers_shown "$d"
verdict "OPS-005 verifica: testimone intatto e confronto tolto, una sola versione, la più recente, con il suo testo" "$d"

d=$work/v-confronto
state "$d" "$WRITTEN"
run "$d" "$work/verify.sh" ok ready
want "manca la riga del testimone" grep -qxF -- "testimone: versione VersTestimone02 più-recente" "$d/out"
want "manca la riga del confronto" grep -qxF -- "testimone: versione VersConfronto01 -" "$d/out"
want "righe «testimone: versione|delete-marker …» $(witness_lines "$d") invece di 2" [ "$(witness_lines "$d")" = 2 ]
want "non si vede il LastModified del confronto (dalla lista)" has "$d" "2026-11-22T12:00:01"
verdict "OPS-005 verifica: con il confronto ancora presente mostra le due versioni (non conclusiva)" "$d"

d=$work/v-delete-marker
state "$d" "{\"$T\":[$WITNESS,$MARKER],$LEFT}"
run "$d" "$work/verify.sh" ok ready
want "manca la riga del delete marker" grep -qxF -- "testimone: delete-marker MarkerTestimone03 più-recente" "$d/out"
want "manca la riga della versione nascosta" grep -qxF -- "testimone: versione VersTestimone02 -" "$d/out"
want "non si vede il LastModified del delete marker (dalla lista)" has "$d" "2026-12-20T08:00:00"
want "la lettura sembra riuscita" hasnt "$d" "il file letto contiene"
want "la riga del client con il motivo («$(reason NoSuchKey) …») non si vede" has "$d" "$(reason NoSuchKey)"
verdict "OPS-005 verifica: un delete marker sul testimone si vede, e la lettura è rifiutata" "$d"

d=$work/v-nessuna
state "$d" "{$LEFT}"
run "$d" "$work/verify.sh" ok ready
want "manca «testimone: nessuna versione e nessun delete marker»" grep -qxF -- "testimone: nessuna versione e nessun delete marker" "$d/out"
want "la lettura sembra riuscita" hasnt "$d" "il file letto contiene"
verdict "OPS-005 verifica: senza versioni né delete marker lo dice" "$d"

d=$work/v-ostile
state "$d" "{\"$T\":[$HOSTILE],$LEFT}"
run "$d" "$work/verify.sh" ok ready
want "manca la riga del testo letto" has "$d" "testimone: il file letto contiene «"
want "nell'uscita c'è un carattere di controllo (anche C1)" "$py" -I -c 'import sys, unicodedata; d = open(sys.argv[1], "rb").read().decode("utf-8", "replace"); sys.exit(any(unicodedata.category(c) == "Cc" and c != "\n" for c in d))' "$d/out"
want "il testo letto finge una riga della lista" noline "$d" "testimone: versione VersFalsa09 -"
want "il testo letto non è il contenuto del file su una riga, con i caratteri di controllo tolti (non cambiati in spazi)" has "$d" "VersFalsa09 -secondariga"
verdict "OPS-005 verifica: il testo del file si stampa su una riga, senza caratteri di controllo" "$d"

d=$work/v-lista-rete
state "$d" "{\"$T\":[$WITNESS],$LEFT}" '{"list-object-versions#1":{"kind":"network"}}'
run "$d" "$work/verify.sh" ok ready
want "righe «testimone: versione …» senza la lista" [ "$(witness_lines "$d")" = 0 ]
want "una lista non riuscita sembra un testimone sparito" hasnt "$d" "nessuna versione"
want "la riga del client con il motivo («$(reason network) …») non si vede" has "$d" "$(reason network)"
verdict "OPS-005 verifica: con la lista non riuscita non dice che il testimone non c'è, e se ne vede il motivo" "$d"

d=$work/v-lista-illeggibile
state "$d" "{\"$T\":[$WITNESS],$LEFT}" '{"list-object-versions#1":{"kind":"garbage"}}'
run "$d" "$work/verify.sh" ok ready
want "manca «testimone: la lista non si legge»" grep -qxF -- "testimone: la lista non si legge" "$d/out"
want "una lista illeggibile sembra un testimone sparito" hasnt "$d" "nessuna versione"
verdict "OPS-005 verifica: con una lista che non si legge lo dice, e non dice che il testimone non c'è" "$d"

d=$work/v-senza-ciclo
state "$d" "{\"$T\":[$WITNESS],$LEFT}" '' none
run "$d" "$work/verify.sh" ok ready
want "la riga del client con il motivo («$(reason NoSuchLifecycleConfiguration) …») non si vede" has "$d" "$(reason NoSuchLifecycleConfiguration)"
want "manca la riga del testimone" grep -qxF -- "testimone: versione VersTestimone02 più-recente" "$d/out"
verdict "OPS-005 verifica: senza ciclo di vita l'errore si vede (non conclusiva)" "$d"

for f in network:'{"kind":"network"}' AccessDenied:'{"kind":"code","code":"AccessDenied"}'; do
  d=$work/v-lettura-${f%%:*}
  state "$d" "{\"$T\":[$WITNESS],$LEFT}" "{\"get-object#1\":${f#*:}}"
  run "$d" "$work/verify.sh" ok ready
  want "manca la riga del testimone" grep -qxF -- "testimone: versione VersTestimone02 più-recente" "$d/out"
  want "la lettura sembra riuscita" hasnt "$d" "il file letto contiene"
  want "la lettura non riuscita sembra un file che non c'è" hasnt "$d" "NoSuchKey"
  want "la riga del client con il motivo («$(reason "${f%%:*}") …») non si vede" has "$d" "$(reason "${f%%:*}")"
  verdict "OPS-005 verifica: con la lettura non riuscita (${f%%:*}) non mostra un testo, e se ne vede il motivo" "$d"
done

d=$work/v-ciclo-rete
state "$d" "{\"$T\":[$WITNESS],$LEFT}" '{"get-bucket-lifecycle-configuration#1":{"kind":"network"}}'
run "$d" "$work/verify.sh" ok ready
want "la lettura del ciclo di vita non riuscita sembra un ciclo di vita che non c'è" hasnt "$d" "NoSuchLifecycleConfiguration"
want "la riga del client con il motivo («$(reason network) …») non si vede" has "$d" "$(reason network)"
want "manca il testo letto del testimone" grep -qxF -- "testimone: il file letto contiene «$(fact "$d" witness_line)»" "$d/out"
verdict "OPS-005 verifica: con la lettura del ciclo di vita non riuscita se ne vede il motivo" "$d"

d=$work/v-due-volte
state "$d" "{\"$T\":[$WITNESS],$LEFT}" '{"get-object#2":{"kind":"network"}}'
run "$d" "$work/verify.sh" ok ready 2
want "chiamate «$(fact "$d" calls)» invece di «L:$T G:$T C L:$C L:$T G:$T C L:$C»" is "$d" calls "L:$T G:$T C L:$C L:$T G:$T C L:$C"
want "il testo letto si vede $(count "$d" "testimone: il file letto contiene «$(fact "$d" witness_line)»") volte invece di una (la prima lettura riesce, la seconda no)" [ "$(count "$d" "testimone: il file letto contiene «$(fact "$d" witness_line)»")" = 1 ]
verdict "OPS-005 verifica: rilanciata nello stesso terminale, con la lettura non riuscita non mostra il testo di prima" "$d"

d=$work/v-correttivo-spento
state "$d" "{\"$T\":[$WITNESS],$LEFT}"
run "$d" "$work/verify.sh" ok off
want "il client è stato chiamato: «$(fact "$d" calls)»" is "$d" calls ""
want "manca «Correttivo del client non attivo»" has "$d" "Correttivo del client non attivo"
verdict "OPS-005 correttivo: non attivo, la Verifica non chiama il client" "$d"

d=$work/v-senza-chiave
state "$d" "{\"$T\":[$WITNESS],$LEFT}"
run "$d" "$work/verify.sh" none ready
want "il client è stato chiamato: «$(fact "$d" calls)»" is "$d" calls ""
verdict "OPS-005 chiavi: senza la chiave la Verifica non chiama il client" "$d"

problems=()
for d in "$work"/v-*; do
  [[ " $(fact "$d" calls) " != *" P:"* ]] || problems+=("${d##*/}: una scrittura")
  [ "$(fact "$d" calls | tr ' ' '\n' | grep -vcE '^(L|G):|^C$|^$')" = 0 ] || problems+=("${d##*/}: chiamate «$(fact "$d" calls)»")
done
verdict "OPS-005 verifica: in nessun caso scrive o cancella (solo liste, lettura e ciclo di vita)" ""
# outcome_rules <label> <output file>: in a Verifica's output no word of spec 08's outcomes,
# «nessuna versione» only in its own line, NoSuchKey and NoSuchLifecycleConfiguration only in the
# client's error line (neither step 4 nor the client prints them otherwise); for each rule broken
# a problem, with the first line that breaks it. Used on the script cases here and on the Verifica
# pasted in a terminal (section 6). The rules test the lines found, not «! grep … | grep -q»:
# under pipefail an early exit of grep -q could turn a match into a pass.
plain_first() { # the first line of the input, without control characters, at most 200 characters
  "$py" -I -c 'import sys, unicodedata; t = sys.stdin.buffer.read().decode("utf-8", "replace").split("\n")[0]; print("".join(c for c in t if unicodedata.category(c) != "Cc")[:200])'
}
outcome_rules() {
  local line
  line=$(grep -aiE -- 'attes[aeio]|conclusiv|intatt|verifica.*(riuscit|fallit)|(riuscit|fallit).*verifica|esito (positiv|negativ)' "$2" | plain_first)
  [ -z "$line" ] || problems+=("$1: una parola d'esito, nella riga «$line»")
  line=$(grep -aiF -- 'nessuna versione' "$2" | grep -vxF -- 'testimone: nessuna versione e nessun delete marker' | plain_first)
  [ -z "$line" ] || problems+=("$1: «nessuna versione» fuori dalla riga «testimone: nessuna versione e nessun delete marker», nella riga «$line»")
  line=$(grep -aE -- 'NoSuchKey|NoSuchLifecycleConfiguration' "$2" | grep -vF -- 'An error occurred (' | plain_first)
  [ -z "$line" ] || problems+=("$1: NoSuchKey o NoSuchLifecycleConfiguration fuori dalla riga d'errore del client, nella riga «$line»")
}
for d in "$work"/v-*; do outcome_rules "${d##*/}" "$d/out"; done
verdict "OPS-005 verifica: il blocco non dà l'esito da sé (lo decide Claude, confrontando l'uscita con «Valori letti»)" ""

# 6. Pasted into an interactive bash in a terminal, as in G8: the system's /etc/bash.bashrc and a
# startup file with the prompt (PS1 and PROMPT_COMMAND, from a startup file as in a real terminal:
# taken from the environment, PROMPT_COMMAND leaves PIPESTATUS empty in bash 5.3; PS0 empty and
# PROMPT_COMMAND a plain variable whatever the system file set), the shell options of the user's
# ~/.bashrc, then the step 4 block and the fake client, sourced at the prompt, and the state of the
# shell (with the terminal's settings and readline's); then the block is pasted (bracketed paste)
# and its questions answered; then the state of the shell again and the key in use. The block's
# own output, from the paste taken to the next prompt, without carriage returns, goes to
# <case dir>/block.
printf '%s\n' 'set enable-bracketed-paste on' >"$work/inputrc"
printf '%s\n' "PS1='PRONTO\$ '" "PS0=" "unset PROMPT_COMMAND" "PROMPT_COMMAND='echo \"<<PRONTO>>\"'" >"$work/bashrc"
pty_run() { # pty_run <case dir> <block>
  "$py" -I - "$1/plan.json" "$1" "$work/step4.sh" "$work/setup.sh" "$2" "$work/inputrc" "$KEY_ID" "$KEY_SECRET" "$STATE_SUM" "$work/bashrc" <<'PY'
import json
import shlex
import sys

plan, d, step4, setup, block, inputrc, key_id, secret, state_sum, rcfile = sys.argv[1:11]
env = {"HOME": d + "/home", "PATH": "/usr/bin:/bin", "TMPDIR": d + "/tmp", "TERM": "xterm-256color",
       "LANG": "C.UTF-8", "INPUTRC": inputrc, "HTTPS_PROXY": "http://127.0.0.1:9", "HTTP_PROXY": "http://127.0.0.1:9"}
probe = ("printf 'STATO-%%s-%%s\\n' \"$-\" \"$(printf '%%s|' %s \"$(stty -g)\" \"$(bind -v -p -s -X 2>/dev/null)\" "
         "| cksum | tr ' ' '-')\"" % state_sum)
json.dump({"env": env, "rcfile": rcfile, "timeout": 90,
           "lines": ["shopt -s extglob progcomp checkwinsize histappend",
                     "source " + shlex.quote(step4),
                     "source %s %s ready" % (shlex.quote(setup), shlex.quote(d + "/state.json")),
                     probe],
           "paste": block, "answers": [key_id, secret],
           "after": [probe, "printf 'IN-USO-%s\\n' \"$KEY_IN_USE\""]}, open(plan, "w", encoding="utf-8"))
PY
  "$py" -I "$ptypaste" "$1/plan.json" "$1/out" "$1/result.json"
  facts "$1"
  "$py" -I - "$1/result.json" "$1/out" >>"$1/facts" <<'PY'
import json
import re
import sys

r = json.load(open(sys.argv[1], encoding="utf-8"))
t = open(sys.argv[2], "rb").read().decode("utf-8", "replace")
want = ["Access key di «file-test» (incolla e premi Invio; non compare): ",
        "Secret key di «file-test» (incolla e premi Invio; non compare): "]
print("pty_prompts=" + ("ok" if r.get("prompts") == want else repr(r.get("prompts"))))
print("pty_echo=" + ("ok" if not r.get("echo_on_at") else repr(r.get("echo_on_at"))))
print("pty_bracketed=" + ("ok" if r.get("bracketed") else "no"))
print("pty_back=" + ("ok" if r.get("prompt_back") else "no"))
print("pty_end=" + ("ok" if r.get("exit") == 0 and not r.get("timeout") and not r.get("ended_early")
                    and not r.get("not_reaped") else
                    "uscita %s, tempo scaduto %s, finita prima %s, non finita dopo la chiusura %s"
                    % (r.get("exit"), r.get("timeout"), r.get("ended_early"), r.get("not_reaped"))))
states = re.findall(r"STATO-[A-Za-z]+-[0-9]+-[0-9]+", t)
print("pty_state=" + ("ok" if len(states) == 2 and states[0] == states[1] else repr(states)))
print("pty_in_use=" + ("ok" if re.search(r"IN-USO-file-test\r?\n", t) else "no"))
start = r.get("taken_at")
own = open(sys.argv[2], "rb").read()[start:] if start is not None else b""
end = own.find(b"<<PRONTO>>")
own = own[:end] if end >= 0 else own
open(sys.argv[2].rsplit("/", 1)[0] + "/block", "w", encoding="utf-8").write(
    own.decode("utf-8", "replace").replace("\r", ""))
PY
}
pty_want() {
  want "domande diverse dalle due di file-test: $(fact "$1" pty_prompts)" is "$1" pty_prompts ok
  want "eco accesa a una domanda: $(fact "$1" pty_echo)" is "$1" pty_echo ok
  want "la shell non ha attivato l'incolla protetto (bracketed paste)" is "$1" pty_bracketed ok
  want "dopo il blocco il prompt non è tornato (il terminale si sarebbe chiuso, o il blocco non è finito)" is "$1" pty_back ok
  want "fine della shell: $(fact "$1" pty_end)" is "$1" pty_end ok
  want "il blocco cambia lo stato della shell ($STATE_WHAT, impostazioni del terminale e di readline): $(fact "$1" pty_state)" is "$1" pty_state ok
  want "dopo il blocco la chiave in uso non è file-test" is "$1" pty_in_use ok
  want "il testo incollato è arrivato a una domanda" hasnt "$1" "prima della domanda era già arrivato del testo"
}
# On the block's own output in the terminal: blk <case dir> <line> (that exact line), blk_count
# <case dir> <regex> (lines that match), blk_plain <case dir> (no control character but newline).
blk() { grep -qxF -- "$2" "$1/block"; }
blk_count() { grep -cE -- "$2" "$1/block" || true; }
blk_plain() {
  "$py" -I -c 'import sys, unicodedata; d = open(sys.argv[1], "rb").read().decode("utf-8", "replace"); sys.exit(any(unicodedata.category(c) == "Cc" and c != "\n" for c in d))' "$1/block"
}

d=$work/p-scrittura
state "$d" "{$LEFT}"
pty_run "$d" "$work/write.sh"
pty_want "$d"
want "chiamate «$(fact "$d" calls)» invece di «L:$T P:$T P:$T L:$T L:$C»" is "$d" calls "L:$T P:$T P:$T L:$T L:$C"
want "versioni $(fact "$d" versions) invece di 2" is "$d" versions 2
want "manca la riga «testimone: il file scritto contiene «…»» con il testo del testimone" blk "$d" "testimone: il file scritto contiene «$(fact "$d" witness_line)»"
want "manca la riga «testimone: $(fact "$d" latest) più-recente»" blk "$d" "testimone: $(fact "$d" latest) più-recente"
want "manca la riga «testimone: versione $(fact "$d" older) -»" blk "$d" "testimone: versione $(fact "$d" older) -"
want "righe «testimone: versione|delete-marker …» $(blk_count "$d" '^testimone: (versione|delete-marker) ') invece di 2" [ "$(blk_count "$d" '^testimone: (versione|delete-marker) ')" = 2 ]
want "manca il LastModified dell'ultima scrittura, dalla lista finale (G9)" grep -qF -- "\"LastModified\": \"$(fact "$d" latest_modified)\"" "$d/block"
want "un messaggio di G8 dopo due scritture riuscite" [ "$(blk_count "$d" 'Testimone non scritto|Testimone NON scritto|Scrittura del testimone interrotta')" = 0 ]
verdict "OPS-005 incolla: la Scrittura incollata nel terminale fa due domande con l'eco spenta e scrive il testimone" "$d"

d=$work/p-rilancio
state "$d" "$WRITTEN"
pty_run "$d" "$work/write.sh"
pty_want "$d"
want "chiamate «$(fact "$d" calls)» invece di «L:$T L:$C»" is "$d" calls "L:$T L:$C"
want "versioni $(fact "$d" versions) invece di 2" is "$d" versions 2
want "manca «Testimone NON scritto»" [ "$(blk_count "$d" 'Testimone NON scritto')" -ge 1 ]
want "un altro dei tre messaggi di G8 oltre a «Testimone NON scritto»" [ "$(blk_count "$d" 'Testimone non scritto|Scrittura del testimone interrotta')" = 0 ]
want "righe «testimone: versione …» dopo un blocco che non ha scritto" [ "$(blk_count "$d" '^testimone: (versione|delete-marker) ')" = 0 ]
verdict "OPS-005 incolla: la Scrittura incollata sopra un testimone già scritto non scrive" "$d"

d=$work/p-verifica
state "$d" "{\"$T\":[$WITNESS],$LEFT}"
pty_run "$d" "$work/verify.sh"
pty_want "$d"
want "chiamate «$(fact "$d" calls)» invece di «L:$T G:$T C L:$C»" is "$d" calls "L:$T G:$T C L:$C"
want "manca la riga «testimone: versione VersTestimone02 più-recente»" blk "$d" "testimone: versione VersTestimone02 più-recente"
want "righe «testimone: versione|delete-marker …», «testimone: nessuna versione e nessun delete marker» o «testimone: la lista non si legge» $(blk_count "$d" '^testimone: ((versione|delete-marker) |nessuna versione e nessun delete marker$|la lista non si legge$)') invece di 1" [ "$(blk_count "$d" '^testimone: ((versione|delete-marker) |nessuna versione e nessun delete marker$|la lista non si legge$)')" = 1 ]
want "manca il testo letto del testimone" blk "$d" "testimone: il file letto contiene «$(fact "$d" witness_line)»"
want "nell'uscita della Verifica incollata c'è un carattere di controllo (anche C1; niente colori)" blk_plain "$d"
outcome_rules "nel terminale" "$d/block"
verdict "OPS-005 incolla: la Verifica incollata nel terminale fa due domande con l'eco spenta e legge il testimone" "$d"

d=$work/p-verifica-rete
state "$d" "{\"$T\":[$WITNESS],$LEFT}" '{"list-object-versions#1":{"kind":"network"}}'
pty_run "$d" "$work/verify.sh"
pty_want "$d"
want "righe «testimone: versione|delete-marker …» senza la lista" [ "$(blk_count "$d" '^testimone: (versione|delete-marker) ')" = 0 ]
want "«nessuna versione» senza la lista" [ -z "$(grep -aiF -- 'nessuna versione' "$d/block")" ]
want "la riga del client con il motivo («$(reason network) …») non si vede" grep -qF -- "$(reason network)" "$d/block"
want "nell'uscita della Verifica incollata c'è un carattere di controllo (anche C1; niente colori)" blk_plain "$d"
outcome_rules "nel terminale" "$d/block"
verdict "OPS-005 incolla: la Verifica incollata con la lista non riuscita non dice che il testimone non c'è" "$d"

# 7. Across all cases: the fake keys never in an output or in a file of the terminal (only the
# fake's state, the answers and the plan of each case hold them, by design), the key only where
# the fake wants it, the screen never cleared.
problems=()
while IFS= read -r f; do
  [[ ${f#"$work"/} =~ ^[wvp]-[^/]+/(state\.json|state\.json\.tmp|keys|plan\.json)$ ]] || problems+=("${f#"$work"/}")
done < <(grep -rlaF -e "$KEY_ID" -e "$KEY_SECRET" -- "$work")
verdict "OPS-005 chiavi: le chiavi finte non compaiono in nessuna uscita e in nessun file del terminale" ""
for d in "$work"/[wvp]-*; do
  [ "$(fact "$d" violations)" = 0 ] || problems+=("${d##*/}: $("$py" -I -c 'import json, sys; print(json.load(open(sys.argv[1]))["violations"][0])' "$d/state.json")")
done
verdict "OPS-005 chiavi: il client riceve la chiave solo nel suo ambiente, e solo le richieste previste (operazioni, opzioni, foondaco-file-test a fsn1, file nella cartella del terminale)" ""
# In a terminal, only what follows the echo of the paste (readline may clear the screen to redraw
# it). In a script case's output and in the block's own output in a terminal (up to the next
# prompt): no erase in display (with any parameter), reset, alternate screen (also among other
# private modes), or cursor moved back over what was printed (up, to a line or position, reverse
# index, restore), also written with the C1 CSI; colours and erase in line stay allowed. After
# it, none of the four usual clearing sequences. The case's name comes with the first sequence
# found, written out.
for d in "$work"/[wvp]-*; do
  seq=$("$py" -I - "$d" <<'PY'
import json
import os
import re
import sys

d = open(sys.argv[1] + "/out", "rb").read()
r = sys.argv[1] + "/result.json"
start = json.load(open(r, encoding="utf-8")).get("taken_at", len(d)) if os.path.exists(r) else 0
own = d[start:]
if os.path.exists(r):
    end = own.find(b"<<PRONTO>>")
    own = own[:end] if end >= 0 else own
own = own.decode("utf-8", "replace").replace("\x9b", "\x1b[")
bad = re.search("\x1b(\\[[0-9;?]*J|c|\\[[0-9;]*[AFHfd]|M|8|\\[u)", own)
alt = next((m for m in re.finditer("\x1b\\[\\?([0-9;]*)h", own)
            if {int(p) for p in m.group(1).split(";") if p.isdigit()} & {47, 1047, 1049}), None)
after = next((s.decode() for s in (b"\x1b[2J", b"\x1b[3J", b"\x1bc", b"\x1b[?1049h") if s in d[start:]), None)
if bad or alt or after:
    print(ascii((bad or alt).group(0) if bad or alt else after)[1:-1])
    sys.exit(1)
PY
  ) || problems+=("${d##*/}${seq:+ ($seq)}")
done
verdict "OPS-005 terminale: nessun blocco cancella lo schermo, le righe già stampate o la cronologia del terminale, né passa a un altro schermo (servono a G8 e G9)" ""

finish
