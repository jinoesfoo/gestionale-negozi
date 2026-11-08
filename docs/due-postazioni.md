# Due postazioni: yoo e joo

Il progetto si sviluppa su due computer Ubuntu, ciascuno con il suo ruolo. Questa pagina dice chi fa cosa, in che ordine, e perché le due postazioni non si pestano i piedi. Claude la legge prima di ogni piano (`CLAUDE.md`, sezione 6).

## In breve

- **joo fa l'applicazione e il database**: 25 compiti. È l'unica postazione che scrive migrazioni.
- **yoo fa i server e tutto quello che li circonda**: 14 compiti, poi il collaudo. Tre dei 14 sono compiti di codice che non toccano il database: NEG-T04, BIL-T01, MOD-T03.
- Ogni compito appartiene a una sola postazione. Gli hook lo fanno rispettare: `INIZIA` rifiuta un compito dell'altra postazione, e anche un compito i cui prerequisiti non sono ancora su `main`.
- Le due postazioni si parlano solo attraverso GitHub: un compito è «fatto» quando la sua pull request è unita su `main` e la sua casella risulta spuntata lì. Fuori da git condividono due cose, il server di test e gli account esterni, con le regole delle sezioni «Il server di test condiviso» e «Stripe».
- Stima: **26 turni invece di 39** (un turno è un compito; i compiti hanno durate diverse, il conto serve a vedere le attese).

## I ruoli

### joo: applicazione e database

Repository e strumenti, database, negozi e separazione dei dati, login e ruoli, pannello amministratore, moduli, abbonamenti e fattura elettronica, esportazione.

Account e chiavi che servono su joo: GitHub, Docker in locale, la **propria** sandbox Stripe di sviluppo (BIL-T02 e successivi), Brevo (prova di invio in FON-T10), sandbox del fornitore SDI (BIL-T11).

### yoo: server, rilasci e operatività

I due server Hostinger, DNS su Cloudflare, Caddy e certificati, archivi S3 e backup, CI e rilasci automatici, monitoraggio e Sentry, intestazioni di sicurezza, documenti e procedure, collaudo finale. Più tre compiti di codice senza migrazioni:
- **NEG-T04**, l'instradamento del proxy, vicino a Caddy e ai domini;
- **BIL-T01**, il listino e i prodotti Stripe;
- **MOD-T03**, il menu e il controllo dei moduli.

Account e chiavi che servono su yoo: Hostinger, chiavi SSH dei server, Cloudflare, Hetzner o Scaleway, Brevo, GitHub (pacchetti GHCR e segreti di Actions), Sentry, servizio di controllo esterno, la **propria** sandbox Stripe di sviluppo e quelle dei due server.

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
| 9 | BIL-T01 | Listino e prodotti Stripe | ACC-T03 |
| 10 | OPS-T09 | Intestazioni di sicurezza, controllo delle dipendenze | ACC-T04 (il cookie `__Host-known`) |
| 11 | MOD-T03 | Menu e controllo dei moduli | MOD-T02 |
| 12 | OPS-T01b | Registrazione dei backup, copia specchio | BIL-T02 (`ops:row-counts` conta anche `subscriptions`) |
| 13 | OPS-T04 | Controllo approfondito, metriche, Sentry | BIL-T11 |
| 14 | OPS-T11 | Documenti, procedure, condizioni | OPS-T08 |
| — | Collaudo | Prove di `specs/09-collaudo.md` | tutto |

