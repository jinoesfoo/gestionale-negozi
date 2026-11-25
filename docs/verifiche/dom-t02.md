# DOM-T02 — Lista di controllo: Caddy, certificati e avvio sui due server

Questa lista resta ferma dopo la fase test; gli esiti si scrivono in `docs/verifiche/dom-t02-esito.md`, con i domini veri al posto dei segnaposto. Le parti automatiche sono due: `tests/unit/infra/caddy.test.ts`, che legge come testo il Caddyfile, il Dockerfile, `infra/versions.env` e la rete `edge` di `infra/compose.yml`; e la prova del filtro dei registri `tests/infra/caddy-log/prova.sh`, che gira con Docker e senza rete. I comandi esatti delle righe qui sotto stanno in `infra/README.md`, nelle sottosezioni DOM-T02 di «Caddy e certificati» e di «File di ambiente dei server». I comandi si possono correggere durante la fase codice; i controlli e gli esiti attesi no.

Chi esegue:
- **C** = Claude: Docker in locale su yoo; sui server con `ssh test` e `ssh prod`, come `deploy`. Ogni comando verso `prod` lo conferma l'utente, anche quando serve a provare il server di test.
- **U** = utente, dal suo terminale (`test-admin` o `prod-admin`, poi `sudo -iu deploy`) o dai pannelli di GitHub e di Hostinger. L'utente detta a Claude l'esito: una risposta o una schermata per riga, mai un «ok» per più righe.

Token e chiavi non passano mai in chat, nelle schermate, in git né nei file del progetto.

Valori (`infra/README.md`, «Accessi e server» per gli IPv4 e «DNS ed email (DOM-T01)» per gli IPv6):

| Server | Indirizzo IPv4 | Indirizzo IPv6 | Dominio |
|---|---|---|---|
| test | `145.14.158.72` | `2a02:4780:d:8458::1` | `{{DOMINIO_TEST}}` |
| produzione | `91.108.122.251` | `2a02:4780:c:f90c::1` | `{{DOMINIO}}` |

L'immagine `ghcr.io/jinoesfoo/gestionale-negozi-caddy` ha due revisioni:
- `2.11.9-1`, di avvio: il Caddyfile ha `respond "In arrivo - {remote_host}" 200` al posto di `reverse_proxy app:3000`;
- `2.11.9-2`: il Caddyfile del repository, con il `reverse_proxy`.

Sui server gira la `2.11.9-1` fino a FON-T07b.

Un tag pubblicato non si ripubblica mai (nota (2) del piano). Se dopo una pubblicazione cambia un file di `infra/caddy/`, serve una revisione nuova. Siccome questa lista nomina i due tag, per aggiornarla si torna ai test (`TORNA AI TEST`).

Decisioni del piano (06 §Caddy, §DNS e §Compiti, note del piano di DOM-T02):
- le due revisioni, con `CADDY_TAG=2.11.9-2` sul ramo;
- IPv6 sulla sola rete `edge`;
- il blocco `log default`, che toglie la richiesta dai registri di Caddy;
- il filtro del token;
- i webhook si registrano solo dopo il passaggio alla `2.11.9-2`.

**Regola del token** (06 §Caddy, nota (4) del piano):
- Finché Caddy non è partito senza errori su un server (E4), su quel server Claude lancia ogni comando `/srv/app/dc` (tranne `config --no-env-resolution`) e legge i log di Caddy solo attraverso il filtro.
- Il filtro gira sul server, dopo `2>&1`, e il comando comincia con `set -o pipefail;`.
- Se un'uscita mostra comunque il valore del token, ci si ferma: vale «Token esposto» (`infra/README.md`, «DNS ed email», punto 2).

