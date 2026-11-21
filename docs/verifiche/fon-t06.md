# FON-T06 — Lista di controllo: compose dei server, Dockerfile, CLI con un file per comando

Le prove automatiche di FON-T06 sono i test di Vitest (`pnpm test`): CLI, worker, punti di ingresso costruiti con tsup, script `dc`, controllo della configurazione Compose, `.dockerignore` e `Dockerfile`. Questa lista raccoglie le prove che chiamano Docker: resta ferma dopo la fase test, e gli esiti si scrivono in `docs/verifiche/fon-t06-esito.md`.

Chi esegue: **C** = Claude (i comandi Docker da soli nella riga, fuori dalla sandbox); **U** = utente dal suo terminale, nella cartella del progetto, dopo aver letto lo script o i comandi. Gli script che chiamano Docker al loro interno li esegue sempre l'utente (`docs/due-postazioni.md`, «Regole di struttura»).

Nome dell'immagine di prova: `gestionale-negozi-app:fon-t06-prova` (locale, mai pubblicata). Alla fine (E2) si toglie.

## A. Contesto e build dell'immagine (FON-006)

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| A1 | C | `docker build --no-cache --progress=plain -f tests/fixtures/docker-context.Dockerfile .` | Il primo livello del contesto contiene solo `drizzle`, `infra`, `next.config.ts`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `src`, `tsconfig.json`, `tsup.config.ts`; i due elenchi di `find` sono vuoti (nessun file `.env*`, nessuna cartella `.git`, `node_modules`, `.next`, `.auth`, `.claude`, `registro`) |
| A2 | C | `docker build --build-arg APP_VERSION=fon-t06-prova -t gestionale-negozi-app:fon-t06-prova .` | La build riesce |
| A3 | C | `docker build -t gestionale-negozi-app:fon-t06-senza-versione .` (senza `APP_VERSION`) | La build fallisce, con un messaggio che nomina `APP_VERSION`; l'immagine `gestionale-negozi-app:fon-t06-senza-versione` non esiste (`docker image ls gestionale-negozi-app`) |
| A4 | C | `docker image inspect --format '{{json .Config.Labels}} {{json .Config.Env}} {{json .Config.User}} {{json .Config.Cmd}}' gestionale-negozi-app:fon-t06-prova` | Label `org.opencontainers.image.source` = `https://github.com/jinoesfoo/gestionale-negozi`; nell'ambiente `APP_VERSION=fon-t06-prova` e `NODE_ENV=production`, nessun'altra variabile oltre a quelle dell'immagine di Node e del server (`PATH`, `NODE_VERSION`, `YARN_VERSION`, `HOSTNAME`, `PORT`, `NEXT_TELEMETRY_DISABLED`); utente diverso da root; comando `["node","server.js"]` |

## B. Punti di ingresso nell'immagine (FON-002)

Tutti con `docker run --rm gestionale-negozi-app:fon-t06-prova …`, senza file di ambiente: l'immagine non contiene segreti.

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| B1 | C | `docker run --rm gestionale-negozi-app:fon-t06-prova node dist/cli.js --help` | Codice 0; elenca i 12 comandi (`admin:grant`, `admin:revoke`, `admin:reset-2fa`, `admin:purge-test-shops`, `billing:reset-customer`, `billing:test-clock-customer`, `stripe:seed`, `ops:record-backup`, `ops:record-restore-test`, `ops:record-host-metrics`, `ops:row-counts`, `jobs:send`), senza nessuna variabile d'ambiente oltre a quelle dell'immagine |
| B2 | C | `docker run --rm gestionale-negozi-app:fon-t06-prova node dist/cli.js admin:grant x@y.it` | Codice 1; il messaggio nomina `DATABASE_OWNER_URL` |
| B3 | C | `docker run --rm gestionale-negozi-app:fon-t06-prova node dist/worker.js` | Codice diverso da 0; il messaggio nomina `DATABASE_URL` |
| B4 | C | `docker run --rm -e DATABASE_OWNER_URL=prova gestionale-negozi-app:fon-t06-prova node dist/worker.js` | Codice diverso da 0; il messaggio nomina `DATABASE_OWNER_URL`, senza il valore |
| B5 | C | `docker run --rm gestionale-negozi-app:fon-t06-prova node dist/migrate.js` | Codice diverso da 0; il messaggio nomina `DATABASE_OWNER_URL` |
| B6 | C | `docker run --rm gestionale-negozi-app:fon-t06-prova node dist/isolation-check.js` | Codice 1; messaggio «non ancora disponibile» |
| B7 | C | `docker run --rm gestionale-negozi-app:fon-t06-prova ls -A /app /app/dist /app/drizzle /opt/infra /opt/infra/env.example` | In `/app`: `server.js`, `.next`, `node_modules`, `package.json`, `dist` (con i quattro `.js`), `drizzle` (con `meta/_journal.json` e le migrazioni); in `/opt/infra` la cartella `infra/` del commit (compose, `env.example/`, `postgres/`, `scripts/` con `dc`); nessun file `.env*`, nessuna cartella `src`, `tests`, `specs`, `.git` |

