# DOM-T02 — Esito della lista di controllo

Lista: `docs/verifiche/dom-t02.md`. Eseguita dal 24/11/2026. Domini: `{{DOMINIO}}` = `foondaco.com` (produzione, server `91.108.122.251`), `{{DOMINIO_TEST}}` = `foondaco.it` (test, server `145.14.158.72`).

Gli esiti dei passi dell'utente sono scritti sotto sua dettatura.

## A. Prima di iniziare

| # | Esito |
|---|---|
| A1 | Riuscito (24/11/2026, fase piano): sul server di test `default via 2a02:4780:d::1 dev eth0 proto static`, indirizzo `2a02:4780:d:8458::1/48` con `valid_lft forever preferred_lft forever`, senza `dynamic`; in produzione `default via 2a02:4780:c::1 dev eth0 proto static`, indirizzo `2a02:4780:c:f90c::1/48` con `valid_lft forever preferred_lft forever`, senza `dynamic`. Comandi lanciati dall'utente con `test-admin` e `prod-admin`. |
| A2 | **Server di test: riuscito dopo l'attivazione del firewall (24/11/2026).**<br>**1. Primo controllo, diverso dall'atteso.** Schermate dell'utente della pagina «Sicurezza» → «Firewall» di `srv2155002.hstgr.cloud` e di `srv1874119.hstgr.cloud`: su tutte e due c'è il gruppo `gestionale-base`, «4 regole», creato il 2026-11-14, ultimo aggiornamento 2026-11-14. Però l'interruttore accanto al gruppo è spento su tutte e due le VPS: il firewall di Hostinger non è attivo su nessun server. Prove di Claude con il firewall spento:<br>- `ping -c 3` e `ping -6 -c 3` rispondono 3 su 3 nelle due direzioni (dal server di test alla produzione e dalla produzione al server di test). Secondo la documentazione di Hostinger, il firewall, quando è attivo, scarta anche il traffico ICMP che nessuna regola accetta, e filtra IPv4 e IPv6 («How to use a managed VPS firewall at Hostinger», articolo 8172641, modificato il 29/10/2026).<br>- `nc -z -v -w 5` da ciascun server verso l'altro, in IPv4 e in IPv6: la porta 22 risponde; le porte 80, 443 e 8080 vanno in timeout. Sulle porte 80 e 443 non è in ascolto niente (A4) e ufw le consente (FON-T07a, E9): ci si aspettava un rifiuto immediato, non un timeout. Si ricontrolla dopo l'avvio di Caddy, le cui porte le pubblica Docker senza passare da ufw.<br>- Uscite dal server di test: `getent hosts acme-v02.api.letsencrypt.org` risolve; `curl` verso Let's Encrypt `200` in IPv4 e in IPv6, verso l'API di Cloudflare `200`, verso `ghcr.io/v2/` `401` (raggiungibile, chiede l'accesso).<br>**2. Regole**, schermata dell'utente dal pannello di `srv2155002`, «1 a 4 di 4»: `Accept TCP 22 Any Any`, `Accept TCP 80 Any Any`, `Accept TCP 443 Any Any`, `Drop Any Any Any Any`. Sono le quattro regole del README, nell'ordine. La quarta, «Rifiuta» nel README, il pannello la chiama «Drop»: scarta senza rispondere.<br>**3. Attivazione.** L'utente ha acceso l'interruttore. Schermata: `gestionale-base` «Attivo», con il messaggio «Il gruppo firewall è in fase di attivazione. Questo potrebbe richiedere fino a 5 minuti.».<br>**4. Prove di Claude con il firewall acceso** (15:14–15:15 UTC):<br>- dalla produzione: `ping -c 3 -W 2` e `ping -6 -c 3 -W 2` verso il server di test 0 su 3; `nc -z -v -w 5` sulla 22 riuscito in IPv4 e in IPv6; 80, 443 e 8080 in timeout, come prima;<br>- dal server di test: SSH funziona; `resolvectl query --cache=no example.org` risponde con due indirizzi IPv4 e due IPv6; `curl` verso Let's Encrypt `200` in IPv4 e in IPv6, verso l'API di Cloudflare `200`, verso `ghcr.io/v2/` `401`; `ping -c 3` e `ping -6 -c 3` verso la produzione 3 su 3; `chronyc -n sources`: cinque sorgenti, tutte con Reach `377` (si ricontrolla dopo almeno un intervallo di interrogazione, 1024 s).<br>**Esito.** Le regole valgono anche per IPv6. ICMP e ICMPv6 in ingresso non passano; passano le risposte al traffico che parte dal server. Poiché ICMPv6 non passa, il rischio per la scoperta della MTU del percorso è annotato nel README («Caddy e certificati», DOM-T02, «Firewall di Hostinger»).<br>**Produzione:** _(da fare)_ |
| A3 | Server di test, riuscito (24/11/2026): `rsync version 3.4.1 protocol version 32`. Produzione: _(da fare)_ |
| A4 | Server di test, riuscito (24/11/2026): `docker ps -a` e `docker volume ls` vuoti; `ss -ltnu` mostra in ascolto solo la 22/tcp (IPv4 e IPv6) e i servizi locali del sistema (53 su `127.0.0.53`/`127.0.0.54`, 323/udp su `127.0.0.1` e `[::1]`), niente sulle porte 80 e 443. Produzione: _(da fare)_ |
| A5 | Riuscito (24/11/2026, fase test): `Prove: 16, come attese: 16, diverse: 0` con `caddy:2.11.9` (`sha256:4851e54a46b206517c574821bb5cc67f170d2156041e9fbc4c9193b45e84a75b`). Prova a rovescio, con la configurazione senza il blocco `log` montata al posto di quella con il blocco: `Prove: 16, come attese: 11, diverse: 5`, uscita 1 (i cinque casi «nessun …» trovano la fuga). |

