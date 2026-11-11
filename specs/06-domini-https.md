# 06 — Sottodomini, DNS e HTTPS

Rinviati (`10-rinviato.md` §2): domini propri dei clienti (ex DOM-002…DOM-007, DOM-010, DOM-011, tabella `domains`, certificati su richiesta con endpoint `ask`, lavori di verifica DNS, viste dei domini nel pannello) → modulo `sito`. In fase 0 ogni negozio è raggiungibile solo su `<sub>.{{DOMINIO}}` (sito pubblico) e su `app.{{DOMINIO}}/n/<sub>` (gestionale).

## Requisiti

**DOM-001** Ogni negozio DEVE essere raggiungibile in HTTPS su `<sottodominio>.{{DOMINIO}}` subito dopo la creazione, senza emettere un certificato per negozio.
- Accettazione: un negozio appena creato risponde su `https://<sub>.{{DOMINIO}}` con il certificato `*.{{DOMINIO}}`.

**DOM-008** I record DNS del dominio principale DEVONO essere "solo DNS" (non proxy) su Cloudflare per `*.{{DOMINIO}}`, `app.{{DOMINIO}}`, `admin.{{DOMINIO}}`, `{{DOMINIO}}`, così che Caddy gestisca il TLS. Caddy DEVE servire solo HTTP/1.1 e HTTP/2 (HTTP/3 disattivato), così verso l'esterno servono solo le porte 80 e 443 TCP.
- Accettazione: `curl -sI --http2 https://{{DOMINIO}}/api/health` risponde 200 in HTTP/2, senza un'intestazione `Alt-Svc` che annunci `h3`; nella configurazione dei server (`/srv/app/dc config --no-env-resolution`) il servizio caddy pubblica la 443 solo in TCP, senza porte `udp`. Il `curl` di Ubuntu non ha HTTP/3: `curl --http3-only` fallirebbe in ogni caso, e non è una prova.

**DOM-009** L'intestazione HSTS DEVE essere inviata con `max-age=31536000; includeSubDomains` su `{{DOMINIO}}` e tutti i suoi sottodomini, senza `preload` in fase 0.

**DOM-012** Il dominio `{{DOMINIO}}` DEVE avere i record per l'invio delle email dal fornitore (Brevo): `SPF` (TXT sulla radice che include il fornitore), `DKIM` (CNAME o TXT sul selettore indicato dal fornitore) e `DMARC` (TXT su `_dmarc.{{DOMINIO}}`, inizialmente `p=none; rua=mailto:dmarc@{{DOMINIO}}`, portato a `p=quarantine` dopo due settimane di rapporti puliti: lo fa l'utente nel pannello di Cloudflare quando ci sono almeno due settimane di rapporti puliti, al più tardi durante COL-T01, che lo controlla dalla sua lista di controllo e ne annota la data, 09). Il mittente `EMAIL_FROM` DEVE essere un indirizzo di `{{DOMINIO}}`. L'indirizzo `rua` sta su `{{DOMINIO}}` (`dmarc@{{DOMINIO}}`, inoltrato ad `ADMIN_ALERT_EMAIL`, per esempio con Cloudflare Email Routing e i suoi record MX [VERIFICA: servizio di inoltro scelto e record richiesti]): se invece si usa direttamente un `ADMIN_ALERT_EMAIL` di un altro dominio, quel dominio DEVE pubblicare il record di autorizzazione dei rapporti esterni (`{{DOMINIO}}._report._dmarc.<dominio del destinatario>` TXT `v=DMARC1`, RFC 7489 §7.1), altrimenti i ricevitori non inviano i rapporti; la scelta si annota in `infra/README.md`.
- Accettazione: le tre interrogazioni DNS di FON-T10 rispondono con i valori attesi e un'email di prova risulta `spf=pass`, `dkim=pass`, `dmarc=pass`.

## Progetto

### Caddy (`infra/caddy/`)
`Dockerfile`:
```dockerfile
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare
FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
LABEL org.opencontainers.image.source="https://github.com/<utente>/<repo>"
```
Fissare la versione di `caddy` nelle due righe `FROM` con lo stesso numero.