Il lavoro sui server di FON-T07a, DOM-T01 e OPS-T03 comincia subito, insieme a FON-T01. Se uno di questi compiti si chiude prima che FON-T01 sia su `main`, i controlli `pnpm` non esistono ancora: `/chiudi-compito` lo dice e lo scrive nella pull request.

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
9       ACC-T03                      (attesa)
10      ACC-T04                      BIL-T01
11      ACC-T05                      OPS-T09
12-16   ACC-T06 … MOD-T02            (attesa)
17      BIL-T02                      MOD-T03
18      BIL-T05                      OPS-T01b
19-22   BIL-T06 … BIL-T11            (attesa)
23      ADM-T03                      OPS-T04
24      OPS-T08                      (attesa)
25      —                            OPS-T11
```

joo non aspetta mai, **se yoo consegna in tempo i sei compiti che joo attende**: DOM-T01, NEG-T04, FON-T08, BIL-T01, MOD-T03, OPS-T04. Per yoo questi vengono prima di tutto il resto. yoo invece ha circa 12 turni di attesa: si riempiono con il lavoro della sezione «Quando aspetti».

## Perché le postazioni non si sovrappongono

1. **Un compito, una postazione.** La tabella delle corsie assegna ogni compito una volta sola. `INIZIA` di un compito dell'altra postazione viene rifiutato dall'hook.
2. **Si parte sempre da `main`.** `INIZIA` controlla su `origin/main` che i compiti precedenti della corsia e i prerequisiti siano spuntati, cioè che la pull request sia unita. Il ramo del compito nasce da `origin/main` appena aggiornato.
3. **Il database ha un solo proprietario: joo.** Migrazioni (`drizzle/`), elenco dei permessi e fixture (`src/server/db/isolation/`) li scrive solo joo. Due postazioni che generano migrazioni insieme produrrebbero due migrazioni con lo stesso numero e istantanee dello schema incoerenti. Se un compito di yoo scopre che gli serve una migrazione, si ferma e lo dice all'utente: quella parte passa a joo.
4. **I file esistenti dell'altra corsia non si modificano; si aggiungono file nuovi.** Dove un compito deve per forza toccare file dell'altra corsia, è un'eccezione pianificata, elencata qui sotto e protetta dai prerequisiti: nello stesso momento nessun compito dell'altra postazione tocca quei file. Se serve una modifica non prevista, Claude si ferma: diventa una correzione dell'altra postazione.
5. **Una pull request di compito alla volta, e prima ci si allinea.** Prima di chiedere `APPROVO` in fase codice, e di nuovo in chiusura, il ramo si allinea all'ultimo `main` e i controlli si rilanciano. `/chiudi-compito` non apre una pull request se ce n'è già una aperta di un compito dell'altra postazione.
6. **Regole di struttura** che tolgono di mezzo i file contesi (vedi sotto).
7. **Fuori da git**, il server di test e Stripe hanno regole proprie (sezioni qui sotto). I segreti non viaggiano mai su git, nello zip o in chat: si passano con il gestore di password (OPS-009). I segreti di GitHub li scrive l'utente.

### Proprietà dei file

| Di joo | Di yoo |
|---|---|
| `drizzle/`, `src/server/db/` (compresi `isolation/`, elenco dei permessi e fixture) | `infra/` (dopo FON-T06; `infra/README.md` da FON-T07a), `Dockerfile`, `.github/` (dopo FON-T06, compreso `dependabot.yml`) |
| `src/server/auth/`, `billing/`, `jobs/`, `email/`, `audit/`, `secrets/`, `invoicing/`, `exports/`, `storage/` | `src/proxy.ts` (da NEG-T04) |
| `src/app/x-*` (le cartelle vuote le crea NEG-T04, poi sono di joo), `src/app/api/` (tranne le route qui a destra), il layout radice `src/app/layout.tsx`, `next.config.*` | `src/app/api/health/echo-headers/`, `src/app/api/health/deep/` |
| `src/modules/`, `src/config/env.ts` (condiviso, vedi sotto), `src/config/platform.ts` (una riga per chiave, vedi sotto), `src/config/terms.ts` | `src/server/ops/` (tranne `cert.ts`, che è di ADM-T07), `src/lib/sentry-*`, `src/config/plans.ts` (BIL-T01; joo lo legge), `src/config/subprocessors.ts` |
| Configurazioni di ESLint, Vitest, TypeScript, `tsup.config.ts` | — |
| `tests/` dei propri compiti | `tests/` dei propri compiti, `infra/scripts/check-*` |

I file dei comandi del CLI (`src/cli/commands/<nome>.ts`) sono del compito che scrive quel comando, anche se il segnaposto lo crea FON-T06.

**Condivisi**, solo con aggiunte piccole e sempre dopo l'allineamento:
- `package.json` e `pnpm-lock.yaml`;
- `src/config/env.ts` e gli esempi delle variabili (`.env.*.example`, `infra/env.example/`);
- `playwright.config.*`, `tests/fixtures/stripe.ts` (lo crea BIL-T01);
- `src/worker.ts` e `src/instrumentation.ts` (una riga ciascuno per Sentry in OPS-T04);
- le caselle e le note in `specs/`.

Su `pnpm-lock.yaml` un conflitto si risolve rigenerandolo con `pnpm install`.

**Eccezioni pianificate:**

- **NEG-T04** (yoo) tocca la configurazione di Playwright, crea i suoi negozi di prova con un aiuto proprio in `tests/e2e/`, idempotente e con pulizia finale (non riusa `src/server/db/isolation/fixtures.ts`, che joo sta scrivendo), e usa `resolveHost()`, che NEG-T02 crea in `src/server/db/`. Intanto joo può essere su NEG-T05 o NEG-T09, che non toccano questi file; ACC-T01 aspetta NEG-T04.
- **FON-T07b e FON-T08** (yoo) completano gli esempi delle variabili creati da joo. FON-T07b aspetta FON-T10 e FON-T08 aspetta NEG-T09: i compiti di joo che aggiungono variabili sono già uniti. ACC-T04, che ne aggiunge una, aspetta FON-T08.
- **I compiti di joo con una procedura manuale** la scrivono nella propria sezione di `infra/README.md`, preparata da FON-T07a, senza righe in comune con yoo. Sono ACC-T04 (`admin:reset-2fa`), NEG-T09 (rotazione di `SHOP_SECRETS_KEY`), BIL-T02 e BIL-T11 (impostazioni del Dashboard Stripe).
- **BIL-T01** (yoo):
  - aggiunge la dipendenza `stripe` e crea il client Stripe con la versione API fissata (`src/server/billing/stripe-client.ts`);
  - espone `seedStripe(stripe, plans)`, che BIL-T05 riusa nei suoi test senza toccare il comando;
  - dopo l'unione, questi file sono di joo;
  - aspetta ACC-T03: i compiti di joo che seguono non prevedono nuove dipendenze fino a BIL-T09, e BIL-T02, il primo che usa `stripe`, aspetta BIL-T01.
- **OPS-T09** (yoo) tocca `src/proxy.ts`, il Caddyfile, `.github/`, i propri test e, del layout radice, solo il nonce sugli script. Un difetto che il suo e2e trova nei cookie (`src/server/auth/`) o in altre pagine non lo corregge: diventa una correzione di joo. Lo stesso per una vulnerabilità segnalata da `pnpm audit`: si corregge a parte, non nel compito che la scopre.
- **MOD-T03** (yoo) tocca il layout e il menu del gestionale, le funzioni di accesso ai moduli in `src/modules/` e `tests/architecture/access-boundary.test.ts`. joo intanto fa BIL-T02 e BIL-T05, che non li toccano, e BIL-T06 aspetta MOD-T03.
- **OPS-T04** (yoo) tocca questi file:
  - aggiunge un file nuovo in `src/server/db/` per le letture del controllo approfondito;
  - mette Sentry in `src/worker.ts`, `src/instrumentation.ts`, `next.config.*` e nel layout radice, una riga ciascuno;
  - scrive il valore di `sentryProjectUrl` in `src/config/platform.ts`, solo quella riga.

  joo intanto fa ADM-T03, che non li tocca, e OPS-T08 aspetta OPS-T04.
- **OPS-T11** (yoo) completa `requireShopAccess`, il test di architettura, `src/config/terms.ts` e le pagine d'invito. Arriva dopo l'ultimo compito di joo.

### Regole di struttura

Fanno parte dei compiti indicati (`specs/README.md`, «Esecuzione su due postazioni»).

- **FON-T01 (joo):** `src/config/platform.ts` nasce con tutte le chiavi citate nelle specifiche e i loro valori iniziali. Dopo, ogni compito cambia solo la riga della propria chiave. FON-T01 non crea `infra/README.md`, che nasce in FON-T07a, e non fa il commit iniziale: il repository parte già dal commit «Specifiche e metodo».
- **FON-T06 (joo): un file per comando del CLI.** `src/cli.ts` elenca da subito tutti i comandi previsti dalle specifiche. Ognuno punta al proprio file `src/cli/commands/<nome>.ts`, creato come segnaposto che termina con il codice 64 («non ancora disponibile»). Dopo, ogni compito modifica solo il file del proprio comando, mai l'elenco. La regola ESLint sul client del proprietario ammette anche `src/cli/commands/**`. I comandi li scrivono otto compiti delle due postazioni: ACC-T04, ADM-T01, ADM-T03, BIL-T01, BIL-T07, BIL-T09, OPS-T01b, OPS-T04.
- **FON-T07a (yoo): `infra/README.md` a sezioni.** Il file nasce con una sezione per ogni procedura citata nelle specifiche e, dove contribuiscono più compiti, una sottosezione per compito, con il suo ID nel titolo. Esempi: impostazioni del Dashboard Stripe per BIL-T01, BIL-T02 e BIL-T11; rotazione dei segreti per NEG-T09 e OPS-T11. Ogni compito scrive solo nella sua.
- **FON-T10 (joo):**
  - i lavori in background si registrano in `src/server/jobs/` (un file per lavoro e un registro), non in `src/worker.ts`, che resta corto: avvio, `ensureQueues()`, registrazione, arresto;
  - il [VERIFICA] su Brevo lo annota soltanto: un'eventuale modifica del matcher nel Caddyfile la fa yoo;
  - il controllo manuale dei record DNS e l'email di prova si fanno da joo, in locale, con la chiave Brevo vera. Non serve il server.
- **NEG-T02 (joo):** crea in `src/server/db/` il wrapper `resolveHost()` di `resolve_host`, che il proxy di NEG-T04 usa.
- **OPS-T01a (yoo):** l'immagine PostgreSQL deve partire anche in sviluppo senza le variabili `PGBACKREST_*`, perché joo la usa ogni giorno con `compose.dev.yml`. È una prova in più del compito.
- **FON-T08 (yoo):** i flussi di rilascio e `deploy.sh` seguono la sezione «Il server di test condiviso». Il nome di progetto `app-dev` in `compose.dev.yml` fa ricreare a joo i volumi locali una volta: va detto nella pull request. La prova con `KNOWN_HOSTS` sbagliato si fa con un segreto di prova separato, mai alterando quello vero. La pull request di prova di FON-005 sta su un ramo `prova-*` e si chiude subito dopo la verifica.
- **OPS-T09 (yoo):** gli aggiornamenti automatici delle dipendenze sono raggruppati, con `open-pull-requests-limit: 1`.
- **Registro delle approvazioni: un file per postazione**, `.claude/registro-compiti-yoo.log` e `.claude/registro-compiti-joo.log`. Così le unioni non si scontrano mai sul registro.

## Il server di test condiviso

Da FON-T08 ogni unione su `main`, di joo o di yoo, arriva da sola sul server di test. Per questo FON-T08 prevede:

1. **Un rilascio alla volta.** `deploy-test.yml` e `deploy-prod.yml` hanno un gruppo di concorrenza (`concurrency`, senza annullare il rilascio in corso), e `deploy.sh` prende un blocco con `flock`. Due unioni ravvicinate si mettono in fila; tra i test di FON-T08 c'è anche questo.
2. **Il fermo dei rilasci.** Una variabile del repository, `TEST_DEPLOY_HOLD`: quando è attiva, il flusso costruisce e pubblica l'immagine, ma non la mette sul server e non le dà il tag `tested-`. In più, un avvio a mano (`workflow_dispatch`) mette sul server di test l'immagine di uno SHA scelto, anche di un ramo.
3. **Il controllo delle variabili.** Prima di `pull` e `migrate`, `deploy.sh` confronta i nomi delle variabili in `/srv/app/env/*.env` con quelli di `infra/env.example/*.env` dell'immagine. Se ne manca uno si ferma e lo nomina, senza stampare valori.

Le regole:

- **Quando yoo lavora sul server di test** (FON-T07b, BIL-T01 per lo `stripe:seed` sui server, OPS-T01b, OPS-T04), attiva il fermo, mette sul server l'immagine del suo ramo con l'avvio a mano e fa le sue prove. In `docs/verifiche/<id>.md` scrive quali prove ha fatto con il fermo attivo e quali restano da fare dopo l'unione. Alla fine toglie il fermo e rilancia il rilascio di `main`. Le prove in produzione (per esempio la copia specchio di OPS-T01b) si fanno dopo l'unione, con un rilascio `v*`.
- **Quando un compito di joo aggiunge una variabile d'ambiente**, la pull request lo dice. Prima di unirla, yoo o l'utente la scrive sui server; se ci si dimentica, è il controllo di `deploy.sh` a fermare il rilascio, indicando quale variabile manca.
- Un rilascio di joo che fallisce per uno stato del server che joo non vede (per esempio un'app spenta da yoo per una prova) non è un errore del compito di joo: si guarda con yoo prima di toccare il codice.

## Stripe: una sandbox per postazione

`specs/05-abbonamenti-stripe.md` vuole una sandbox Stripe per ogni ambiente. Con due computer gli ambienti di sviluppo sono due, quindi le sandbox sono quattro: **sviluppo-joo**, **sviluppo-yoo**, server di test, produzione. Ciascuna ha le sue chiavi, il suo `stripe listen` e il suo `STRIPE_PORTAL_CONFIGURATION_ID`. Così i test di una postazione non spostano i prezzi o le configurazioni del portale mentre girano quelli dell'altra.

Lo `stripe:seed` sulle sandbox dei due server, dopo l'unione di BIL-T01, lo fa yoo, insieme a `STRIPE_PORTAL_CONFIGURATION_ID` in `app.env`. Fa parte di BIL-T01 e va scritto in `docs/verifiche/bil-t01.md`.

## Il giro di un compito

1. `/stato` dice il prossimo compito di questa postazione, oppure che cosa si aspetta e da chi.
2. L'utente scrive `INIZIA <ID>`. L'hook controlla corsia e prerequisiti su `origin/main`.
3. **Piano.** Primo passo: `git switch --no-track -c <id> origin/main` (l'hook ha già fatto `git fetch`), poi `pnpm install` se esiste `package.json`. La cartella di lavoro dev'essere pulita, a parte il registro di questa postazione. Poi la costituzione, questa pagina e l'area del compito.
4. **Test** e **codice**, come in `docs/metodo.md`. I comandi verso i server si usano solo dalla fase codice in poi.
5. **Allineamento, prima di chiedere `APPROVO` in fase codice.** `git fetch origin`; se `origin/main` è andato avanti, `git stash push -u`, `git merge --ff-only origin/main`, `git stash pop`. Poi si risolvono i conflitti (il codice in questa fase si può correggere), `pnpm install` se sono cambiate le dipendenze, e si rilanciano lint, typecheck e test. Se il conflitto è in un test, ci si ferma: l'utente scrive `TORNA AI TEST`.
6. **Revisione** con `/revisione`.
7. **Chiusura** con `/chiudi-compito`. Controlla che non ci sia una pull request aperta di un compito dell'altra postazione, si riallinea, rifà i controlli, spunta la casella, fa il commit e apre la pull request.
8. **L'utente** guarda la pull request. Quando la CI è verde la unisce con «Squash and merge» (il ramo si cancella da solo), poi scrive `CHIUSO`. L'hook accetta `CHIUSO` solo quando il compito risulta su `main`. Se la CI è rossa: `TORNA AL CODICE`.

## Quando aspetti

Nessuno di questi lavori modifica codice o tocca i server: i file nuovi stanno in `docs/` e partono con il commit del compito successivo della stessa postazione.

**yoo** (circa 12 turni di attesa previsti):

- **Revisione incrociata** della pull request aperta da joo: in sola lettura (`gh pr diff <numero>`), con l'esito riferito all'utente in chat prima dell'unione. Su GitHub non si scrive nulla senza il suo ok.
- **Anticipo dei punti [VERIFICA] dei propri prossimi compiti**, per esempio le policy dei bucket Hetzner (OPS-T03) o `docker compose run -e` (OPS-T01b). L'esito va in `docs/verifiche-anticipate/<ID>.md`, e il piano del compito lo riporta nella specifica.
- **Preparazione del collaudo:** le liste di controllo delle prove di `specs/09-collaudo.md`, in `docs/collaudo/`.

La manutenzione dei server (aggiornamenti, prova di ripristino mensile dopo OPS-T01b) la fa l'utente, oppure yoo dentro un compito aperto per quello.

**joo** (attese previste: nessuna). Se capita: anticipo dei [VERIFICA] dei propri prossimi compiti, in `docs/verifiche-anticipate/`, e revisione incrociata della pull request di yoo.

## Se qualcosa va storto

- **Conflitto durante l'allineamento in fase codice:** lo risolve Claude, poi rilancia i controlli. Su un file di test ci si ferma e l'utente scrive `TORNA AI TEST`.
- **Conflitto durante la chiusura:** se riguarda solo `specs/` o `docs/` (per esempio due caselle vicine spuntate dalle due postazioni), Claude lo risolve tenendo entrambe le parti. Altrimenti l'utente scrive `TORNA AL CODICE`: si risolve in fase codice, poi di nuovo revisione e chiusura.
- **CI rossa sulla pull request:** l'utente scrive `TORNA AL CODICE`. Alla nuova chiusura `/chiudi-compito` aggiorna la stessa pull request.
- **GitHub segnala un conflitto su una pull request** (succede solo se le due postazioni aprono la pull request nello stesso momento): unisci prima l'altra. Se il conflitto riguarda solo caselle o documenti, risolvilo dal sito di GitHub («Resolve conflicts») tenendo entrambe le parti; altrimenti risolvilo tu in VS Code, perché gli hook non bloccano l'utente.
- **Senza rete:** `INIZIA` e `CHIUSO` usano l'ultima copia nota di `origin/main` e lo dicono.
- **Un compito abbandonato** (`ABBANDONA`) blocca i compiti che lo seguono finché non viene rifatto e unito.

## Compiti nuovi e cambi di corsia

Un compito nuovo si scrive prima nella specifica. Poi l'utente aggiunge una riga in `.claude/hooks/corsie.txt` (Claude non può): `ID|postazione|prerequisiti dell'altra postazione`, nel punto della corsia in cui va eseguito. La regola per scegliere: **se il compito tocca il database, è di joo**. Lo stesso vale per spostare un compito. La modifica conta per tutte e due le postazioni solo quando è su `main`.

## Pull request automatiche delle dipendenze

Da OPS-T09 un aggiornamento automatico apre ogni settimana una pull request sulle dipendenze, raggruppata, una alla volta. Non blocca `/chiudi-compito`, che conta solo le pull request dei compiti. Uniscila solo quando non è aperta nessuna pull request di compito. Dopo l'unione, ciascuna postazione si allinea come al punto 5 del giro.

## Le prove di integrazione prima di FON-T08

Fino a FON-T08 la CI non esegue `pnpm test:int`. I compiti di joo che arrivano prima (FON-T10, NEG-T01, NEG-T02, NEG-T05, NEG-T09) li eseguono in locale, in `/chiudi-compito`, dove sono obbligatori per ogni compito che tocca il database. La pull request di FON-T08 fa girare l'intera serie sul `main` di quel momento. Succedeva già con l'ordine originale per FON-T03 e i compiti successivi; qui riguarda anche l'area NEG.

## Limiti

- Gli hook sono stati provati su Windows, con Git Bash, sia nella forma Windows sia in una simulazione del comportamento Linux. Non sono stati provati su un Ubuntu vero: per questo la prima installazione su ogni computer comprende una prova (`AVVIO.md`, punto 6).
- Gli hook controllano Claude, non l'utente: chi modifica i file a mano o unisce una pull request senza CI può rompere le regole.
- I controlli sui comandi riconoscono i modi comuni di scrivere un file, non tutti. Un programma lanciato da terminale, per esempio uno script, `prettier --write`, `eslint --fix` o `vitest -u`, può ancora modificare file che il metodo protegge. La difesa resta la lettura delle differenze e la revisione.
- Il controllo «una pull request di compito alla volta» lo fa `/chiudi-compito` nel momento in cui apre la pull request: se le due postazioni la aprono nello stesso istante, possono passare entrambe (vedi «Se qualcosa va storto»).
- La protezione di `main` su GitHub e le regole di unione si decidono con il collegamento a GitHub. Finché non ci sono, l'unica barriera contro una spinta diretta su `main` è l'hook.
