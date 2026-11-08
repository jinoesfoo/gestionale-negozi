# Specifiche — Fase 0: piattaforma

Queste specifiche descrivono **cosa** costruire e **come verificarlo** per la fase 0 della piattaforma (il contenitore su cui gireranno gestionale, moduli e siti dei negozi). Sono scritte per essere lette da Claude Code durante lo sviluppo.

Documento di riferimento a monte: "Progetto tecnico — Fase 0: piattaforma" (versione del 3 novembre 2026), rivisto il 6 novembre 2026 dopo una revisione indipendente (gestionale su un solo host, rinvii in `10-rinviato.md`). In caso di conflitto valgono queste specifiche; ogni conflitto trovato va segnalato e risolto aggiornando entrambi.

## Come si usano

1. Il kit `kit-sviluppo.zip` (`CLAUDE.md`, `.claude/` e `docs/metodo.md`) viene consegnato **insieme** a queste specifiche e deve essere presente nel repository **prima di FON-T01**: senza gli hook e i comandi del metodo nessun compito si può eseguire. Prima di FON-T01, quindi, copia nella radice del repository: la cartella `specs/`, e dal kit il file `CLAUDE.md`, la cartella `.claude/` (con `.claude/hooks/*` e i comandi `/stato`, `/revisione`, `/chiudi-compito`) e `docs/metodo.md`. Poi installa `jq` (lo usano gli hook), esegui `chmod +x .claude/hooks/*.sh` e aggiungi `.claude/compito-corrente.json` e `.claude/settings.local.json` a `.gitignore`. FON-T01 include questi file nel commit iniziale.
2. Lavora **un'area alla volta, nell'ordine sotto**. Ogni area ha tre parti: *Requisiti* (cosa deve succedere, con criteri di accettazione), *Progetto* (come è fatto), *Compiti* (passi in ordine, ciascuno con i test che lo chiudono).
3. Chiedi a Claude Code di eseguire un compito alla volta: "Esegui il compito FON-T03 di `specs/01-fondamenta.md`". Il compito è finito solo quando i suoi test passano e la casella è spuntata.
4. Se durante lo sviluppo una specifica si rivela sbagliata o incompleta, **si corregge prima la specifica**, poi il codice.

## Ordine delle aree

| # | File | Area | Dipende da |
|---|---|---|---|
| 0 | `00-costituzione.md` | Regole valide per tutto il progetto | — |
| 1 | `01-fondamenta.md` | Repository, Docker, database, rilasci, email, registro delle azioni (anticipato in FON-T10) | 0 |
| 2 | `02-negozi-separazione.md` | Negozi, separazione dei dati, segreti per negozio | 1 |
| 3 | `03-accesso-ruoli.md` | Login su `app.{{DOMINIO}}`, ruoli, inviti, recupero credenziali | 2 |
| 4 | `04-moduli.md` | Moduli attivabili | 2, 3 |
| 5 | `05-abbonamenti-stripe.md` | Abbonamenti, pagamenti, fattura elettronica | 4 |
| 6 | `06-domini-https.md` | Sottodomini, DNS (anche email), HTTPS | 2, 3 |
| 7 | `07-pannello-admin.md` | Pannello amministratore | 3, 4, 5, 6 |
| 8 | `08-operativita.md` | Backup, monitoraggio, registro, esportazione, sicurezza, documenti legali | 1, 2, 3, 5, 7 |
| 9 | `09-collaudo.md` | Prove di chiusura della fase 0 | tutte |
| 10 | `10-rinviato.md` | Note di progetto delle parti rinviate (nessun compito) | — |

La colonna "Dipende da" vale per le aree nel loro insieme, con un'eccezione: i compiti DOM-T01, DOM-T02 (area 06), OPS-T03 e OPS-T01a (area 08) si eseguono **dentro** l'ordine dell'area 01, come descritto qui sotto, anche se le loro aree dipendono da aree successive; sono compiti di infrastruttura che non usano nulla delle aree 02–07.