`Caddyfile` (schema; i valori arrivano da variabili d'ambiente):
```caddyfile
{
	email {$ACME_EMAIL}
	servers {
		protocols h1 h2
	}
}

{$BASE_DOMAIN}, *.{$BASE_DOMAIN} {
	tls {
		dns cloudflare {env.CF_API_TOKEN}
	}
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"
	request_header -x-middleware-subrequest
	request_header -x-shop-id
	request_header -x-nonce
	@email_webhook_foreign {
		host {$BASE_DOMAIN} www.{$BASE_DOMAIN}
		path /api/webhooks/email
		not remote_ip <intervalli IP pubblicati da Brevo>
	}
	respond @email_webhook_foreign 403
	encode zstd gzip
	reverse_proxy app:3000
}
```
Il token è scritto `{env.CF_API_TOKEN}` e non `{$CF_API_TOKEN}`: la forma con `$` Caddy la sostituisce quando legge il file, e il token finirebbe nella configurazione che `caddy adapt` e la porta di amministrazione di Caddy stampano; con `env.` nella configurazione resta il segnaposto, e il valore si legge solo quando serve. `BASE_DOMAIN` e `ACME_EMAIL` non sono segreti e restano con `$`, perché servono alla lettura del file.

[VERIFICA: sintassi di `servers { protocols … }`, di `request_header -<nome>` e del modulo DNS, con il token scritto `{env.CF_API_TOKEN}`, sulla versione di Caddy fissata.]

Il matcher `@email_webhook_foreign` limita `/api/webhooks/email` sull'host radice (e `www`) agli indirizzi da cui Brevo invia i webhook: è il secondo livello accanto al token `EMAIL_WEBHOOK_TOKEN` (FON-011, FON-T10), perché Brevo non firma le chiamate. Gli intervalli si scrivono nel Caddyfile (copiato nell'immagine): un loro cambio è una nuova revisione dell'immagine Caddy. [VERIFICA: intervalli IP correnti dei webhook di Brevo dalla sua documentazione; annotare la data del controllo in `infra/README.md`.]

Le tre righe `request_header -…` tolgono gli header interni dell'app: `src/proxy.ts` imposta solo `x-shop-id` (per il sito pubblico del negozio, area 02 §Instradamento punto 6; l'area raggiunta si ricava dalla riscrittura del percorso in `/x-*`, non da un header) e `x-nonce` (nonce della CSP, area 08 §Intestazioni di sicurezza, sempre sovrascritto dal proxy); `x-middleware-subrequest` non esiste in Next.js 16 (era il meccanismo delle sotto-richieste del vecchio `middleware`, sparito con il passaggio a `proxy`), quindi la sua rimozione non corregge una vulnerabilità della versione in uso: resta come difesa per il caso di una regressione o di un comportamento di versioni precedenti.

Un host non coperto dal certificato jolly (per esempio un dominio di un cliente puntato per sbaglio al server) non ottiene nessun certificato: la connessione TLS fallisce, che è il comportamento voluto in fase 0. Il proxy dell'app (area 02) toglie di nuovo gli header interni: due livelli indipendenti.

