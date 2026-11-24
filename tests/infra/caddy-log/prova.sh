#!/bin/sh
# The Caddy log filter test (specs/06-domini-https.md, §Caddy, the `log default` block; 00 §4.2; DOM-T02):
# checklist docs/verifiche/dom-t02.md.
#
# It runs inside a Caddy image, without network, launched from the project folder:
#
#   docker run --rm --network none -v ./tests/infra/caddy-log:/prova:ro <image> sh /prova/prova.sh
#
# <image> is the official caddy:2.11.9 in the test phase, and each project image
# (ghcr.io/jinoesfoo/gestionale-negozi-caddy:<tag>) in the code phase. It needs nothing else: no keys, no tokens.
#
# For each of the two configurations of this folder it starts Caddy and sends one request that fails with 502 (the
# reverse_proxy upstream is a closed port, as when the app is stopped during a release). The request carries a dummy
# token in the query string (?k=, as in the external health check, OPS-011, and in the email webhook) and in the
# x-health-token header, and comes from a recognisable client address, 127.0.0.2. Then the script stops Caddy and reads
# everything Caddy logged:
# - Caddyfile-senza-filtro, the same site without the `log default` block: the error entry carries the request, so the
#   log has the two dummy tokens, the header name, the request object (uri, headers) and the client address. Each
#   search of the filtered run has here its twin that must find something: the test recognises a leak when there is
#   one;
# - Caddyfile, with the `log default` block of infra/caddy/Caddyfile (tests/unit/infra/caddy.test.ts keeps the two
#   blocks identical): the error entry is still logged (logger http.log.error, status 502, with its message and
#   duration), without the request object: no token, no header name, no uri or headers, no client address.
# Every case name starts with the rule it protects (00§4.2). Caddy writes header names in canonical form
# (X-Health-Token), so the log is searched ignoring case. A search that fails (grep exit status above 1) gives
# «errore», which is never the expected result.
#
# Exit status: 0 when every case is as expected. The last line is «Prove: N, come attese: N, diverse: 0».
set -u

here=$(dirname "$0")
url='http://127.0.0.1:8080/api/health?k=valore-query-prova'
work=$(mktemp -d) || exit 1
pid=
total=0
same=0

cleanup() {
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
  fi
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

# check <case> <expected: si|no> <found: si|no|errore>
check() {
  total=$((total + 1))
  if [ "$2" = "$3" ]; then
    same=$((same + 1))
    printf 'ok       %s\n' "$1"
  else
    printf 'DIVERSA  %s (attesa: %s, trovata: %s)\n' "$1" "$2" "$3"
  fi
}

# found <file> <extended regular expression>: si when a line of the file matches, ignoring case; errore when grep
# fails (unreadable file, rejected expression).
found() {
  grep -qiE -- "$2" "$1"
  case $? in
    0) echo si ;;
    1) echo no ;;
    *) echo errore ;;
  esac
}

# error_entry <file>: si when Caddy logged the failed request as an error: one line with logger http.log.error,
# status 502, the message of the failed connection and the duration.
error_entry() {
  if grep -F '"logger":"http.log.error"' "$1" | grep -F '"status":502' | grep -F '"msg":"dial tcp' |
    grep -qF '"duration":'; then
    echo si
  else
    echo no
  fi
}

# run <configuration> <log file>: starts Caddy, sends the request, waits for the error entry, stops Caddy.
# Sets started (si|no) and status (the HTTP status of the response, empty if there was none).
run() {
  started=no
  status=
  caddy run --config "$here/$1" --adapter caddyfile >"$2" 2>&1 &
  pid=$!
  i=0
  while [ "$i" -lt 100 ]; do
    if grep -qF 'serving initial configuration' "$2"; then
      started=si
      break
    fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
    i=$((i + 1))
  done
  if [ "$started" = si ]; then
    status=$(curl -s -o /dev/null -w '%{http_code}' --interface 127.0.0.2 -H 'X-Health-Token: valore-header-prova' "$url")
    # Caddy writes the error entry when it answers: allow it up to 5 seconds.
    i=0
    while [ "$i" -lt 50 ] && [ "$(error_entry "$2")" = no ]; do
      sleep 0.1
      i=$((i + 1))
    done
  fi
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  pid=
}

# is_502: si when the last request was answered with 502.
is_502() {
  if [ "$status" = 502 ]; then echo si; else echo no; fi
}

request_object='"(request|uri|headers)"[[:space:]]*:'
client_address='127\.0\.0\.2|"(remote_ip|remote_port|client_ip)"[[:space:]]*:'

control="$work/senza-filtro.log"
run Caddyfile-senza-filtro "$control"
check '00§4.2 senza il blocco log: Caddy parte' si "$started"
check '00§4.2 senza il blocco log: la richiesta riceve 502' si "$(is_502)"
check "00§4.2 senza il blocco log: il registro ha l'errore 502 (http.log.error, con messaggio e durata)" si \
  "$(error_entry "$control")"
check '00§4.2 senza il blocco log: il registro ha il token della query (la prova vede la fuga)' si \
  "$(found "$control" 'valore-query-prova')"
check "00§4.2 senza il blocco log: il registro ha il token dell'intestazione (la prova vede la fuga)" si \
  "$(found "$control" 'valore-header-prova')"
check "00§4.2 senza il blocco log: il registro ha il nome dell'intestazione x-health-token (la prova vede la fuga)" si \
  "$(found "$control" 'x-health-token')"
check "00§4.2 senza il blocco log: il registro ha l'oggetto request, con uri e headers (la prova vede la fuga)" si \
  "$(found "$control" "$request_object")"
check "00§4.2 senza il blocco log: il registro ha l'indirizzo del client, 127.0.0.2 (la prova vede la fuga)" si \
  "$(found "$control" '127\.0\.0\.2')"

filtered="$work/con-filtro.log"
run Caddyfile "$filtered"
check '00§4.2 con il blocco log: Caddy parte' si "$started"
check '00§4.2 con il blocco log: la richiesta riceve 502' si "$(is_502)"
check "00§4.2 con il blocco log: il registro ha ancora l'errore 502 (http.log.error, con messaggio e durata)" si \
  "$(error_entry "$filtered")"
check '00§4.2 con il blocco log: nessun token della query' no "$(found "$filtered" 'valore-query-prova')"
check "00§4.2 con il blocco log: nessun token dell'intestazione" no "$(found "$filtered" 'valore-header-prova')"
check "00§4.2 con il blocco log: nessun nome dell'intestazione x-health-token" no \
  "$(found "$filtered" 'x-health-token')"
check '00§4.2 con il blocco log: nessun oggetto request, uri o headers' no "$(found "$filtered" "$request_object")"
check '00§4.2 con il blocco log: nessun indirizzo del client (127.0.0.2, remote_ip, remote_port, client_ip)' no \
  "$(found "$filtered" "$client_address")"

if [ "$same" -ne "$total" ]; then
  # Only dummy values: the container has no keys and no tokens.
  echo
  echo 'Ultime righe del registro senza il blocco log:'
  tail -n 20 "$control"
  echo 'Ultime righe del registro con il blocco log:'
  tail -n 20 "$filtered"
  echo
fi
echo "Prove: $total, come attese: $same, diverse: $((total - same))"
if [ "$same" -eq "$total" ]; then exit 0; fi
exit 1
