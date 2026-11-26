# OPS-T01a — Lista di controllo: immagine PostgreSQL con pgBackRest, backup notturni e server

Questa lista resta ferma dopo la fase test; gli esiti si scrivono in `docs/verifiche/ops-t01a-esito.md`. Le parti automatiche sono tre:
- i test unitari di `tests/unit/infra/` (`postgres-image`, `backup-timers`, `pgbackrest-summary`, `pgbackrest-init`, `backup-sh`, `check-pgbackrest-compose`, `check-pgbackrest-repo`), che girano con `pnpm test`, senza Docker;
- i controlli `infra/check-ports.sh` (con `infra/scripts/check-pgbackrest-compose.ts`) e `infra/scripts/check-pgbackrest-repo.sh`;
- la prova con Docker `tests/infra/pgbackrest/run.sh`, contro l'emulatore S3 e un proxy TLS (01 §Servizi, esito del [VERIFICA] sull'ingresso TLS).

I comandi esatti delle righe stanno in `infra/README.md`, nelle sottosezioni OPS-T01a di «PostgreSQL e backup» e di «File di ambiente dei server». I comandi si possono correggere durante la fase codice; i controlli e gli esiti attesi no.

Chi esegue:
- **C** = Claude: Docker in locale su yoo, un comando per volta; sui server con `ssh test` e `ssh prod`, come `deploy`. Ogni comando verso `prod` lo conferma l'utente.
- **U** = utente, dal suo terminale: gli script che chiamano Docker al loro interno (`run.sh`, `check-ports.sh`, `check-fresh-clone.sh`: CLAUDE.md §4), i file di `/srv/app/env/` (`test-admin` o `prod-admin`, poi `sudo -iu deploy`) e i pannelli di GitHub. L'utente detta a Claude l'esito: una risposta o una schermata per riga, mai un «ok» per più righe.

Token, chiavi e password non passano mai in chat, nelle schermate, in git né nei file del progetto. Sui server i controlli di `postgres.env` rispondono con numeri o con «riuscito» e «fallito», mai con i valori.

Valori (non segreti; `infra/README.md`, «Accessi e server» e «Archivi S3 (OPS-T03)»):

| Server | Indirizzo | Bucket dei backup | Chiave S3 (voce del gestore di password) | Endpoint e regione |
|---|---|---|---|---|
| test | `145.14.158.72` | `foondaco-backup-test` | `pgbackrest-test` | `fsn1.your-objectstorage.com`, `fsn1` |
| produzione | `91.108.122.251` | `foondaco-backup` | `pgbackrest-prod` | `fsn1.your-objectstorage.com`, `fsn1` |

**T** è il valore di `POSTGRES_TAG` in `infra/versions.env` nel commit pubblicato: `18.7-1` alla prima pubblicazione. Un tag pubblicato non si ripubblica mai (08, note del piano di OPS-T01a, «Tag»). Se dopo la pubblicazione cambia un file di `infra/postgres/`, per esempio per la revisione, si pubblica la revisione successiva (`18.7-2`). Poi si rifanno le righe da C1 a C6 e, su ogni server, E1, E2, E3, E6 ed E10. Questa lista non nomina il numero di revisione, quindi non cambia.

PostgreSQL resta fermo su tutti e due i server: lo avvia FON-T07b. Fino ad allora `/srv/app/.env` tiene `CADDY_TAG=2.11.9-1` e `APP_TAG=bootstrap`.

Se un esito non è quello atteso ci si ferma: Claude annota nell'esito cosa ha visto, e il passo successivo si decide con l'utente.

