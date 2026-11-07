# 00 — Costituzione del progetto

Regole valide per ogni area e ogni compito. Una modifica a questo file è una decisione di progetto: va motivata e datata in fondo.

## 1. Tecnologie e versioni

| Parte | Scelta | Regola sulla versione |
|---|---|---|
| Runtime | Node.js 24 LTS | Fissata in `.nvmrc` e `engines` |
| Linguaggio | TypeScript, `strict: true`, `noUncheckedIndexedAccess: true` | — |
| Gestore pacchetti | pnpm | Versione fissata con `packageManager` |
| Web | Next.js 16 (App Router). Il file di instradamento a livello di richiesta è `src/proxy.ts` con export `proxy` (in Next.js 16 sostituisce `middleware.ts` e gira su Node.js) | Ultima 16.x stabile all'avvio, poi aggiornamenti minori controllati |
| Database | PostgreSQL 18 | Immagine `postgres:18` con versione minore fissata |
| Accesso ai dati | Drizzle ORM + drizzle-kit | Versioni esatte nel lockfile |
| Login | Better Auth 1.7.x con plugin ufficiali `twoFactor` (incluso in `better-auth`) e `passkey` (pacchetto separato `@better-auth/passkey`); per le password trapelate il plugin del progetto `pwnedCheck`, che usa la funzione `isPasswordCompromised` del plugin ufficiale `haveIBeenPwned` con timeout e fallback (area 03); due soli host di login: `app.{{DOMINIO}}` (utenti dei negozi) e `admin.{{DOMINIO}}` (amministratori), area 03; `@better-auth/core` è dipendenza diretta perché il plugin `sessionPolicy` importa `@better-auth/core/context`, che con pnpm non è raggiungibile come dipendenza solo transitiva (area 03) | [VERIFICA] nomi e pacchetti dei plugin sulla versione installata; `@better-auth/core` con la stessa versione esatta di `better-auth`, aggiornati insieme |
| Lavori in background | pg-boss | [VERIFICA] opzioni di installazione dello schema |
| Proxy/HTTPS | Caddy 2 compilato con `github.com/caddy-dns/cloudflare`, solo HTTP/1.1 e HTTP/2 (HTTP/3 disattivato: basta la porta 443/TCP) | Immagine costruita con `xcaddy` |
| File | Archivio S3 compatibile in UE con versioning (Hetzner o Scaleway) tramite `@aws-sdk/client-s3`; file e backup di ogni ambiente in unità separate con credenziali proprie, più una copia specchio dei backup che la produzione non può cancellare (OPS-007, OPS-008) | — |
| Email | Fornitore con dati in UE (es. Brevo) dietro un'interfaccia `EmailSender` | Il fornitore si cambia in un file |
| Pagamenti | Stripe (Billing, Checkout, Customer Portal) con SDK `stripe` | Versione API fissata nel client |
| Fattura elettronica | Fornitore SDI via API dietro l'interfaccia `InvoicingProvider` (`src/server/invoicing/provider.ts`); candidati Fatture in Cloud, Openapi, A-Cube [VERIFICA: scelta]; fornitore finto in sviluppo e CI | Il fornitore si cambia in un file |
| Errori | Sentry, regione dati UE: `@sentry/nextjs` nell'app, `@sentry/node` nel worker | — |
| Test | Vitest (unità e integrazione), Playwright (end-to-end) | — |
| Hash e cifratura | SHA-256 per token casuali ad alta entropia; AES-256-GCM per i segreti in coda (`JOB_PAYLOAD_KEY`) e per i segreti per negozio (`SHOP_SECRETS_KEY`); le password le gestisce Better Auth | — |

Nessuna nuova dipendenza di produzione senza motivarla nella specifica dell'area.

## 2. Struttura del repository

