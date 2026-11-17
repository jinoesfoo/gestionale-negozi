# DOM-T01 — Esito della lista di controllo

Lista: `docs/verifiche/dom-t01.md`. Eseguita dal 15 al 17/11/2026. Domini: `{{DOMINIO}}` = `foondaco.com` (produzione, server `91.108.122.251`), `{{DOMINIO_TEST}}` = `foondaco.it` (test, server `145.14.158.72`).

I controlli DNS li ha fatti Claude dai server (`ssh test dig …`, uno da `ssh prod dig …`). Le interrogazioni finali, del 17/11/2026, usano il risolutore pubblico `1.1.1.1`. Prima dell'attivazione Claude ha interrogato anche i registri (`@a.gtld-servers.net` per `.com`, `@a.dns.it` per `.it`) e il nameserver di Cloudflare (`@jay.ns.cloudflare.com`). Gli esiti dei passi dell'utente sono scritti sotto sua dettatura (risposte e schermate in chat). Token e chiavi non sono passati in chat.

## A. Prima di iniziare

| # | Esito |
|---|---|
| A1 | Riuscito (15/11/2026): `DiG 9.20.24-1ubuntu0.5-Ubuntu` su test e prod. |
| A2 | Riuscito (15/11/2026): IPv6 globale su entrambi i server (`2a02:4780:d:8458::1/48` test, `2a02:4780:c:f90c::1/48` prod), quindi servono i record `AAAA` (C3). |
| A3 | Riuscito dopo una correzione. Il 15 e 16/11/2026 i registri rispondevano ancora con i nameserver di Hostinger (`nova`/`cosmos.dns-parking.com` per `.com`, `orbit`/`horizon.dns-parking.com` per `.it`): in hPanel era ancora scelto «Utilizza i nameserver Hostinger», e la zona `foondaco.it` su Cloudflare non esisteva ancora. L'utente ha creato la zona `foondaco.it` e scelto in hPanel «Cambia i nameserver» per i due domini. Delega nel registro `.com` il 16/11/2026, nel registro `.it` il 17/11/2026. Il 17/11/2026, da `1.1.1.1`: `jay.ns.cloudflare.com` e `princess.ns.cloudflare.com` per tutti e due; nessun record DS (DNSSEC) rimasto nei registri. La zona `foondaco.com` è diventata «Active» nel pannello dopo «Check nameservers now». |
| A4 | Riuscito (17/11/2026): Brevo, «Senders, Domains & Dedicated IPs» → «Domains», mostra `foondaco.it` e `foondaco.com` (schermata dell'utente). |

## B. Token API di Cloudflare

| # | Esito |
|---|---|
| B1 | Riuscito (17/11/2026): token `caddy-foondaco-com`, creato con «Create Token» → «Start from scratch» → «Start with a Zone policy». La sua pagina nel pannello («API Tokens» → nome del token → «Token Summary», schermata dell'utente del 17/11/2026) mostra in «Permission policies» una sola voce: la zona `foondaco.com` dell'account dell'utente, con «Zone: Read» e «DNS: Edit», nient'altro. «IP Address Filtering»: «All IP addresses allowed», quindi nessun filtro che escluda il server di produzione. «Expiration»: «No expiration». In un primo momento l'utente aveva confermato permessi e zona solo con un «ok»; la schermata lo sostituisce. |
| B2 | Riuscito (17/11/2026): token `caddy-foondaco-it`, creato come B1. La sua pagina («Token Summary», schermata dell'utente del 17/11/2026) mostra una sola voce, la zona `foondaco.it`, con «Zone: Read» e «DNS: Edit»; «All IP addresses allowed»; «No expiration». È un token diverso da quello di B1: altro nome, altra zona, un'altra riga nell'elenco «API Tokens». |
| B3 | Riuscito dopo una correzione (17/11/2026). Al primo controllo non era riuscito: l'utente aveva risposto «ok» anche alla domanda sul gestore di password, ma intendeva la password dell'account Cloudflare, e il valore dei due token, che Cloudflare mostra una volta sola, non era stato salvato da nessuna parte. Correzione, lo stesso giorno, con i passi dati in chat: l'utente ha rigenerato i due token con «Roll» (nome, permessi e zona restano; il valore vecchio non vale più), ha salvato ciascun valore nuovo in una voce del gestore di password e l'ha riaperta per controllare, poi ha fatto la copia sigillata (OPS-009; procedura in `infra/README.md`, punto 2, «Valore perso»). Esito riferito dall'utente («fatto»): il valore di un token, per regola, Claude non lo vede. Nessun programma usava ancora i token («Last used» vuoto nell'elenco, schermata del 17/11/2026), quindi la rigenerazione non ha interrotto niente. I token non sono passati in chat, in git né in file del progetto. |

Osservazione: l'elenco «API Tokens» del 17/11/2026 mostrava anche un terzo token, «Cloudflare Agent Token - 2026-11-15», non creato dal compito. Lo crea l'assistente AI del pannello («Ask AI») quando gli si concede l'accesso all'account, e ha permessi ampi. Al progetto non serve: l'utente l'ha cancellato il 17/11/2026 (riferito dall'utente). Se ricompare, si spegne l'assistente (`infra/README.md`, punto 2, «Altri token»).

## C. Record dei server, «solo DNS» (DOM-008)

| # | Esito |
|---|---|
| C1 | Riuscito (17/11/2026): `foondaco.com`, `app.foondaco.com`, `admin.foondaco.com`, `prova-dom-t01.foondaco.com` → solo `91.108.122.251`. Anche `www.foondaco.com` → `91.108.122.251`, dal jolly. Da `ssh prod`, `app.foondaco.com` → `91.108.122.251`. |
| C2 | Riuscito (17/11/2026): `foondaco.it`, `app.foondaco.it`, `admin.foondaco.it`, `prova-dom-t01.foondaco.it` → solo `145.14.158.72`. Anche `www.foondaco.it` → `145.14.158.72`. |
| C3 | Riuscito (17/11/2026): i quattro nomi di `foondaco.com` → `2a02:4780:c:f90c::1`; i quattro di `foondaco.it` → `2a02:4780:d:8458::1`. |
| C4 | Riuscito, confermato dall'utente: tutti i record `A`, `AAAA` e `CNAME` delle due zone sono «DNS only». Lo conferma il DNS: gli `A`/`AAAA` rispondono con gli indirizzi dei server (con il proxy risponderebbero indirizzi di Cloudflare) e i DKIM rispondono come `CNAME`. Correzioni durante il compito: i record importati da Hostinger (`A @ 2.57.91.91` e `CNAME www`, in tutte e due le zone) sono stati cancellati; in `foondaco.it` i `CNAME` DKIM di Brevo, importati «Proxied», sono stati messi «DNS only». |

## D. Record delle email (DOM-012)

| # | Esito |
|---|---|
| D1 | Riuscito (17/11/2026): sulla radice di `foondaco.com` un solo record `v=spf1`, cioè `v=spf1 include:spf.brevo.com include:_spf.mx.cloudflare.net ~all` (l'altro TXT è il `brevo-code`). Email Routing aveva creato `v=spf1 include:_spf.mx.cloudflare.net ~all`; l'utente l'ha modificato. `spf.brevo.com` esiste (TXT `v=spf1 ip4:… -all`). L'«include indicato da Brevo» non viene dal pannello, che non chiede SPF: viene dalla documentazione di Brevo («Merge multiple SPF records», letta il 17/11/2026; fonti in `infra/README.md`, punto 6). |
| D2 | Riuscito (17/11/2026): sulla radice di `foondaco.it` un solo record `v=spf1`, cioè `v=spf1 include:spf.brevo.com ~all`. L'`include` di Brevo ha la stessa fonte di D1. |
| D3 | Riuscito; per `foondaco.com` con una verifica indiretta. Su tutte e due le radici c'è `brevo-code:deb6e878db29b6ed66e2bd2fc5d772c9`. Per `foondaco.it` il valore l'ha letto l'utente nel pannello di Brevo (16/11/2026). Per `foondaco.com` il valore del pannello non è stato dettato: Brevo mostra però il dominio «Authenticated» (D5), quindi accetta quel codice, che è lo stesso per i due domini. |
| D4 | Riuscito (17/11/2026): `brevo1._domainkey.foondaco.com` → `b1.foondaco-com.dkim.brevo.com`; `brevo2._domainkey.foondaco.com` → `b2.foondaco-com.dkim.brevo.com`; `brevo1._domainkey.foondaco.it` → `b1.foondaco-it.dkim.brevo.com`; `brevo2._domainkey.foondaco.it` → `b2.foondaco-it.dkim.brevo.com`. Tutte e quattro le destinazioni portano a una chiave RSA di Brevo, TXT `k=rsa;p=…`: `b1.foondaco-com…` → `brevo5.dkim.brevo.com`, `b2.foondaco-com…` → `brevo6`, `b1.foondaco-it…` → `brevo9`, `b2.foondaco-it…` → `brevo10`. È la verifica indipendente del 17/11/2026. I valori di `foondaco.it` coincidono con quelli letti nel pannello il 16/11/2026; quelli di `foondaco.com` li ha copiati l'utente dal pannello, e Brevo li ha accettati (D5). |
| D5 | Riuscito (17/11/2026): Brevo mostra «All domains are authenticated», con `foondaco.it` e `foondaco.com` «Authenticated» (schermata dell'utente). «Not branded» riguarda i link di tracciamento con un sottodominio proprio: non serve. |
| D6 | Riuscito (17/11/2026): `_dmarc.foondaco.com` → un solo record, `v=DMARC1; p=none; rua=mailto:dmarc@foondaco.com`. |
| D7 | Riuscito (17/11/2026): `_dmarc.foondaco.it` → un solo record, `v=DMARC1; p=none; rua=mailto:dmarc@foondaco.com`. Correzione: il DMARC importato da Hostinger, quello proposto da Brevo con `rua=mailto:rua@dmarc.brevo.com`, è stato sostituito. |
| D8 | Riuscito (17/11/2026): `foondaco.it._report._dmarc.foondaco.com` → `v=DMARC1`. |
| D9 | Riuscito (17/11/2026): MX di `foondaco.com` → `31 route1.mx.cloudflare.net`, `34 route3.mx.cloudflare.net`, `88 route2.mx.cloudflare.net`. Email Routing ha creato anche il TXT DKIM `cf2024-1._domainkey.foondaco.com` (`v=DKIM1; h=sha256; k=rsa; p=…`), presente. |
| D10 | Riuscito (17/11/2026), confermato dall'utente: Email Routing attivo su `foondaco.com`, con «Onboard Domain» dopo l'attivazione della zona. Prima di «Activate» il pannello ha mostrato i record attesi: tre MX, il TXT DKIM `cf2024-1` e il TXT SPF (schermate dell'utente). L'indirizzo `dmarc@foondaco.com` inoltra alla casella che l'utente userà come `ADMIN_ALERT_EMAIL`, con la destinazione verificata («tutto ok»). La corrispondenza con la variabile è una dichiarazione dell'utente: sui server la variabile non esiste ancora, la scrive FON-T07b, e da lì la tiene allineata la regola di `infra/README.md`, punto 4. |
| D11 | Riuscito (17/11/2026): un'email di prova a `dmarc@foondaco.com` è arrivata nella casella di destinazione (riferito dall'utente). |

## E. Documentazione

| # | Esito |
|---|---|
| E1 | Riuscito: `infra/README.md`, «DNS ed email (DOM-T01)», contiene la procedura dei token e di tutti i record delle due zone, Email Routing, la scelta per il `rua` e, in «Valori letti», i record pubblicati con le date dei controlli. Nessun segreto. |
| E2 | Riuscito: in `specs/06-domini-https.md`, sotto DOM-012, l'esito del [VERIFICA] (servizio di inoltro e record richiesti) e la nota sulle decisioni del piano. |

## Test del compito

- **DOM-008**, parte DNS: riuscito (A3, C1, C2, C3, C4). La parte HTTP/2 e HTTP/3 è di DOM-T02.
- **DOM-012**: riuscito (D1–D11), con il `rua` su `dmarc@foondaco.com` e l'inoltro attivo. La prova di invio con `spf=pass`, `dkim=pass` e `dmarc=pass` è di FON-T10.
- **Token per zona:** riuscito (B1–B3); B3 dopo una correzione, con i token rigenerati e salvati il 17/11/2026.

Tutti i controlli della lista sono stati eseguiti. Uno solo non era riuscito al primo controllo, B3, ed è riuscito dopo la correzione. Gli esiti che Claude non ha letto da sé con `dig` vengono da:
- schermate dell'utente: A4, B1, B2, D5 e, in D10, i record mostrati prima di «Activate»;
- conferme dell'utente su ciò che vedeva nei pannelli: C4 (confermata anche dal DNS) e D10;
- dichiarazioni dell'utente: B3 (token rigenerati e conservati) e D11 (l'email di prova è arrivata);
- una verifica indiretta: D3 e D4 per `foondaco.com`. I valori del pannello di Brevo non sono stati dettati; Brevo mostra il dominio «Authenticated» (D5), quindi ha trovato nel DNS i valori che si aspetta.

Correzioni durante l'esecuzione:
- il cambio dei nameserver su Hostinger, all'inizio non salvato;
- la zona `foondaco.it`, creata su Cloudflare durante il compito;
- i record importati, cancellati o messi «DNS only»;
- la zona `foondaco.com`, fatta ricontrollare a Cloudflare perché risultasse «Active»;
- i due token di Cloudflare, rigenerati e salvati perché il primo valore non era stato conservato (B3).