Si procede nell'ordine della tabella (con una sola postazione; con due vale la sezione «Esecuzione su due postazioni» più sotto), con un'eccezione obbligatoria: nell'area 01, dopo FON-T07a (preparazione di base dei server), si eseguono DOM-T01 e DOM-T02 (DNS, record email, immagine Caddy, certificato; DOM-T02 installa anche `/srv/app/infra`, `/srv/app/.env`, `/srv/app/deploy-env`, `env/caddy.env` (con i file di ambiente degli altri servizi creati vuoti) e lo script `/srv/app/dc`, e avvia il Caddy di bootstrap con Compose, così lo stato ACME sta da subito nel volume `app_caddy_data`) poi OPS-T03 (unità di archivio e credenziali: con Hetzner un bucket non si sposta tra progetti, quindi i progetti separati vanno creati prima di qualsiasi bucket) e OPS-T01a (immagine PostgreSQL, bucket dei backup nel suo progetto, `pgbackrest-init`, script `backup.sh`, timer notturni dei backup), poi FON-T10 (worker, email e registro: il job di `test:int` di FON-T08 chiama la sua `ensureQueues()`), FON-T07b (che aggiorna `CADDY_TAG`, completa i file di ambiente ed esegue anche il primo backup completo) e FON-T08. Per l'avvio iniziale, le variabili di Stripe, Sentry, email e fornitore SDI possono avere valori segnaposto riconoscibili (che iniziano con `placeholder`): lo schema delle variabili li accetta, le funzioni che li userebbero rispondono con un errore chiaro, e `/api/health` ne segnala la presenza con il campo booleano `placeholders` (FON-009); si sostituiscono nei compiti che li usano (BIL-T01, BIL-T11, OPS-T04, FON-T10), sempre prima del collaudo; con due postazioni i valori veri sui server li scrive yoo, o l'utente se sono segreti (`docs/due-postazioni.md`, «Il server di test condiviso»). Unica eccezione: `STRIPE_SECRET_KEY` in `migrate.env` dei server è una vera chiave `sk_test_` fin dal primo avvio (01 §Variabili d'ambiente: la usa `admin:purge-test-shops`); il segnaposto vale lì solo in sviluppo e CI.

## Compiti della fase 0

39 compiti in tutto. Gli ID sono stabili: dopo la revisione del 6/11/2026 alcuni compiti sono stati accorpati o rinviati, quindi la numerazione ha dei **vuoti** (es. non esistono FON-T02, NEG-T03, ACC-T02, BIL-T08, OPS-T02); non vanno riusati.

| Area | Compiti | Numero |
|---|---|---|
| FON | T01, T03, T06, T07a, T07b, T08, T10 | 7 |
| NEG | T01, T02, T04, T05, T09 | 5 |
| ACC | T01, T03, T04, T05, T06 | 5 |
| MOD | T01, T02, T03 | 3 |
| BIL | T01, T02, T05, T06, T07, T09, T11 | 7 |
| DOM | T01, T02 | 2 |
| ADM | T01, T03, T07 | 3 |
| OPS | T01a, T01b, T03, T04, T08, T09, T11 | 7 |

Ordine di esecuzione con una sola postazione: FON-T01, FON-T03, FON-T06, FON-T07a, DOM-T01, DOM-T02, OPS-T03, OPS-T01a, FON-T10, FON-T07b, FON-T08, poi NEG, ACC, MOD, BIL, ADM (ADM-T01 può essere anticipato subito dopo ACC per avere il pannello prima di Stripe), OPS (OPS-T01b, T04, T08, T09, T11), collaudo.

### Esecuzione su due postazioni (8/11/2026)

