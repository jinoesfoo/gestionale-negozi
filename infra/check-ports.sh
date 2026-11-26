#!/usr/bin/env bash
# Controllo della configurazione Compose dei server (FON-008, FON-010, FON-002; 01 §Servizi Docker Compose, FON-T06;
# OPS-001, servizio pgbackrest-init, 08 §pgBackRest, OPS-T01a).
# Per test e per produzione calcola la configurazione con `docker compose config`, usando i file di ambiente di esempio
# di infra/env.example/ (ENV_DIR) e tag fittizi, così gira anche in CI (FON-T08), dove i file veri di /srv/app/env/
# non esistono. La configurazione di ogni ambiente si calcola una volta sola e passa a due controlli:
# - infra/scripts/check-compose.ts: solo caddy pubblica porte (80 e 443, TCP), log a rotazione su ogni servizio,
#   DATABASE_OWNER_URL solo in migrate (mai in app o worker), più le regole di §Servizi;
# - infra/scripts/check-pgbackrest-compose.ts: il servizio una tantum pgbackrest-init (stessa immagine di postgres,
#   comando, utente postgres, volumi pgdata e pgsocket, app e worker che lo aspettano, migrate no) e le variabili
#   PGBACKREST_* solo in postgres e pgbackrest-init.
# Girano sempre tutti e due, anche se il primo trova problemi, così l'elenco è completo; lo script termina con 1 se uno
# dei due ne ha trovati. L'uscita di Compose contiene i valori degli esempi: resta in una variabile della shell e va
# solo ai controlli, che scrivono nomi, mai valori.
#
#   bash infra/check-ports.sh
#
# Termina con 0, una riga OK per ambiente e per controllo e la riga OK finale, oppure con l'elenco dei problemi e un
# codice diverso da 0.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export ENV_DIR="$root/infra/env.example"
export APP_TAG=check-ports
export CADDY_TAG=check-ports
export POSTGRES_TAG=check-ports

failed=0
for environment in test prod; do
  # --profile tools: senza, migrate (profilo tools) non comparirebbe nella configurazione. Se Compose non riesce a
  # calcolarla, set -e ferma lo script con il suo errore.
  config="$(docker compose -p app --project-directory "$root" \
    -f "$root/infra/compose.yml" -f "$root/infra/compose.$environment.yml" \
    --profile tools config --format json)"
  printf '%s\n' "$config" | node "$root/infra/scripts/check-compose.ts" "$environment" || failed=1
  printf '%s\n' "$config" | node "$root/infra/scripts/check-pgbackrest-compose.ts" "$environment" || failed=1
done

if [ "$failed" -ne 0 ]; then
  echo "Configurazione Compose con problemi: l'elenco è qui sopra." >&2
  exit 1
fi
echo "OK: solo caddy pubblica porte, log a rotazione, DATABASE_OWNER_URL solo in migrate, pgbackrest-init e variabili PGBACKREST_* come in 08 §pgBackRest (test e prod)."
