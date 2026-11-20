#!/usr/bin/env bash
# FON-001: su un clone pulito, dopo i comandi documentati (docker compose -f infra/compose.dev.yml up -d,
# pnpm db:migrate, pnpm dev), GET http://localhost:3000/api/health risponde 200 entro 60 secondi.
#
# - Il clone è del commit corrente del repository da cui si lancia lo script (git rev-parse HEAD): le modifiche non
#   salvate non ci entrano, quindi prima si fa un commit (01, note del piano di FON-T03). In CI (FON-T08) il checkout
#   deve avere la storia che serve a clonarlo (per esempio fetch-depth: 0).
# - Il clone sta in una cartella temporanea fuori dal progetto (mktemp -d), mai in una sottocartella, dove un
#   repository annidato fermerebbe gli hook (docs/due-postazioni.md, «Limiti»); la cartella si cancella alla fine,
#   anche in caso di errore.
# - I file di ambiente sono le copie degli esempi .env.app.example, .env.worker.example, .env.migrate.example, che
#   contengono le password di sviluppo coerenti con infra/compose.dev.yml.
# - Compose usa un nome di progetto proprio (COMPOSE_PROJECT_NAME, che vale anche sopra un `name:` del file), quindi
#   container e volumi nuovi, tolti alla fine con `down -v`; i servizi di sviluppo non si toccano, ma devono essere
#   spenti, perché le porte 5432, 9000 e 3000 servono libere (lo script si ferma e lo dice).
#
# Chiama Docker: lo esegue l'utente nel suo terminale (docs/due-postazioni.md, «Regole di struttura») e, da FON-T08,
# la CI, in un job separato. Uso: bash infra/scripts/check-fresh-clone.sh  (esce con 0 se la prova riesce)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HEALTH_URL="http://localhost:3000/api/health"
HEALTH_SECONDS=60
POSTGRES_WAIT_SECONDS=120
PROJECT="fon001-fresh-clone-$$"
WORK=""
DEV_PID=""

fail() {
  echo "ERRORE: $*" >&2
  exit 1
}

port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

cleanup() {
  local status=$?
  set +e
  if [ -n "$DEV_PID" ]; then
    # pnpm dev gira in un gruppo di processi suo (setsid): si ferma tutto il gruppo, compreso next dev.
    kill -TERM -- "-$DEV_PID" 2>/dev/null
    wait "$DEV_PID" 2>/dev/null
  fi
  if [ -n "$WORK" ] && [ -f "$WORK/repo/infra/compose.dev.yml" ]; then
    (cd "$WORK/repo" && COMPOSE_PROJECT_NAME="$PROJECT" docker compose -f infra/compose.dev.yml down -v --remove-orphans >/dev/null 2>&1)
  fi
  if [ -n "$WORK" ]; then
    rm -rf "$WORK"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

for port in 5432 9000 3000; do
  if port_busy "$port"; then
    fail "la porta $port è occupata: spegni prima i servizi di sviluppo (docker compose -f infra/compose.dev.yml stop) e pnpm dev"
  fi
done

COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
if [ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]; then
  echo "Attenzione: ci sono modifiche non salvate; il clone usa solo il commit $COMMIT."
fi

WORK="$(mktemp -d)"
REPO="$WORK/repo"
echo "Clone del commit $COMMIT in una cartella temporanea…"
git clone --quiet --no-checkout "$ROOT" "$REPO"
git -C "$REPO" checkout --quiet --detach "$COMMIT"

cd "$REPO"
cp .env.app.example .env.app
cp .env.worker.example .env.worker
cp .env.migrate.example .env.migrate

echo "Installazione delle dipendenze…"
pnpm install --frozen-lockfile

export COMPOSE_PROJECT_NAME="$PROJECT"

echo "1/3 docker compose -f infra/compose.dev.yml up -d"
docker compose -f infra/compose.dev.yml up -d

healthy=""
for _ in $(seq 1 "$POSTGRES_WAIT_SECONDS"); do
  if [ "$(docker compose -f infra/compose.dev.yml ps --format '{{.Health}}' postgres 2>/dev/null)" = "healthy" ]; then
    healthy=1
    break
  fi
  sleep 1
done
[ -n "$healthy" ] || fail "PostgreSQL non è in salute dopo $POSTGRES_WAIT_SECONDS secondi"

echo "2/3 pnpm db:migrate"
pnpm db:migrate

echo "3/3 pnpm dev"
setsid pnpm dev >"$WORK/dev.log" 2>&1 &
DEV_PID=$!

started=$SECONDS
code=""
while [ $((SECONDS - started)) -lt "$HEALTH_SECONDS" ]; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
  if [ "$code" = "200" ]; then
    echo "OK: GET $HEALTH_URL ha risposto 200 dopo $((SECONDS - started)) secondi."
    exit 0
  fi
  sleep 1
done

echo "Ultime righe di pnpm dev:" >&2
tail -n 30 "$WORK/dev.log" >&2 || true
fail "GET $HEALTH_URL non ha risposto 200 entro $HEALTH_SECONDS secondi (ultimo codice: ${code:-nessuno})"
