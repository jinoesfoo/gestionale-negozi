# FON-T10 — Lista di controllo: record DNS delle email ed email di prova (DOM-012)

Le prove automatiche di FON-T10 sono i test di Vitest (`pnpm test` e, nella gabbia, `test:int`). Questa lista raccoglie la prova manuale di DOM-012 (01 FON-T10, 06 DOM-012): i record SPF, DKIM e DMARC di DOM-T01 rispondono su entrambe le zone, e un'email di prova inviata con Brevo da ciascuno dei due mittenti arriva allineata. Resta ferma dopo la fase test; gli esiti si scrivono in `docs/verifiche/fon-t10-esito.md`.

Chi esegue: **U** = utente, dal suo terminale, nella cartella del progetto, in locale su joo (`docs/due-postazioni.md`, «Regole di struttura», FON-T10): `dig` dalla sandbox non esce, l'email di prova usa la chiave Brevo vera e le intestazioni si leggono nella casella che la riceve. Il server non serve. Claude scrive l'esito sotto dettatura.

Zone e valori attesi: `infra/README.md`, «DNS ed email (DOM-T01)», «Valori letti». `{{DOMINIO}}` è `foondaco.com`, `{{DOMINIO_TEST}}` è `foondaco.it`. I selettori DKIM di Brevo sono `brevo1` e `brevo2`.

## A. Record DNS (U)

Con il risolutore pubblico `1.1.1.1`, così non conta la cache della rete di casa.

| # | Controllo | Esito atteso |
|---|---|---|
| A1 | `dig @1.1.1.1 +short TXT foondaco.com` | Un solo record che inizia con `v=spf1`: `v=spf1 include:spf.brevo.com include:_spf.mx.cloudflare.net ~all` (più il `brevo-code:…` di Brevo) |
| A2 | `dig @1.1.1.1 +short CNAME brevo1._domainkey.foondaco.com` e lo stesso con `brevo2` | `b1.foondaco-com.dkim.brevo.com.` e `b2.foondaco-com.dkim.brevo.com.` |
| A3 | `dig @1.1.1.1 +short TXT brevo1._domainkey.foondaco.com` | Una chiave `v=DKIM1; …` (il CNAME risolto fino alla chiave di Brevo) |
| A4 | `dig @1.1.1.1 +short TXT _dmarc.foondaco.com` | `v=DMARC1; p=none; rua=mailto:dmarc@foondaco.com` (oppure `p=quarantine`, se è già passato a quel valore) |
| A5 | `dig @1.1.1.1 +short TXT foondaco.it` | Un solo record che inizia con `v=spf1`: `v=spf1 include:spf.brevo.com ~all` (più il `brevo-code:…`) |
| A6 | `dig @1.1.1.1 +short CNAME brevo1._domainkey.foondaco.it` e lo stesso con `brevo2` | `b1.foondaco-it.dkim.brevo.com.` e `b2.foondaco-it.dkim.brevo.com.` |
| A7 | `dig @1.1.1.1 +short TXT brevo1._domainkey.foondaco.it` | Una chiave `v=DKIM1; …` |
| A8 | `dig @1.1.1.1 +short TXT _dmarc.foondaco.it` | `v=DMARC1; p=none; rua=mailto:dmarc@foondaco.com` (oppure `p=quarantine`) |
| A9 | `dig @1.1.1.1 +short TXT foondaco.it._report._dmarc.foondaco.com` | `"v=DMARC1"` |

## B. Email di prova con il nostro adattatore Brevo (U)

Lo script `pnpm email:prova <destinatario> <mittente>` invia il modello `prova` con l'adattatore Brevo del worker e le variabili di `.env.worker` (nota (3) del piano di FON-T10). Il destinatario è una casella tua di un altro dominio (per esempio Gmail), dove si possono leggere le intestazioni originali. I mittenti sono quelli che hai creato su Brevo, uno su `foondaco.com` e uno su `foondaco.it` (`infra/README.md`, «DNS ed email (DOM-T01)»).

| # | Controllo | Esito atteso |
|---|---|---|
| B1 | In `.env.worker`, solo per questa prova: `EMAIL_PROVIDER=brevo` ed `EMAIL_API_KEY` con la chiave API vera di Brevo (dal gestore di password; non va in chat né in git) | — |
| B2 | `pnpm email:prova <tua casella> <mittente su foondaco.com>` | Esce con 0 e stampa l'id del messaggio di Brevo; nessuna chiave nell'uscita |
| B3 | Nella casella, l'email di B2: «Mostra originale» (o le intestazioni complete), riga `Authentication-Results` | `spf=pass`, `dkim=pass` (firma con `d=foondaco.com`) e `dmarc=pass` |
| B4 | `pnpm email:prova <tua casella> <mittente su foondaco.it>` | Esce con 0 e stampa l'id del messaggio di Brevo |
| B5 | Nella casella, l'email di B4, riga `Authentication-Results` | `spf=pass`, `dkim=pass` (firma con `d=foondaco.it`) e `dmarc=pass` |
| B6 | In `.env.worker` si rimettono `EMAIL_PROVIDER=fake` e il valore di sviluppo di `EMAIL_API_KEY` (quelli di `.env.worker.example`) | Il worker di sviluppo non invia più email vere |

Se in B3 o B5 `spf` o `dkim` non è `pass`, si confrontano i record della sezione A con quelli di `infra/README.md`: un record DKIM con la nuvola arancione di Cloudflare (proxy) non si verifica. Se `dmarc` non è `pass` ma `spf` e `dkim` sì, il dominio della firma (`d=`) o del mittente SPF non è quello del mittente: va controllato il mittente scelto su Brevo.
