# Due postazioni: yoo e joo

Il progetto si sviluppa su due computer Ubuntu, ciascuno con il suo ruolo. Questa pagina dice chi fa cosa, in che ordine, e perché le due postazioni non si pestano i piedi. Claude la legge prima di ogni piano (`CLAUDE.md`, sezione 6).

## In breve

- **joo fa l'applicazione e il database**: 25 compiti. È l'unica postazione che scrive migrazioni.
- **yoo fa i server e tutto quello che li circonda**: 14 compiti, poi il collaudo. In più tre compiti di codice che non toccano il database.
- Ogni compito appartiene a una sola postazione. Gli hook lo fanno rispettare: `INIZIA` rifiuta un compito dell'altra postazione, e anche un compito i cui prerequisiti non sono ancora su `main`.
- Le due postazioni si parlano solo attraverso GitHub: un compito è «fatto» quando la sua pull request è unita su `main` e la sua casella risulta spuntata lì.
- Stima: **26 turni invece di 39** (un turno è un compito; i compiti hanno durate diverse, il conto serve a vedere le attese).

## I ruoli

### joo: applicazione e database

Repository e strumenti, database, negozi e separazione dei dati, login e ruoli, pannello amministratore, moduli, abbonamenti e fattura elettronica, esportazione.

Account e chiavi che servono su joo: GitHub, Docker in locale, Stripe in modalità test (BIL-T02 e successivi), Brevo (prova di invio in FON-T10), sandbox del fornitore SDI (BIL-T11).

### yoo: server, rilasci e operatività

I due server Hostinger, DNS su Cloudflare, Caddy e certificati, archivi S3 e backup, CI e rilasci automatici, monitoraggio e Sentry, intestazioni di sicurezza, documenti e procedure, collaudo finale. In più tre compiti di codice senza migrazioni: **NEG-T04** (instradamento del proxy, vicino a Caddy e ai domini), **BIL-T01** (listino e prodotti Stripe), **MOD-T03** (menu e controllo dei moduli).

Account e chiavi che servono su yoo: Hostinger, chiavi SSH dei server, Cloudflare, Hetzner o Scaleway, Brevo, GitHub (pacchetti GHCR e segreti di Actions), Sentry, servizio di controllo esterno, Stripe in modalità test.

## Le corsie

L'ordine è quello di `.claude/hooks/corsie.txt`. Vale la copia su `main`, uguale per le due postazioni, e la modifica solo l'utente. Una postazione inizia un compito solo quando i compiti che lo precedono nella sua corsia, più quelli segnati nella colonna «aspetta», sono uniti su `main`.

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
| 9 | ACC-T01 | Better Auth, membership | — |
| 10 | ACC-T03 | Secondo fattore, passkey, pagine di login | NEG-T04 (proxy) |
| 11 | ACC-T04 | Limiti dei tentativi, recupero password | FON-T08 (CI completa) |
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
| 25 | OPS-T08 | Registro, esportazione dei dati | OPS-T04 (Sentry e controlli) |

### Corsia di yoo