**Caddyfile di avvio** (prima revisione dell'immagine, DOM-T02): identico allo schema ma con `respond "In arrivo" 200` al posto di `reverse_proxy app:3000`, così il certificato jolly si emette e si prova prima che esista un'immagine dell'app; la revisione successiva dell'immagine (FON-T07b) mette il `reverse_proxy`.

### DNS (Cloudflare, "solo DNS")
Record `A` per `{{DOMINIO}}`, `*.{{DOMINIO}}`, `app.{{DOMINIO}}`, `admin.{{DOMINIO}}` verso l'IP del server (il record esplicito `app` e `admin` evita sorprese se il jolly viene toccato); record `AAAA` se il server ha IPv6; record di DOM-012 per le email. Stessa struttura sulla zona `{{DOMINIO_TEST}}` con l'IP del server di test, compresi i record di DOM-012: il server di test invia email vere (`EMAIL_PROVIDER=brevo` nel suo `worker.env`), con `EMAIL_FROM` su un indirizzo di `{{DOMINIO_TEST}}` e il dominio di test aggiunto su Brevo come mittente, perché gli inviti dal pannello servono anche lì (il negozio di prova e l'utente di carico di C19, 09) e un account nasce solo da un invito o da `admin:grant` (03 ACC-001); `fake` (`FakeEmailSender`, che non invia nulla) resta per sviluppo e CI, 01 §Variabili d'ambiente, FON-T10.

## Compiti

- [ ] **DOM-T01** Record DNS su Cloudflare per produzione (zona `{{DOMINIO}}`) e test (zona separata `{{DOMINIO_TEST}}`, con un token diverso), tutti "solo DNS"; record SPF, DKIM e DMARC di DOM-012 su entrambe le zone, con i due mittenti (`{{DOMINIO}}` e `{{DOMINIO_TEST}}`) configurati su Brevo, perché anche il server di test invia email vere (§DNS); ciascun token API limitato alla sua zona con **Zone › Zone › Read** e **Zone › DNS › Edit**; annota tutto in `infra/README.md`. Token, record ed Email Routing li crea l'utente nel pannello di Cloudflare, durante il compito, dall'elenco che Claude scrive in `infra/README.md` (le zone le ha create prima, `AVVIO.md` «Fuori da GitHub»; Claude non ha un accesso a Cloudflare: dalla sandbox il sito non si raggiunge, e i token sono segreti); Claude poi ne controlla la risposta come dicono i test. Test: DOM-008 (verifica manuale annotata; la parte HTTP/3 in DOM-T02), DOM-012 (i record rispondono su entrambe le zone, compreso il `rua` su `dmarc@{{DOMINIO}}` con l'inoltro attivo, o il record di autorizzazione esterna se si è scelto un altro dominio; la prova di invio si fa in FON-T10).
- [ ] **DOM-T02** (dopo FON-T07a) Immagine Caddy con il Caddyfile di avvio, costruita e pubblicata a mano su GHCR per la prima volta (comandi in `infra/README.md`, tag registrato in `infra/versions.env`; dai rilasci successivi la costruisce la CI), certificato `*.{{DOMINIO_TEST}}` sul server di test (e `*.{{DOMINIO}}` sul server di produzione, con lo stesso Caddyfile di avvio); poi la revisione con `reverse_proxy` pronta per FON-T07b. **Avvio del Caddy di bootstrap su entrambi i server**, sempre tramite Compose e mai con un `docker run` improvvisato (lo stato ACME deve vivere fin dal primo giorno nel volume Compose `app_caddy_data`, lo stesso che userà la configurazione completa: Let's Encrypt limita i certificati duplicati a 5 a settimana, e un volume diverso al passaggio a FON-T07b farebbe riemettere il certificato jolly), con questi passi, documentati in `infra/README.md`, che preparano ciò che `/srv/app/dc` e i file compose si aspettano prima che esistano gli altri servizi: copia della cartella `infra/` del repository (commit corrente) in `/srv/app/infra/`; `/srv/app/.env` con `CADDY_TAG=<tag appena pubblicato>` e, come segnaposto, `APP_TAG=bootstrap` e `POSTGRES_TAG=bootstrap` (il tag di PostgreSQL lo scrive OPS-T01a quando pubblica la sua immagine, `APP_TAG` lo aggiorna FON-T07b; i file compose richiedono le tre variabili anche per avviare un solo servizio, e un servizio non avviato non scarica l'immagine); `/srv/app/env/caddy.env` (`BASE_DOMAIN`, `ACME_EMAIL`, `CF_API_TOKEN`; permessi 600, proprietario `deploy`); nella stessa cartella (creata dall'utente in FON-T07a; i file dentro li scrive l'utente, `docs/due-postazioni.md`) i file **vuoti** `app.env`, `worker.env`, `migrate.env`, `postgres.env` (permessi 600, proprietario `deploy`), perché Compose, caricando il progetto, controlla che esistano i file `env_file` di ogni servizio anche quando ne avvia uno solo: li sostituisce l'utente con i file veri, seguendo le procedure di OPS-T01a (`postgres.env`) e FON-T07b (gli altri tre) in `infra/README.md` [VERIFICA: alternativa `env_file: [{path, required: false}]` con Compose ≥ 2.24]; `/srv/app/deploy-env` con una sola riga, `test` o `prod` (da lì `/srv/app/dc` sceglie `compose.test.yml` o `compose.prod.yml`, 01 §CI/CD; `deploy.sh` non lo tocca mai); installazione dello script `infra/scripts/dc` di FON-T06 come `/srv/app/dc` (eseguibile; da qui lo usano OPS-T01a, `backup.sh`, i timer, FON-T07b e, da FON-T08, `deploy.sh`); poi `/srv/app/dc up -d caddy` (solo il servizio `caddy`, che non ha `depends_on`: `app`, `worker` e `postgres` non hanno ancora immagini né file di ambiente veri). FON-T07b, trovando `.env`, `deploy-env`, `env/caddy.env`, `/srv/app/dc` e il volume già presenti, aggiorna solo `CADDY_TAG` con la revisione che ha il `reverse_proxy`. Test: certificato jolly emesso e servito con la risposta fissa; `docker volume ls` mostra `app_caddy_data` e `/srv/app/dc ps` elenca `caddy` nel progetto `app` (nessun container Caddy fuori dal progetto); DOM-008 (HTTP/3 né annunciato né pubblicato, HTTP/2 servito); DOM-009 (curl delle intestazioni); gli header interni `x-middleware-subrequest`, `x-shop-id` e `x-nonce` inviati dal client non arrivano all'app (prova delegata a FON-T07b, che la elenca tra i suoi test: con l'app avviata, l'endpoint di prova `GET /api/health/echo-headers`, esistente solo in `APP_ENV=test`, rispecchia gli header ricevuti e la prova asserisce che i valori inviati dal client non arrivino mai all'app: `x-middleware-subrequest` è assente; `x-nonce` e `x-shop-id`, se presenti, sono diversi dai valori inviati dal client (li ha impostati il proxy)). DOM-001 (negozio raggiungibile subito dopo la creazione) si prova nel collaudo C10, quando esistono negozi e rilasci.
