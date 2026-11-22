# FON-T10 — Esito della lista di controllo

Lista: `docs/verifiche/fon-t10.md`. Postazione joo. Tutti i passi sono dell'utente (**U**), dal suo terminale; l'uscita incollata in chat è trascritta da Claude.

## A. Record DNS

| # | Data | Esito |
|---|---|---|
| A1 | 21/11/2026 | Superato. `foondaco.com` TXT: `"v=spf1 include:spf.brevo.com include:_spf.mx.cloudflare.net ~all"` (un solo record `v=spf1`) e `"brevo-code:deb6e878db29b6ed66e2bd2fc5d772c9"`. |
| A2 | 21/11/2026 | Superato. `brevo1._domainkey.foondaco.com` → `b1.foondaco-com.dkim.brevo.com.`; `brevo2._domainkey.foondaco.com` → `b2.foondaco-com.dkim.brevo.com.` |
| A3 | 21/11/2026 | Superato nella sostanza. `brevo1._domainkey.foondaco.com` → `b1.foondaco-com.dkim.brevo.com.` → `brevo5.dkim.brevo.com.` → TXT `"k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuH2LOIK…QIDAQAB"` (chiave RSA pubblica, in due stringhe). Il record non ha il `v=DKIM1;` iniziale che la lista indicava: per la RFC 6376 §3.6.1 il campo `v=` della chiave è facoltativo (consigliato, predefinito `DKIM1`), quindi la chiave è valida; la verifica che conta è `dkim=pass` in B3. |
| A4 | 21/11/2026 | Superato. `_dmarc.foondaco.com`: `"v=DMARC1; p=none; rua=mailto:dmarc@foondaco.com"`. |
| A5 | 21/11/2026 | Superato. `foondaco.it` TXT: `"v=spf1 include:spf.brevo.com ~all"` (un solo record `v=spf1`) e `"brevo-code:deb6e878db29b6ed66e2bd2fc5d772c9"`. |
| A6 | 21/11/2026 | Superato. `brevo1._domainkey.foondaco.it` → `b1.foondaco-it.dkim.brevo.com.`; `brevo2._domainkey.foondaco.it` → `b2.foondaco-it.dkim.brevo.com.` |
| A7 | 21/11/2026 | Superato nella sostanza, come A3. `brevo1._domainkey.foondaco.it` → `b1.foondaco-it.dkim.brevo.com.` → `brevo9.dkim.brevo.com.` → TXT `"k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvmlFF00…QIDAQAB"`, senza `v=DKIM1;` (facoltativo, RFC 6376 §3.6.1); la verifica che conta è `dkim=pass` in B5. |
| A8 | 21/11/2026 | Superato. `_dmarc.foondaco.it`: `"v=DMARC1; p=none; rua=mailto:dmarc@foondaco.com"`. |
| A9 | 21/11/2026 | Superato. `foondaco.it._report._dmarc.foondaco.com`: `"v=DMARC1"`. |

## B. Email di prova con il nostro adattatore Brevo

| # | Data | Esito |
|---|---|---|
| B1 | 21/11/2026 | Fatto (utente): in `.env.worker` `EMAIL_PROVIDER=brevo` e una chiave API di Brevo creata per la prova (`prova-joo`). Prima di riuscire, due rifiuti di Brevo, visti con il messaggio di Brevo che l'adattatore ora riporta (destinatario mascherato): `stato 403 (permission_denied): api key is not authorized for resource "transactional.email"` con la prima chiave, che non aveva il permesso per le email transazionali (risolto con una chiave ad accesso completo); poi `stato 401 (unauthorized): We have detected you are using an unrecognised IP address …`, il blocco degli IP non riconosciuti dell'account (risolto autorizzando l'IP in «Security» → «Authorised IPs»). Nota (15) in 01 per FON-T07b. |
| B2 | 21/11/2026 | Superato. `pnpm email:prova <casella dell'utente su Gmail> noreply@foondaco.com`: `Email di prova inviata da noreply@foondaco.com (id del messaggio di Brevo: <202611211602.67783480980@smtp-relay.mailin.fr>).`, codice 0, nessuna chiave nell'uscita. |
| B3 | 21/11/2026 | Superato. `Authentication-Results: mx.google.com; dkim=pass header.i=@foondaco.com header.s=brevo1; spf=pass (… designates 77.32.148.28 as permitted sender) smtp.mailfrom=bounces-…@hb.d.sender-sib.com; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=foondaco.com`. SPF passa sul mittente della busta di Brevo (IP condivisi), DMARC passa grazie al DKIM allineato su `foondaco.com` (firma `d=foondaco.com`, `s=brevo1`), come previsto in `infra/README.md` (DOM-T01). |
| B4 | 21/11/2026 | Superato. `pnpm email:prova <casella dell'utente su Gmail> noreply@foondaco.it`: `Email di prova inviata da noreply@foondaco.it (id del messaggio di Brevo: <202611211602.64605119918@smtp-relay.mailin.fr>).`, codice 0. Il mittente `noreply@foondaco.it` l'utente lo ha creato su Brevo durante la prova («Add sender», «Skip for now» sul sottodominio personalizzato). |
| B5 | 21/11/2026 | Superato. `Authentication-Results: mx.google.com; dkim=pass header.i=@foondaco.it header.s=brevo1; spf=pass (… designates 77.32.148.27 as permitted sender) smtp.mailfrom=bounces-…@ha.d.sender-sib.com; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=foondaco.it`. |
| B6 | 21/11/2026 | Fatto (utente, confermato in chat): in `.env.worker` di nuovo `EMAIL_PROVIDER=fake` ed `EMAIL_API_KEY=dev-email-api-key`, il valore di `.env.worker.example`. |

## Note

- Brevo aggiunge alle email transazionali, da sé, un'immagine di tracciamento delle aperture e le intestazioni `List-Unsubscribe` (visto nelle due email di prova). Non dipende dal codice: è un'impostazione dell'account Brevo. Da valutare insieme ai documenti sulla riservatezza (OPS-T11) se tenerla per le email di servizio.
