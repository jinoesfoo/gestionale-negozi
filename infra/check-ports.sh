#!/usr/bin/env bash
# Controllo della configurazione Compose dei server (FON-008, FON-010, FON-002; 01 §Servizi Docker Compose, FON-T06).
# Per test e per produzione calcola la configurazione con `docker compose config`, usando i file di ambiente di esempio
# di infra/env.example/ (ENV_DIR) e tag fittizi, così gira anche in CI (FON-T08), dove i file veri di /srv/app/env/
# non esistono. Il controllo lo fa infra/scripts/check-compose.ts: solo caddy pubblica porte (80 e 443, TCP), log a
# rotazione su ogni servizio, DATABASE_OWNER_URL solo in migrate (mai in app o worker), più le regole di §Servizi.
# L'uscita di Compose contiene i valori degli esempi: va solo al controllo, che scrive nomi, mai valori.
#
#   bash infra/check-ports.sh
#
# Termina con 0 e una riga OK per ambiente, oppure con l'elenco dei problemi e un codice diverso da 0.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export ENV_DIR="$root/infra/env.example"
export APP_TAG=check-ports
export CADDY_TAG=check-ports
export POSTGRES_TAG=check-ports

for environment in test prod; do
  # --profile tools: senza, migrate (profilo tools) non comparirebbe nella configurazione.
  docker compose -p app --project-directory "$root" \
    -f "$root/infra/compose.yml" -f "$root/infra/compose.$environment.yml" \
    --profile tools config --format json |
    node "$root/infra/scripts/check-compose.ts" "$environment"
done

echo "OK: solo caddy pubblica porte, log a rotazione, DATABASE_OWNER_URL solo in migrate (test e prod)."
