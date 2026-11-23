#!/usr/bin/env python3
"""Fake AWS CLI v2 for the dry runs of the lifecycle witness blocks (infra/README.md, «Archivi S3
(OPS-T03)», step 14; specs/08-operativita.md, OPS-005, «Testimone del ciclo di vita»). Used by
tests/infra/testimone-ops-005/run.sh only. It never talks to a network.

run.sh calls it from a shell function named aws, defined after the key terminal block of step 4,
so the block's own _aws runs it with the key pair in the environment of that one call:
  fake-s3.py <state.json> --endpoint-url URL --region REGION s3api <operation> [options]

It emulates, on the versions of one bucket, the four calls the witness blocks may make, with the
output and error formats of AWS CLI v2: list-object-versions, put-object, get-object and
get-bucket-lifecycle-configuration. Any other operation is a violation: the blocks must not
delete, copy or change settings.

State (JSON, rewritten after every call):
  key_id, secret        the only key pair accepted: the fake file-test key of run.sh
  bucket, place         foondaco-file-test, fsn1
  objects               {key: [entry, ...]}, oldest first; the last entry is the current one;
                        entry: {"VersionId", "LastModified", "body"} or {"VersionId",
                        "LastModified", "delete_marker": true}
  lifecycle             list of rules, or null (NoSuchLifecycleConfiguration)
  expiration            the Expiration header of put-object and get-object answers
  fail                  {"<operation>#<n>": {"kind": "network" | "code" | "garbage", "code": C,
                        "after": bool}}: the n-th call of that operation fails; "after" applies
                        the call first (a write saved by the provider whose answer was lost);
                        for put-object also {"kind": "repeated"}: the n-th write is saved twice,
                        as when the client sends it again after an answer that got lost
  counts, calls         filled by the fake: calls of each operation, and the log of every call
                        (operation, key or prefix, the body of a write), without keys
  violations            filled by the fake: hygiene violations of the caller
  next_id, clock        counters for the new VersionId and LastModified values
Every --body file and the output file of get-object must be in the block's $WORK, the temporary
folder of the key terminal: _aws of step 4 runs the client with HOME=$WORK.
Exit status: 0 success; 254 an S3 error; 255 a network error; 99 a hygiene violation of the
caller (a key on the command line, in another variable or in the file to write, another key,
place, endpoint, bucket or operation), so that a dry run fails loudly. An operation outside the
four is logged in calls too, before the violation.
"""
import datetime as dt
import hashlib
import json
import os
import sys

state_path = sys.argv[1]
args = sys.argv[2:]
with open(state_path, encoding="utf-8") as f:
    state = json.load(f)


def save():
    tmp = state_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, state_path)


def violation(msg):
    state.setdefault("violations", []).append(msg)
    save()
    sys.stderr.write("FAKE-S3: violazione: %s\n" % msg)
    sys.exit(99)


OPNAMES = {
    "list-object-versions": "ListObjectVersions",
    "put-object": "PutObject",
    "get-object": "GetObject",
    "get-bucket-lifecycle-configuration": "GetBucketLifecycleConfiguration",
}

# 1. Hygiene: the key pair only in the environment of the call, never on the command line or in
# another variable; the endpoint and region of the bucket's place.
key_id, secret = state["key_id"], state["secret"]
for a in args:
    if key_id in a or secret in a:
        violation("una parte della chiave fra gli argomenti del client")
for name, value in os.environ.items():
    if name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
        continue
    if key_id in value or secret in value:
        violation("una parte della chiave nella variabile %s" % name)
if os.environ.get("AWS_ACCESS_KEY_ID") != key_id or os.environ.get("AWS_SECRET_ACCESS_KEY") != secret:
    violation("il client non ha ricevuto la chiave file-test nel suo ambiente")
place = state["place"]
if args[:5] != ["--endpoint-url", "https://%s.your-objectstorage.com" % place, "--region", place, "s3api"]:
    violation("indirizzo, regione o comando diversi da quelli di %s: %r" % (place, args[:5]))
if len(args) < 6:
    violation("nessuna operazione")
op, rest = args[5], args[6:]
if op not in OPNAMES:
    state.setdefault("calls", []).append({"op": op})
    violation("operazione non prevista dai blocchi del testimone: %s" % op)

# 2. Options.
opts, positional, i = {}, [], 0
while i < len(rest):
    a = rest[i]
    if a.startswith("--") and "=" in a:
        k, v = a[2:].split("=", 1)
        opts[k] = v
        i += 1
    elif a.startswith("--"):
        if i + 1 >= len(rest):
            violation("opzione %s senza valore" % a)
        opts[a[2:]] = rest[i + 1]
        i += 2
    else:
        positional.append(a)
        i += 1
allowed = {
    "list-object-versions": {"bucket", "prefix"},
    "put-object": {"bucket", "key", "body"},
    "get-object": {"bucket", "key"},
    "get-bucket-lifecycle-configuration": {"bucket"},
}[op]
if set(opts) - allowed:
    violation("opzioni non previste per %s: %s" % (op, sorted(set(opts) - allowed)))
if opts.get("bucket") != state["bucket"]:
    violation("bucket diverso da %s: %r" % (state["bucket"], opts.get("bucket")))
work = os.path.realpath(os.environ["HOME"]) if os.environ.get("HOME", "").startswith("/") else None


def inside_work(path):
    return work is not None and os.path.realpath(path).startswith(work + os.sep)


