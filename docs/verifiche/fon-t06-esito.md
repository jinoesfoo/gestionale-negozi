# FON-T06 — Esito della lista di controllo

Lista: `docs/verifiche/fon-t06.md`. Postazione joo. Esiti dei passi **C** riportati da Claude dall'output dei comandi; esiti dei passi **U** riportati dall'utente (output incollato in chat), trascritti da Claude.

## A. Contesto e build dell'immagine

| # | Data | Esito |
|---|---|---|
| A1 | 21/11/2026 | Superato. Contesto trasferito: 344 kB. Primo livello: `drizzle`, `infra`, `next.config.ts`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `src`, `tsconfig.json`, `tsup.config.ts`; i due `find` non elencano nulla (solo le righe «fine dell'elenco…»). Nota: contrariamente al commento di `tests/fixtures/docker-context.Dockerfile` («nessuna immagine con nome: la prova lascia solo la cache di costruzione»), la build lascia un'immagine senza nome (`moby-dangling`, `d498cef5b1fd`), tolta subito dopo con `docker image rm`. |
| A2 | 21/11/2026 | Superato alla seconda prova. La prima si è fermata a `npm install --global pnpm@12.18.0` con `ETIMEDOUT` verso `registry.npmjs.org` dopo 100 s, prima della build vera; un container lanciato subito dopo raggiungeva il registro (`npm ping`: `PONG 1017ms`), e la seconda prova è riuscita, con molti avvisi di richieste lente (fino a 39 s): rete lenta in quel momento, non un difetto del `Dockerfile`. Dopo il ritocco del `Dockerfile` (`--allow-scripts=pnpm`, niente `npm cache clean --force`) la build è stata rifatta da capo: riuscita, senza più l'avviso di npm sugli script di installazione di pnpm. `next build` (Turbopack) e `tsup` nella fase di build: `dist/isolation-check.js` 767 B, `dist/cli.js` 750,77 KB, `dist/migrate.js` 1,10 MB, `dist/worker.js` 2,21 MB. Immagine `gestionale-negozi-app:fon-t06-prova`: 395 MB su disco, 95,7 MB di contenuto. |
| A3 | 21/11/2026 | Superato. La build senza `APP_VERSION` si ferma all'ultimo passo con `Manca --build-arg APP_VERSION (lo SHA del commit).`, codice 1; `docker image ls gestionale-negozi-app` mostra solo `fon-t06-prova`. |
| A4 | 21/11/2026 | Superato. Label `{"org.opencontainers.image.source":"https://github.com/jinoesfoo/gestionale-negozi"}`; ambiente `PATH`, `NODE_VERSION=24.22.3`, `YARN_VERSION=1.22.22`, `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1`, `HOSTNAME=0.0.0.0`, `PORT=3000`, `APP_VERSION=fon-t06-prova`; utente `node`; comando `["node","server.js"]`. |

## B. Punti di ingresso nell'immagine

| # | Data | Esito |
|---|---|---|
| B1 | 21/11/2026 | Superato. Codice 0; l'elenco ha i 12 comandi, ciascuno con argomenti e scopo. |
| B2 | 21/11/2026 | Superato. Codice 1: `Comando admin:grant rifiutato. Variabili d'ambiente mancanti o non valide: …, DATABASE_OWNER_URL (mancante), ADMIN_ALERT_EMAIL (mancante)` (solo nomi). |
| B3 | 21/11/2026 | Superato. Codice 1: `Avvio del worker rifiutato. …`, fra le variabili `DATABASE_URL (mancante)`. |
| B4 | 21/11/2026 | Superato. Codice 1: la prima variabile dell'elenco è `DATABASE_OWNER_URL (vietata)`; il valore (`prova`) non compare. |
| B5 | 21/11/2026 | Superato. Codice 1: `Migrazioni rifiutate. …`, fra le variabili `DATABASE_OWNER_URL (mancante)`. |
| B6 | 21/11/2026 | Superato. Codice 1: `isolation-check: non ancora disponibile.` |
| B7 | 21/11/2026 | Superato. `/app`: `.next`, `dist`, `drizzle`, `node_modules`, `package.json`, `server.js`; `/app/dist`: i quattro `.js`; `/app/drizzle`: `0000_init.sql`, `meta`; `/opt/infra`: `README.md`, `check-ports.sh`, i quattro compose, `env.example` (i cinque esempi), `postgres`, `s3`, `scripts` (con `dc` e `check-compose.ts`). Nessun `.env*`, `src`, `tests`, `specs`, `.git`. |

## C. Configurazione Compose dei server

| # | Data | Esito |
|---|---|---|
| C1 | 21/11/2026 | Superato (utente) dopo il cambio dei tag in `infra/compose.yml` (`TORNA AI TEST` del 21/11/2026, revisione): le stesse tre righe `OK` (test, prod e la riga finale); con i tag impostati da `check-ports.sh` il progetto si carica senza problemi. Prova precedente, superata (utente): `bash infra/check-ports.sh`: `OK: configurazione Compose (test) senza problemi.`, `OK: configurazione Compose (prod) senza problemi.`, `OK: solo caddy pubblica porte, log a rotazione, DATABASE_OWNER_URL solo in migrate (test e prod).` |
| C2 | 21/11/2026 | Superato dopo la revisione, con il testo atteso nuovo: immagini `ghcr.io/jinoesfoo/gestionale-negozi-caddy:${CADDY_TAG:?manca CADDY_TAG in /srv/app/.env}`, `…-app:${APP_TAG:?manca APP_TAG in /srv/app/.env}` per `app`, `worker` e `migrate`, `…-postgres:${POSTGRES_TAG:?manca POSTGRES_TAG in /srv/app/.env}`; `env_file` e comandi invariati. Prova precedente, superata sulla forma `${X_TAG}`: cinque `env_file` nella forma `${ENV_DIR:-/srv/app/env}/<servizio>.env` (`caddy`, `app`, `worker`, `migrate`, `postgres`); immagini `ghcr.io/jinoesfoo/gestionale-negozi-caddy:${CADDY_TAG}`, `…-app:${APP_TAG}` per `app`, `worker` e `migrate`, `…-postgres:${POSTGRES_TAG}`; comandi `['node', 'server.js']`, `['node', 'dist/worker.js']`, `['node', 'dist/migrate.js']`. |
| C3 | 21/11/2026 | Superato (passo aggiunto dopo la revisione). Prima del cambio di `infra/compose.yml` (fase test) Compose stampava solo avvisi (`The "APP_TAG" variable is not set. Defaulting to a blank string.`, e lo stesso per `CADDY_TAG` e `POSTGRES_TAG`) e caricava il progetto. Dopo: codice 1, nessuna configurazione stampata, un errore per ogni immagine, per esempio `error while interpolating services.app.image: required variable APP_TAG is missing a value: manca APP_TAG in /srv/app/.env` (anche per `caddy`, `migrate`, `postgres`, `worker`). |

## D. L'immagine con il database di sviluppo

| # | Data | Esito |
|---|---|---|
| D1 | 21/11/2026 | Superato (utente). `curl` subito dopo il `run`: `{"status":"ok","version":"dev","db":"ok","placeholders":true} 200`. La versione `dev` è quella di `.env.app` (lo stesso valore di `.env.app.example`) e non quella dell'immagine (`fon-t06-prova`): il file di ambiente prevale. Container tolto con `docker rm -f fon-t06-app`. |
| D2 | 21/11/2026 | Superato alla seconda prova (utente). Con `sleep 35` dopo il `run`: `docker logs` mostra `Worker avviato (versione dev).`; `docker ps` mostra il container creato 40 secondi prima e `Up 36 seconds`; `time docker stop fon-t06-worker`: `real 0m2.984s`, quindi il worker si è fermato da sé con SIGTERM. La prima prova, con i comandi lanciati uno dopo l'altro senza attesa, non valeva: `docker logs` vuoto, `docker ps` a 5 secondi dalla creazione (`Up 2 seconds`), `docker stop` in 3,046 s. |

## E. Controlli statici e pulizia

| # | Data | Esito |
|---|---|---|
| E1 | 21/11/2026 | Superato dopo la revisione (cambio dei tag): `pnpm lint` e `pnpm typecheck` verdi; `pnpm test`: 15 file, 556 test superati (i 3 nuovi di `tests/unit/infra/compose-file.test.ts` compresi); `test:int` nella gabbia: 5 file, 14 test superati. Prima prova, superata dopo il controllo di allineamento (`origin/main` = `1bb4377`, già base del ramo). `pnpm lint` verde (ESLint e Prettier); `pnpm typecheck` verde; `pnpm test`: 14 file, 553 test superati. In più, nella gabbia, `test:int`: 5 file, 14 test superati. |
| E2 | 21/11/2026 | Superato. `docker image rm gestionale-negozi-app:fon-t06-prova`: `Untagged` e `Deleted`; `docker image ls gestionale-negozi-app` non elenca nessuna immagine. |

## Note

- Prova in più, fuori dalla lista (21/11/2026): `docker compose -p app --project-directory . -f infra/compose.yml -f infra/compose.prod.yml --profile tools config --no-env-resolution --format json` passata a `node infra/scripts/check-compose.ts prod`: un solo problema, quello atteso senza i file di ambiente (`migrate: manca DATABASE_OWNER_URL`). La cartella montata risulta `/home/j-mac/gestionale-negozi/infra/postgres/init`: Compose risolve `./infra/…` dalla cartella del progetto. Con `--profile tools` compaiono tutti e cinque i servizi, e la sovrapposizione `services: {}` è accettata.