## A. Fase test

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| A1 | C | `pnpm lint`, `pnpm typecheck` e `pnpm test`, con i test nuovi | Lint e typecheck verdi. In `pnpm test` falliscono solo i test nuovi di OPS-T01a che aspettano file o righe della fase codice, e per il motivo giusto: un file o uno script che manca, oppure una riga nuova che il Dockerfile o le configurazioni non hanno ancora. Passano i test di `check-pgbackrest-compose` e di `check-pgbackrest-repo`, e tutti i test che c'erano prima |
| A2 | U | `bash tests/infra/pgbackrest/run.sh`, dalla cartella del progetto | Le prove di servizio S1, S2 e S3 sono come attese: l'emulatore e il bucket sono pronti, il proxy TLS registra le richieste, il `migrate` finto esce con il codice scelto. Le prove da P1 a P11 sono diverse, perché l'immagine non ha ancora pgBackRest e `infra/scripts/backup.sh` non esiste. L'utente manda a Claude l'uscita, che contiene solo valori di prova |
| A3 | U | `bash infra/check-ports.sh` | Termina con errore. Per test e produzione `check-compose.ts` non trova problemi; fra i problemi di `check-pgbackrest-compose.ts` c'è `manca il servizio pgbackrest-init (OPS-001)` |

## B. Fase codice, in locale

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| B1 | C | `pnpm lint`, `pnpm typecheck` e `pnpm test` | Tutti verdi, compresi i test di OPS-T01a |
| B2 | C | Commit del codice sul ramo `ops-t01a` | SHA annotato. Le righe da B3 a B5 e la costruzione di C1 usano questo commit; un cambiamento successivo di `infra/` fa rifare le righe che lo riguardano |
| B3 | U | `bash infra/scripts/check-fresh-clone.sh` | Riuscito: una copia pulita del commit di B2 avvia i servizi di sviluppo, e PostgreSQL è in salute entro 120 secondi (FON-001) |
| B4 | U | `bash infra/check-ports.sh` | Una riga OK per ambiente, compreso `pgbackrest-init` |
| B5 | C | PostgreSQL di sviluppo ricostruito dal commit di B2 (`docker compose -f infra/compose.dev.yml up -d --build postgres`), poi `show archive_mode` e `bash .claude/hooks/gabbia.sh test:int` | PostgreSQL in salute; `archive_mode` è `off`; `test:int` verde |

## C. Immagine T: costruzione, prove e pubblicazione

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| C1 | C | Costruzione di `ghcr.io/jinoesfoo/gestionale-negozi-postgres:T` dal commit di B2 | Riuscita, senza errori |
| C2 | C | Versioni nell'immagine: `pgbackrest version` e le versioni dei pacchetti `pgbackrest`, `jq` e `ca-certificates` | `pgBackRest 2.60.1`, oppure un'altra 2.x di cui Claude ha letto le note di rilascio dalla 2.60.1 in poi, annotando nell'esito cosa cambia per il progetto. Le tre versioni annotate, per la tabella dei digest del README |
| C3 | C | File nell'immagine | `/etc/pgbackrest/pgbackrest.conf` identico, byte per byte, a `infra/postgres/pgbackrest.conf` del commit; `/etc/pgbackrest.conf` assente; `/usr/local/bin/pgbackrest-summary` e `/usr/local/bin/pgbackrest-init` identici ai file del commit, con permessi 755; `/etc/ssl/certs/ca-certificates.crt` presente e non vuoto; nessuna variabile `PGBACKREST_*` nell'ambiente dell'immagine |
| C4 | C | Certificato dell'endpoint vero, senza chiavi vere: `pgbackrest info` nell'immagine, come utente `postgres`, verso `fsn1.your-objectstorage.com` (regione `fsn1`, bucket `foondaco-backup-test`), con chiave, segreto e `repo1-cipher-pass` finti | La risposta arriva dal bucket: un errore HTTP 403, perché la chiave finta è rifiutata (per esempio `InvalidAccessKeyId`). Un errore del certificato (`unable to verify certificate`) o della connessione vuol dire che l'immagine non raggiunge il bucket in modo sicuro: non si pubblica |
| C5 | U | `bash tests/infra/pgbackrest/run.sh` con l'immagine di C1 (`PROVA_IMMAGINE=ghcr.io/jinoesfoo/gestionale-negozi-postgres:T`) | `Prove: N, come attese: N, diverse: 0` |
| C6 | C | Pubblicazione su GHCR | Prima della pubblicazione il tag T non esiste su GHCR: nessun manifest. Pubblicazione riuscita; digest annotato, con le versioni di C2 |