Lo sviluppo si fa su due computer, **joo** (applicazione e database, l'unica postazione che scrive migrazioni) e **yoo** (server, rilasci, operatività, più NEG-T04, BIL-T01 e MOD-T03). L'ordine di ciascuna postazione e i compiti dell'altra che deve aspettare stanno in `.claude/hooks/corsie.txt`; le ragioni e le regole contro le sovrapposizioni in `docs/due-postazioni.md`. Ogni dipendenza scritta nei compiti resta rispettata, come ha verificato una revisione indipendente (8/11/2026). Rispetto all'ordine qui sopra cambia questo:

- **FON-T07a, DOM-T01 e OPS-T03 in parallelo con FON-T01, FON-T03 e FON-T06.** Il lavoro sui server non usa il codice. OPS-T03 scrive solo nella sua sezione di `infra/README.md`, preparata da FON-T07a, che lo precede; resta prima di ogni bucket e prima di OPS-T01a, come chiede la sua nota. FON-T01 non fa il commit iniziale: il repository parte dal commit «Specifiche e metodo».
- **FON-T10 prima di FON-T07b e FON-T08**, che lo aspettano. Gli servono FON-T03, FON-T06 e i record di DOM-T01. L'ordine originale aveva un'inversione, corretta l'8/11/2026 anche nell'ordine con una sola postazione: il job di `test:int` di FON-T08 chiama `ensureQueues()`, che nasce in FON-T10. Così il primo avvio sui server (FON-T07b) gira già con il worker vero.
- **NEG-T04 a yoo** (instradamento, vicino a Caddy e ai domini), in parallelo con NEG-T05 e NEG-T09. Aspetta NEG-T02 per `resolve_host` e FON-T07b per `/api/health/echo-headers`. ACC-T01 aspetta NEG-T04, perché il controllo di `Origin` che prova (NEG-011) lo applica il proxy; ACC-T03 prova anche il 404 del proxy su `/api/auth/*`.
- **ADM-T01 e ADM-T07 subito dopo ACC**, prima di MOD e BIL. L'anticipo di ADM-T01 era già ammesso; ADM-T07 non dipende da MOD né da BIL e crea le tabelle operative che servono a OPS-T01b.
- **BIL-T01 e MOD-T03 a yoo**: non hanno migrazioni. BIL-T02 aspetta BIL-T01 (listino e libreria `stripe`), BIL-T06 aspetta MOD-T03.
- **OPS-T01b dopo BIL-T02**, perché `ops:row-counts` conta anche `subscriptions` (OPS-004).
- **OPS-T04 prima di OPS-T08**, perché i due compiti non aggiungano dipendenze nello stesso momento.
- **OPS-T09 dopo OPS-T04**, come nell'ordine con una sola postazione: la CSP di OPS-T09 deve ammettere l'host di Sentry (08 §Intestazioni), che arriva con OPS-T04.
- **Le prove di integrazione entrano in CI con FON-T08.** I compiti di joo che lo precedono le eseguono in locale in `/chiudi-compito`, e la pull request di FON-T08 fa girare l'intera serie (`docs/due-postazioni.md`, «Le prove di integrazione prima di FON-T08»).

Regole per le due postazioni, che fanno parte dei compiti indicati (dettagli e motivi in `docs/due-postazioni.md`, «Regole di struttura», «Protezione del metodo», «Il server di test condiviso», «Stripe»):

- **FON-T01:** `src/config/platform.ts` nasce con tutte le chiavi citate nelle specifiche; dopo, ogni compito cambia solo la riga della propria. `src/config/env.ts` e gli esempi nascono con tutte le variabili di 01 §Variabili d'ambiente, tranne `EMAIL_PROVIDER` (FON-T10), `AUTH_RATE_LIMIT_TEST_ALLOW_IP` (ACC-T04) e le variabili SDI dell'app (BIL-T11). FON-T01 non crea `infra/README.md`.
- **FON-T06:** ogni comando del CLI ha il suo file `src/cli/commands/<nome>.ts`. FON-T06 crea subito tutti quelli previsti dalle specifiche come segnaposto con uscita 64, e l'elenco in `src/cli.ts` non cambia più. La regola ESLint sul client del proprietario ammette anche `src/cli/commands/**`.
- **FON-T07a:** `infra/README.md` nasce con una sezione per ogni procedura citata nelle specifiche e, dove contribuiscono più compiti, una sottosezione per compito, intitolata con il suo ID. La prova del `docker pull` di un'immagine privata usa un'immagine di prova pubblicata a mano e poi cancellata. Gli accessi ai server si fanno con i nomi SSH `test` e `prod` (`AVVIO.md`).
- **FON-T10:** i gestori dei lavori si registrano in `src/server/jobs/` (un file per lavoro e un registro), non in `src/worker.ts`. Il [VERIFICA] su Brevo si annota soltanto: un'eventuale modifica del Caddyfile la fa FON-T07b. Il controllo manuale dei record DNS e l'email di prova si fanno in locale, senza il server.
- **NEG-T02:** crea in `src/server/db/` il wrapper `resolveHost()`, che usa il proxy di NEG-T04.
- **OPS-T01a:** l'immagine PostgreSQL parte anche in sviluppo senza le variabili `PGBACKREST_*`.
- **FON-T08:**
  - `deploy.sh`, `/srv/app/dc` e gli script dei timer prendono lo stesso blocco con `flock -w`, e `deploy.sh` scrive `infra/` e `.env` in modo atomico; tra i test, un rilascio lanciato durante un backup aspetta;
  - la costruzione dell'immagine sta fuori dai gruppi di concorrenza; il rilascio usa due gruppi separati, `deploy-test` e `deploy-prod`, senza annullare quello in corso;
  - la variabile del repository `TEST_DEPLOY_HOLD` ferma i rilasci sul server di test, e un avvio a mano rilascia uno SHA scelto. Le immagini Caddy e PostgreSQL di uno SHA che non è su `main` prendono il tag `<tag>-<sha7>`, scritto solo nel `.env` del server di test; i tag ufficiali li pubblica solo `main`;
  - prima di `pull` e `migrate`, `deploy.sh` controlla che nei cinque file dei servizi ci siano tutte le variabili degli esempi, saltando quelle segnate `# facoltativa` e non chiedendo mai `STRIPE_LIVE_SECRET_KEY` e `ROLES_ALLOW_CREATEDB`;
  - la prova con `KNOWN_HOSTS` sbagliato usa un segreto di prova separato;
  - la pull request di prova di FON-005 sta su un ramo `prova-*`.
- **BIL-T01:** crea il client Stripe con la versione API fissata e `seedStripe(stripe, plans)`, riusabile da BIL-T05. Dopo l'unione, prima di `CHIUSO`, prepara la sandbox del server di test: `stripe:seed`, gli endpoint dei webhook con l'elenco completo degli eventi (05 §Webhook) e le impostazioni del Dashboard. Quella di produzione si prepara dopo il primo rilascio `v*`. Ogni postazione di sviluppo ha la sua sandbox Stripe (05 §Ogni ambiente usa una propria sandbox).
- **OPS-T09:** aggiornamenti automatici delle dipendenze solo per npm e GitHub Actions, raggruppati, con `open-pull-requests-limit: 1`, compresi gli aggiornamenti di sicurezza.

## Convenzioni di scrittura

- **ID dei requisiti:** `AREA-NNN` (es. `NEG-004`). **ID dei compiti:** `AREA-TNN` (es. `NEG-T02`). I test citano l'ID del requisito che verificano nel nome: `it('NEG-004: ...')`. Anche gli ID dei requisiti hanno vuoti (es. non esiste BIL-015 né ACC-009: rinviati).
- **Formato dei requisiti:** "QUANDO <evento>, il sistema DEVE <risposta>" oppure "Il sistema DEVE <proprietà>". "DEVE" è obbligatorio; "DOVREBBE" è consigliato; "PUÒ" è facoltativo.
- **Segnaposto:** `{{DOMINIO}}` = dominio principale del prodotto (ancora da scegliere); `{{PRODOTTO}}` = nome del prodotto; `{{SLUG}}` = nome breve senza spazi; `{{DOMINIO_TEST}}` = dominio separato per il server di test. Vivono in un solo punto: `src/config/platform.ts` e le variabili d'ambiente.
- **Valori di configurazione** (tolleranza, prove, scadenze) sono in `src/config/platform.ts`. Le specifiche indicano il valore iniziale.
- **[VERIFICA]** segna un dettaglio che dipende dalla versione esatta di una libreria o da una scelta ancora aperta (fornitore SDI, testo fiscale). Il compito che lo contiene deve controllare la documentazione della versione installata (o decidere la scelta) prima di scrivere codice, e annotare l'esito nella specifica.

## Cosa resta fuori dalla fase 0

- **Rinviato con note di progetto** (`10-rinviato.md`): dispositivi del banco, PIN e ruolo operativo (modulo cassa); domini propri dei clienti e certificati su richiesta (modulo sito); fattura di recupero automatica "Paga ora"; sessioni di assistenza dell'amministratore; prova di ripristino automatica tra server (sostituita da una prova manuale mensile).
- **Non ancora progettato:** cassa, incassi, conti sospesi, magazzino, lettura AI delle fatture, modelli grafici dei siti, vetrina, documento commerciale (modulo `fiscale`, tramite fornitore certificato), WhatsApp, Gmail/Drive, plugin per siti esistenti, app installabile. I moduli esistono come voci vuote per provare attivazione e pagamento.

Le garanzie che la fase 0 mantiene intatte: RLS forzata con test di separazione automatico e test dei permessi; backup continui con prova di ripristino reale (mensile, manuale) e copia specchio che la produzione non può cancellare; segreti solo nell'ambiente (con copia fuori linea); webhook Stripe firmati, idempotenti e riletti da Stripe; registro delle azioni; esportazione dei dati; HTTPS e intestazioni di sicurezza; Sentry e monitoraggio esterno; fattura elettronica per ogni pagamento.
