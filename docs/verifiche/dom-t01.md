# DOM-T01 — Lista di controllo: DNS ed email

Compito senza test automatici (CLAUDE.md §1). Questa lista resta ferma dopo la fase test; gli esiti si scrivono in `docs/verifiche/dom-t01-esito.md`, con i domini veri al posto dei segnaposto.

Chi esegue: **C** = Claude (con `ssh test` / `ssh prod`; dalla sandbox `dig` non esce), **U** = utente dal suo terminale o dal pannello (Cloudflare, Brevo), che detta a Claude ciò che vede. Token e chiavi non passano mai in chat.

Valori: zona di produzione `{{DOMINIO}}` → server di produzione `91.108.122.251`; zona di test `{{DOMINIO_TEST}}` → server di test `145.14.158.72` (`infra/README.md`, «Accessi e server»). Le interrogazioni si fanno con un risolutore pubblico: `dig @1.1.1.1 +short <tipo> <nome>`. L'elenco dei record da creare sta in `infra/README.md`, «DNS ed email (DOM-T01)».

Decisioni del piano: inoltro del `rua` con Cloudflare Email Routing sulla zona di produzione; un solo record SPF sulla radice di produzione, che comprende Brevo ed Email Routing; il DMARC della zona di test manda i rapporti a `dmarc@{{DOMINIO}}`, con il record di autorizzazione esterna nella zona di produzione (RFC 7489 §7.1).

## A. Prima di iniziare

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| A1 | C | `ssh test dig -v` e `ssh prod dig -v` | `dig` presente su entrambi i server (se manca, l'utente installa `bind9-dnsutils` con `admin-personale`) |
| A2 | C | `ssh test ip -6 addr show scope global` (e `prod`) | Annotato se il server ha un indirizzo IPv6 globale; decide se servono i record `AAAA` (C3) |
| A3 | C | `dig @1.1.1.1 +short NS {{DOMINIO}}` e `NS {{DOMINIO_TEST}}` | Due nomi `*.ns.cloudflare.com` per ciascuna zona: le zone sono attive su Cloudflare |
| A4 | U | Pannello di Brevo, «Senders, Domains» | I due domini `{{DOMINIO}}` e `{{DOMINIO_TEST}}` sono presenti |

## B. Token API di Cloudflare (U)

| # | Controllo | Esito atteso |
|---|---|---|
| B1 | Token della zona di produzione, letto nel pannello («My Profile» → «API Tokens») | Permessi esattamente **Zone › Zone › Read** e **Zone › DNS › Edit**; «Zone Resources»: `Include` → `Specific zone` → `{{DOMINIO}}`, nient'altro; nessun filtro IP che escluda il server di produzione |
| B2 | Token della zona di test | Come B1, con `{{DOMINIO_TEST}}` come unica zona; è un token diverso da B1 |
| B3 | Conservazione | I due token sono nel gestore di password (OPS-009); non sono stati scritti in chat, in git né in un file del progetto |

## C. Record dei server, «solo DNS» (DOM-008)

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| C1 | C | `dig @1.1.1.1 +short A` su `{{DOMINIO}}`, `app.{{DOMINIO}}`, `admin.{{DOMINIO}}` e su un nome inventato del jolly (`prova-dom-t01.{{DOMINIO}}`) | Tutti rispondono **solo** `91.108.122.251` (nessun indirizzo di Cloudflare: il record non passa dal proxy) |
| C2 | C | Gli stessi quattro nomi su `{{DOMINIO_TEST}}` | Tutti rispondono **solo** `145.14.158.72` |
| C3 | C | `dig @1.1.1.1 +short AAAA` sugli stessi otto nomi | Se A2 ha trovato un IPv6 globale: l'indirizzo IPv6 di quel server; altrimenti nessuna risposta |
| C4 | U | Pannello DNS delle due zone | I record di C1–C3 (`@`, `*`, `app`, `admin`) hanno la nuvola grigia, «DNS only»; nessun altro record `A`/`AAAA`/`CNAME` sugli stessi nomi |

## D. Record delle email (DOM-012)

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| D1 | C | `dig @1.1.1.1 +short TXT {{DOMINIO}}` | **Un solo** record che inizia con `v=spf1`; comprende l'`include` indicato da Brevo e `include:_spf.mx.cloudflare.net`; termina con `~all` (o `-all`) |
| D2 | C | `dig @1.1.1.1 +short TXT {{DOMINIO_TEST}}` | **Un solo** record `v=spf1` con l'`include` di Brevo, che termina con `~all` (o `-all`) |
| D3 | C | Il codice di verifica di Brevo (TXT `brevo-code:…` o quello indicato dal pannello) su entrambe le radici | Presente e uguale a quello del pannello (U legge il valore e lo detta) |
| D4 | C | I record DKIM indicati da Brevo (nome e tipo come nel pannello, per esempio `CNAME brevo1._domainkey`, `brevo2._domainkey`) su entrambe le zone | Rispondono con i valori del pannello di Brevo |
| D5 | U | Pannello di Brevo, i due domini | Entrambi «autenticati» (DKIM e DMARC con il segno verde, o la dicitura equivalente annotata) |
| D6 | C | `dig @1.1.1.1 +short TXT _dmarc.{{DOMINIO}}` | Un solo record: `v=DMARC1; p=none; rua=mailto:dmarc@{{DOMINIO}}` |
| D7 | C | `dig @1.1.1.1 +short TXT _dmarc.{{DOMINIO_TEST}}` | Un solo record: `v=DMARC1; p=none; rua=mailto:dmarc@{{DOMINIO}}` |
| D8 | C | `dig @1.1.1.1 +short TXT {{DOMINIO_TEST}}._report._dmarc.{{DOMINIO}}` | `v=DMARC1` |
| D9 | C | `dig @1.1.1.1 +short MX {{DOMINIO}}` | I record MX di Cloudflare Email Routing (nomi `route*.mx.cloudflare.net`, annotati con le priorità) |
| D10 | U | Pannello Email Routing della zona `{{DOMINIO}}` | Servizio attivo; indirizzo di destinazione (quello di `ADMIN_ALERT_EMAIL`) «Verified»; regola `dmarc@{{DOMINIO}}` → quella destinazione, attiva |
| D11 | U | Email di prova dalla propria casella a `dmarc@{{DOMINIO}}` | Arriva nella casella di `ADMIN_ALERT_EMAIL` |

## E. Documentazione (C)

| # | Controllo | Esito atteso |
|---|---|---|
| E1 | `infra/README.md`, «DNS ed email (DOM-T01)» | Contiene l'elenco completo dei token e dei record delle due zone, la scelta per il `rua` (Email Routing), la data dei controlli; nessun segreto |
| E2 | `specs/06-domini-https.md` | Esito del [VERIFICA] di DOM-012 (servizio di inoltro e record richiesti) annotato |

## Test del compito (06 DOM-T01)

- **DOM-008** (verifica manuale, parte DNS): A3, C1, C2, C3, C4. La parte HTTP/2 e HTTP/3 è di DOM-T02.
- **DOM-012** (i record rispondono su entrambe le zone, compreso il `rua` con l'inoltro attivo): D1–D11. La prova di invio (`spf=pass`, `dkim=pass`, `dmarc=pass`) è di FON-T10.
- **Token per zona:** B1–B3.
