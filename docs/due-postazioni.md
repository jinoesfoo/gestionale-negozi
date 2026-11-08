# Due postazioni: yoo e joo

Il progetto si sviluppa su due computer Ubuntu, ciascuno con il suo ruolo. Questa pagina dice chi fa cosa, in che ordine, e perché le due postazioni non si pestano i piedi. Claude la legge prima di ogni piano (`CLAUDE.md`, sezione 6). È un file del metodo: la cambia solo l'utente.

## In breve

- **joo fa l'applicazione e il database**: 25 compiti. È l'unica postazione che scrive migrazioni.
- **yoo fa i server e tutto quello che li circonda**: 15 compiti, l'ultimo è il collaudo (COL-T01). Tre dei 15 sono compiti delle aree dell'applicazione (NEG, BIL, MOD), senza migrazioni: NEG-T04, BIL-T01, MOD-T03.
- Ogni compito appartiene a una sola postazione. Gli hook lo fanno rispettare: `INIZIA` rifiuta un compito dell'altra postazione, e anche un compito i cui prerequisiti non sono ancora su `main`.
- Le due postazioni si parlano solo attraverso GitHub: un compito è «fatto» quando la sua pull request è unita su `main` e la sua casella risulta spuntata lì. Fuori da git condividono due cose, il server di test e gli account esterni, con le regole delle sezioni «Il server di test condiviso» e «Stripe».
- Stima: **27 turni invece di 40** (un turno è un compito; i compiti hanno durate diverse, il conto serve a vedere le attese).

## I ruoli

### joo: applicazione e database

Repository e strumenti, database, negozi e separazione dei dati, login e ruoli, pannello amministratore, moduli, abbonamenti e fattura elettronica, esportazione.

Account e chiavi che servono su joo: GitHub, Docker in locale, la **propria** sandbox Stripe di sviluppo (BIL-T02 e successivi), Brevo (prova di invio in FON-T10), sandbox del fornitore SDI (BIL-T11).

### yoo: server, rilasci e operatività

I due server Hostinger, DNS su Cloudflare, Caddy e certificati, archivi S3 e backup, CI e rilasci automatici, monitoraggio e Sentry, intestazioni di sicurezza, documenti e procedure, collaudo finale. Più tre compiti delle aree dell'applicazione, senza migrazioni:
- **NEG-T04**, l'instradamento del proxy, vicino a Caddy e ai domini;
- **BIL-T01**, il listino e i prodotti Stripe;
- **MOD-T03**, il menu e il controllo dei moduli.

Scrivono codice dell'applicazione anche altri compiti di yoo (FON-T07b, OPS-T01b, OPS-T04, OPS-T09, OPS-T11), sempre nei file della sua colonna o nelle eccezioni pianificate.

Account e chiavi che servono su yoo: Hostinger, chiavi SSH dei server, Cloudflare, Hetzner o Scaleway, Brevo, GitHub (pacchetti GHCR e variabili di Actions), Sentry, servizio di controllo esterno, la **propria** sandbox Stripe di sviluppo e quelle dei due server.

## Le corsie

L'ordine è quello di `.claude/hooks/corsie.txt`. Vale la copia su `main`, uguale per le due postazioni, e la modifica solo l'utente. Una postazione inizia un compito solo quando sono uniti su `main` i compiti che lo precedono nella sua corsia e quelli segnati nella colonna «aspetta».

### Corsia di joo

| # | Compito | Cosa | Aspetta da yoo |
|---|---|---|---|
| 1 | FON-T01 | Repository, strumenti, schemi delle variabili | — |
| 2 | FON-T03 | Database in locale, ruoli, migrazioni, `/api/health` | — |
| 3 | FON-T06 | Compose dei server, Dockerfile, CLI con un file per comando | — |
| 4 | FON-T10 | Worker, email, registro delle azioni | DOM-T01 (record DNS ed email) |
| 5 | NEG-T01 | Tabella dei negozi | — |
| 6 | NEG-T02 | `withShop`, `resolve_host` | — |
| 7 | NEG-T05 | Test di separazione e dei permessi | — |
| 8 | NEG-T09 | Segreti per negozio | — |
| 9 | ACC-T01 | Better Auth, membership | NEG-T04 (il proxy applica il controllo di `Origin`, NEG-011) |
| 10 | ACC-T03 | Secondo fattore, passkey, pagine di login | — |
| 11 | ACC-T04 | Limiti dei tentativi, recupero password | FON-T08 (che completa gli esempi delle variabili prima di lui) |
| 12 | ACC-T05 | `requireShopAccess`, pagina dei membri | — |
| 13 | ACC-T06 | Inviti, condizioni | — |
| 14 | ADM-T01 | Accesso al pannello (anticipato) | — |
| 15 | ADM-T07 | Pagina Sistema, tabelle operative (anticipato) | — |
| 16 | MOD-T01 | Moduli | — |
| 17 | MOD-T02 | Moduli per negozio | — |
| 18 | BIL-T02 | Abbonamenti, webhook Stripe | BIL-T01 (listino e libreria `stripe`) |
| 19 | BIL-T05 | Stato di pagamento, sincronizzazione | — |
| 20 | BIL-T06 | Checkout, portale, impostazioni | MOD-T03 (menu dei moduli) |
| 21 | BIL-T07 | Promemoria, controllo orario | — |
| 22 | BIL-T09 | Archivio file, cancellazione dei negozi, `isolation-check` | — |
| 23 | BIL-T11 | Fattura elettronica | — |
| 24 | ADM-T03 | Gestione dei negozi nel pannello | — |
| 25 | OPS-T08 | Registro, esportazione dei dati | OPS-T04 (che aggiunge Sentry prima delle sue dipendenze) |

### Corsia di yoo