## B. Revisione di avvio `2.11.9-1`, in locale

| # | Esito |
|---|---|
| B1 | Riuscito (24/11/2026): `pnpm lint` e `pnpm typecheck` verdi; `pnpm test` 746 su 746, compresi i 21 di `tests/unit/infra/caddy.test.ts`. |
| B2 | Riuscito (24/11/2026): commit `082e5fc75eec3c2e70d84a0c4029598e46ada8ba` («DOM-T02: revisione di avvio dell'immagine Caddy (2.11.9-1)»). Il commit successivo, `0aa6289`, rimette i file di B1: cambiano solo `respond "In arrivo - {remote_host}" 200` → `reverse_proxy app:3000` nel Caddyfile e `CADDY_TAG=2.11.9-1` → `CADDY_TAG=2.11.9-2` in `infra/versions.env`. |
| B3 | Riuscito (24/11/2026): `docker build -t ghcr.io/jinoesfoo/gestionale-negozi-caddy:2.11.9-1 infra/caddy` dal commit di B2. Immagini di base `caddy:2.11.9-builder@sha256:cda07fe9d82728c7ac44d844306d435e98131423dc7b114f05a8a8ecfff94707` e `caddy:2.11.9@sha256:4851e54a46b206517c574821bb5cc67f170d2156041e9fbc4c9193b45e84a75b`; xcaddy ha preso `caddy-dns/cloudflare v0.2.4` con `libdns/cloudflare v0.2.2`. Indice dell'immagine locale `sha256:58ad41dca747143904e76c5b1372273ad89443917904d3859f8097103550bc5a`. |
| B4 | Riuscito (24/11/2026): `caddy version` → `v2.11.9 h1:bhZtcRKQOq0fuLvEgCdPYvUxXyGn9kzjG4lh2332DTE=`; `caddy list-modules --versions --skip-standard` → `dns.providers.cloudflare v0.2.4`, «Non-standard modules: 1». |
| B5 | Riuscito (24/11/2026): impronta di `/etc/caddy/Caddyfile` nell'immagine `da5fdccd0d447d2f178f8d56801b22fbbfae5ef28b095e12a3d8c2e308ace7f0`, uguale a quella di `infra/caddy/Caddyfile` nel commit di B2. |
| B6 | Riuscito (24/11/2026), lanciato dall'utente nel suo terminale (con il token finto `cfut_` seguito da 40 `x`, Claude Code fa girare il comando nella sandbox, dove Docker non si raggiunge): «Valid configuration». Nel log, `server is listening only on the HTTPS port but has no TLS connection policies; adding one to enable TLS` e `enabling automatic HTTP->HTTPS redirects` per `srv0`. |
| B7 | Riuscito (24/11/2026): `Prove: 16, come attese: 16, diverse: 0`. |
| B8 | Riuscito (24/11/2026). Prima della pubblicazione `docker manifest inspect ghcr.io/jinoesfoo/gestionale-negozi-caddy:2.11.9-1` → `manifest unknown`, uscita 1: il tag non esisteva. `docker push` riuscito: `2.11.9-1: digest: sha256:58ad41dca747143904e76c5b1372273ad89443917904d3859f8097103550bc5a`. |

## C. Pacchetto su GitHub

| # | Esito |
|---|---|
| C1 | Riuscito (24/11/2026), schermata dell'utente: la pagina del pacchetto `gestionale-negozi-caddy` (tag `2.11.9-1`) ha l'etichetta **Private**. |
| C2 | Riuscito (24/11/2026), schermate dell'utente: nella pagina del pacchetto, sotto «Details», il repository `gestionale-negozi`; in «Package settings», «Repository source» `jinoesfoo/gestionale-negozi`, con la label `org.opencontainers.image.source` del Dockerfile. |
| C3 | Riuscito (24/11/2026), schermata dell'utente: «Package settings» → «Manage Actions access» elenca `gestionale-negozi` con «Role: Write», dopo il messaggio «Permissions added for selected repositories.». |

## D. Preparazione di ciascun server

| # | Server di test | Produzione |
|---|---|---|
| D1 | Riuscito (24/11/2026): `docker pull` come `deploy`, `Digest: sha256:58ad41dca747143904e76c5b1372273ad89443917904d3859f8097103550bc5a`, lo stesso di B8. | _(da fare)_ |
| D2 | Riuscito (24/11/2026): `rsync -rlpt --delete infra/ test:/srv/app/infra/` dal commit `a439fef`, con `git status --short --ignored infra` vuoto; il confronto `rsync -rlpcn --delete --itemize-changes` non stampa nulla; `grep -c enable_ipv6 /srv/app/infra/compose.yml` → `1`. | _(da fare)_ |
| D3 | Riuscito (24/11/2026): `/srv/app/.env` contiene esattamente `CADDY_TAG=2.11.9-1`, `APP_TAG=bootstrap`, `POSTGRES_TAG=bootstrap`; `deploy 664 regular file`. | _(da fare)_ |
| D4 | Riuscito (24/11/2026): `/srv/app/deploy-env` contiene `test`. | _(da fare)_ |
| D5 | Riuscito (24/11/2026): `install -m 755 /srv/app/infra/scripts/dc /srv/app/dc`; `cmp` non stampa nulla; `deploy 755 regular file`. | _(da fare)_ |
| D6 | Riuscito (24/11/2026): `stat -c '%U %a %s %n'` lanciato dall'utente come `deploy`, uscita incollata in chat: `deploy 600` per tutti e cinque i file; dimensioni `caddy.env` 122 byte, `app.env`, `worker.env`, `migrate.env` e `postgres.env` 0 byte. | _(da fare)_ |
| D7 | Riuscito (24/11/2026): comandi lanciati dall'utente come `deploy` su `srv2155002`, uscita incollata in chat: righe con un valore `3`; righe del token `1`; forma `CF_API_TOKEN=cfut_…` `1`; `BASE_DOMAIN=foondaco.it` esatto `1`; `ACME_EMAIL` con un indirizzo `1`; `CAMBIA` `0`. | _(da fare)_ |
| D8 | Riuscito (24/11/2026): l'utente risponde «fatto» alla richiesta di aggiornare tutte e due le parti della copia fuori linea, cioè il gestore di password e la copia sigillata. Nella voce `caddy-foondaco-it` c'è ora l'appunto con `BASE_DOMAIN=foondaco.it` e `ACME_EMAIL`, e lo stesso appunto è nella copia sigillata. Il token c'era già in tutte e due dal 17/11/2026 (DOM-T01). | _(da fare)_ |
| D9 | Riuscito (24/11/2026): delle cinque righe finte, `riga normale` esce uguale e le quattro con `cfut_`, `cfat_`, `CF_API_TOKEN` e «appears invalid» escono come `[riga nascosta dal filtro del token]`; `set -o pipefail; false \| sed …` → `esito-diverso-da-zero`. | _(da fare)_ |