counts = state.setdefault("counts", {})
counts[op] = counts.get(op, 0) + 1
call = {"op": op}
for k in ("key", "prefix"):
    if k in opts:
        call[k] = opts[k]
if op == "put-object":
    body_path = opts.get("body", "")
    if not inside_work(body_path):
        violation("il file da scrivere non è in $WORK, la cartella temporanea del terminale: %r" % body_path)
    with open(body_path, "rb") as f:
        call["body"] = f.read().decode("utf-8", "replace")
    if key_id in call["body"] or secret in call["body"]:
        violation("una parte della chiave nel file da scrivere")
state.setdefault("calls", []).append(call)
fail = (state.get("fail") or {}).get("%s#%d" % (op, counts[op]))


def now():
    t = dt.datetime.fromisoformat(state.get("clock", "2026-11-22T12:00:00+00:00"))
    t += dt.timedelta(seconds=1)
    state["clock"] = t.isoformat()
    return t


def new_id():
    n = state.get("next_id", 1)
    state["next_id"] = n + 1
    return "VersFinta%04d.ab_cd-ef" % n


def error(code, message=""):
    save()
    sys.stderr.write("\naws: [ERROR]: An error occurred (%s) when calling the %s operation: %s\n"
                     % (code, OPNAMES[op], message))
    sys.exit(254)


def network():
    save()
    sys.stderr.write('\nCould not connect to the endpoint URL: "https://%s.your-objectstorage.com/%s"\n'
                     % (place, state["bucket"]))
    sys.exit(255)


def emit(obj):
    save()
    sys.stdout.write(json.dumps(obj, indent=4, ensure_ascii=False) + "\n")
    sys.exit(0)


if fail and not fail.get("after"):
    if fail["kind"] == "network":
        network()
    if fail["kind"] == "code":
        error(fail["code"])
    if fail["kind"] == "garbage":
        save()
        sys.stdout.write("<html><body><h1>502 Bad Gateway</h1></body></html>\n")
        sys.exit(0)

objects = state.setdefault("objects", {})


def stamp(entry):
    return entry["LastModified"]


# 3. The operations.
if op == "list-object-versions":
    if "prefix" not in opts:
        violation("list-object-versions senza --prefix")
    versions, markers = [], []
    for key in sorted(objects):
        if not key.startswith(opts["prefix"]):
            continue
        entries = objects[key]
        for n, e in enumerate(entries):
            latest = n == len(entries) - 1
            if e.get("delete_marker"):
                markers.append({"Owner": {"DisplayName": "proprietario", "ID": "p0"}, "Key": key,
                                "VersionId": e["VersionId"], "IsLatest": latest, "LastModified": stamp(e)})
            else:
                body = e["body"].encode("utf-8")
                versions.append({"ETag": '"%s"' % hashlib.md5(body).hexdigest(), "Size": len(body),
                                 "StorageClass": "STANDARD", "Key": key, "VersionId": e["VersionId"],
                                 "IsLatest": latest, "LastModified": stamp(e),
                                 "Owner": {"DisplayName": "proprietario", "ID": "p0"}})
    versions.sort(key=lambda v: (v["Key"], v["LastModified"]), reverse=True)
    markers.sort(key=lambda v: (v["Key"], v["LastModified"]), reverse=True)
    out = {}
    if versions:
        out["Versions"] = versions
    if markers:
        out["DeleteMarkers"] = markers
    out["RequestCharged"] = None
    out["Prefix"] = opts["prefix"]
    emit(out)

if op == "put-object":
    if "key" not in opts or positional:
        violation("put-object senza --key o con argomenti in più")
    entry = {"VersionId": new_id(), "LastModified": now().isoformat(), "body": call["body"]}
    objects.setdefault(opts["key"], []).append(entry)
    if fail and fail["kind"] == "repeated":  # sent again by the client: saved twice, one answer
        entry = {"VersionId": new_id(), "LastModified": now().isoformat(), "body": call["body"]}
        objects[opts["key"]].append(entry)
    elif fail:  # saved by the provider, answer lost
        network() if fail["kind"] == "network" else error(fail.get("code", "InternalError"))
    emit({"Expiration": state["expiration"],
          "ETag": '"%s"' % hashlib.md5(call["body"].encode("utf-8")).hexdigest(),
          "VersionId": entry["VersionId"]})

if op == "get-object":
    if "key" not in opts or len(positional) != 1:
        violation("get-object senza --key o senza un solo file di uscita")
    if not inside_work(positional[0]):
        violation("il file letto non va in $WORK, la cartella temporanea del terminale: %r" % positional[0])
    entries = objects.get(opts["key"]) or []
    if not entries or entries[-1].get("delete_marker"):
        error("NoSuchKey", "The specified key does not exist.")
    e = entries[-1]
    body = e["body"].encode("utf-8")
    with open(positional[0], "wb") as f:
        f.write(body)
    emit({"AcceptRanges": "bytes", "Expiration": state["expiration"], "LastModified": stamp(e),
          "ContentLength": len(body), "ETag": '"%s"' % hashlib.md5(body).hexdigest(),
          "VersionId": e["VersionId"], "ContentType": "binary/octet-stream", "Metadata": {}})

if op == "get-bucket-lifecycle-configuration":
    if state.get("lifecycle") is None:
        error("NoSuchLifecycleConfiguration")
    emit({"Rules": state["lifecycle"]})