## D. Pacchetto su GitHub (U, account `jinoesfoo`; una schermata per riga; solo alla prima pubblicazione)

| # | Controllo | Esito atteso |
|---|---|---|
| D1 | Pagina del pacchetto `gestionale-negozi-postgres` | **Private** |
| D2 | Collegamento al repository (con «Connect Repository», se compare) | Collegato a `gestionale-negozi` |
| D3 | «Package settings» → «Manage Actions access» | `gestionale-negozi` con il ruolo **Write** |

## E. Ciascun server: prima il server di test, poi la produzione

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| E1 | C | Copia in `/srv/app/infra/` della cartella `infra/` del commit di B2 | Il confronto dei file non trova differenze con `infra/` di quel commit |
| E2 | C | `/srv/app/.env` | Esattamente tre righe: `CADDY_TAG=2.11.9-1`, `APP_TAG=bootstrap`, `POSTGRES_TAG=T`. Proprietario `deploy` |
| E3 | C | `docker pull` dell'immagine T, come `deploy` | Riuscito, con lo stesso digest di C6 |
| E4 | U | `postgres.env`, scritto dall'utente con la procedura del README. Le password nuove le genera nel suo terminale e le salva nel gestore di password. `PGBACKREST_REPO1_CIPHER_PASS` è nuova, una per server, e si salva **prima** nel gestore di password e nella copia fuori linea: senza, i backup non si leggono più. Chiave e segreto S3 sono quelli della voce della tabella dei valori | Proprietario `deploy`, permessi 600. I controlli del README rispondono con un numero:<br>- righe con un valore, senza commenti né righe vuote: `13`;<br>- valori `CAMBIA`: `0`;<br>- `POSTGRES_DB=app` esatto: `1`; `POSTGRES_USER=postgres` esatto: `1`;<br>- `PGBACKREST_REPO1_S3_ENDPOINT=fsn1.your-objectstorage.com` esatto: `1`;<br>- `PGBACKREST_REPO1_S3_BUCKET` uguale al bucket della tabella: `1`;<br>- `PGBACKREST_REPO1_S3_REGION=fsn1` esatto: `1`;<br>- righe con `://`: `0` |
| E5 | U | Copia fuori linea (OPS-009) | Aggiornata con `postgres.env` di quel server. L'utente risponde «fatto» |
| E6 | C | `bash /srv/app/infra/scripts/check-pgbackrest-repo.sh` | `riuscito: bucket raggiungibile, stanza assente (codice 1)` |
| E7 | C | Container e volumi dopo E6 | Nessun container di `postgres` né di `pgbackrest-init`, né in esecuzione né fermo. Ci sono i volumi `app_pgdata` e `app_pgsocket`, creati da E6 (08, note del piano di OPS-T01a, «Prova del bucket sui server») |
| E8 | C | Timer installati come `deploy`: copia dei tre file in `~/.config/systemd/user/`, `daemon-reload`, avvio dei due timer | I tre file di `~/.config/systemd/user/` sono identici a quelli di `infra/systemd/` del commit. `systemctl --user list-timers` mostra `backup-full.timer` e `backup-diff.timer`: il prossimo completo è la prossima domenica alle 3:30 di Roma, il prossimo differenziale la prossima notte dal lunedì al sabato alle 3:30 di Roma |
| E9 | C | `loginctl show-user deploy --property=Linger` | `Linger=yes` (FON-T07a): i timer girano anche senza nessuno collegato |
| E10 | C | `systemctl --user start backup@diff.service` con PostgreSQL fermo, poi il journal del servizio | Il comando termina con 0. Nel journal c'è la riga `backup.sh: il servizio postgres non è in esecuzione: backup saltato`. Nessun container avviato |
| E11 | C | Stato finale del server | PostgreSQL fermo; l'immagine T presente; i due timer attivi |