| # | Compito | Cosa | Aspetta da joo |
|---|---|---|---|
| 1 | FON-T07a | Preparazione dei due server | — |
| 2 | DOM-T01 | DNS ed email (Cloudflare, Brevo) | — |
| 3 | OPS-T03 | Archivi S3 separati (anticipato) | — |
| 4 | DOM-T02 | Caddy, certificati, avvio di bootstrap | FON-T06 |
| 5 | OPS-T01a | PostgreSQL con pgBackRest, backup notturni | — |
| 6 | FON-T07b | Primo avvio completo sui server | — |
| 7 | NEG-T04 | Instradamento: `src/proxy.ts` | NEG-T02 |
| 8 | FON-T08 | CI completa e rilasci automatici | FON-T10, NEG-T09 |
| 9 | BIL-T01 | Listino e prodotti Stripe | ACC-T03 |
| 10 | OPS-T09 | Intestazioni di sicurezza, controllo delle dipendenze | ACC-T04 |
| 11 | OPS-T01b | Registrazione dei backup, copia specchio | ADM-T07 |
| 12 | MOD-T03 | Menu e controllo dei moduli | MOD-T02 |
| 13 | OPS-T04 | Controllo approfondito, metriche, Sentry | BIL-T11 |
| 14 | OPS-T11 | Documenti, procedure, condizioni | OPS-T08 |
| — | Collaudo | Prove di `specs/09-collaudo.md` | tutto |

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
12-14   ACC-T06, ADM-T01, ADM-T07    (attesa)
15      MOD-T01                      OPS-T01b
16      MOD-T02                      (attesa)
17      BIL-T02                      MOD-T03
18-22   BIL-T05 … BIL-T11            (attesa)
23      ADM-T03                      OPS-T04
24      OPS-T08                      (attesa)
25      —                            OPS-T11
```

joo non aspetta mai, **se yoo consegna in tempo i sei compiti che joo attende**: DOM-T01, NEG-T04, FON-T08, BIL-T01, MOD-T03, OPS-T04. Per yoo questi vengono prima di tutto il resto. yoo invece ha circa 12 turni di attesa: si riempiono con il lavoro della sezione «Quando aspetti».

## Perché le postazioni non si sovrappongono

1. **Un compito, una postazione.** La tabella delle corsie assegna ogni compito una volta sola. `INIZIA` di un compito dell'altra postazione viene rifiutato dall'hook.
2. **Si parte sempre da `main`.** `INIZIA` controlla su `origin/main` che i compiti precedenti della corsia e i prerequisiti siano spuntati (pull request unita). Il ramo del compito nasce da `origin/main` appena aggiornato.
3. **Il database ha un solo proprietario: joo.** Migrazioni (`drizzle/`), elenco dei permessi e fixture (`src/server/db/isolation/`) li scrive solo joo. Due postazioni che generano migrazioni insieme produrrebbero due migrazioni con lo stesso numero e istantanee dello schema incoerenti. Se un compito di yoo scopre che gli serve una migrazione, si ferma e lo dice all'utente: quella parte passa a joo.
4. **I file esistenti dell'altra corsia non si modificano; si aggiungono file nuovi.** Dove un compito deve per forza toccare file dell'altra corsia, è un'eccezione pianificata, elencata qui sotto e protetta dai prerequisiti: nello stesso momento nessun compito dell'altra postazione tocca quei file.
5. **Una pull request alla volta, e prima ci si allinea.** Prima di chiedere `APPROVO` in fase codice, e di nuovo in chiusura, il ramo si allinea all'ultimo `main` e i controlli si rilanciano. `/chiudi-compito` non apre una pull request se ce n'è già una aperta dell'altra postazione.
6. **Regole di struttura** che tolgono di mezzo i file contesi (vedi sotto).
7. **I segreti non viaggiano mai** su git, nello zip o in chat: si passano con il gestore di password (OPS-009). I valori veri sui server li scrive yoo, o l'utente. Un compito di joo che aggiunge una variabile lo scrive nella descrizione della pull request, e la variabile va sui server **prima** dell'unione: da FON-T08 ogni unione su `main` arriva sul server di test.

### Proprietà dei file

| Di joo | Di yoo |
|---|---|
| `drizzle/`, `src/server/db/` (compresi `isolation/`, elenco dei permessi e fixture) | `infra/` (dopo FON-T06), `Dockerfile`, `.github/` (dopo FON-T06) |
| `src/server/auth/`, `billing/`, `jobs/`, `email/`, `audit/`, `secrets/`, `invoicing/`, `exports/`, `storage/` | `src/proxy.ts` (da NEG-T04) |
| `src/app/x-*` (le cartelle vuote le crea NEG-T04, poi sono di joo), `src/app/api/` (tranne le route qui a destra) | `src/app/api/health/echo-headers/`, `src/app/api/health/deep/` |
| `src/modules/`, `src/config/platform.ts` | `src/server/ops/` (tranne `cert.ts`, che è di ADM-T07), `src/lib/sentry-*` |
| `tests/` dei propri compiti | `tests/` dei propri compiti, `infra/scripts/check-*` |

I file dei comandi del CLI (`src/cli/commands/<nome>.ts`) sono del compito che scrive quel comando, anche se il segnaposto lo crea FON-T06.

**Condivisi**, solo con aggiunte piccole e sempre dopo l'allineamento: `package.json` e `pnpm-lock.yaml`, `src/config/env.ts` e gli esempi delle variabili (`.env.*.example`, `infra/env.example/`), `src/worker.ts` e `src/instrumentation.ts` (una riga ciascuno per Sentry in OPS-T04), le caselle e le note in `specs/`. Su `pnpm-lock.yaml` un conflitto si risolve rigenerandolo con `pnpm install`.

**Eccezioni pianificate:**

- **NEG-T04** (yoo) tocca la configurazione di Playwright creata in FON-T01. Intanto joo lavora su NEG-T05, che non la tocca.
- **I compiti di joo con una procedura manuale** (per esempio ACC-T04, `admin:reset-2fa`) la scrivono nella propria sezione di `infra/README.md`, preparata da FON-T07a: sezioni separate, nessuna riga in comune con yoo.
- **FON-T07b e FON-T08** (yoo) completano gli esempi delle variabili creati da joo. FON-T08 aspetta NEG-T09, così in quel momento joo non li sta toccando.
- **BIL-T01** (yoo) aggiunge la dipendenza `stripe`. Aspetta ACC-T03: i compiti di joo che seguono non prevedono nuove dipendenze fino a BIL-T09, e BIL-T02, il primo che usa `stripe`, aspetta BIL-T01.
- **MOD-T03** (yoo) tocca il layout del gestionale e `tests/architecture/access-boundary.test.ts`. joo intanto fa BIL-T02 e BIL-T05, che non li toccano, e BIL-T06 aspetta MOD-T03.
- **OPS-T04** (yoo) aggiunge un file in `src/server/db/` per le letture del controllo approfondito (file nuovo, nessun file esistente cambiato), più Sentry nel worker e nell'app. joo intanto fa ADM-T03, e OPS-T08 aspetta OPS-T04.
- **OPS-T11** (yoo) completa `requireShopAccess` e il test di architettura. Arriva dopo l'ultimo compito di joo.

### Regole di struttura

- **FON-T06 (joo): un file per comando del CLI.** `src/cli.ts` elenca da subito tutti i comandi previsti dalle specifiche. Ognuno punta al proprio file `src/cli/commands/<nome>.ts`, creato come segnaposto che termina con il codice 64 («non ancora disponibile»). Dopo, ogni compito modifica solo il file del proprio comando, mai l'elenco. I comandi li scrivono otto compiti delle due postazioni: ACC-T04, ADM-T01, ADM-T03, BIL-T01, BIL-T07, BIL-T09, OPS-T01b, OPS-T04.
- **FON-T07a (yoo): `infra/README.md` a sezioni.** Il file nasce con una sezione per ogni procedura, con nel titolo il compito che la scrive: amministrazione dei server, DNS, certificati, backup, rotazione dei segreti con la copia fuori linea (OPS-T11), `admin:reset-2fa` (ACC-T04), impostazioni del Dashboard Stripe, fattura di recupero a mano e le altre citate nelle specifiche. Ogni compito scrive solo nella sua sezione.
- **FON-T10 (joo): i lavori in background si registrano in `src/server/jobs/`** (un file per lavoro e un registro), non in `src/worker.ts`, che resta corto: avvio, `ensureQueues()`, registrazione, arresto.
- **Registro delle approvazioni: un file per postazione**, `.claude/registro-compiti-yoo.log` e `.claude/registro-compiti-joo.log`. Così le unioni non si scontrano mai sul registro.

## Il giro di un compito

1. `/stato` dice il prossimo compito di questa postazione, oppure che cosa si aspetta e da chi.
2. L'utente scrive `INIZIA <ID>`. L'hook controlla corsia e prerequisiti su `origin/main`.
3. **Piano.** Primo passo: `git switch -c <id> origin/main` (l'hook ha già fatto `git fetch`). Poi la costituzione, questa pagina e l'area del compito.
4. **Test** e **codice**, come in `docs/metodo.md`.
5. **Allineamento, prima di chiedere `APPROVO` in fase codice:** `git fetch origin`; se `origin/main` è andato avanti, `git stash push -u`, `git merge --ff-only origin/main`, `git stash pop`. Poi si risolvono i conflitti (il codice in questa fase si può correggere) e si rilanciano lint, typecheck e test. Se il conflitto è in un test, ci si ferma: l'utente scrive `TORNA AI TEST`.
6. **Revisione** con `/revisione`.
7. **Chiusura** con `/chiudi-compito`: controlla che non ci sia una pull request aperta dell'altra postazione, si riallinea, rifà i controlli, spunta la casella, fa il commit e apre la pull request.
8. **L'utente** guarda la pull request. Quando la CI è verde la unisce con «Squash and merge», cancella il ramo e scrive `CHIUSO`. Finché la pull request non è unita, il compito successivo della stessa postazione e quelli che lo aspettano restano bloccati.

## Quando aspetti

Nessuno di questi lavori modifica codice: i file nuovi stanno in `docs/` e partono con il commit del compito successivo della stessa postazione.

**yoo** (circa 12 turni di attesa previsti):

- **Revisione incrociata** della pull request aperta da joo: in sola lettura (`gh pr diff <numero>`), con l'esito riferito all'utente in chat prima dell'unione. Su GitHub non si scrive nulla senza il suo ok.
- **Anticipo dei punti [VERIFICA] dei propri prossimi compiti**, per esempio le policy dei bucket Hetzner (OPS-T03) o `docker compose run -e` (OPS-T01b). L'esito va in `docs/verifiche-anticipate/<ID>.md`, e il piano del compito lo riporta nella specifica.
- **Preparazione del collaudo:** le liste di controllo delle prove di `specs/09-collaudo.md`, in `docs/collaudo/`.
- **Manutenzione:** aggiornamenti dei server, la prova di ripristino mensile (dopo OPS-T01b), account e chiavi dei compiti successivi (Sentry, controllo esterno).

**joo** (attese previste: nessuna). Se capita: anticipo dei [VERIFICA] dei propri prossimi compiti, in `docs/verifiche-anticipate/`, e revisione incrociata della pull request di yoo.

## Se qualcosa va storto

- **Conflitto durante l'allineamento in fase codice:** lo risolve Claude, poi rilancia i controlli. Su un file di test ci si ferma e l'utente scrive `TORNA AI TEST`.
- **Conflitto durante la chiusura:** se riguarda solo `specs/` o `docs/` (per esempio due caselle vicine spuntate dalle due postazioni), Claude lo risolve tenendo entrambe le parti. Altrimenti l'utente scrive `TORNA AL CODICE`: si risolve in fase codice, poi di nuovo revisione e chiusura.
- **GitHub segnala un conflitto su una pull request** (succede solo se le due postazioni aprono la pull request nello stesso momento): unisci prima l'altra. Se il conflitto riguarda solo caselle o documenti, risolvilo dal sito di GitHub («Resolve conflicts») tenendo entrambe le parti; altrimenti risolvilo tu in VS Code, perché gli hook non bloccano l'utente.
- **Senza rete:** `INIZIA` usa l'ultima copia nota di `origin/main` e lo dice.
- **Un compito abbandonato** (`ABBANDONA`) blocca i compiti che lo seguono finché non viene rifatto e unito.

## Compiti nuovi e cambi di corsia

Un compito nuovo si scrive prima nella specifica. Poi l'utente aggiunge una riga in `.claude/hooks/corsie.txt` (Claude non può): `ID|postazione|prerequisiti dell'altra postazione`, nel punto della corsia in cui va eseguito. La regola per scegliere: **se il compito tocca il database, è di joo**. Lo stesso vale per spostare un compito. La modifica conta per tutte e due le postazioni solo quando è su `main`.

## Pull request automatiche delle dipendenze

Da OPS-T09 un aggiornamento automatico apre ogni settimana pull request sulle dipendenze. Uniscile solo quando nessuna delle due postazioni ha un compito aperto che tocca `package.json`. Dopo l'unione, ciascuna postazione si allinea come al punto 5 del giro.

## Limiti

- Gli hook sono stati provati su Windows, con Git Bash, sia nella forma Windows sia in una simulazione del comportamento Linux. Non sono stati provati su un Ubuntu vero: per questo la prima installazione su ogni computer comprende una prova (`AVVIO.md`, punto 6).
- Gli hook controllano Claude, non l'utente: chi modifica i file a mano o unisce una pull request senza CI può rompere le regole.
- Il controllo «una pull request alla volta» lo fa `/chiudi-compito` nel momento in cui apre la pull request: se le due postazioni la aprono nello stesso istante, possono passare entrambe (vedi «Se qualcosa va storto»).
