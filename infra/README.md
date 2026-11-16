# infra — procedure dei server

Procedure manuali dei server e delle aree che ne hanno bisogno. Ogni compito scrive **solo nella sua sezione** (o sottosezione, intitolata con il suo ID): `docs/due-postazioni.md`, «Regole di struttura». Le sezioni ancora vuote dicono quale compito le scrive.

Convenzioni:

- I server si raggiungono con i nomi SSH `test` e `prod` (utente `deploy`, chiave di yoo) e, per l'utente, con `test-admin` e `prod-admin` (utente amministrativo, chiave personale). Vedi «Accessi».
- I file di `/srv/app/env/` li scrive e li controlla **solo l'utente**: contengono segreti. Claude non li legge e non li nomina nei comandi.
- Ogni segreto creato o cambiato va anche nella copia fuori linea (gestore di password e copia sigillata, OPS-009).

## Indice

1. [Accessi e server (FON-T07a)](#accessi-e-server-fon-t07a)
2. [Preparazione di base di un server (FON-T07a)](#preparazione-di-base-di-un-server-fon-t07a)
3. [Firewall di Hostinger (FON-T07a)](#firewall-di-hostinger-fon-t07a)
4. [Accesso a GHCR dai server (FON-T07a)](#accesso-a-ghcr-dai-server-fon-t07a)
5. [DNS ed email (DOM-T01)](#dns-ed-email-dom-t01)
6. [Caddy e certificati (DOM-T02, FON-T07b)](#caddy-e-certificati)
7. [Archivi S3 (OPS-T03)](#archivi-s3-ops-t03)
8. [PostgreSQL e backup (OPS-T01a, OPS-T01b)](#postgresql-e-backup)
9. [File di ambiente dei server](#file-di-ambiente-dei-server)
10. [Primo avvio completo (FON-T07b)](#primo-avvio-completo-fon-t07b)
11. [Rilasci automatici (FON-T08)](#rilasci-automatici-fon-t08)
12. [Rotazione dei segreti (NEG-T09, OPS-T11)](#rotazione-dei-segreti)
13. [Amministratori e secondo fattore (ACC-T04, ADM-T01)](#amministratori-e-secondo-fattore)
14. [Dashboard Stripe, compresa la fattura di recupero (BIL-T01, BIL-T02, BIL-T11)](#dashboard-stripe)
15. [Monitoraggio (OPS-T04)](#monitoraggio-ops-t04)
16. [Strumenti sull'host (OPS-T01b, COL-T01)](#strumenti-sullhost)

---

## Accessi e server (FON-T07a)

| | Server di test | Server di produzione |
|---|---|---|
| Nome SSH (Claude, utente `deploy`) | `test` | `prod` |
| Nome SSH (utente, amministrativo) | `test-admin` | `prod-admin` |
| Indirizzo | `145.14.158.72` | `91.108.122.251` |
| Nome dell'host | `srv2155002` | `srv1874119` |
| Sistema | Ubuntu 26.04.1 LTS (`resolute`), x86_64 | Ubuntu 26.04.1 LTS (`resolute`), x86_64 |

### Utenti

| Utente | Chi lo usa | `sudo` | Chiavi in `authorized_keys` |
|---|---|---|---|
| `deploy` | Claude (da yoo) e la CI (rilasci) | no; gruppo `docker` | chiave di yoo `gestionale-yoo` (senza opzioni); chiave di rilascio **di quel server** con `command="/srv/app/deploy.sh",no-port-forwarding,no-agent-forwarding,no-pty` |
| `admin-personale` | solo l'utente, per i pacchetti dell'host e la manutenzione | sì, con password (nessun `NOPASSWD`) | chiave personale dell'utente `admin-personale` |
| `root` | nessuno via SSH (`PermitRootLogin no`); resta la console di Hostinger | — | — |

Attenzione: il gruppo `docker` equivale a root sull'host. Per questo la chiave di rilascio può solo lanciare `/srv/app/deploy.sh` (che arriva in FON-T08: fino ad allora quella chiave non fa nulla).

Impronte delle chiavi pubbliche installate (tutte ed25519):

| Chiave | Impronta |
|---|---|
| `gestionale-yoo` (Claude) | `SHA256:LqA3iEr06I1eAhVgKFcnW7KGhj2sDSdxtyTmuDE6a6E` |
| `admin-personale` (utente) | `SHA256:GWB6d6s++EecImdCTXjEm0Gu7sxTyofZPLjVE2vRBy4` |
| `rilascio-test` (CI, solo server di test) | `SHA256:rWZX8xe4IV4pMga3IXI4j91b1Vjs2g9SsWMhIM1HMDU` |
| `rilascio-prod` (CI, solo produzione) | `SHA256:Pgocu2W+HqArc+yBlTSV+OadZEY/6xiAaHLGwOLWjjo` |

La sudoers di Hostinger (`/etc/sudoers.d/90-cloud-init-users`) contiene `root ALL=(ALL) NOPASSWD:ALL`: vale solo per `root`, che non entra via SSH.

### Chiavi degli host

Righe `known_hosts` (chiave ed25519), lette sui server via SSH il 13/11/2026. Il 14/11/2026 l'utente ha letto le impronte nella console di Hostinger (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`, canale indipendente da SSH): coincidono con queste e con quelle accettate al primo collegamento. Servono al segreto `KNOWN_HOSTS` dei flussi di rilascio (FON-T08) e a `backup-mirror.known_hosts` (OPS-T01b, solo la produzione).

```text
145.14.158.72 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHPLKFEkKDRbStBCqrlJL35pjr5UcEHJczkvA91qxqT9
91.108.122.251 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKjfOtQsGJERxtXqy8zra/KKPHWs/c8EFi+NTHyUDzWo
```

| Server | Impronta ed25519 |
|---|---|
| test | `SHA256:QRERssGOclqZRqIWABgktHu/zmbfXS+R+fjkhGHKko4` |
| prod | `SHA256:i1i1PW6cBBzVEO8cn2KQNSlvCmDCssCr+RFZiMyBpcE` |

Se un server viene ricreato, le chiavi dell'host cambiano: si rileggono, si confrontano con la console e si aggiornano qui, in `KNOWN_HOSTS` e in `backup-mirror.known_hosts`.

### Configurazione SSH dell'utente su yoo (`~/.ssh/config`)

```text
Host test
  HostName 145.14.158.72
  User deploy
  IdentityFile ~/.ssh/gestionale-yoo
  IdentitiesOnly yes
Host prod
  HostName 91.108.122.251
  User deploy
  IdentityFile ~/.ssh/gestionale-yoo
  IdentitiesOnly yes
Host test-admin
  HostName 145.14.158.72
  User admin-personale
  IdentityFile ~/.ssh/admin-personale
  IdentitiesOnly yes
Host prod-admin
  HostName 91.108.122.251
  User admin-personale
  IdentityFile ~/.ssh/admin-personale
  IdentitiesOnly yes
```

Controllo rapido che i nomi puntino al server giusto: `ssh test-admin hostname` risponde `srv2155002`, `ssh prod-admin hostname` risponde `srv1874119`.

Per lavorare come `deploy` dal proprio utente (per esempio per i file di `/srv/app/env/`): `ssh -t test-admin sudo -iu deploy`, poi controllare con `hostname` e `whoami` prima di qualsiasi comando.

---

## Preparazione di base di un server (FON-T07a)

Procedura eseguita il 13/11/2026 su entrambi i server; si ripete uguale per un server nuovo (anche nella ricostruzione da zero, `infra/RIPRISTINO.md`). L'esito dei controlli è in `docs/verifiche/fon-t07a-esito.md`; la lista di controllo in `docs/verifiche/fon-t07a.md`.

L'ordine è obbligatorio: prima tutto ciò che si fa da root, poi la password di `sudo`, per ultima la chiusura di SSH.

### Prerequisiti (utente)

- La VPS su Hostinger, con l'accesso SSH di `root` con la chiave di yoo (`ssh-copy-id -i ~/.ssh/gestionale-yoo.pub <nome>`, oppure dal pannello: VPS → Chiavi SSH), confermando l'impronta dell'host con la console.
- Le chiavi pubbliche in `~/chiavi-pubbliche/` (solo i file `.pub`): `gestionale-yoo`, `admin-personale`, `rilascio-test`, `rilascio-prod`. Le coppie si creano con `ssh-keygen -t ed25519` (senza passphrase, `-N ''`, per `gestionale-yoo` e le due di rilascio; con passphrase per `admin-personale`).
- Nei blocchi `test` e `prod` di `~/.ssh/config`, temporaneamente, `User root`.

### Passi da root (Claude, con `ssh test` / `ssh prod`)

1. Aggiornamento: `apt-get update && apt-get -y upgrade` (con `DEBIAN_FRONTEND=noninteractive` e `--force-confold`); se esiste `/var/run/reboot-required`, `systemctl reboot`.
2. Utenti:
   ```bash
   adduser --disabled-password --comment "" deploy
   adduser --disabled-password --comment "" admin-personale
   usermod -aG sudo admin-personale
   install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
   install -d -m 700 -o admin-personale -g admin-personale /home/admin-personale/.ssh
   ```
3. `authorized_keys`: preparati su yoo (per `deploy`: la riga della chiave di yoo, poi la riga `command="/srv/app/deploy.sh",no-port-forwarding,no-agent-forwarding,no-pty <chiave di rilascio di quel server>`; per `admin-personale`: la chiave personale), copiati con `scp <file> test:/home/deploy/.ssh/authorized_keys` e `scp <file> test:/home/admin-personale/.ssh/authorized_keys`, poi `chown` al proprietario e `chmod 600`. Controllo: `ssh-keygen -lf <file>` mostra le impronte della tabella in «Accessi».
4. ufw:
   ```bash
   ufw default deny incoming
   ufw default allow outgoing
   ufw allow 22/tcp
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw --force enable
   ```
   Solo TCP: HTTP/3 è disattivato (00 §1), quindi niente 443/udp. Docker non passa da ufw: le porte dei container le limita la configurazione Compose (FON-008).
5. Docker dal repository ufficiale (documentazione «Install Docker Engine on Ubuntu», metodo apt; il repository ha la distribuzione `resolute`, verificato il 13/11/2026):
   ```bash
   apt-get install -y ca-certificates curl
   install -m 0755 -d /etc/apt/keyrings
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
   chmod a+r /etc/apt/keyrings/docker.asc
   ```
   Impronta attesa della chiave (`gpg --show-keys --with-fingerprint /etc/apt/keyrings/docker.asc`): `9DC8 5822 9FC7 DD38 854A  E2D8 8D81 803C 0EBF CD88`. Poi `/etc/apt/sources.list.d/docker.sources`:
   ```text
   Types: deb
   URIs: https://download.docker.com/linux/ubuntu
   Suites: resolute
   Components: stable
   Architectures: amd64
   Signed-By: /etc/apt/keyrings/docker.asc
   ```
   e `apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`. Versioni installate il 13/11/2026: Docker Engine 29.9.3, Docker Compose v5.7.1 (≥ 2.24, richiesto da DOM-T02). Gli aggiornamenti di Docker arrivano con `apt upgrade`, che fa l'utente.
6. Il resto:
   ```bash
   usermod -aG docker deploy
   loginctl enable-linger deploy
   install -d -m 755 -o deploy -g deploy /srv/app
   apt-get install -y unattended-upgrades
   ```
   e `/etc/apt/apt.conf.d/20auto-upgrades` con:
   ```text
   APT::Periodic::Update-Package-Lists "1";
   APT::Periodic::Unattended-Upgrade "1";
   ```
   `loginctl enable-linger` fa partire i timer systemd di `deploy` (backup, OPS-T01a) anche senza una sessione aperta.
7. Chiave dell'host: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` e `cat` dello stesso file; riga e impronta vanno in «Chiavi degli host», l'utente le confronta con la console.

### Password di `sudo` e prove (utente)

```bash
ssh -t test sudo passwd admin-personale          # la password la sceglie l'utente; nel gestore di password
ssh -t test-admin 'sudo -v && echo sudo-ok'      # entra con la chiave personale, sudo chiede la password
ssh -i ~/.ssh/gestionale-yoo -o IdentitiesOnly=yes deploy@<indirizzo> 'echo deploy-ok'
```

Se una delle due prove fallisce, **non** si chiude SSH: dopo resterebbe solo la console di Hostinger.

### Chiusura di SSH (Claude, ultimo comando da root)

`/etc/ssh/sshd_config.d/00-hardening.conf` (il prefisso `00-` lo fa leggere prima di `50-cloud-init.conf`, che su Ubuntu contiene `PasswordAuthentication yes`: per sshd vale il primo valore letto):

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
```

poi `sshd -t && sshd -T | grep -Ei '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication) ' && systemctl reload ssh`.

Subito dopo l'utente rimette `User deploy` nei blocchi `test` e `prod` di `~/.ssh/config`, e Claude controlla `ssh test id` (utente `deploy`, gruppo `docker`, senza `sudo`) e `ssh test docker run --rm hello-world`.

### Prove dopo la chiusura (utente)

```bash
ssh -t test-admin 'sudo sshd -T | grep -Ei "^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication) "'
ssh -i ~/.ssh/gestionale-yoo -o IdentitiesOnly=yes root@<indirizzo> true                       # Permission denied
ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password,keyboard-interactive deploy@<indirizzo>   # Permission denied (publickey)
ssh -i ~/.ssh/rilascio-test -o IdentitiesOnly=yes deploy@<indirizzo del test> echo ciao        # nessuna shell: risponde il comando forzato
ssh -i ~/.ssh/rilascio-test -o IdentitiesOnly=yes deploy@<indirizzo di prod> true              # Permission denied (chiave dell'altro server)
ssh -t test-admin 'sudo ufw status verbose'
```

### Manutenzione dell'host (utente)

I pacchetti dell'host (`apt upgrade`, riavvii, e più avanti `rclone` e `k6`) li installa e aggiorna solo l'utente, con `ssh -t test-admin` e `sudo`: `deploy` non ha `sudo`. Gli aggiornamenti di sicurezza arrivano da soli con `unattended-upgrades`; quando compare `/var/run/reboot-required`, l'utente sceglie il momento del riavvio (sul server di test senza rilasci in corso; in produzione fuori dagli orari di lavoro dei negozi).

---

## Firewall di Hostinger (FON-T07a)

Secondo livello oltre a ufw (01 §Server). Lo imposta l'utente nel pannello di Hostinger, per **ciascuna** delle due VPS: VPS → Sicurezza → Firewall → nuova configurazione, associata alla VPS.

Regole in ingresso, nell'ordine:

| # | Azione | Protocollo | Porta | Origine |
|---|---|---|---|---|
| 1 | Accetta | TCP | 22 | qualsiasi |
| 2 | Accetta | TCP | 80 | qualsiasi |
| 3 | Accetta | TCP | 443 | qualsiasi |
| 4 | Rifiuta | qualsiasi | qualsiasi | qualsiasi |

Niente UDP (HTTP/3 è disattivato). La prova delle porte dall'esterno (`nmap`, FON-T07b e collaudo C13) non distingue questo firewall da ufw: per questo l'utente legge le regole nel pannello e le detta a Claude, che le annota in `docs/verifiche/fon-t07a-esito.md`. A ogni modifica nel pannello si aggiorna questa tabella.

---

## Accesso a GHCR dai server (FON-T07a)

Le immagini del progetto (`caddy`, `postgres`, `app`) sono pacchetti privati di `ghcr.io/jinoesfoo/`. I server le scaricano come `deploy` con un token **classic** di sola lettura (`read:packages`), dell'account `jinoesfoo`, diverso da quello `write:packages` che l'utente usa su yoo per le pubblicazioni a mano. I token *fine-grained* non funzionano con GHCR.

Il token sta in `/srv/app/env/ghcr-token` (600, `deploy`), nella cartella `/srv/app/env` (700, `deploy`), e lo scrive solo l'utente. `deploy.sh` (FON-T08) ripete il login a ogni rilascio leggendo quel file.

### Procedura (utente, su ciascun server)

1. Su GitHub, con l'account `jinoesfoo`: Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic), nome `ghcr-server`, solo `read:packages`. Il token (inizia con `ghp_`) va nel gestore di password.
2. `ssh -t test-admin sudo -iu deploy`, poi, **un comando alla volta**:
   ```bash
   hostname                      # srv2155002 per il test, srv1874119 per la produzione
   whoami                        # deploy
   install -d -m 700 /srv/app/env
   umask 077
   read -rs T && printf '%s\n' "$T" > /srv/app/env/ghcr-token && unset T
   ```
   Dopo il `read` il terminale aspetta: si incolla il token (non si vede) e si preme Invio. Non incollare più righe insieme: il `read` prenderebbe come token la riga seguente.
   ```bash
   chmod 600 /srv/app/env/ghcr-token
   docker login ghcr.io -u jinoesfoo --password-stdin < /srv/app/env/ghcr-token     # Login Succeeded
   stat -c '%U %a %n' /srv/app/env /srv/app/env/ghcr-token                          # deploy 700 / deploy 600
   exit
   ```
3. Lo stesso con `prod-admin`.

L'avviso «credentials are stored unencrypted in /home/deploy/.docker/config.json» è atteso: il token è di sola lettura e il file è leggibile solo da `deploy`.

### Rotazione del token

Si crea un nuovo token come al punto 1, si ripete il punto 2 su entrambi i server (sovrascrive il file), si controlla con `ssh test docker pull <un'immagine del progetto>`, poi si revoca il token vecchio su GitHub e si aggiorna la copia fuori linea.

### Prova con un'immagine di prova

In FON-T07a, quando non esisteva ancora un'immagine del progetto, Claude ha pubblicato da yoo `ghcr.io/jinoesfoo/gestionale-negozi-prova:1` (`busybox:1.37.0` con la label `org.opencontainers.image.source=https://github.com/jinoesfoo/gestionale-negozi`), privata, e i due server l'hanno scaricata ed eseguita come `deploy`. Poi l'utente l'ha cancellata («Package settings» → «Delete this package») e Claude l'ha tolta dai server con `docker image rm`.

### Collegamento dei pacchetti al repository (prime pubblicazioni a mano)

Prova di FON-T07a (13–14/11/2026): pubblicando da yoo con `docker push` e il token dell'utente, i pacchetti **non** nascono collegati al repository anche con la label `org.opencontainers.image.source` nel Dockerfile, sia con la costruzione predefinita (indice con attestazione) sia con `--provenance=false --sbom=false` (manifest singolo), sia in un pacchetto nuovo sia in uno esistente (dettagli in `docs/verifiche/fon-t07a-esito.md`). La label resta comunque nei Dockerfile: non costa nulla e serve alle pubblicazioni della CI.

Dopo ogni prima pubblicazione a mano (Caddy in DOM-T02, PostgreSQL in OPS-T01a, app in FON-T07b) l'utente, con l'account `jinoesfoo`:

1. apre la pagina del pacchetto (`https://github.com/jinoesfoo?tab=packages`) e controlla che sia **Private**;
2. se compare «Link this package to a repository», preme **Connect Repository** e sceglie `gestionale-negozi` (provato: funziona);
3. in «Package settings» → «Manage Actions access» aggiunge `gestionale-negozi` con il ruolo **Write**, che serve ai flussi di FON-T08 per pubblicare (`AVVIO.md` §8 passo 7).

---

## DNS ed email (DOM-T01)

_Da scrivere in DOM-T01:_ token API Cloudflare per zona (Zone › Zone › Read, Zone › DNS › Edit), record DNS di entrambe le zone, record email (SPF, DKIM di Brevo, DMARC), Email Routing o autorizzazione esterna per l'indirizzo DMARC, intervalli IP dei webhook di Brevo con la data del controllo.

## Caddy e certificati

### DOM-T02

_Da scrivere in DOM-T02:_ costruzione e prima pubblicazione dell'immagine Caddy, `/srv/app/infra/`, `/srv/app/.env`, `/srv/app/deploy-env`, installazione di `/srv/app/dc`, avvio del Caddy di bootstrap con Compose (volume `app_caddy_data`).

### FON-T07b

_Da scrivere in FON-T07b:_ revisione dell'immagine Caddy con `reverse_proxy` e aggiornamento di `CADDY_TAG`.

## Archivi S3 (OPS-T03)

_Da scrivere in OPS-T03:_ fornitore scelto, progetti, bucket, chiavi, versioning, ciclo di vita, policy, client S3 da usare dal terminale dell'utente, `check-bucket-isolation.sh`.

## PostgreSQL e backup

### OPS-T01a

_Da scrivere in OPS-T01a:_ prima pubblicazione dell'immagine PostgreSQL, `POSTGRES_TAG`, `pgbackrest-init`, `backup.sh`, timer notturni.

### OPS-T01b

_Da scrivere in OPS-T01b:_ copia specchio (`backup-mirror`), chiave dedicata con comando forzato in produzione, `backup-mirror.known_hosts`, versione di `rclone`, prova di ripristino mensile.

## File di ambiente dei server

Tutti i file di `/srv/app/env/` li scrive l'utente, come `deploy` (`ssh -t <nome>-admin sudo -iu deploy`), con permessi 600, dagli esempi di `infra/env.example/`. Per cambiare un file mentre i rilasci sono attivi si modifica una copia e la si sostituisce con `mv` (`docs/due-postazioni.md`, «Variabili e valori dei server»). Ogni valore nuovo va nella copia fuori linea.

### DOM-T02

_Da scrivere in DOM-T02:_ `caddy.env` e i file vuoti `app.env`, `worker.env`, `migrate.env`, `postgres.env`.

### OPS-T01a

_Da scrivere in OPS-T01a:_ `postgres.env`.

### FON-T07b

_Da scrivere in FON-T07b:_ `app.env`, `worker.env`, `migrate.env` (compresa la chiave `sk_test_` della sandbox Stripe di quel server).

### BIL-T01

_Da scrivere in BIL-T01:_ `STRIPE_PORTAL_CONFIGURATION_ID`.

### BIL-T02

_Da scrivere in BIL-T02:_ `STRIPE_WEBHOOK_SECRET`.

### BIL-T11

_Da scrivere in BIL-T11:_ variabili del fornitore SDI.

### OPS-T04

_Da scrivere in OPS-T04:_ `SENTRY_DSN`, `HEALTH_TOKEN`.

## Primo avvio completo (FON-T07b)

_Da scrivere in FON-T07b:_ prima immagine dell'app (`bootstrap`), aggiornamento di `/srv/app/.env` e `/srv/app/infra/`, `pull`, `run --rm migrate`, `up -d`, primo backup completo, webhook dei rimbalzi email di Brevo (`/api/webhooks/email?k=…`).

## Rilasci automatici (FON-T08)

_Da scrivere in FON-T08:_ `deploy.sh`, segreti dei flussi (chiavi di rilascio, `KNOWN_HOSTS` dalle righe di «Chiavi degli host»), fermo `TEST_DEPLOY_HOLD`, avvio a mano.

## Rotazione dei segreti

### OPS-T11

_Da scrivere in OPS-T11:_ procedura generale di rotazione di ogni segreto, con ultimo passo «aggiorna la copia fuori linea» e la data dell'ultimo aggiornamento (OPS-009).

### NEG-T09

_Da scrivere in NEG-T09:_ rotazione di `SHOP_SECRETS_KEY`.

## Amministratori e secondo fattore

### ADM-T01

_Da scrivere in ADM-T01:_ nomina degli amministratori del pannello con `admin:grant`.

### ACC-T04

_Da scrivere in ACC-T04:_ `admin:reset-2fa` con verifica d'identità.

## Dashboard Stripe

### BIL-T01

_Da scrivere in BIL-T01:_ impostazioni del Dashboard delle sandbox dei server (05 §Impostazioni da fare nel Dashboard Stripe), compresa la procedura «fattura di recupero a mano» (negozio in `payment_failed` dopo un fallimento SEPA, 05; collaudo C21).

### BIL-T02

_Da scrivere in BIL-T02:_ registrazione degli endpoint dei webhook nelle sandbox dei due server.

### BIL-T11

_Da scrivere in BIL-T11:_ impostazioni del Dashboard per la fattura elettronica.

## Monitoraggio (OPS-T04)

_Da scrivere in OPS-T04:_ Sentry, servizio di controllo esterno (sottodominio `<casuale>` annotato qui), timer `host-metrics`.

## Strumenti sull'host

### OPS-T01b

_Da scrivere in OPS-T01b:_ versione di `rclone` da installare (utente, con `admin-personale`).

### COL-T01

_Da scrivere in COL-T01:_ versione di `k6` da installare (utente, con `admin-personale`).
