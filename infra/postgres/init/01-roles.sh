#!/usr/bin/env bash
# Crea i ruoli del database app dal modello roles.sql.tpl (01 §Inizializzazione del database, FON-003).
# L'entrypoint dell'immagine lo esegue (è eseguibile) solo alla creazione del volume, con il server provvisorio che
# ascolta solo sul socket; la CI lo esegue contro il suo servizio PostgreSQL con PGHOST, PGPORT, PGUSER, PGPASSWORD,
# PGDATABASE e ROLES_TEMPLATE=infra/postgres/roles.sql.tpl.
#
# Variabili: APP_OWNER_PASSWORD, APP_USER_PASSWORD, APP_WORKER_PASSWORD, APP_JOBS_PASSWORD (obbligatorie);
# ROLES_TEMPLATE (predefinito /opt/roles.sql.tpl); ROLES_ALLOW_CREATEDB (facoltativa: con 1 concede CREATEDB ad
# app_owner, per il database usa e getta app_fresh dei test; solo in compose.dev.yml e in CI, mai sui server).
# Gli errori nominano le variabili, mai i valori.
set -euo pipefail

for name in APP_OWNER_PASSWORD APP_USER_PASSWORD APP_WORKER_PASSWORD APP_JOBS_PASSWORD; do
  if [ -z "${!name:-}" ]; then
    echo "01-roles.sh: manca $name" >&2
    exit 1
  fi
done

# Senza --dbname psql si collegherebbe al database postgres, e i comandi sullo schema public finirebbero nel
# database sbagliato.
database="${PGDATABASE:-${POSTGRES_DB:?01-roles.sh: manca PGDATABASE o POSTGRES_DB}}"
user="${PGUSER:-${POSTGRES_USER:?01-roles.sh: manca PGUSER o POSTGRES_USER}}"

psql -v ON_ERROR_STOP=1 \
  -v owner_password="$APP_OWNER_PASSWORD" \
  -v user_password="$APP_USER_PASSWORD" \
  -v worker_password="$APP_WORKER_PASSWORD" \
  -v jobs_password="$APP_JOBS_PASSWORD" \
  --dbname "$database" --username "$user" \
  -f "${ROLES_TEMPLATE:-/opt/roles.sql.tpl}"

if [ "${ROLES_ALLOW_CREATEDB:-}" = "1" ]; then
  psql -v ON_ERROR_STOP=1 --dbname "$database" --username "$user" -c 'ALTER ROLE app_owner CREATEDB'
fi
