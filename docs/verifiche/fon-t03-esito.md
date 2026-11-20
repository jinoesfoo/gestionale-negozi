# FON-T03 — Esito della lista di controllo

Lista: `docs/verifiche/fon-t03.md`. Postazione joo. Esiti dei passi **C** riportati da Claude dall'output dei comandi; esiti dei passi **U** riportati dall'utente (output incollato in chat), trascritti da Claude.

## A. Servizi di sviluppo

| # | Data | Esito |
|---|---|---|
| A1 | 19/11/2026 | Superato. `config --no-env-resolution`: porte `127.0.0.1:5432` (PostgreSQL) e `127.0.0.1:9000` → 8333 (emulatore); dati nei volumi `pgdata` e `s3data`; `infra/postgres/init` e `infra/s3` montate con `read_only: true`; `ROLES_ALLOW_CREATEDB: "1"` solo nel servizio `postgres`. |
| A2 | 19/11/2026 | Superato. `postgres` healthy, `s3` in esecuzione, `s3-init` `Exited (0)`. Nei log l'inizializzazione esegue `01-roles.sh` (quattro `CREATE ROLE`, permessi, `ALTER ROLE` finale per `CREATEDB`). |
| A3 | 19/11/2026 | Superato. Log di `s3-init`: `created bucket app-dev`, `Bucket app-dev versioning set to Enabled`, `Versioning: Enabled`. |
| A4 | 19/11/2026 | Superato. Secondo `up -d` senza errori; `s3-init`: `Il bucket app-dev esiste già.`, `Versioning: Enabled`, `Exited (0)`. |
| A5 | 20/11/2026 | Superato (utente). `ls -la` della radice e di `infra/`: nessun file o cartella creata dai container; tutto di `j-mac`; in `infra/` solo `README.md`, `compose.dev.yml`, `env.example/`, `postgres/`, `s3/`, `scripts/`. |

## B. Migrazioni e test di integrazione

| # | Data | Esito |
|---|---|---|
| B1 | 20/11/2026 | Superato. `gabbia.sh db:migrate`: `Migrazioni applicate.`, codice 0. |
| B2 | 20/11/2026 | Superato. Seconda esecuzione: `Migrazioni applicate.`, codice 0; `drizzle.__drizzle_migrations` ha una sola riga (`id` 1). |
| B3 | 20/11/2026 | Superato. `gabbia.sh test:int`: 5 file, 13 test verdi (dopo la correzione della query del test di FON-003 sulle sequenze, con `TORNA AI TEST`: `has_sequence_privilege` chiamata anche su una tabella TOAST); dopo la prova il database `app_fresh` non esiste. |
| B4 | 20/11/2026 | Superato. `pnpm lint` e `pnpm typecheck` verdi; `pnpm test`: 7 file, 408 test verdi. |
| B5 | 19/11/2026 | Superato. `pnpm build` senza file di ambiente: riesce, `/api/health` dinamica (`ƒ`). |

## C. Ruoli senza `ROLES_ALLOW_CREATEDB`

| # | Data | Esito |
|---|---|---|
| C1 | 20/11/2026 | Superato (utente), alla seconda prova. Prima prova (10:04): lo script stampa la riga `OK: …` ed esce con 0, nessun container `check-roles-no-createdb-*` dopo, ma resta un **volume anonimo** non attaccato a nessun container (`0fa809…`): lo script toglieva il container con `docker rm -f` senza `-v`, e l'immagine `postgres` dichiara `/var/lib/postgresql` come volume. Corretto con `TORNA AI TEST` (`docker rm -f -v`, ed esito atteso di C1 esteso ai volumi). Seconda prova: `OK: senza ROLES_ALLOW_CREATEDB, 01-roles.sh crea i quattro ruoli e app_owner non ha CREATEDB.`, uscita 0; `docker volume ls --filter dangling=true` uguale prima e dopo (solo `0fa809…`, rimasto dalla prima prova). |

## D. Clone pulito

