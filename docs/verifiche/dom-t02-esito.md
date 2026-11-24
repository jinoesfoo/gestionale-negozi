# DOM-T02 — Esito della lista di controllo

Lista: `docs/verifiche/dom-t02.md`. Eseguita dal 24/11/2026. Domini: `{{DOMINIO}}` = `foondaco.com` (produzione, server `91.108.122.251`), `{{DOMINIO_TEST}}` = `foondaco.it` (test, server `145.14.158.72`).

Gli esiti dei passi dell'utente sono scritti sotto sua dettatura.

## A. Prima di iniziare

| # | Esito |
|---|---|
| A1 | Riuscito (24/11/2026, fase piano): sul server di test `default via 2a02:4780:d::1 dev eth0 proto static`, indirizzo `2a02:4780:d:8458::1/48` con `valid_lft forever preferred_lft forever`, senza `dynamic`; in produzione `default via 2a02:4780:c::1 dev eth0 proto static`, indirizzo `2a02:4780:c:f90c::1/48` con `valid_lft forever preferred_lft forever`, senza `dynamic`. Comandi lanciati dall'utente con `test-admin` e `prod-admin`. |
| A2 | _(da fare)_ |
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