```
/
├─ CLAUDE.md
├─ specs/                     queste specifiche
├─ src/
│  ├─ proxy.ts                riconoscimento host → area (sito, app, admin, prodotto)
│  ├─ app/
│  │  ├─ x-site/              sito pubblico del negozio (fase 0: pagina segnaposto)
│  │  ├─ x-gestione/[slug]/   gestionale del negozio (URL pubblico app.{{DOMINIO}}/n/<slug>)
│  │  ├─ x-app/               login, scelta del negozio (/n), inviti, sicurezza, recupero password (solo app.{{DOMINIO}})
│  │  ├─ x-admin/             pannello amministratore (solo admin.{{DOMINIO}})
│  │  ├─ x-product/           sito del prodotto ({{DOMINIO}})
│  │  └─ api/                 auth, webhook, health
│  │                          (le cartelle x-* si raggiungono solo con la riscrittura di proxy.ts)
│  ├─ modules/<codice>/       un modulo = una cartella (manifest, pagine, server)
│  ├─ lib/
│  │  └─ sentry-scrub.ts      scrubUrl, usata da app (server e browser) e worker (area 08)
│  ├─ server/
│  │  ├─ db/                  schema, client, withShop, withUser, funzioni di piattaforma, auth-counters.ts (query degli hook di accesso, importabile da src/server/auth/**), isolation/ (elenco consentito dei permessi e costruttori delle fixture inerti, condivisi dai test di integrazione e da isolation-check.ts, NEG-T05)
│  │  ├─ auth/                Better Auth e plugin del progetto (invites, sessionPolicy, pwnedCheck, admin-enrollment)
│  │  ├─ billing/             Stripe
│  │  ├─ ops/                 operatività: cert.ts (scadenza del certificato, aree 07 e 08), registrazione dei backup (ops:record-*)
│  │  ├─ invoicing/           fattura elettronica (interfaccia e fornitore SDI)
│  │  ├─ secrets/             segreti per negozio (shop_secrets)
│  │  ├─ jobs/                definizione dei lavori pg-boss
│  │  ├─ audit/               registro delle azioni
│  │  ├─ email/               interfaccia e fornitore email
│  │  ├─ exports/             esportazione dei dati (redact.ts, costruzione dello ZIP; aree 02 e 08)
│  │  └─ storage/             archivio file
│  ├─ config/
│  │  ├─ platform.ts          valori di configurazione e segnaposto
│  │  ├─ env.ts               schemi zod delle variabili d'ambiente, uno per processo (area 01)
│  │  ├─ plans.ts             piani, moduli acquistabili, dicitura dei prezzi (area 05)
│  │  ├─ terms.ts             versione e clausole delle condizioni (aree 03 e 08)
│  │  ├─ audit-exempt.ts      scritture di servizio esenti dal registro (area 08; creato in FON-T10 con il primo helper audit())
│  │  └─ subprocessors.ts     elenco dei sub-responsabili (area 08)
│  ├─ worker.ts               processo dei lavori in background
│  ├─ migrate.ts              migrazioni (servizio migrate)
│  ├─ isolation-check.ts      controllo di separazione eseguibile in produzione (collaudo C12)
│  └─ cli.ts                  comandi da riga di comando (admin:grant, …)
├─ drizzle/                   migrazioni SQL generate e manuali
├─ docs/                      verifiche manuali (docs/verifiche/), documenti legali (docs/legale/)
├─ infra/                     Caddy, compose, PostgreSQL, pgBackRest, script (infra/scripts/, tra cui check-fresh-clone.sh e backup.sh), README, INCIDENTI.md, RIPRISTINO.md
└─ tests/                     integration/, e2e/, fixtures/, architecture/ (test di architettura), load/ (script k6 del test di carico, OPS-045)
```

## 3. Regole sui dati dei negozi (non negoziabili)