## A. Prima di iniziare

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| A1 | U | Rotta e indirizzo IPv6 di ciascun server (`ip -6 route show default` e `ip -6 addr show scope global`, con `test-admin` e `prod-admin`) | Rotta predefinita `proto static`. Indirizzo globale con `valid_lft forever` e senza `dynamic`. Controllo fatto nel piano, il 24/11/2026 (06 §DNS) |
| A2 | U | Firewall di Hostinger di ciascuna VPS, nel pannello: una schermata per VPS | Le quattro regole di `infra/README.md`, «Firewall di Hostinger». Si annota se le regole valgono anche per IPv6 e se ICMP e ICMPv6 passano. Se ICMPv6 non passa, il README annota il rischio per le connessioni IPv6, perché si rompe la scoperta della MTU del percorso |
| A3 | C | Su ciascun server, come `deploy`: il programma `rsync` | Presente. Se manca, la copia di D2 si fa con `scp -r` (annotato nell'esito) |
| A4 | C | Su ciascun server, prima del primo avvio: container, volumi e porte | Nessun container Caddy. Nessun volume `app_caddy_data` né `app_caddy_config`. Sull'host nessun ascolto sulle porte 80 e 443 TCP né sulla 443 UDP |
| A5 | C | Prova del filtro dei registri con l'immagine ufficiale `caddy:2.11.9`: `docker run --rm --network none -v ./tests/infra/caddy-log:/prova:ro caddy:2.11.9 sh /prova/prova.sh` (fatta in fase test, il 24/11/2026) | `Prove: 16, come attese: 16, diverse: 0` |

## B. Revisione di avvio `2.11.9-1`, in locale (C)

| # | Controllo | Esito atteso |
|---|---|---|
| B1 | `pnpm lint`, `pnpm typecheck` e `pnpm test` sui file del ramo: il Caddyfile con il `reverse_proxy` e `CADDY_TAG=2.11.9-2` | Tutti verdi, compreso `tests/unit/infra/caddy.test.ts` |
| B2 | Commit della revisione di avvio sul ramo `dom-t02`: Caddyfile di avvio e `CADDY_TAG=2.11.9-1` | SHA annotato. Rispetto ai file di B1 cambiano due righe. Nel Caddyfile, `reverse_proxy app:3000` diventa `respond "In arrivo - {remote_host}" 200`. In `infra/versions.env`, `CADDY_TAG=2.11.9-2` diventa `CADDY_TAG=2.11.9-1` |
| B3 | Costruzione dell'immagine dal commit di B2, con il tag `2.11.9-1` | Riuscita, senza errori |
| B4 | Versioni nell'immagine | `caddy version` comincia con `v2.11.9`. `caddy list-modules --versions --skip-standard` elenca un solo modulo non standard: `dns.providers.cloudflare v0.2.4` |
| B5 | Caddyfile nell'immagine | `/etc/caddy/Caddyfile` è identico, byte per byte, a `infra/caddy/Caddyfile` del commit di B2 |
| B6 | `caddy validate` nell'immagine, senza rete, con valori finti in `BASE_DOMAIN`, `ACME_EMAIL` e `CF_API_TOKEN` (un token finto `cfut_…` nella forma che il modulo accetta) | «Valid configuration», nessun errore |
| B7 | Prova del filtro dei registri con l'immagine: come A5, con `ghcr.io/jinoesfoo/gestionale-negozi-caddy:2.11.9-1` al posto di `caddy:2.11.9` | `Prove: 16, come attese: 16, diverse: 0` |
| B8 | Pubblicazione su GHCR | Prima della pubblicazione il tag `2.11.9-1` non esiste su GHCR: nessun manifest. Pubblicazione riuscita; digest annotato |

## C. Pacchetto su GitHub (U, account `jinoesfoo`; una schermata per riga)

| # | Controllo | Esito atteso |
|---|---|---|
| C1 | Pagina del pacchetto `gestionale-negozi-caddy` | **Private** |
| C2 | Collegamento al repository (con «Connect Repository», se compare) | Collegato a `gestionale-negozi` |
| C3 | «Package settings» → «Manage Actions access» | `gestionale-negozi` con il ruolo **Write** |

## D. Preparazione di ciascun server: prima il server di test, poi la produzione

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| D1 | C | `docker pull` della `2.11.9-1`, come `deploy` | Riuscito, con lo stesso digest di B8 |
| D2 | C | Copia in `/srv/app/infra/` della cartella `infra/` di un commit del ramo (SHA annotato) | Il confronto dei file non trova differenze con `infra/` di quel commit. `infra/compose.yml` ha la rete `edge` con IPv6 |
| D3 | C | `/srv/app/.env` | Esattamente tre righe: `CADDY_TAG=2.11.9-1`, `APP_TAG=bootstrap`, `POSTGRES_TAG=bootstrap`. Proprietario `deploy` |
| D4 | C | `/srv/app/deploy-env` | Una sola riga: `test` sul server di test, `prod` in produzione |
| D5 | C | `/srv/app/dc` | File normale, non un collegamento. Stesso contenuto di `infra/scripts/dc` del commit di D2. Permessi 755, proprietario `deploy` |
| D6 | U | File di `/srv/app/env/`, scritti dall'utente come `deploy` | `caddy.env`, `app.env`, `worker.env`, `migrate.env`, `postgres.env` hanno proprietario `deploy` e permessi 600. I quattro diversi da `caddy.env` sono vuoti (0 byte) |
| D7 | U | Forma di `caddy.env`, con i comandi del README, che rispondono con un numero e non stampano i valori | Ogni controllo dà il numero indicato:<br>- righe con un valore, senza commenti né righe vuote: `3`;<br>- righe del token, senza i commenti: `1`;<br>- riga del token nella forma `CF_API_TOKEN=cfut_…` che il modulo accetta: `1`;<br>- `BASE_DOMAIN={{DOMINIO_TEST}}` esatto sul server di test, `BASE_DOMAIN={{DOMINIO}}` in produzione: `1`;<br>- riga `ACME_EMAIL=` con un indirizzo email: `1`;<br>- valori `CAMBIA`: `0` |
| D8 | U | Copia fuori linea (OPS-009) | Aggiornata con `caddy.env` di quel server. L'utente risponde «fatto» |
| D9 | C | Il filtro del token, provato sul server con righe finte | Le righe che contengono `cfut_`, `cfat_`, `CF_API_TOKEN` o «appears invalid» escono sostituite dal segnaposto, le altre escono uguali. Con `set -o pipefail;`, un comando che fallisce dà un esito diverso da 0 anche passando dal filtro |

## E. Avvio e prove su ciascun server: prima il server di test, poi la produzione

Le prove «dall'altro server» per il server di test si lanciano da `prod`, quelle per la produzione da `test`.

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| E1 | C | Avvio con `/srv/app/dc up -d caddy`, attraverso il filtro | Esito 0, nessuna riga sostituita dal filtro |
| E2 | C | `/srv/app/dc ps` (attraverso il filtro) e `docker ps -a` | Un solo container Caddy, `app-caddy-1`, nel progetto `app`, in stato «Up». Nessun container Caddy fuori dal progetto |
| E3 | C | `docker volume ls` e, dopo E4, la cartella dei certificati nel container (`/data`, cioè il volume `app_caddy_data`) | Ci sono `app_caddy_data` e `app_caddy_config`. Nella cartella dei certificati di Let's Encrypt ci sono la radice e il jolly |
| E4 | C | Log di Caddy, attraverso il filtro | Nel log:<br>- «certificate obtained successfully» per `{{DOMINIO_TEST}}` e per `*.{{DOMINIO_TEST}}` (in produzione per `{{DOMINIO}}` e `*.{{DOMINIO}}`), dall'emittente di produzione di Let's Encrypt (`acme-v02.api.letsencrypt.org`);<br>- la voce «server running» del server HTTPS (`"name":"srv0"`) con `"protocols":["h1","h2"]`, e nessuna voce «enabling HTTP/3 listener». Il server dei reindirizzamenti della porta 80 (`remaining_auto_https_redirects`) elenca i protocolli predefiniti, `h3` compreso, ma senza TLS non avvia né HTTP/2 né HTTP/3: i due avvisi «HTTP/2 skipped because it requires TLS» e «HTTP/3 skipped because it requires TLS» sono attesi;<br>- nessuna riga sostituita dal filtro e nessun errore dopo l'emissione.<br>Da qui Caddy è partito senza errori, e i log si leggono anche senza il filtro |
| E5 | C | Certificati, chiesti dall'altro server, per la radice, `www`, `app`, `admin` e un nome inventato del jolly | Per la radice il certificato di `{{DOMINIO_TEST}}`, per gli altri quello di `*.{{DOMINIO_TEST}}` (in produzione lo stesso con `{{DOMINIO}}`). Emittente Let's Encrypt di produzione, non quello di prova (`STAGING`). Validi oggi |
| E6 | C | DOM-008: `https://{{DOMINIO_TEST}}/api/health` in HTTP/2, dall'altro server, in IPv4 e in IPv6 (in produzione `{{DOMINIO}}`) | `HTTP/2 200` in tutti e due i casi, senza un'intestazione `alt-svc` |
| E7 | C | DOM-008: la configurazione Compose sul server (`/srv/app/dc config --no-env-resolution`) e le porte dell'host | Il servizio `caddy` pubblica 80 e 443 solo in TCP, senza porte `udp`. Sull'host nessun ascolto UDP sulla 443 |
| E8 | C | DOM-009: le intestazioni della radice, di `app.` e di un nome inventato del jolly | `strict-transport-security: max-age=31536000; includeSubDomains`, senza `preload` |
| E9 | C | HTTP sulla porta 80, dall'altro server, in IPv4 e in IPv6 (`curl -sI -4` e `curl -sI -6`) | In tutti e due i casi un reindirizzamento (308) allo stesso indirizzo in `https://` |
| E10 | C | 06§DNS: la risposta di avvio, chiesta dall'altro server in IPv4 e in IPv6 | `In arrivo - <IPv4 dell'altro server>` e `In arrivo - <IPv6 dell'altro server>`: a Caddy arriva l'indirizzo vero di chi chiama, non quello di un gateway di Docker |
| E11 | C | FON-011: `/api/webhooks/email` sulla radice e su `www`, chiesto dall'altro server (fuori dagli intervalli di Brevo), in IPv4 e in IPv6 | 403 in tutti e quattro i casi |
| E12 | C | Un nome fuori dai due certificati: una connessione TLS all'IP del server con il nome `esempio.invalid` | La connessione TLS fallisce (nessun certificato) e non arriva nessuna risposta HTTP |
| E13 | C | 06§DNS: la rete Docker e l'host dopo l'avvio | La rete `app_edge` ha IPv6, con una sottorete ULA (`fd…/64`); la rete `app_internal` no. Inoltro IPv6 acceso (`net.ipv6.conf.all.forwarding = 1`). Rotta predefinita IPv6 e indirizzo globale uguali ad A1 |

## F. Revisione con il `reverse_proxy`, `2.11.9-2` (C)

| # | Controllo | Esito atteso |
|---|---|---|
| F1 | Costruzione dai file del ramo (quelli di B1), con il tag `2.11.9-2` | Riuscita, senza errori |
| F2 | Versioni e Caddyfile nell'immagine | Versioni come in B4. `/etc/caddy/Caddyfile` è identico, byte per byte, a `infra/caddy/Caddyfile` del ramo |
| F3 | `caddy validate`, come in B6 | «Valid configuration», nessun errore |
| F4 | Prova del filtro dei registri con l'immagine: come A5, con `ghcr.io/jinoesfoo/gestionale-negozi-caddy:2.11.9-2` | `Prove: 16, come attese: 16, diverse: 0` |
| F5 | Differenza fra i Caddyfile delle immagini `2.11.9-1` e `2.11.9-2` | Una sola riga: `respond "In arrivo - {remote_host}" 200` nella prima, `reverse_proxy app:3000` nella seconda |
| F6 | Pubblicazione su GHCR, poi `docker pull` della `2.11.9-2` come `deploy` sul server di test | Prima della pubblicazione il tag `2.11.9-2` non esiste su GHCR: nessun manifest. Pubblicazione riuscita, digest annotato. `docker pull` riuscito, con lo stesso digest |
| F7 | I due server dopo la pubblicazione | `/srv/app/.env` ha ancora `CADDY_TAG=2.11.9-1`, e `app-caddy-1` usa ancora l'immagine `2.11.9-1`: il passaggio alla `2.11.9-2` lo fa FON-T07b |

## G. Chiusura

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| G1 | U | `bash infra/check-ports.sh` nel suo terminale (usa Docker), con `infra/compose.yml` del ramo | La riga `OK: …` (test e produzione) |
| G2 | C | `infra/versions.env` e Caddyfile del ramo, dopo l'allineamento a `main` | `CADDY_TAG=2.11.9-2`. Il Caddyfile è quello con il `reverse_proxy`, lo stesso dell'immagine di F2 |
| G3 | C | `pnpm lint`, `pnpm typecheck` e `pnpm test` | Tutti verdi |
| G4 | C | `infra/README.md`, sottosezioni DOM-T02 di «Caddy e certificati» e di «File di ambiente dei server» | Ci sono:<br>- la costruzione e la pubblicazione delle due revisioni, con versioni e digest;<br>- la preparazione e l'avvio sui server;<br>- il filtro del token;<br>- i file di ambiente, con i controlli di D6–D8;<br>- gli intervalli dei webhook di Brevo, con la data del controllo (24/11/2026), la fonte e il modo di ripeterlo;<br>- come si aggiorna una versione (revisioni e `infra/versions.env`);<br>- la scelta IPv6: rete `edge` con IPv6, e la precondizione della rotta e dell'indirizzo statici, da ricontrollare a ogni ricostruzione di un server;<br>- come si sono chiusi i tre punti che DOM-T01 ha lasciato a DOM-T02 nei suoi «Punti lasciati ai compiti successivi» (intervalli di Brevo, IPv6, formato dei token e modulo di Caddy). La sezione di DOM-T01 non si tocca: ogni compito scrive solo nella sua (`docs/due-postazioni.md`, FON-T07a). Unica eccezione, approvata dall'utente il 25/11/2026: dopo il «Roll» di un token si aggiornano le righe «Token in uso» e «Rotazioni» di quella sezione, come chiede la sua procedura «Valore perso» |
