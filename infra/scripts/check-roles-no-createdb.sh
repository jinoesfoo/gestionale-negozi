#!/usr/bin/env bash
# FON-003, caso negativo: senza ROLES_ALLOW_CREATEDB, infra/postgres/init/01-roles.sh crea i ruoli ma NON concede
# CREATEDB ad app_owner (01 §Inizializzazione del database). Il caso positivo (con ROLES_ALLOW_CREATEDB=1, come in
# compose.dev.yml e in CI) lo prova il test di integrazione tests/integration/app/roles.test.ts.
#
# Avvia un container usa e getta con l'immagine postgres di base di infra/postgres/Dockerfile (riga FROM), senza la
# variabile, con 01-roles.sh e roles.sql.tpl montati in sola lettura come nell'immagine del progetto, aspetta la fine
# dell'inizializzazione e legge rolcreatedb di app_owner. Il container si toglie alla fine, anche in caso di errore.
# Le password sono valori di prova, usati solo da questo container.
#
# Chiama Docker: lo esegue l'utente nel suo terminale (docs/due-postazioni.md, «Regole di struttura») e, da FON-T08,
# la CI. Uso: bash infra/scripts/check-roles-no-createdb.sh  (esce con 0 se la prova riesce)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCKERFILE="$ROOT/infra/postgres/Dockerfile"
INIT_DIR="$ROOT/infra/postgres/init"
TEMPLATE="$ROOT/infra/postgres/roles.sql.tpl"
NAME="check-roles-no-createdb-$$"
WAIT_SECONDS=90

fail() {
  echo "ERRORE: $*" >&2
  exit 1
}

for path in "$DOCKERFILE" "$INIT_DIR/01-roles.sh" "$TEMPLATE"; do
  [ -e "$path" ] || fail "manca ${path#"$ROOT"/}"
done
[ -x "$INIT_DIR/01-roles.sh" ] || fail "infra/postgres/init/01-roles.sh non è eseguibile (l'entrypoint lo leggerebbe con '.')"

IMAGE="$(sed -nE 's/^FROM[[:space:]]+(postgres:[^[:space:]]+).*/\1/p' "$DOCKERFILE" | head -n 1)"
[ -n "$IMAGE" ] || fail "nessuna riga 'FROM postgres:<versione>' in infra/postgres/Dockerfile"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

echo "Avvio di un container $IMAGE senza ROLES_ALLOW_CREATEDB…"
docker run -d --name "$NAME" \
  -e POSTGRES_DB=app \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=prova-password-postgres \
  -e APP_OWNER_PASSWORD=prova-password-app-owner \
  -e APP_USER_PASSWORD=prova-password-app-user \
  -e APP_WORKER_PASSWORD=prova-password-app-worker \
  -e APP_JOBS_PASSWORD=prova-password-app-jobs \
  -v "$INIT_DIR:/docker-entrypoint-initdb.d:ro" \
  -v "$TEMPLATE:/opt/roles.sql.tpl:ro" \
  "$IMAGE" >/dev/null

# Il server provvisorio dell'inizializzazione ascolta solo sul socket: pg_isready su 127.0.0.1 risponde solo quando
# l'inizializzazione (compreso 01-roles.sh) è finita e il server definitivo è partito.
ready=""
for _ in $(seq 1 "$WAIT_SECONDS"); do
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != "true" ]; then
    docker logs --tail 30 "$NAME" >&2 || true
    fail "il container si è fermato durante l'inizializzazione (01-roles.sh fallito?)"
  fi
  if docker exec "$NAME" pg_isready -q -h 127.0.0.1 -U postgres -d app >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ -n "$ready" ] || fail "PostgreSQL non è pronto dopo $WAIT_SECONDS secondi"

result="$(docker exec "$NAME" psql -X -q -t -A -U postgres -d app \
  -c "SELECT rolname || '=' || rolcreatedb FROM pg_roles WHERE rolname IN ('app_owner', 'app_user', 'app_worker', 'app_jobs') ORDER BY rolname")"
expected=$'app_jobs=false\napp_owner=false\napp_user=false\napp_worker=false'

if [ "$result" != "$expected" ]; then
  echo "Atteso (rolcreatedb per ruolo):" >&2
  echo "$expected" >&2
  echo "Ottenuto:" >&2
  echo "${result:-<nessun ruolo: 01-roles.sh non ha creato i ruoli>}" >&2
  fail "senza ROLES_ALLOW_CREATEDB i ruoli devono esistere tutti e nessuno deve avere CREATEDB"
fi

echo "OK: senza ROLES_ALLOW_CREATEDB, 01-roles.sh crea i quattro ruoli e app_owner non ha CREATEDB."