## C. Configurazione Compose dei server (FON-008, FON-010, FON-002)

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| C1 | U | `bash infra/check-ports.sh` (dopo averlo letto) | Stampa `OK: configurazione Compose (test) senza problemi.`, la stessa riga per `prod` e la riga finale `OK: …`; esce con 0 |
| C2 | C | `grep -nE 'image:\|env_file:\|command:' infra/compose.yml` | Cinque `env_file`, uno per servizio, nella forma `${ENV_DIR:-/srv/app/env}/<servizio>.env` (`caddy`, `app`, `worker`, `migrate`, `postgres`); immagini `ghcr.io/jinoesfoo/gestionale-negozi-caddy:${CADDY_TAG}`, `…-app:${APP_TAG}` per `app`, `worker` e `migrate`, `…-postgres:${POSTGRES_TAG}`; comandi `node dist/worker.js` e `node dist/migrate.js` (per `app` vale il `CMD` dell'immagine, `node server.js`, oppure lo stesso comando scritto nel file) |

## D. L'immagine con il database di sviluppo (FON-002, FON-009)

Con i servizi di sviluppo avviati (`docker compose -f infra/compose.dev.yml up -d`, `postgres` healthy) e le migrazioni applicate, e con `pnpm dev` spento (porta 3000 libera). I file `.env.app` e `.env.worker` li legge Docker, fuori dalla sandbox: per questo li lancia l'utente.

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| D1 | U | `docker run --rm -d --name fon-t06-app --network host --env-file .env.app -e HOSTNAME=127.0.0.1 gestionale-negozi-app:fon-t06-prova`, poi dopo qualche secondo `curl -s -w ' %{http_code}\n' http://127.0.0.1:3000/api/health`, poi `docker rm -f fon-t06-app` | Risposta `200` con `status` e `db` uguali a `ok` e `version` uguale all'`APP_VERSION` di `.env.app` (che prevale su quella dell'immagine) |
| D2 | U | `docker run --rm -d --name fon-t06-worker --network host --env-file .env.worker gestionale-negozi-app:fon-t06-prova node dist/worker.js`, poi dopo almeno 30 secondi `docker ps --filter name=fon-t06-worker`, poi `time docker stop fon-t06-worker` (il container si toglie da solo, `--rm`) | Dopo 30 secondi il container è ancora `Up`; `docker stop` termina in meno di 10 secondi, cioè il worker si ferma da sé con SIGTERM, senza aspettare che Docker lo uccida |

## E. Controlli statici e pulizia

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| E1 | C | `pnpm lint`, `pnpm typecheck`, `pnpm test` (nella sandbox) | Verdi |
| E2 | C | `docker image rm gestionale-negozi-app:fon-t06-prova`, poi `docker image ls gestionale-negozi-app` | Nessuna immagine `gestionale-negozi-app` rimasta |