1. **R-DATI-1.** Ogni dato che appartiene a un negozio sta in una tabella con colonna `shop_id uuid NOT NULL`. Unica eccezione: `audit_log`, dove `shop_id` nullo indica un'azione di piattaforma (area 08); quelle righe non sono visibili ad `app_user`.
2. **R-DATI-2.** Ogni tabella con `shop_id` ha `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` e la policy di separazione definita in `02-negozi-separazione.md`.
3. **R-DATI-3.** Il codice dell'applicazione accede ai dati di un negozio **solo** dentro `withShop(ctx, fn)`. Il client del database non si importa fuori da `src/server/db/` (regola ESLint `no-restricted-imports`). Eccezioni: l'adattatore di Better Auth, esportato da `src/server/db/auth-adapter.ts` e importato solo da `src/server/auth/auth.ts`; le query SQL dirette degli hook di accesso sulle tabelle senza `shop_id` (contatori `two_factor_failures` e `login_failures`, `known_logins`, conteggio dei fattori dell'utente, cancellazione delle sessioni provvisorie del TOTP), esportate da `src/server/db/auth-counters.ts` e importabili da qualsiasi file sotto `src/server/auth/` (i plugin del progetto e le callback della configurazione in `src/server/auth/auth.ts`, come `onPasswordReset`; nella regola ESLint l'eccezione vale per il modello `src/server/auth/**`, area 03); le connessioni del proprietario e del controllo di separazione, esportate da `src/server/db/owner-client.ts` e importate solo dai punti di ingresso `src/migrate.ts`, `src/cli.ts` e `src/isolation-check.ts` (area 01); i test in `tests/**` (aiuto `tests/fixtures/db.ts`, area 01).
4. **R-DATI-4.** Ogni migrazione che crea una tabella di piattaforma (senza `shop_id`) esegue subito `REVOKE ALL ON <tabella> FROM app_user, app_worker` e poi concede a ciascuno dei due ruoli solo i permessi indicati nella specifica. Lo stesso vale per le revoche sulle tabelle dei negozi (es. `shops`, `audit_log`, `shop_modules`, `subscriptions`): si scrivono sempre per entrambi i ruoli. Il test NEG-012 confronta i permessi reali di `app_user`, `app_worker` e `app_jobs` su ogni tabella con l'elenco consentito in `src/server/db/isolation/privileges.allowlist.ts` (importato sia dai test di integrazione sia da `src/isolation-check.ts`, area 02 NEG-T05).
5. **R-DATI-5.** Stato di fatturazione del negozio (`shops.status` e colonne collegate), `subscriptions` e `shop_modules` si modificano **solo** tramite funzioni di piattaforma (area 02), eccetto i comandi CLI con credenziali del proprietario elencati in 01 (`billing:reset-customer`, `admin:reset-2fa`, `admin:purge-test-shops`, …), che scrivono direttamente e registrano l'azione nel registro di piattaforma. Le funzioni che cambiano lo stato di pagamento e le righe `plan`/`purchase` sono eseguibili solo da `app_worker`; tra le funzioni che toccano fatturazione e moduli, dall'app web sono eseguibili solo `billing_customer_for_shop`, `billing_attach_checkout`, `stripe_event_record` (limitate al negozio del contesto o senza effetti sullo stato), le funzioni di sola lettura `platform_config_get` e `sdi_invoices_stale` (U e W) e le funzioni `admin_*`; l'elenco completo e vincolante dei ruoli è la colonna "Ruoli" in 02. Il controllo `is_platform_admin(app_user_id())` dentro le funzioni `admin_*` protegge solo da errori di logica: `app_user` può impostare `app.user_id` da sé, quindi il controllo vero è quello dell'app.
6. **R-DATI-6.** Le operazioni che devono leggere prima di conoscere il negozio usano **solo** le funzioni di piattaforma elencate in `02-negozi-separazione.md`. Aggiungerne una richiede di aggiornare quella specifica.
7. **R-DATI-7.** Il test di separazione (NEG-T05) gira a ogni rilascio e scopre da solo le tabelle con `shop_id`: una tabella nuova senza RLS fa fallire il test.
8. **R-DATI-8.** Le chiavi esterne tra tabelle di negozi includono `shop_id` quando serve a impedire collegamenti tra negozi diversi (vincolo composto `(shop_id, id)`).
9. **R-DATI-9.** Le tabelle che contengono registrazioni fiscali o di vendita (in fase 0 solo `sdi_invoices`, specchio delle fatture del fornitore della piattaforma, per importi e identificativi; dal modulo cassa anche documenti commerciali, righe di vendita, incassi) sono **solo in aggiunta**: una correzione è una nuova riga di storno che rimanda alla riga corretta, mai una modifica o una cancellazione. Ai ruoli di runtime non si concede `UPDATE` né `DELETE` su quelle tabelle (eccezione dichiarata nella specifica per le sole colonne di stato tecnico, come `sdi_invoices.status`), e un trigger `BEFORE UPDATE OR DELETE`, chiamato **sempre** `append_only_guard` su ogni tabella di sola aggiunta, le rifiuta anche per il proprietario, così nemmeno una migrazione sbagliata o uno script le altera in silenzio. La cancellazione di un negozio (`purge_shop`) è l'unica eccezione, dichiarata nella funzione, e avviene con il trigger disabilitato nella stessa transazione: la funzione lo cerca per nome in `pg_trigger` su ogni tabella con `shop_id` che lo ha, così funziona anche prima che esista la prima tabella fiscale (BIL-T09 precede BIL-T11) e copre da sola le tabelle del modulo cassa. Poiché `TRUNCATE` non attiva i trigger di riga, ogni tabella di sola aggiunta ha anche un secondo trigger, chiamato **sempre** `append_only_guard_truncate`, `BEFORE TRUNCATE … FOR EACH STATEMENT`, che solleva sempre un errore (anche per il proprietario): `purge_shop` non lo disabilita mai, perché cancella per negozio con `DELETE`, mai con `TRUNCATE`. Le fatture che la **piattaforma** ha emesso a un negozio non si perdono con la sua cancellazione: prima di cancellare, `purge_shop` ne copia le righe di `sdi_invoices` arrivate allo SDI (stato `sent`, `accepted` o `rejected`; solo per i negozi non `is_test`) nella tabella di piattaforma `issued_invoices_archive` (area 05: senza colonna `shop_id`, quindi fuori dalla scoperta automatica delle tabelle di negozio, senza permessi ai ruoli di runtime, anch'essa solo in aggiunta con gli stessi due trigger), perché la piattaforma come emittente ha l'obbligo di conservarle 10 anni.
10. **R-DATI-10.** I segreti che appartengono a un negozio (credenziali di fornitori esterni, in futuro quelle del fornitore del documento commerciale) stanno **solo** in `shop_secrets` (area 02), cifrati con AES-256-GCM e la chiave `SHOP_SECRETS_KEY`, che hanno solo app e worker e che non sta né nel database né nei backup (stesso trattamento di `JOB_PAYLOAD_KEY`, §4.3). Mai in colonne di altre tabelle, nei log, nelle esportazioni o in Sentry. Si leggono e si scrivono solo con `src/server/secrets/shop-secrets.ts`, dentro `withShop`.