| # | Compito | Cosa | Aspetta da joo |
|---|---|---|---|
| 1 | FON-T07a | Preparazione dei due server | — |
| 2 | DOM-T01 | DNS ed email (Cloudflare, Brevo) | — |
| 3 | OPS-T03 | Archivi S3 separati (anticipato) | — |
| 4 | DOM-T02 | Caddy, certificati, avvio di bootstrap | FON-T06 |
| 5 | OPS-T01a | PostgreSQL con pgBackRest, backup notturni | — |
| 6 | FON-T07b | Primo avvio completo sui server | FON-T10 (si avvia il worker vero, con le sue variabili) |
| 7 | NEG-T04 | Instradamento: `src/proxy.ts` | NEG-T02 |
| 8 | FON-T08 | CI completa e rilasci automatici | NEG-T09 |
| 9 | BIL-T01 | Listino e prodotti Stripe | ACC-T04 (che aggiunge `ua-parser-js`: le due dipendenze nuove non arrivano insieme) |
| 10 | MOD-T03 | Menu e controllo dei moduli | MOD-T02 |
| 11 | OPS-T01b | Registrazione dei backup, copia specchio | BIL-T02 (`ops:row-counts` conta anche `subscriptions`) |
| 12 | OPS-T04 | Controllo approfondito, metriche, Sentry | BIL-T11 |
| 13 | OPS-T09 | Intestazioni di sicurezza, controllo delle dipendenze | — (viene dopo OPS-T04: la CSP deve ammettere l'host di Sentry) |
| 14 | OPS-T11 | Documenti, procedure, condizioni | OPS-T08 |
| 15 | COL-T01 | Collaudo della fase 0 (`specs/09-collaudo.md`) | OPS-T08, cioè tutti i compiti di joo |

FON-T07a comincia subito, insieme a FON-T01. DOM-T01 e OPS-T03 lo seguono, mentre joo fa FON-T03 e FON-T06: nessuno dei tre usa il codice. Se uno di questi compiti si chiude prima che FON-T01 sia su `main`, i controlli `pnpm` non esistono ancora: `/chiudi-compito` lo dice e lo scrive nella pull request.

### Calendario indicativo

Simulato dal collaudo degli hook, con ogni compito lungo un turno:

```text
turno   joo                          yoo
0       FON-T01                      FON-T07a
1       FON-T03                      DOM-T01
2       FON-T06                      OPS-T03
3       FON-T10                      DOM-T02
4       NEG-T01                      OPS-T01a
5       NEG-T02                      FON-T07b
6       NEG-T05                      NEG-T04
7       NEG-T09                      (attesa)
8       ACC-T01                      FON-T08
9-10    ACC-T03, ACC-T04             (attesa)
11      ACC-T05                      BIL-T01
12-16   ACC-T06 … MOD-T02            (attesa)
17      BIL-T02                      MOD-T03
18      BIL-T05                      OPS-T01b
19-22   BIL-T06 … BIL-T11            (attesa)
23      ADM-T03                      OPS-T04
24      OPS-T08                      OPS-T09
25      —                            OPS-T11
26      —                            COL-T01
```

joo non aspetta mai, **se yoo consegna in tempo i sei compiti che joo attende**: DOM-T01, NEG-T04, FON-T08, BIL-T01, MOD-T03, OPS-T04. L'ordine della corsia di yoo è fisso, e `INIZIA` lo impone: yoo li consegna in tempo se tra un compito e l'altro non lascia pause. yoo invece ha circa 12 turni di attesa: si riempiono con il lavoro della sezione «Quando aspetti».

## Perché le postazioni non si sovrappongono

1. **Un compito, una postazione.** La tabella delle corsie assegna ogni compito una volta sola. `INIZIA` di un compito dell'altra postazione viene rifiutato dall'hook.
2. **Si parte sempre da `main`.** `INIZIA` controlla su `origin/main` che i compiti precedenti della corsia e i prerequisiti siano spuntati, cioè che la pull request sia unita. Il ramo del compito nasce da `origin/main` appena aggiornato.
3. **Il database ha un solo proprietario: joo.** Migrazioni (`drizzle/`), elenco dei permessi e fixture (`src/server/db/isolation/`) li scrive solo joo. Due postazioni che generano migrazioni insieme produrrebbero due migrazioni con lo stesso numero e istantanee dello schema incoerenti. Se un compito di yoo scopre che gli serve una migrazione, si ferma e lo dice all'utente: quella parte passa a joo.
4. **I file esistenti dell'altra corsia non si modificano; si aggiungono file nuovi.** Dove un compito deve per forza toccare file dell'altra corsia, è un'eccezione pianificata, elencata qui sotto e protetta dai prerequisiti: nello stesso momento nessun compito dell'altra postazione tocca quei file. Se serve una modifica non prevista, Claude si ferma: diventa una correzione dell'altra postazione.
5. **Una pull request di compito alla volta, e prima ci si allinea.** Prima di chiedere `APPROVO` in fase codice, e di nuovo in chiusura, il ramo si allinea all'ultimo `main` e i controlli si rilanciano. `/chiudi-compito` non apre una pull request se ce n'è già una aperta di un compito dell'altra postazione.
6. **Regole di struttura** che tolgono di mezzo i file contesi (vedi sotto).
7. **Fuori da git**, il server di test e Stripe hanno regole proprie (sezioni qui sotto). I segreti non viaggiano mai su git, nello zip o in chat: si passano con il gestore di password (OPS-009). I segreti di GitHub e i file di ambiente dei server li scrive l'utente.

### Proprietà dei file

| Di joo | Di yoo |
|---|---|
| `drizzle/`, `src/server/db/` (compresi `isolation/`, elenco dei permessi e fixture) | `infra/`, `Dockerfile` e `.github/`, dopo FON-T06, che li crea (`infra/README.md` da FON-T07a; compreso `dependabot.yml`) |
| `src/server/auth/`, `billing/`, `jobs/`, `email/`, `audit/`, `secrets/`, `invoicing/`, `exports/`, `storage/` | `src/proxy.ts` (da NEG-T04) |
| `src/app/x-*` (le cartelle vuote le crea NEG-T04, poi sono di joo), `src/app/api/` (tranne le route qui a destra), il layout radice `src/app/layout.tsx`, `next.config.*` | `src/app/api/health/echo-headers/`, `src/app/api/health/deep/` |
| `src/modules/`, `src/config/env.ts` (condiviso, vedi sotto), `src/config/platform.ts` (una riga per chiave, vedi sotto), `src/config/terms.ts` | `src/server/ops/` (tranne `cert.ts`, che è di ADM-T07), `src/lib/sentry-*`, `src/config/plans.ts` (BIL-T01; joo lo legge), `src/config/subprocessors.ts` |
| Configurazioni di ESLint, Vitest, TypeScript, `tsup.config.ts` | — |
| `tests/` dei propri compiti | `tests/` dei propri compiti, `infra/scripts/check-*` (i due di FON-T03, `check-fresh-clone.sh` e `check-roles-no-createdb.sh`, li crea joo; dopo FON-T06 tutta `infra/` è di yoo) |
| In `docs/`: i file dei propri compiti (`docs/verifiche/<id>.md`, `docs/verifiche/<id>-esito.md`, `docs/verifiche-anticipate/<id>.md`) | In `docs/`: i file dei propri compiti, più `docs/collaudo/`, `docs/legale/` (OPS-T11) e `docs/verifiche/ripristino-mensile.md` (OPS-T01b) |

I file dei comandi del CLI (`src/cli/commands/<nome>.ts`) sono del compito che scrive quel comando, anche se il segnaposto lo crea FON-T06. **Tutto ciò che non compare in tabella è di joo.** I file del metodo (`.claude/`, `CLAUDE.md`, `AVVIO.md`, `docs/metodo.md`, questa pagina) non sono di nessuna delle due: li cambia l'utente. `/revisione` elenca i file modificati che non appartengono alla postazione del compito e non sono nelle sue eccezioni; i file di `docs/` dei compiti precedenti della stessa postazione, che partono con il commit successivo, non contano.

**Condivisi**, solo con aggiunte piccole e sempre dopo l'allineamento:
- `package.json` e `pnpm-lock.yaml`;
- `src/config/env.ts` e gli esempi delle variabili (`.env.*.example`, `infra/env.example/`);
- `playwright.config.*`, `tests/fixtures/stripe.ts` (lo crea BIL-T01);
- `src/worker.ts` e `src/instrumentation.ts`: le righe di Sentry le aggiunge OPS-T04 (vedi le eccezioni pianificate);
- le caselle e le note in `specs/`.

Su `pnpm-lock.yaml` un conflitto si risolve rigenerandolo con `pnpm install`.

**Eccezioni pianificate:**

- **NEG-T04** (yoo) tocca la configurazione di Playwright, crea i suoi negozi di prova con un aiuto proprio in `tests/e2e/`, idempotente e con pulizia finale (non riusa `src/server/db/isolation/fixtures.ts`, che joo sta scrivendo), e usa `resolveHost()`, che NEG-T02 crea in `src/server/db/`. Intanto joo può essere su NEG-T05 o NEG-T09, che non toccano questi file; ACC-T01 aspetta NEG-T04.
- **FON-T07b e FON-T08** (yoo) completano gli esempi delle variabili creati da joo. FON-T01 crea schemi ed esempi con tutte le variabili della tabella di 01 §Variabili d'ambiente, tranne tre che nascono più tardi: `EMAIL_PROVIDER` (FON-T10, che FON-T07b aspetta), `AUTH_RATE_LIMIT_TEST_ALLOW_IP` (ACC-T04, che aspetta FON-T08) e le variabili SDI dell'app (BIL-T11, molto dopo). Così, mentre yoo completa gli esempi, nessun compito di joo vi aggiunge righe.
- **I compiti di joo con una procedura manuale** la scrivono nella propria sezione di `infra/README.md`, preparata da FON-T07a, senza righe in comune con yoo. Sono ACC-T04 (`admin:reset-2fa`), NEG-T09 (rotazione di `SHOP_SECRETS_KEY`), BIL-T02 e BIL-T11 (impostazioni del Dashboard Stripe).
- **BIL-T01** (yoo):
  - aggiunge la dipendenza `stripe` e crea il client Stripe con la versione API fissata (`src/server/billing/stripe-client.ts`);
  - espone `seedStripe(stripe, plans)`, che BIL-T05 riusa nei suoi test senza toccare il comando;
  - dopo l'unione, questi file sono di joo;
  - aspetta ACC-T04, che aggiunge `ua-parser-js` (03, ACC-005): dopo ACC-T04 i compiti di joo non prevedono nuove dipendenze fino a BIL-T09, e BIL-T02, il primo che usa `stripe`, aspetta BIL-T01.
- **OPS-T09** (yoo) tocca `src/proxy.ts`, il Caddyfile, `.github/`, i propri test e, del layout radice, solo il nonce sugli script. Viene dopo OPS-T04, così la CSP ammette l'host vero di Sentry; intanto joo fa ADM-T03 o OPS-T08, che non toccano questi file. Un difetto che il suo e2e trova nei cookie (`src/server/auth/`) o in altre pagine non lo corregge: diventa una correzione di joo. Lo stesso per una vulnerabilità segnalata da `pnpm audit` (sezione «Pull request automatiche delle dipendenze»).
- **MOD-T03** (yoo) tocca il layout e il menu del gestionale, le funzioni di accesso ai moduli in `src/modules/` e `tests/architecture/access-boundary.test.ts`. joo intanto fa BIL-T02 e BIL-T05, che non li toccano, e BIL-T06 aspetta MOD-T03.
- **OPS-T04** (yoo) tocca questi file:
  - aggiunge un file nuovo in `src/server/db/` per le letture del controllo approfondito;
  - mette Sentry in `src/worker.ts`, `src/instrumentation.ts`, `next.config.*` e nel layout radice, con le sole modifiche che servono a Sentry, elencate nella pull request;
  - scrive il valore di `sentryProjectUrl` in `src/config/platform.ts`, solo quella riga.

  joo intanto fa ADM-T03, che non li tocca, e OPS-T08 aspetta OPS-T04.
- **OPS-T11** (yoo) completa `requireShopAccess`, il test di architettura, `src/config/terms.ts` e le pagine d'invito. Arriva dopo l'ultimo compito di joo. Quando accende il controllo delle condizioni (OPS-048: senza un'accettazione della versione corrente le API di un negozio rispondono 403 `TERMS_REQUIRED`), i test di joo che aprono un negozio diventerebbero rossi: OPS-T11 aggiorna, nella sua fase test, gli aiuti di test e le fixture di joo che creano titolari e negozi, perché scrivano l'accettazione della versione corrente letta da `src/config/terms.ts`, e li elenca nella pull request. Per questo ACC-T06 (joo), che crea `terms_acceptances`, raccoglie in un aiuto di test unico la creazione del titolare con la sua accettazione.

### Regole di struttura

Fanno parte dei compiti indicati (`specs/README.md`, «Esecuzione su due postazioni»).

- **FON-T01 (joo):**
  - `src/config/platform.ts` nasce con tutte le chiavi citate nelle specifiche e i loro valori iniziali; dopo, ogni compito cambia solo la riga della propria chiave;
  - `src/config/env.ts` e gli esempi nascono con tutte le variabili di 01 §Variabili d'ambiente, tranne `EMAIL_PROVIDER` (FON-T10), `AUTH_RATE_LIMIT_TEST_ALLOW_IP` (ACC-T04) e le variabili SDI dell'app (BIL-T11);
  - la configurazione dei controlli (tsconfig, Vitest, Playwright, ESLint, `ci.yml`, script dei controlli in `package.json`) si scrive nella fase test, perché dopo resta ferma come i test (`CLAUDE.md`, sezione 1);
  - FON-T01 non crea `infra/README.md`, che nasce in FON-T07a, e non fa il commit iniziale: il repository parte già dal commit «Specifiche e metodo».
- **FON-T07a (yoo):** la prova del `docker pull` di un'immagine privata del repository si fa con un'immagine di prova pubblicata a mano su GHCR (per esempio `gestionale-negozi-prova`) e cancellata dopo la prova: a quel punto non esiste ancora nessuna immagine del progetto.
- **FON-T06 (joo): un file per comando del CLI.** `src/cli.ts` elenca da subito tutti i comandi previsti dalle specifiche. Ognuno punta al proprio file `src/cli/commands/<nome>.ts`, creato come segnaposto che termina con il codice 64 («non ancora disponibile»). Dopo, ogni compito modifica solo il file del proprio comando, mai l'elenco. La regola ESLint sul client del proprietario ammette anche `src/cli/commands/**`. I comandi li scrivono otto compiti delle due postazioni: ACC-T04, ADM-T01, ADM-T03, BIL-T01, BIL-T07, BIL-T09, OPS-T01b, OPS-T04.
- **FON-T07a (yoo): `infra/README.md` a sezioni.** Il file nasce con una sezione per ogni procedura citata nelle specifiche e, dove contribuiscono più compiti, una sottosezione per compito, con il suo ID nel titolo. Esempi: impostazioni del Dashboard Stripe per BIL-T01, BIL-T02 e BIL-T11; rotazione dei segreti per NEG-T09 e OPS-T11; i file di ambiente dei server, che scrive l'utente. Ogni compito scrive solo nella sua.
- **FON-T10 (joo):**
  - i lavori in background si registrano in `src/server/jobs/` (un file per lavoro e un registro), non in `src/worker.ts`, che resta corto: avvio, `ensureQueues()`, registrazione, arresto;
  - il [VERIFICA] su Brevo lo annota soltanto: un'eventuale modifica del matcher nel Caddyfile la fa FON-T07b, che aspetta FON-T10 e aggiorna comunque `CADDY_TAG`;
  - il controllo manuale dei record DNS e l'email di prova si fanno da joo, in locale, con la chiave Brevo vera. Non serve il server.
- **FON-T07b (yoo):** scrive nella sua sezione di `infra/README.md` la procedura del webhook dei rimbalzi dei due server (`/api/webhooks/email?k=…`, FON-011). L'utente mette `EMAIL_WEBHOOK_TOKEN` in `app.env` e l'indirizzo del webhook nel pannello di Brevo, perché il token è un segreto. Serve alla prova C27 del collaudo.
- **NEG-T02 (joo):** crea in `src/server/db/` il wrapper `resolveHost()` di `resolve_host`, che il proxy di NEG-T04 usa.
- **OPS-T01a (yoo):** l'immagine PostgreSQL deve partire anche in sviluppo senza le variabili `PGBACKREST_*`, perché joo la usa ogni giorno con `compose.dev.yml`. È una prova in più del compito.
- **FON-T08 (yoo):** i flussi di rilascio, `deploy.sh` e `/srv/app/dc` seguono la sezione «Il server di test condiviso». Il nome di progetto `app-dev` in `compose.dev.yml` fa ricreare a joo i volumi locali una volta: va detto nella pull request. La prova con `KNOWN_HOSTS` sbagliato si fa con un segreto di prova separato, mai alterando quello vero. La pull request di prova di FON-005 sta su un ramo `prova-*`, creato dal ramo del compito in fase codice (`git switch -c prova-<nome>`, dove i commit sono permessi), e si chiude subito dopo la verifica.
- **OPS-T09 (yoo):** gli aggiornamenti automatici delle dipendenze riguardano solo npm e GitHub Actions (non le immagini Docker, che cambiano solo con un compito), sono raggruppati, con `open-pull-requests-limit: 1`; gli aggiornamenti di sicurezza stanno in un gruppo a parte (`applies-to: security-updates`), perché GitHub non applica a loro quel limite.
- **Registro delle approvazioni: un file per postazione**, `registro/compiti-yoo.log` e `registro/compiti-joo.log`. Così le unioni non si scontrano mai sul registro. Sta fuori da `.claude/` perché git, che gira nella sandbox, deve poter unire quello dell'altra postazione.

## Protezione del metodo

Un filtro che legge il testo dei comandi si può sempre aggirare con una forma nuova. Per questo gli hook sono la guida, non il muro: il muro è la sandbox, e dietro ci sono i controlli sul contenuto e GitHub. Tutto è configurato in `.claude/settings.json`.

1. **La sandbox di Claude Code** (Linux, con bubblewrap). I comandi di Claude, git compreso, girano isolati.
   - Scrivono solo nella cartella del progetto, nella cartella temporanea e nelle cache di pnpm (`~/.local/share/pnpm/store`, `~/.cache/pnpm`, `~/.local/state/pnpm`).
   - Nel progetto non toccano i file del metodo: `.claude/`, `CLAUDE.md`, `CLAUDE.local.md`, `.mcp.json`, `AVVIO.md`, `docs/metodo.md`, questa pagina. La sandbox protegge da sé anche la configurazione e gli hook di git (`.git/config`, `.git/hooks`), `.vscode` e i file di avvio della shell.
   - Non leggono i file di ambiente veri (`.env`, `.env.local`, `.env.app`, `.env.worker`, `.env.migrate`, `.env.test`, `.env.test.owner` e le varianti di Next.js, ovunque nel progetto, e i `*.env` delle cartelle `env/`). I divieti `Read(...)` delle impostazioni valgono per gli strumenti di Claude, e Claude Code li aggiunge alla sandbox: così valgono anche per `grep -r` e per ogni programma lanciato da un comando. Gli esempi (`*.example`, `infra/env.example/`) restano leggibili.
   - Non possono uscire dalla sandbox (`allowUnsandboxedCommands: false`). Se la sandbox manca, Claude Code non parte (`failIfUnavailable: true`).
   - La rete è chiusa, tranne GitHub, il registro di npm, Stripe e Brevo: per un dominio nuovo Claude Code ti chiede il permesso. Il traffico che non è TCP (`dig`, `ping`) non esce; `localhost` è privato; i socket di sistema (Docker compreso) non si aprono.
2. **I comandi che girano fuori dalla sandbox** (`excludedCommands`) sono pochi e scritti in una forma sola, da soli nella riga: Claude Code li lascia fuori solo se ogni pezzo della riga corrisponde, e l'hook rifiuta variabili, `$(…)`, heredoc senza apici e comandi in più.
   - **Docker**: un container può tutto, per questo l'hook controlla i volumi (anche nei file compose, con `docker compose config`), le opzioni che danno accesso al computer (`--privileged`, `--cap-add`, `--device`, la rete o i processi dell'host), il socket di Docker e le uscite su file.
   - **`ssh`, `scp`, `rsync`**: solo verso `test` e `prod`, solo con le opzioni di un elenco (niente `-F`, `-o` con altre chiavi, `-S`, `-e` diverso da `ssh`), e niente file di ambiente dei server nel comando. `sftp` non si usa.
   - **La gabbia**, `bash .claude/hooks/gabbia.sh <comando>`: test di integrazione, end-to-end, server di sviluppo, worker, migrazioni, CLI. Girano fuori dalla sandbox perché lì il database non si raggiunge, ma dentro una gabbia di bubblewrap: rete e progetto liberi, file del metodo, `.git`, registro e resto del computer in sola lettura, niente chiavi SSH, credenziali di GitHub, Docker e portachiavi. Nella stessa gabbia gli hook eseguono i controlli dello Stop (lint, typecheck, test).
3. **I divieti delle impostazioni.** Lo strumento Monitor e PowerShell sono vietati. Con Edit e Write non si scrive nei file del metodo, nelle impostazioni e nelle istruzioni dell'utente, nella cartella di stato. Ogni comando verso il server `prod` chiede conferma all'utente.
4. **Gli hook**, che si fermano se si rompono (`onFailure: block`, da Claude Code v2.1.295; lo Stop non lo prevede, e lascia passare). `bash-guard.sh` scompone ogni comando come lo legge la shell, comprese le sostituzioni, e ne controlla scritture, git, gh, server e Docker. Le operazioni di git che cambierebbero i file del metodo (un ramo o un `main` con hook nuovi) le ferma prima che partano: le esegue l'utente nel suo terminale.
5. **I controlli sul contenuto**, che si accorgono di una modifica qualunque comando l'abbia fatta:
   - alla fine della fase test gli hook salvano l'impronta dei test, delle liste di controllo e della configurazione dei controlli. Se uno di questi cambia dopo, `APPROVO` e il commit si fermano e dicono quale; non conta un file arrivato identico da `main` con l'allineamento;
   - a ogni parola chiave gli hook confrontano con il commit i file del metodo, cercano file nuovi che istruiscono Claude Code (`CLAUDE.local.md`, un `CLAUDE.md` in una sottocartella, `.mcp.json`) e controllano che `.claude/settings.local.json` contenga solo approvazioni. Se qualcosa non torna, nessuna fase avanza;
   - controllano che il registro coincida con la copia tenuta dagli hook, e che la cartella `.git` sia ancora quella registrata con `imposta-postazione.sh`.
6. **GitHub.** Con la protezione di `main` (nessuna spinta diretta, pull request obbligatoria con la CI verde) e un'identità per Claude che non può unire, nulla arriva su `main` senza che l'utente unisca la pull request, e la CI rifà tutti i controlli da zero su un computer pulito. La pull request mostra ogni file cambiato. Queste impostazioni si fanno nella parte sul collegamento a GitHub, **prima di iniziare i compiti**: finché mancano, contro una spinta su `main` fatta da un programma scritto apposta non c'è un muro, solo gli hook.

**Fase, postazione e copia del registro** stanno fuori dal progetto, in `~/.local/state/gestionale-negozi/<progetto>/`, dove i comandi nella sandbox e nella gabbia non possono scrivere. Il nome della postazione lo scrive l'utente con `imposta-postazione.sh`, dal suo terminale.

## Il server di test condiviso

Da FON-T08 ogni unione su `main`, di joo o di yoo, arriva da sola sul server di test. Per questo FON-T08 prevede:

1. **Un'operazione alla volta sul server.** `deploy.sh`, gli script dei timer (backup, copia specchio, metriche) e `/srv/app/dc` usano lo stesso blocco con `flock -w`, così un rilascio aspetta la fine di un backup e viceversa. Il blocco lo prende il processo più esterno, che poi chiama `/srv/app/dc` con `DC_LOCKED=1`: `dc` lo prende da sé solo quando la variabile non c'è, altrimenti aspetterebbe il blocco del processo che l'ha lanciato. `dc` prende il blocco solo per i comandi che cambiano i servizi (`up`, `down`, `pull`, `run`, `restart`, `stop`, `rm`, `create`): con `logs`, `ps`, `exec` e `config` no, così un `logs -f` o uno `psql` aperto (collaudo C26) non fanno scadere un rilascio in attesa. `deploy.sh` scrive `infra/` e `.env` in modo atomico (cartella temporanea, poi `mv`). Tra i test di FON-T08: un rilascio lanciato durante un backup aspetta, e un `deploy.sh` completo non si ferma sul proprio blocco.
2. **Un rilascio alla volta su GitHub.** La costruzione dell'immagine sta fuori dai gruppi di concorrenza, così ogni SHA unito ha la sua immagine. Il rilascio usa due gruppi separati, `deploy-test` e `deploy-prod`, senza annullare quello in corso: un rilascio in produzione in attesa di approvazione non ferma il server di test.
3. **Il fermo dei rilasci.** C'è una variabile del repository, `TEST_DEPLOY_HOLD`.
   - È attivo quando vale `1`. È la condizione `if:` del job di rilascio sul server di test, non un passo dentro il job, e vale solo per i rilasci automatici (unione su `main`): l'avvio a mano non la guarda, altrimenti con il fermo attivo salterebbe anche lui. Con il fermo attivo il flusso costruisce e pubblica l'immagine, ma il job di rilascio viene saltato: non entra nel gruppo di concorrenza, e quindi non può annullare un rilascio a mano in attesa. L'immagine non riceve il tag `tested-`.
   - Il fermo lo toglie chi l'ha attivato: yoo dentro il suo compito, l'utente quando l'ha attivato lui per modificare i file di ambiente. `/stato` e `CHIUSO` avvisano se è ancora attivo.
   - Un avvio a mano (`workflow_dispatch`) mette sul server di test l'immagine di uno SHA scelto, anche di un ramo. Per uno SHA che non è su `main`, l'avvio costruisce le immagini Caddy e PostgreSQL i cui file differiscono da `main`, con il tag `<tag>-<sha7>`, e prima di costruire l'immagine dell'app scrive quei tag in `infra/versions.env`, solo nella copia del job: così `deploy.sh`, che riceve solo lo SHA, li legge dall'immagine. Un avvio a mano su uno SHA di un ramo non dà mai il tag `tested-`. I tag ufficiali di `infra/versions.env` li pubblica soltanto `main`.
4. **Il controllo delle variabili.** Prima di `pull` e `migrate`, `deploy.sh` confronta i nomi delle variabili dei cinque file dei servizi in `/srv/app/env/` (`app`, `worker`, `migrate`, `postgres`, `caddy`) con quelli di `infra/env.example/` dell'immagine.
   - Se ne manca uno si ferma e lo nomina, senza stampare valori.
   - Le variabili facoltative sono segnate negli esempi con `# facoltativa` e non si controllano.
   - Le variabili che non devono mai stare in un file di ambiente (`STRIPE_LIVE_SECRET_KEY`, `ROLES_ALLOW_CREATEDB`) non si chiedono mai.
   - I file di un solo server, come `backup-mirror.env`, restano fuori dal confronto.

Le regole:

- **Quando yoo lavora sul server di test** dentro un compito, da FON-T08 in poi: FON-T08 stesso, BIL-T01 (dopo l'unione), OPS-T01b, OPS-T04, OPS-T09 (Caddyfile) e COL-T01.
  - Attiva il fermo solo quando non c'è un rilascio in corso.
  - Allinea il ramo a `main`, fa un commit e spinge il ramo (dalla fase codice i commit sul ramo del compito sono permessi; la pull request si apre solo in chiusura), mette sul server l'immagine del suo ramo con l'avvio a mano e fa le sue prove.
  - In `docs/verifiche/<id>-esito.md` scrive quali prove ha fatto con il fermo attivo e quali restano da fare dopo l'unione.
  - Toglie il fermo solo **dopo** l'unione, poi rilancia il rilascio di `main`. Toglierlo prima farebbe sparire dal server gli script e i timer del ramo.
  - Se l'utente scrive `ABBANDONA` con il fermo attivo, prima si toglie il fermo e si rilancia il rilascio di `main` (lo fa Claude prima della parola chiave, o l'utente dal sito di GitHub): altrimenti i rilasci di joo restano fermi.
- **Prima di FON-T08** non ci sono rilasci automatici: FON-T07b lavora tutto a mano, come dice la sua specifica.
- **I rilasci in produzione** (tag `v*`) li decide e li crea l'utente.
- **Prove in produzione.** Alcuni compiti hanno una parte da provare sul server di produzione: FON-T08 (FON-007, il primo rilascio `v*` con l'approvazione), BIL-T01 (la sandbox Stripe di produzione), OPS-T01b (OPS-004 e OPS-008), OPS-T04 (il timer `host-metrics` e il controllo esterno).
  - Dopo l'unione: se il fermo è attivo, yoo lo toglie e rilancia il rilascio di `main`. Quando lo SHA di `main` ha il tag `tested-` (il rilascio sul server di test è riuscito), l'utente crea il rilascio `v*`: prima `deploy-prod.yml` fallirebbe.
  - Il compito resta in fase chiusura, fa la parte in produzione e ne scrive l'esito in `docs/verifiche/<id>-esito.md`. Solo dopo l'utente scrive `CHIUSO`. La casella su `main` è già spuntata dall'unione, ma la postazione non inizia un altro compito finché questo non è chiuso.
  - Se la prova in produzione fallisce, l'utente scrive `TORNA AL CODICE`: Claude ricrea il ramo del compito da `origin/main` (`git switch --no-track -C <id> origin/main`), corregge, e la chiusura apre una nuova pull request. L'hook accetterebbe già `CHIUSO`, perché la casella è su `main`: sei tu a scriverlo solo quando la correzione è unita e la prova riesce.
  - Il collaudo intero è COL-T01.
- **Operazioni sui server dopo l'unione.** Un compito che deve agire sul server dopo l'unione lo fa prima di `CHIUSO`: in chiusura i comandi verso i server sono ancora permessi. È il caso di FON-T08 (FON-006: dopo l'unione il server di test riporta lo SHA in `/api/health` entro 15 minuti) e di BIL-T01, che fa lo `stripe:seed` sul server di test con l'immagine di `main` appena rilasciata. L'esito va in `docs/verifiche/<id>-esito.md`: un file nuovo o modificato, che parte con il commit del compito successivo della stessa postazione.
- **Variabili e valori dei server.** Tutti i file di `/srv/app/env/` (i file di ambiente, ma anche `backup-mirror.known_hosts` e le chiavi) li scrive e li controlla l'utente, seguendo la procedura del compito in `infra/README.md`: contengono segreti o stanno con loro, e gli hook impediscono a Claude di nominarli.
  - Un compito che aggiunge una variabile d'ambiente, o che richiede di sostituire un valore segnaposto sui server (per esempio le variabili SDI di BIL-T11), lo scrive nella pull request, e l'utente scrive il valore prima dell'unione.
  - Un valore che nasce dopo l'unione, come `STRIPE_PORTAL_CONFIGURATION_ID` stampato da `stripe:seed` o il segreto dei webhook di Stripe, l'utente lo scrive dopo l'unione, prima di `CHIUSO`.
  - Per non lasciare un file a metà mentre `deploy.sh` lo legge, si modifica una copia e poi la si sostituisce con `mv`, quando non c'è un rilascio in corso: sul server di test con il fermo attivo, che l'utente attiva e poi toglie.
  - Se ci si dimentica una variabile, è il controllo di `deploy.sh` a fermare il rilascio, indicando quale manca.
  - `/srv/app/.env` invece contiene solo i tag delle immagini: yoo lo scrive dentro un compito, con il fermo attivo.
- **Controlli di rete.** Dalla sandbox si raggiungono solo GitHub, npm, Stripe e Brevo. I controlli verso i domini del progetto (`curl`, `dig`, `nmap`, `k6`) Claude li esegue sul server, con `ssh test …` o `ssh prod …`, oppure li esegue l'utente dal suo terminale: per esempio `nmap` da una rete esterna (C13).
- **Un rilascio di joo che fallisce** per uno stato del server che joo non vede (per esempio un'app spenta da yoo per una prova) non è un errore del compito di joo: si guarda con yoo prima di toccare il codice.

## Stripe: una sandbox per postazione

Le specifiche vogliono una sandbox Stripe per ogni ambiente, ciascuna con il proprio endpoint webhook (05 §Lavoro `billing.sync`, passo 1). Con due computer gli ambienti di sviluppo sono due, quindi le sandbox sono quattro: **sviluppo-joo**, **sviluppo-yoo**, server di test, produzione. Ciascuna ha le sue chiavi, il suo `stripe listen` e il suo `STRIPE_PORTAL_CONFIGURATION_ID`. Così i test di una postazione non spostano i prezzi o le configurazioni del portale mentre girano quelli dell'altra.

Le sandbox dei due server le prepara yoo dentro BIL-T01, dopo l'unione e prima di `CHIUSO`: prima quella del server di test, poi quella di produzione, con il rilascio `v*` che l'utente crea quando `main` ha il tag `tested-` («Prove in produzione»). Per ciascuna:
- lo `stripe:seed`, il cui `STRIPE_PORTAL_CONFIGURATION_ID` l'utente scrive in `app.env`;
- gli endpoint dei webhook con l'elenco completo degli eventi di 05 §Endpoint, compresi `refund.updated` e `refund.failed`;
- le impostazioni del Dashboard (05 §Impostazioni da fare nel Dashboard Stripe).

`STRIPE_WEBHOOK_SECRET` lo scrive l'utente sui server. L'esito va in `docs/verifiche/bil-t01-esito.md`.

## Il giro di un compito

1. `/stato` dice il prossimo compito di questa postazione, oppure che cosa si aspetta e da chi.
2. L'utente scrive `INIZIA <ID>`. L'hook controlla corsia e prerequisiti su `origin/main`.
3. **Piano.** Primo passo: `git switch --no-track -c <id> origin/main` (l'hook ha già fatto `git fetch`), poi `pnpm install` se esiste `package.json`. Le sole modifiche ammesse in quel momento sono il registro di questa postazione e i file di `docs/` dei suoi compiti, nuovi o modificati (per esempio un esito scritto dopo l'unione), che partono con questo compito. Se `main` porta modifiche ai file del metodo, il comando lo esegue l'utente nel suo terminale. Poi la costituzione, questa pagina e l'area del compito.
4. **Test** e **codice**, come in `docs/metodo.md`. All'`APPROVO` che chiude la fase test gli hook salvano l'impronta dei test, delle liste di controllo e della configurazione dei controlli: da lì un cambiamento ferma `APPROVO` e il commit. Dalla fase codice si possono fare commit sul ramo del compito e spingerlo (serve per l'avvio a mano sul server di test e per i rami `prova-*`); la pull request si apre solo in chiusura. I comandi verso i server si usano solo dalla fase codice in poi.
5. **Allineamento, prima di chiedere `APPROVO` in fase codice.** `git fetch origin`; se `origin/main` è andato avanti: `git stash push -u` se ci sono modifiche, poi `git merge --ff-only origin/main` se il ramo non ha commit propri, oppure `git merge --no-edit origin/main` se li ha (succede dopo `TORNA AL CODICE`), poi `git stash pop`. Poi si risolvono i conflitti (il codice in questa fase si può correggere), `pnpm install` se sono cambiate le dipendenze, e si rilanciano lint, typecheck e test. Se il conflitto è in un test o nella configurazione dei controlli, ci si ferma: l'utente scrive `TORNA AI TEST`.
6. **Revisione** con `/revisione`.
7. **Chiusura** con `/chiudi-compito`. Controlla che non ci sia una pull request aperta di un compito dell'altra postazione, si riallinea, rifà i controlli, spunta la casella, fa il commit e apre la pull request.
8. **L'utente** guarda la pull request. Quando la CI è verde la unisce con «Squash and merge» (il ramo si cancella da solo). Se il compito ha prove sui server dopo l'unione, si fanno ora. Poi l'utente scrive `CHIUSO`: l'hook lo accetta solo quando il compito risulta su `main`. Se la CI è rossa: `TORNA AL CODICE`.

## Quando aspetti

Nessuno di questi lavori modifica codice o tocca i server: i file nuovi stanno in `docs/` (nei file di questa postazione, tabella «Proprietà dei file») e partono con il commit del compito successivo della stessa postazione.

**yoo** (circa 12 turni di attesa previsti):

- **Revisione incrociata** della pull request aperta da joo: in sola lettura (`gh pr diff <numero>`), con l'esito riferito all'utente in chat prima dell'unione. Su GitHub non si scrive nulla senza il suo ok.
- **Anticipo dei punti [VERIFICA] dei propri prossimi compiti**, per esempio le policy dei bucket Hetzner (OPS-T03) o `docker compose run -e` (OPS-T01b). L'esito va in `docs/verifiche-anticipate/<ID>.md`, e il piano del compito lo riporta nella specifica.
- **Preparazione del collaudo:** le liste di controllo delle prove di `specs/09-collaudo.md`, in `docs/collaudo/`; COL-T01 le porta in `docs/verifiche/col-t01.md`.

La manutenzione dei server (aggiornamenti, prova di ripristino mensile dopo OPS-T01b) la fa l'utente, oppure yoo dentro un compito aperto per quello.

**joo** (attese previste: nessuna). Se capita: anticipo dei [VERIFICA] dei propri prossimi compiti, in `docs/verifiche-anticipate/`, e revisione incrociata della pull request di yoo.

## Se qualcosa va storto

- **Conflitto durante l'allineamento in fase codice:** lo risolve Claude, poi rilancia i controlli. Su un test o sulla configurazione dei controlli ci si ferma e l'utente scrive `TORNA AI TEST`.
- **Conflitto durante la chiusura:** se riguarda solo `specs/` o `docs/` (per esempio due caselle vicine spuntate dalle due postazioni), Claude lo risolve tenendo entrambe le parti. Altrimenti l'utente scrive `TORNA AL CODICE`: l'unione resta aperta, Claude risolve il conflitto in fase codice e la conclude con `git commit --no-edit`; poi di nuovo revisione e chiusura.
- **CI rossa sulla pull request:** l'utente scrive `TORNA AL CODICE`. Il ramo ha già un commit: da qui ci si allinea con `git merge --no-edit origin/main`. Alla nuova chiusura `/chiudi-compito` aggiorna la stessa pull request.
- **`main` porta file del metodo nuovi** (l'utente ha cambiato hook, corsie o istruzioni): l'hook ferma il `git switch` o il `git merge` e indica il comando. Lo esegui tu nel tuo terminale, nella cartella del progetto; poi Claude riprende.
- **GitHub segnala un conflitto su una pull request** (succede solo se le due postazioni aprono la pull request nello stesso momento): unisci prima l'altra. Se il conflitto riguarda solo caselle o documenti, risolvilo dal sito di GitHub («Resolve conflicts») tenendo entrambe le parti; altrimenti risolvilo tu in VS Code, perché gli hook non bloccano l'utente.
- **Senza rete:** `INIZIA` e `CHIUSO` usano l'ultima copia nota di `origin/main` e lo dicono.
- **Un compito abbandonato** (`ABBANDONA`) blocca i compiti che lo seguono finché non viene rifatto e unito. Con il fermo dei rilasci attivo, prima si toglie il fermo (sezione «Il server di test condiviso»).
- **La CI di FON-T08 trova rosso un test di integrazione di joo** (la prima volta che `test:int` gira in CI, «Le prove di integrazione prima di FON-T08»): è una correzione di joo. joo la fa nel compito che ha aperto in quel momento, dichiarandola nella pull request (con `TORNA AI TEST`, se serve toccare il test); se quel compito è già in chiusura, nel successivo. FON-T08 si riallinea dopo l'unione di quella correzione.

## Compiti nuovi e cambi di corsia

Un compito nuovo si scrive prima nella specifica. Poi l'utente aggiunge una riga in `.claude/hooks/corsie.txt` (Claude non può): `ID|postazione|prerequisiti dell'altra postazione`, nel punto della corsia in cui va eseguito. La regola per scegliere: **se il compito cambia lo schema del database (migrazioni, permessi, elenco consentito, fixture di `src/server/db/isolation/`), è di joo**. Lo stesso vale per spostare un compito. La modifica conta per tutte e due le postazioni solo quando è su `main`.

Un compito di joo aggiunto dopo OPS-T08 (per esempio la correzione di un cookie trovata da OPS-T09, o di una dipendenza segnalata da `pnpm audit`) entra anche nei prerequisiti di OPS-T11 e di COL-T01: OPS-T11 tocca file di joo dando per scontato che joo abbia finito, e il collaudo deve trovare tutte le correzioni.

## Pull request automatiche delle dipendenze

Da OPS-T09 un aggiornamento automatico apre ogni settimana una pull request sulle dipendenze, raggruppata, una alla volta; gli aggiornamenti di sicurezza arrivano in un gruppo a parte. Non bloccano `/chiudi-compito`, che conta solo le pull request dei compiti. Uniscile solo quando non è aperta nessuna pull request di compito. Dopo l'unione, ciascuna postazione si allinea come al punto 5 del giro.

Prima di OPS-T09, attiva nelle impostazioni del repository su GitHub i «Dependabot security updates»: così una correzione di sicurezza arriva anche prima che OPS-T09 sia unito.

**Se `pnpm audit` diventa rosso** per una vulnerabilità nuova, estranea al compito, la pull request del compito resta ferma. La correzione non si fa dentro il compito:
- arriva dall'aggiornamento di sicurezza automatico, che l'utente unisce per primo; poi la pull request del compito si riallinea;
- se una versione corretta non esiste ancora, o se `pnpm audit` è già rosso quando OPS-T09 lo porta in CI, decide l'utente: per esempio un'eccezione dichiarata e datata nella configurazione di `pnpm audit`, e la correzione della versione in un compito di joo.

## Le prove di integrazione prima di FON-T08

Fino a FON-T08 la CI non esegue `pnpm test:int`. I compiti di joo che possono essere uniti prima (FON-T10, NEG-T01, NEG-T02, NEG-T05, NEG-T09, ACC-T01, ACC-T03) li eseguono in locale, in `/chiudi-compito`, nella gabbia, dove sono obbligatori per ogni compito che tocca il database. La pull request di FON-T08 fa girare l'intera serie sul `main` di quel momento: se un test di joo fallisce solo lì, lo corregge joo («Se qualcosa va storto»). Succedeva già con l'ordine originale per FON-T03 e i compiti successivi; qui riguarda anche le aree NEG e ACC.

## Limiti

- **Provato in simulazione, non su un Ubuntu vero.** Gli hook sono stati provati su Windows, con Git Bash, sia nella forma Windows sia in una simulazione del comportamento Linux. La sandbox, la gabbia e le regole delle impostazioni non si possono provare qui, perché esistono solo su Linux. Per questo la prima installazione su ogni computer comprende una prova (`AVVIO.md`, punto 6).
- **Gli hook controllano Claude, non l'utente.** Chi modifica i file a mano, o unisce una pull request senza CI, può rompere le regole.
- **Docker resta il punto più debole.** Un container ha i permessi di amministratore sul computer. Gli hook controllano volumi, file compose e opzioni pericolose, ma non tutto ciò che un'immagine può fare: i comandi Docker vanno guardati quando Claude Code ti chiede il permesso.
- **Il codice nella gabbia non tocca il metodo, ma il progetto sì, e legge i file di ambiente.** Un test o un file di configurazione scritto apposta può cambiare file del progetto mentre gira: lo vedi nelle differenze, e l'impronta scopre i test e la configurazione dei controlli cambiati. I file di ambiente servono ai test di integrazione e al server di sviluppo, quindi nella gabbia si leggono: un test scritto apposta potrebbe stamparne un valore. La CI su GitHub rifà comunque tutto da zero.
- **La cartella `.git` si scrive dalla sandbox**, tranne la configurazione e gli hook. Un programma scritto apposta potrebbe confondere la storia locale (per esempio spostare un ramo): i controlli degli hook che dipendono da `main` rifanno `git fetch`, e su GitHub non arriva nulla senza la tua unione.
- **GitHub vede Claude come te.** Le due postazioni usano il tuo account, e dalla sandbox GitHub è raggiungibile con le tue credenziali: l'hook impedisce a Claude di unire pull request, spingere su `main` o scrivere con l'API quando lo chiede con un comando, anche dentro `python -c` o `node -e`, ma un programma scritto apposta in un file potrebbe farlo lo stesso. Per questo, prima di iniziare i compiti, servono la protezione di `main` e un'identità separata per Claude, senza il permesso di unire: si decidono con il collegamento a GitHub.
- **Strumenti che riscrivono file.** Nella sandbox, un programma come `prettier --write`, `eslint --fix` o `vitest -u` può modificare file del progetto, compresi i test. Se tocca un test dopo la fase test, se ne accorge il controllo dell'impronta.
- **Due pull request nello stesso istante.** Il controllo «una pull request di compito alla volta» lo fa `/chiudi-compito` nel momento in cui apre la pull request. Se le due postazioni la aprono nello stesso istante, possono passare entrambe (vedi «Se qualcosa va storto»).
- **`main` su GitHub.** La protezione di `main` e le regole di unione si decidono con il collegamento a GitHub, prima di iniziare i compiti (vedi sopra).