| # | Data | Esito |
|---|---|---|
| D1 | 20/11/2026 | Superato. Commit `b02a520` sul ramo `fon-t03`; `git status` pulito, a parte i file che la sandbox monta nella radice. |
| D2 | 20/11/2026 | Superato (utente). Servizi di sviluppo spenti. |
| D3 | 20/11/2026 | Superato (utente). Clone di `b02a520f49603036ebc66c62d8bdce1ca4526798`, `pnpm install` (1 min 23 s), `up -d` del progetto `fon001-fresh-clone-24196`, `pnpm db:migrate` (`Migrazioni applicate.`), `pnpm dev`: `OK: GET http://localhost:3000/api/health ha risposto 200 dopo 4 secondi.` |
| D4 | 20/11/2026 | Superato (utente). `docker ps -a` e `docker volume ls`: nessun container né volume `fon001-fresh-clone-*`. Resta l'immagine `fon001-fresh-clone-24196-postgres` costruita dalla prova (`down -v` non toglie le immagini; fuori dal controllo). |
| D5 | 20/11/2026 | Superato. `start`: `postgres` healthy con i dati di prima (registro delle migrazioni con 1 riga), `s3-init` riconferma `Versioning: Enabled`. |

Seconda prova di D2–D5 (20/11/2026), dopo la revisione: con `TORNA AI TEST` lo script toglie anche l'immagine PostgreSQL costruita (`down -v --rmi local`) e D4 controlla anche `docker image ls`.

| # | Data | Esito |
|---|---|---|
| D1 | 20/11/2026 | Superato. Commit `0c2ad65` sul ramo `fon-t03`; restano non salvati solo il registro della postazione e i file che la sandbox monta nella radice (lo script lo segnala: il clone usa solo il commit). |
| D2 | 20/11/2026 | Superato (utente). Servizi di sviluppo spenti (`Exited (0)`). |
| D3 | 20/11/2026 | Superato (utente). Clone di `0c2ad65434a236ab9d5297ff88105fd2ff15b6d8`, `up -d` del progetto `fon001-fresh-clone-185133` (immagine `fon001-fresh-clone-185133-postgres` costruita), `pnpm db:migrate` (`Migrazioni applicate.`), `pnpm dev`: `OK: GET http://localhost:3000/api/health ha risposto 200 dopo 2 secondi.` |
| D4 | 20/11/2026 | Superato (utente). `docker ps -a`, `docker volume ls`, `docker image ls`: nessun container, volume o immagine `fon001-fresh-clone-*` (tolta anche l'immagine della prova); restano i servizi di sviluppo (`infra-*`), i loro volumi `infra_pgdata` e `infra_s3data`, il volume anonimo `6d53c4e2…` di `infra-s3-init-1` (`docker ps -a --filter volume=…`: è di quel container, l'immagine dell'emulatore dichiara `/data` come volume) e le immagini `chrislusf/seaweedfs:4.53`, `infra-postgres`, `postgres:18.7-trixie`. |
| D5 | 20/11/2026 | Superato. `start`: `postgres` healthy, `s3-init`: `Il bucket app-dev esiste già.`, `Versioning: Enabled`; `gabbia.sh test:int` subito dopo: 5 file, 14 test verdi (con i due controlli nuovi di FON-003 su `app_owner`). |

## E. Prova di `AVVIO.md` §6 su joo

| # | Data | Esito |
|---|---|---|
| E1 | 20/11/2026 | Superato. `docker compose -f infra/compose.dev.yml up -d` funziona (A2) e `gabbia.sh test:int` raggiunge il database (B3). |

## Note

- 20/11/2026, al riavvio dei servizi dopo la notte: PostgreSQL è andato in recupero appena acceso (`untracked child process (PID 14) exited with exit code 2`). Causa: il controllo di salute in forma shell interrotto da Docker su un disco lento lasciava `pg_isready` orfano al PID 1, cioè a PostgreSQL. Corretto nel `Dockerfile` (forma exec, `-t 5`, `--timeout=10s`; nota (e) di FON-T03 in `specs/01-fondamenta.md`); dopo la ricostruzione dell'immagine gli avvii sono puliti (B1–B3, D5).
