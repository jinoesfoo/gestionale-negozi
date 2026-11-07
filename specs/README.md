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

Si procede nell'ordine della tabella, con un'eccezione obbligatoria: nell'area 01, dopo FON-T07a (preparazione di base dei server), si eseguono DOM-T01 e DOM-T02 (DNS, record email, immagine Caddy, certificato; DOM-T02 installa anche `/srv/app/infra`, `/srv/app/.env`, `/srv/app/deploy-env`, `env/caddy.env` (con i file di ambiente degli altri servizi creati vuoti) e lo script `/srv/app/dc`, e avvia il Caddy di bootstrap con Compose, così lo stato ACME sta da subito nel volume `app_caddy_data`) poi OPS-T03 (unità di archivio e credenziali: con Hetzner un bucket non si sposta tra progetti, quindi i progetti separati vanno creati prima di qualsiasi bucket) e OPS-T01a (immagine PostgreSQL, bucket dei backup nel suo progetto, `pgbackrest-init`, script `backup.sh`, timer notturni dei backup), poi FON-T07b (che aggiorna `CADDY_TAG`, completa i file di ambiente ed esegue anche il primo backup completo), FON-T08 e FON-T10. Per l'avvio iniziale, le variabili di Stripe, Sentry, email e fornitore SDI possono avere valori segnaposto riconoscibili (che iniziano con `placeholder`): lo schema delle variabili li accetta, le funzioni che li userebbero rispondono con un errore chiaro, e `/api/health` ne segnala la presenza con il campo booleano `placeholders` (FON-009); si sostituiscono nei compiti che li usano (BIL-T01, BIL-T11, OPS-T04, FON-T10), sempre prima del collaudo. Unica eccezione: `STRIPE_SECRET_KEY` in `migrate.env` dei server è una vera chiave `sk_test_` fin dal primo avvio (01 §Variabili d'ambiente: la usa `admin:purge-test-shops`); il segnaposto vale lì solo in sviluppo e CI.

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

Ordine di esecuzione: FON-T01, FON-T03, FON-T06, FON-T07a, DOM-T01, DOM-T02, OPS-T03, OPS-T01a, FON-T07b, FON-T08, FON-T10, poi NEG, ACC, MOD, BIL, ADM (ADM-T01 può essere anticipato subito dopo ACC per avere il pannello prima di Stripe), OPS (OPS-T01b, T04, T08, T09, T11), collaudo.

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