## 4. Sicurezza

1. Segreti solo in variabili d'ambiente, validate all'avvio con uno schema (`zod`): l'app non parte se manca una variabile. Ogni servizio ha il suo file di ambiente con le sole variabili che gli servono. Di **tutti** i segreti (file di ambiente, `PGBACKREST_REPO1_CIPHER_PASS`, token Cloudflare, chiavi Stripe, chiavi S3, `JOB_PAYLOAD_KEY`, `SHOP_SECRETS_KEY`) esiste una copia cifrata fuori linea in un gestore di password più una copia sigillata su carta o chiavetta, aggiornata a ogni rotazione (OPS-009): senza `PGBACKREST_REPO1_CIPHER_PASS` i backup sono illeggibili.
2. Nessun dato personale, token o password nei log o negli errori inviati a Sentry (filtro `beforeSend`).
3. Token casuali (inviti, recupero password, registrazione degli amministratori, link di conferma del primo fattore; le esportazioni non hanno token propri: il download usa link firmati di 15 minuti, 08 OPS-031) salvati solo come hash, senza eccezioni. I token del progetto (inviti, registrazione degli amministratori, link `factor-enroll` di area 03) si generano con `crypto.randomBytes(32)` e si salvano con SHA-256; il token di recupero password lo genera Better Auth stesso (`generateId(24)` in 1.7.18) e lo salva con l'hash dell'opzione `verification.storeIdentifier` (prefisso `reset-password:` in modalità `hashed`, area 03, ACC-013). Quando un token in chiaro deve passare per una coda (per esempio il link d'invito nel lavoro `email.send`), il campo si cifra con AES-256-GCM e la chiave `JOB_PAYLOAD_KEY`, che hanno solo app e worker e che non sta né nel database né nei backup di pgBackRest (gli snapshot della VPS invece contengono sia i file di ambiente sia i dati: si trattano come segreti, vedi `infra/INCIDENTI.md`) (`sealJobSecret` / `openJobSecret` in `src/server/jobs/seal.ts`): le righe di `pgboss.job`, i WAL e i backup contengono solo il testo cifrato. I lavori `email.send` si creano inoltre con conservazione breve dopo il completamento (1 ora) (opzione `deleteAfterSeconds` di `send`, verificata in pg-boss 12.38).
4. Ogni azione che modifica dati di un negozio o della piattaforma scrive una riga in `audit_log` nella stessa transazione (per le scritture fatte da Better Auth: subito dopo, dai suoi hook; area 08, OPS-020).
5. Ogni endpoint verifica sul server ruolo e modulo; nascondere un pulsante non è un controllo.
6. Le sessioni valgono solo sull'host che le ha create (`originHost`, area 03): un cookie di `app.{{DOMINIO}}` ripresentato su `admin.{{DOMINIO}}`, o viceversa, non vale mai come sessione: gli endpoint di Better Auth rispondono 401 e fanno scadere il cookie (`Max-Age=0`), `requireShopAccess` e `requireAdmin` rispondono come senza sessione (03 §`sessionPolicy`). Gli header `Set-Cookie` di scadenza viaggiano **dentro** l'`APIError` lanciato dall'hook (terzo argomento `headers`): un hook `before` che lancia non restituisce una risposta, e `toResponse` di better-call usa solo `error.headers`, quindi un `ctx.setCookie` fatto prima del `throw` andrebbe perso.

## 5. Test

- Ogni requisito ha almeno un test con l'ID nel nome, oppure una prova di collaudo in 09 che lo cita.
- I test sulla separazione dei dati e sulle policy girano su un PostgreSQL 18 reale (servizio Docker in CI), mai su simulazioni.
- Le logiche con stati (fatturazione, sessioni, moduli) sono funzioni pure testate con tabelle di casi.
- **Tempo nei test.** Il tempo valutato in SQL resta sempre `now()` del database (finestre di `two_factor_failures` e `login_failures`, `factorEnrollUntil`, scadenze di `verification` e `invitations`, `pending_since`, soglie in giorni delle funzioni di piattaforma): nessun orologio finto lo sposta. I test spostano il tempo **retrodatando le righe** (`window_start`, `last_failure_at`, `pending_since`, `accepted_at`, `created_at`, `last_activity_at`, `expires_at`, `authenticatedAt`, `createdAt`, `received_at`, …) con il client del proprietario dei test (`tests/fixtures/db.ts`); lo stesso vale per le date salvate che Better Auth confronta in JavaScript con l'ora reale (scadenze di `session` e `verification`). Solo il tempo valutato in JavaScript senza una riga da retrodatare usa un orologio iniettato: le funzioni pure ricevono `now` dal test (`computeBillingState(…, now)`, `checkSessionPolicy(session, now)`, `isModuleActive(rows, shopStatus, now)`) e i gestori con una finestra oraria ricevono l'orologio come dipendenza (la finestra 8:00–8:05 di `billing.events.retry`, area 05). Un confronto fatto in SQL non si prova mai con l'orologio iniettato.
- La CI blocca l'unione se lint, typecheck, test unitari o di integrazione falliscono.

## 6. Database e migrazioni

- Quattro ruoli di login:
  - `app_owner`: proprietario delle tabelle dello schema `public` e dello schema `drizzle` delle migrazioni, `BYPASSRLS`, usato **solo** dal servizio `migrate` e dagli script da riga di comando sul server. Le sue credenziali non arrivano mai ai container `app` e `worker`.
  - `app_user`: runtime dell'app web (`app`) per tutti i dati, `NOBYPASSRLS`, non proprietario di nulla.
  - `app_worker`: runtime del processo `worker`, `NOBYPASSRLS`, permessi sulle tabelle elencati separatamente nell'elenco consentito (di base come `app_user`, più le poche scritture di pulizia indicate nelle aree), più `EXECUTE` sulle funzioni di piattaforma con "W" nella colonna "Ruoli" dell'elenco in 02 (tra cui quelle che cambiano lo stato di pagamento o le righe `plan`/`purchase` dei moduli, cancellazione dei negozi e operazioni notturne, che `app_user` non può eseguire). Così nessuna richiesta web, nemmeno con un bug, può cambiare lo stato di pagamento o cancellare (`purge_shop`) un negozio. Le funzioni `admin_*` del pannello invece sono U: una di esse, `admin_close_shop`, può chiudere un negozio, e si affida al controllo `is_platform_admin(app_user_id())` al suo interno, con il limite dichiarato in R-DATI-5 (`app_user` può impostare `app.user_id` da sé: il controllo vero è quello dell'app, `requireAdmin`).
  - `app_jobs`: crea e possiede lo schema `pgboss` (ha `CREATE` sul database solo per questo), `NOBYPASSRLS`, senza permessi sullo schema `public`; usato da app e worker solo per la coda dei lavori. Così pg-boss può installare e aggiornare il suo schema e creare le code senza toccare i dati dei negozi.
- Le funzioni `SECURITY DEFINER` appartengono ad `app_owner`, hanno `SET search_path = public, pg_temp`, `REVOKE EXECUTE ... FROM PUBLIC` e `GRANT EXECUTE` solo ai ruoli indicati nella colonna "Ruoli" dell'elenco in 02.
- Identificativi con `uuidv7()` di PostgreSQL 18, tranne le tabelle di Better Auth che usano i suoi id testuali.
- Migrazioni solo additive nello stesso rilascio ("expand/contract"): una colonna si rimuove almeno un rilascio dopo che il codice non la usa più.
- Le parti che Drizzle non esprime (FORCE RLS, funzioni, permessi, trigger) stanno in migrazioni SQL scritte a mano create con `drizzle-kit generate --custom` (il migratore applica solo i file registrati in `drizzle/meta/_journal.json`; un file `.sql` aggiunto a mano senza registrazione viene ignorato). `pnpm db:migrate` esegue `src/migrate.ts` con `.env.migrate`, non `drizzle-kit migrate`, così in sviluppo girano anche l'aggiornamento di `platform_config` e la sincronizzazione dei moduli.
- Nel codice SQL (funzioni, migrazioni, query) i nomi di tabelle e funzioni dello schema `public` si scrivono qualificati (`public.shops`) nelle funzioni `SECURITY DEFINER`; il `search_path` fisso dei ruoli (area 01) protegge il resto. Nel SQL scritto a mano (funzioni, migrazioni, query di `auth-counters.ts`, comandi CLI, test) **ogni** identificativo di Better Auth, nome di tabella o di colonna, si scrive tra virgolette doppie: `"user"`, `"session"`, `"account"`, `"verification"`, `"rateLimit"`, `"twoFactor"`, `"passkey"`, `"id"`, `"userId"`, `"expiresAt"`, `"identifier"`, `"value"`, `"providerId"`, `"twoFactorEnabled"`, `"verified"`, … (anche qualificati: `public."user"`). I nomi fisici sono singolari e in camelCase, uguali ai nomi dei campi di Better Auth, senza mappatura in snake_case né `usePlural`: il generatore Drizzle del CLI di Better Auth (`auth generate`) converte i nomi in snake_case se l'adattatore Drizzle non ha `camelCase: true`, quindi l'adattatore è **sempre** `drizzleAdapter(db, { provider: 'pg', camelCase: true })`, creato da un'unica funzione di `src/server/db/auth-adapter.ts` e usato sia da `auth generate` sia a runtime (03 §Better Auth, ACC-T01). Senza virgolette PostgreSQL porta il nome in minuscolo (`twoFactor` diventa `twofactor`, `userId` diventa `userid`) e la query fallisce, e `user` è una parola riservata. Non servono per le tabelle del progetto (`two_factor_failures`, `known_logins`, …) né per le colonne del progetto in snake_case aggiunte a una tabella di Better Auth (es. `pending_since` di `"twoFactor"`).

- **Permessi per colonna e Drizzle.** Su tabelle dove un ruolo ha permessi solo su alcune colonne (es. `INSERT` su `exports` e `terms_acceptances`; `SELECT (id, name, email)` su `user` per `app_worker`), l'inserimento o la lettura NON DEVONO usare `insert(t).values()` né `select().from(t)` di Drizzle: il costruttore di inserimenti elenca tutte le colonne (anche quelle non valorizzate, come `default`) e PostgreSQL controlla il permesso su ciascuna. Si usano query SQL esplicite con `tx.execute`, per esempio `INSERT INTO exports (shop_id, requested_by) VALUES (...)`, o `select({ id: user.id, ... })` con le sole colonne permesse, tramite un helper in `src/server/db/column-grants.ts`. Un test di integrazione esegue ciascuna di queste operazioni con il ruolo reale.

## 7. Interfaccia

- Italiano, date `gg/mm/aaaa`, valuta EUR con formato `it-IT`, fuso `Europe/Rome`.
- Usabile da tablet e telefono (larghezza minima 360 px) e da tastiera.
- Messaggi d'errore che dicono cosa è successo e cosa fare.

## 8. Glossario

| Termine | Significato | Nome nel codice |
|---|---|---|
| Negozio | Cliente della piattaforma | `shop` |
| Titolare | Ruolo con tutti i permessi sul negozio | `owner` |
| Responsabile | Gestione quotidiana e impostazioni; vede i membri in sola lettura, senza abbonamento e senza gestione degli utenti | `manager` |
| Operatore | Lavora al banco; in fase 0 il ruolo esiste nel vincolo CHECK ma nessuno può crearlo: arriva con il modulo cassa (`10-rinviato.md`) | `operator` |
| Contabile | Sola lettura ed esportazioni | `accountant` |
| Amministratore | Tu, gestore della piattaforma | `platform_admin` |
| Modulo | Funzione vendibile attivabile per negozio | `module` |
| Tolleranza | Giorni di uso normale dopo un pagamento non riuscito | `graceDays` |
| Slug | Sottodominio del negozio, usato anche nell'URL del gestionale `app.{{DOMINIO}}/n/<slug>` | `subdomain` |

## Registro delle modifiche
- 3/11/2026 — prima versione.
- 3/11/2026 — quarta revisione: ruolo `app_worker` per il processo in background.
- 3/11/2026 — dopo la revisione indipendente: terzo ruolo `app_jobs`, credenziali del proprietario fuori da app e worker, cartelle `x-*`, Sentry per il worker.
- 6/11/2026 — seconda revisione indipendente: un solo host per il gestionale (`app.{{DOMINIO}}`, niente passaggio tra host); dispositivi del banco, PIN, domini dei clienti, fattura di recupero, sessioni di assistenza e prova di ripristino automatica rinviati (`10-rinviato.md`); regole R-DATI rinumerate in ordine; nuove R-DATI-9 (tabelle fiscali solo in aggiunta) e R-DATI-10 (segreti per negozio); copia fuori linea dei segreti; fattura elettronica SDI per gli abbonamenti; HTTP/3 disattivato.
- 6/11/2026 — terza revisione indipendente: R-DATI-9 chiarisce che in fase 0 l'unica tabella fiscale è `sdi_invoices`; il controllo delle password trapelate passa dal plugin del progetto `pwnedCheck` (timeout e fallback, area 03) invece di `haveIBeenPwned()` registrato direttamente.
- 7/11/2026 — quarta revisione indipendente: §4.6 precisa l'esito di un cookie di sessione ripresentato su un altro host (401 e cookie fatto scadere dall'hook di `sessionPolicy`, unico meccanismo); R-DATI-5 dichiara l'eccezione dei comandi CLI con credenziali del proprietario (area 01), che scrivono direttamente e registrano l'azione.
- 7/11/2026 — quinta revisione indipendente: §4.6 precisa che gli header `Set-Cookie` di scadenza viaggiano nell'`APIError` dell'hook (terzo argomento), non in `ctx.setCookie`; R-DATI-5 elenca anche le funzioni di sola lettura `platform_config_get` e `sdi_invoices_stale` tra quelle eseguibili dall'app; `audit-exempt.ts` nasce in FON-T10.
- 7/11/2026 — sesta revisione: §1 aggiunge `@better-auth/core` come dipendenza diretta, con la stessa versione esatta di `better-auth` (import di `@better-auth/core/context` nel plugin `sessionPolicy`, area 03).
- 7/11/2026 — settima revisione: §6 (`app_worker`) riformula l'eccezione delle funzioni `admin_*`: le richieste web non cambiano lo stato di pagamento né cancellano un negozio, ma `admin_close_shop` può chiuderlo e si affida al controllo `is_platform_admin(app_user_id())`, con il limite di R-DATI-5.
- 7/11/2026 — ottava revisione: R-DATI-9 aggiunge il trigger `append_only_guard_truncate` (`BEFORE TRUNCATE`) su ogni tabella di sola aggiunta e la copia delle fatture emesse dalla piattaforma in `issued_invoices_archive` prima di `purge_shop` (obbligo decennale dell'emittente).
- 7/11/2026 — nona revisione: R-DATI-9 precisa che `purge_shop` archivia solo le righe di `sdi_invoices` arrivate allo SDI (`sent`, `accepted`, `rejected`); il glossario allinea il responsabile alla matrice di 03 ACC-010 (vede impostazioni e membri, questi in sola lettura).
- 7/11/2026 — decima revisione: §4.3 toglie le esportazioni dall'elenco dei token casuali salvati come hash (il download usa link firmati di 15 minuti generati dopo il controllo dei permessi, 08 OPS-031: nessun token dell'esportazione viene salvato).
- 7/11/2026 — undicesima revisione: §4.3 toglie l'eccezione del token di recupero password (ora salvato come hash con `verification.storeIdentifier` di Better Auth, 03 ACC-013); §5 aggiunge la regola sul tempo nei test (il tempo valutato in SQL si sposta retrodatando le righe, l'orologio iniettato vale solo per il tempo valutato in JavaScript); R-DATI-3 estende l'eccezione di `auth-counters.ts` a ogni file sotto `src/server/auth/`; §6 impone le virgolette doppie per ogni identificativo di Better Auth nel SQL scritto a mano.
- 7/11/2026 — dodicesima revisione: §6 richiede l'adattatore `drizzleAdapter(db, { provider: 'pg', camelCase: true })` da un'unica funzione di `auth-adapter.ts`, sia per `auth generate` sia a runtime (senza, il generatore del CLI di Better Auth produce nomi in snake_case); §4.3 distingue i token del progetto (`crypto.randomBytes(32)`, SHA-256) dal token di recupero password, generato da Better Auth e salvato come hash con `storeIdentifier`; R-DATI-4 sposta l'elenco consentito in `src/server/db/isolation/`, condiviso da test e `isolation-check`.
