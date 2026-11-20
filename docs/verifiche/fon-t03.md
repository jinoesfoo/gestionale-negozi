# FON-T03 — Lista di controllo: database in locale, ruoli, migrazioni, `/api/health`

Le prove automatiche di FON-T03 sono i test di Vitest (`pnpm test` e `pnpm test:int`). Questa lista raccoglie le prove che si fanno a mano, perché chiamano Docker o avviano i servizi: resta ferma dopo la fase test, e gli esiti si scrivono in `docs/verifiche/fon-t03-esito.md`.

Chi esegue: **C** = Claude (i comandi Docker da soli nella riga, fuori dalla sandbox; `test:int`, `db:migrate` e `dev` nella gabbia, `bash .claude/hooks/gabbia.sh <comando>`); **U** = utente dal suo terminale, nella cartella del progetto, dopo aver letto lo script. Gli script che chiamano Docker al loro interno li esegue sempre l'utente (`docs/due-postazioni.md`, «Regole di struttura»).

Prima di iniziare: l'utente ha creato i file di ambiente locali copiando i cinque esempi (`AVVIO.md`, «Fuori da GitHub»), e li ha aggiornati se la fase codice ha cambiato gli esempi.

## A. Servizi di sviluppo (FON-001, `infra/compose.dev.yml`)

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| A1 | C | `docker compose -f infra/compose.dev.yml config --no-env-resolution` | Porte pubblicate solo su `127.0.0.1` (5432 per PostgreSQL, 9000 per l'emulatore S3); i dati su volumi con nome; le cartelle del progetto montate solo in sola lettura (`read_only: true`); `ROLES_ALLOW_CREATEDB` vale `1` solo nel servizio PostgreSQL |
| A2 | C | `docker compose -f infra/compose.dev.yml up -d`, poi `docker compose -f infra/compose.dev.yml ps -a` | PostgreSQL `healthy`; emulatore S3 in esecuzione; il servizio che prepara il bucket è terminato con codice 0 |
| A3 | C | `docker compose -f infra/compose.dev.yml logs` del servizio che prepara il bucket | Il bucket `app-dev` (quello di `S3_BUCKET` degli esempi di sviluppo) esiste con il versioning `Enabled` |
| A4 | C | `docker compose -f infra/compose.dev.yml up -d` una seconda volta | Nessun errore; il servizio del bucket termina di nuovo con 0 (bucket già esistente, versioning ancora attivo) |
| A5 | U | `git status --short` e `ls -la` nella radice del progetto e in `infra/` dopo A2 | Nessun file o cartella nuova creata dai container nel progetto (niente bind mount scrivibili, `docs/due-postazioni.md`, «Limiti») |

## B. Migrazioni e test di integrazione (FON-003, FON-004, FON-009)

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| B1 | C | `bash .claude/hooks/gabbia.sh db:migrate` | Termina con 0; nel database `app` esiste lo schema `drizzle` con `__drizzle_migrations` e la riga della prima migrazione |
| B2 | C | `bash .claude/hooks/gabbia.sh db:migrate` una seconda volta | Termina con 0, senza nuove righe nel registro (FON-004, provato anche dal test di integrazione) |
| B3 | C | `bash .claude/hooks/gabbia.sh test:int` | Tutti i test di `int-app` e `int-worker` passano (FON-003, FON-004, FON-009); il database usa e getta `app_fresh` non resta dopo la prova |
| B4 | C | `pnpm lint`, `pnpm typecheck`, `pnpm test` (nella sandbox) | Verdi: i test unitari non hanno bisogno né del database né dei file di ambiente |
| B5 | C | `pnpm build` (nella sandbox, senza file di ambiente) | Riesce: `/api/health` non si esegue durante la build e non serve il database (FON-T01, `NEXT_PHASE`) |

## C. Ruoli senza `ROLES_ALLOW_CREATEDB` (FON-003, caso negativo)

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| C1 | U | `docker volume ls --filter dangling=true` prima e dopo `bash infra/scripts/check-roles-no-createdb.sh` | Lo script stampa `OK: senza ROLES_ALLOW_CREATEDB, 01-roles.sh crea i quattro ruoli e app_owner non ha CREATEDB.` ed esce con 0; dopo, nessun container `check-roles-no-createdb-*` (`docker ps -a`) e l'elenco dei volumi non attaccati a un container è uguale a quello di prima (lo script toglie anche il volume anonimo del suo container) |

## D. Clone pulito (FON-001)

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| D1 | C | Commit di tutto il lavoro sul ramo `fon-t03` (dalla fase codice i commit sul ramo sono permessi) | `git status` pulito, a parte i file non tracciati che la sandbox monta nella radice |
| D2 | U | Spegnere i servizi di sviluppo (`docker compose -f infra/compose.dev.yml stop`) e un eventuale `pnpm dev` | Le porte 5432, 9000 e 3000 sono libere |
| D3 | U | `bash infra/scripts/check-fresh-clone.sh` | Stampa `OK: GET http://localhost:3000/api/health ha risposto 200 dopo N secondi.` con N ≤ 60 ed esce con 0 |
| D4 | U | Dopo D3: `docker ps -a`, `docker volume ls` | Nessun container o volume `fon001-fresh-clone-*` rimasto; la cartella temporanea del clone non esiste più |
| D5 | C | `docker compose -f infra/compose.dev.yml start` | I servizi di sviluppo ripartono con i dati di prima |

## E. Prova di `AVVIO.md` §6 su joo

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| E1 | C | Esiti di A2 e B3 | `docker compose -f infra/compose.dev.yml up -d` funziona e, con il database avviato, `bash .claude/hooks/gabbia.sh test:int` lo raggiunge |
