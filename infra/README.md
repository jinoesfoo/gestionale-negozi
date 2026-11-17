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

Specifica: 06 DOM-008, DOM-012, §DNS. Lista di controllo: `docs/verifiche/dom-t01.md`; esiti: `docs/verifiche/dom-t01-esito.md`.

| | Produzione | Test |
|---|---|---|
| Zona Cloudflare | `foondaco.com` (`{{DOMINIO}}`) | `foondaco.it` (`{{DOMINIO_TEST}}`) |
| Registrar | Hostinger | Hostinger |
| IPv4 del server | `91.108.122.251` | `145.14.158.72` |
| IPv6 del server | `2a02:4780:c:f90c::1` | `2a02:4780:d:8458::1` |

Tutto si fa nei pannelli di Hostinger (hPanel, https://hpanel.hostinger.com, solo per i nameserver), di Cloudflare (https://dash.cloudflare.com) e di Brevo (https://app.brevo.com), con l'account dell'utente. Claude non ha accesso ai pannelli: controlla i record con `ssh test dig @1.1.1.1 …`. Ogni record è **«DNS only»** (nuvola grigia): con il proxy di Cloudflare il TLS non lo farebbe più Caddy (DOM-008). TTL: «Auto».

### 1. Zone attive (utente)

1. Su Cloudflare: «Add a domain» (o «Onboard a domain») → il dominio → importazione automatica dei record («Quick scan») → piano **Free**. Cloudflare mostra i **due nameserver** della zona (pagina «Overview»).
2. Su Hostinger: hPanel → Domini → Portafoglio domini → il dominio → Gestisci → DNS / Nameserver. La pagina «Seleziona i nameserver» parte da «Utilizza i nameserver Hostinger»: si preme **«Cambia i nameserver»**, si scelgono i nameserver personalizzati, si scrivono i due di Cloudflare (Nameserver 1 e 2; gli altri vuoti) e si salva. Se c'è DNSSEC attivo su Hostinger, prima si spegne.
3. Controllo della delega direttamente nel registro, che non ha copie vecchie: `ssh test dig +noall +authority NS foondaco.com @a.gtld-servers.net` e `ssh test dig +noall +authority NS foondaco.it @a.dns.it` devono rispondere con i due nomi `*.ns.cloudflare.com`. Finché rispondono `*.dns-parking.com`, il cambio su Hostinger non è salvato o non è ancora arrivato al registro.
4. Su Cloudflare la zona diventa «Active» quando Cloudflare ricontrolla i nameserver: lo fa da sé, ma per farlo subito si preme «Check nameservers now» nella pagina «Overview» della zona. Email Routing (punto 4) si attiva solo su una zona «Active».

Le impostazioni proposte da Cloudflare (SSL, HTTPS automatico, «Quick Start Guide») non si toccano: con «DNS only» non hanno effetto.

### 2. Token API, uno per zona (utente)

Servono a Caddy per il certificato jolly con la sfida DNS (06 §Caddy; vanno in `CF_API_TOKEN` di `/srv/app/env/caddy.env` in DOM-T02, ciascuno sul suo server). Per ciascuna zona:

1. «My Profile» (icona in alto a destra) → «API Tokens» → «Create Token».
2. «Token name»: `caddy-foondaco-com` (produzione) o `caddy-foondaco-it` (test).
3. «Policies» → «Start from scratch» → **«Start with a Zone policy»**. Zona: solo `foondaco.com` (o `foondaco.it`), mai «All zones». Permessi: **Zone Read** e **DNS Edit**, nient'altro. Il modello «Edit zone DNS» non basta: ha solo il permesso DNS, e al modulo DNS di Caddy serve anche Zone Read per trovare la zona.
4. «Token expiration»: «No expiration». «Client IP address filtering»: vuoto.
5. «Continue to summary»: il riepilogo mostra solo la zona del token, con Zone Read e DNS Edit. Poi «Create Token».
6. Il valore del token, una stringa lunga che inizia con `cfut_`, si vede **una volta sola**. Prima di chiudere la pagina lo si copia con il pulsante di copia e lo si incolla in una voce nuova del gestore di password, con il nome del token. Si salva la voce e la si riapre per controllare che il valore ci sia. Poi il valore va nella copia sigillata (OPS-009). La password dell'account Cloudflare non basta: il valore non si può più rivedere, né nel pannello né con l'API. Non si scrive in chat, in git né in file del progetto. Il comando `curl` di prova che Cloudflare mostra contiene il token scritto per intero: non si lancia (la prova senza token nella riga è al punto 2 della rotazione).

Nella versione precedente del pannello lo stesso si fa con «Custom token» → «Get started»: «Permissions» `Zone` · `Zone` · `Read` e `Zone` · `DNS` · `Edit`; «Zone Resources» `Include` · `Specific zone` · la zona.

**Controllo di un token.** «API Tokens» → clic sul nome del token: si apre «Token Summary». Nella scheda «Summary», «Permission policies» mostra una sola voce, la zona del token, con «Zone: Read» e «DNS: Edit»; «IP Address Filtering» dice «All IP addresses allowed» e «Expiration» «No expiration». Si esce con «Back», senza toccare altro (pannello del 17/11/2026).

**Valore perso.** Se il valore di un token non è nel gestore di password, non si recupera: lo si rigenera. «API Tokens» → menu «⋯» della riga del token → «Roll» → «Confirm». Il token resta lo stesso (nome, permessi, zona), il valore vecchio non vale più e quello nuovo si vede una volta sola: si salva come al punto 6. Se il token è già in `caddy.env`, invece del «Roll» si fa una rotazione (sotto), così Caddy non resta con un valore che non vale più.

**Altri token.** Sull'account restano solo i token che servono. L'assistente AI del pannello («Ask AI», nella documentazione Agent Lee, prima «Cloudflare Agent») crea un token utente «Cloudflare Agent Token - <data>», con permessi ampi, quando gli si concede l'accesso (documentazione di Cloudflare, «Agent Lee» → «Manage access», letta il 17/11/2026). Se l'assistente non serve, quel token si cancella dall'elenco («⋯» → «Delete»). Se ricompare, si spegne l'assistente: «Configurations» → «Preferences» → «Cloudflare Agent». Alla richiesta di accesso di «Ask AI» non si risponde di sì, se l'assistente non serve.

Token in uso: `caddy-foondaco-com` e `caddy-foondaco-it`, creati il 17/11/2026 (DOM-T01) e rigenerati con «Roll» lo stesso giorno, perché il primo valore non era stato salvato. Copia fuori linea (OPS-009): nel gestore di password e nella copia sigillata, ultimo aggiornamento 17/11/2026.

**Rotazione di un token** (utente). Caddy usa il token solo quando emette o rinnova un certificato: intanto serve quello già salvato nel volume `app_caddy_data`. Per questo «il certificato si vede ancora» non prova che il token nuovo funzioni.

1. Si crea un token nuovo come ai punti 1–6, con un nome che porta la data (per esempio `caddy-foondaco-com-2027-05`).
2. Prova del token nuovo dal proprio terminale, senza scriverlo nella riga del comando (resterebbe nella cronologia). Un comando alla volta:
   ```bash
   read -rs T
   curl -s -H "Authorization: Bearer $T" https://api.cloudflare.com/client/v4/user/tokens/verify
   curl -s -H "Authorization: Bearer $T" "https://api.cloudflare.com/client/v4/zones?name=foondaco.com"
   curl -s -H "Authorization: Bearer $T" "https://api.cloudflare.com/client/v4/zones?name=foondaco.it"
   unset T
   ```
   Dopo il `read` si incolla il token (non si vede) e si preme Invio. La prima risposta deve dire `"status":"active"`. Delle altre due, solo quella della zona del token deve trovare la zona (`"count":1`). Quella dell'altra zona non deve trovarla: risponde senza zone (`"count":0`) oppure con un errore di permesso (`"success":false`). Le risposte non contengono il token.
3. Si scrive il token nuovo in `CF_API_TOKEN` di `/srv/app/env/caddy.env` del server di quella zona, con la procedura dei file di ambiente (copia del file e `mv`, «File di ambiente dei server»).
4. Si ricrea il container di Caddy, perché rilegga il file: come `deploy`, `/srv/app/dc up -d --force-recreate caddy`. Un `restart` non basta: Compose rilegge `env_file` solo quando ricrea il container.
5. Solo dopo, si cancella il token vecchio («API Tokens» → il token → «Delete»).
6. Ultimo passo: si aggiorna la copia fuori linea (gestore di password e copia sigillata, OPS-009), togliendo il token vecchio, e se ne annota qui sotto la data.

Rotazioni: _nessuna finora_.

### 3. Record dei server (utente), su ciascuna zona

«DNS» → «Records» → «Add record», nuvola grigia («DNS only»):

| Tipo | Nome | Valore in `foondaco.com` | Valore in `foondaco.it` |
|---|---|---|---|
| A | `@` | `91.108.122.251` | `145.14.158.72` |
| A | `*` | `91.108.122.251` | `145.14.158.72` |
| A | `app` | `91.108.122.251` | `145.14.158.72` |
| A | `admin` | `91.108.122.251` | `145.14.158.72` |
| AAAA | `@` | `2a02:4780:c:f90c::1` | `2a02:4780:d:8458::1` |
| AAAA | `*` | `2a02:4780:c:f90c::1` | `2a02:4780:d:8458::1` |
| AAAA | `app` | `2a02:4780:c:f90c::1` | `2a02:4780:d:8458::1` |
| AAAA | `admin` | `2a02:4780:c:f90c::1` | `2a02:4780:d:8458::1` |

Se Cloudflare, creando la zona, ha importato altri record `A`, `AAAA` o `CNAME` su `@`, `*`, `www`, `app` o `admin` (per esempio quelli del parcheggio di Hostinger), si cancellano. `www` non ha un record proprio: lo copre il jolly. Nelle due zone, il 16–17/11/2026, Cloudflare aveva importato `A @ 2.57.91.91` (parcheggio di Hostinger) e `CNAME www → @` (in `foondaco.it` «Proxied»): cancellati. Ogni record importato «Proxied» che resta (in `foondaco.it` i DKIM di Brevo) va messo «DNS only».

### 4. Email Routing per `dmarc@foondaco.com` (utente, solo zona `foondaco.com`)

I rapporti DMARC di entrambe le zone arrivano a `dmarc@foondaco.com`, inoltrati all'indirizzo di `ADMIN_ALERT_EMAIL` (06 DOM-012, nota di DOM-T01).

1. Menu a sinistra dell'account: «Compute» → «Email Service» → «Email Routing» → **«Onboard Domain»** → zona `foondaco.com` → «Continue». Se compare «This zone is not active», prima si attiva la zona (punto 1.4).
2. «Verify DNS records»: Cloudflare mostra i record che aggiunge, cioè tre `MX` sulla radice (`route1`, `route2`, `route3.mx.cloudflare.net`, con priorità scelte da Cloudflare), un TXT DKIM `cf2024-1._domainkey` per l'inoltro e un TXT SPF `v=spf1 include:_spf.mx.cloudflare.net ~all` sulla radice → **«Activate»**.
3. Nella pagina di Email Routing di `foondaco.com`: «Create address» → «Custom address» `dmarc`, «Action» «Send to an email», «Destination» l'indirizzo di `ADMIN_ALERT_EMAIL` → salva.
4. Cloudflare manda un'email di verifica a quell'indirizzo: si apre il link («Verify email address»).
5. Controllo: Email Routing di `foondaco.com` attivo, la destinazione «Verified» (in «Destination addresses»), l'indirizzo `dmarc@foondaco.com` attivo verso quella destinazione.

Nella versione precedente del pannello lo stesso si fa dalla zona: «Email» → «Email Routing» → «Get started», poi «Add records and enable».

La destinazione deve restare la casella di `ADMIN_ALERT_EMAIL` (06 DOM-012). Oggi la variabile non esiste ancora sui server: l'utente la scrive in FON-T07b. In quel momento, e a ogni cambio della variabile, l'utente controlla che la destinazione di Email Routing coincida. Se non coincide, aggiunge la nuova destinazione, la verifica, ci sposta `dmarc@foondaco.com` e rifà la prova del punto 8.2.

### 5. Record di Brevo (utente), su ciascuna zona

Su Brevo: account → «Senders, Domains & Dedicated IPs» → scheda «Domains» → il dominio → «Authenticate» → configurazione manuale («Authenticate the domain yourself»; **non** l'autenticazione automatica con Cloudflare). I valori li dà Brevo per ciascun dominio e si copiano così come sono:

| Tipo | Nome | Valore |
|---|---|---|
| TXT | `@` | il codice di verifica di Brevo (`brevo-code:…`) |
| CNAME (nuvola grigia) | `brevo1._domainkey` | il valore del pannello di Brevo |
| CNAME (nuvola grigia) | `brevo2._domainkey` | il valore del pannello di Brevo |

I valori pubblicati sono in «Valori letti», più sotto. Il DMARC proposto da Brevo (`rua=mailto:rua@dmarc.brevo.com`) **non** si usa: vale quello del punto 7. Brevo non chiede né SPF né MX per autenticare un dominio (punto 6).

### 6. SPF: un solo record per radice (utente)

Un nome può avere un solo record SPF: due record `v=spf1` sullo stesso nome fanno fallire SPF.

| Zona | Record TXT su `@` |
|---|---|
| `foondaco.com` | `v=spf1 include:spf.brevo.com include:_spf.mx.cloudflare.net ~all` — si **modifica** il record creato da Email Routing al punto 4, non se ne aggiunge un secondo |
| `foondaco.it` | `v=spf1 include:spf.brevo.com ~all` |

Da dove viene `include:spf.brevo.com`. Il pannello di Brevo non chiede nessun SPF. L'articolo di Brevo «Authenticate your domain with Brevo (Brevo code, DKIM, DMARC)» (help.brevo.com, articolo 12163873383186, aggiornato il 14/11/2026, letto il 17/11/2026) dice che SPF e MX servono solo con un IP dedicato. Con gli IP condivisi, infatti, il mittente della busta (return-path) è un dominio di Brevo: l'SPF che conta è quello di Brevo, e il DMARC passa grazie al DKIM allineato. L'`include` sta lo stesso nel record perché DOM-012 chiede un SPF «che include il fornitore».

Il valore viene dall'articolo di Brevo «Merge multiple SPF records» (articolo 4414335084434, aggiornato il 19/10/2026), dove l'SPF di Brevo è `v=spf1 include:spf.brevo.com mx ~all`. Il meccanismo `mx` non si copia:
- gli MX di `foondaco.com` sono i server di Cloudflare che ricevono per Email Routing, e non inviano posta come `foondaco.com`;
- `foondaco.it` non ha MX.

Se Brevo cambia il nome del suo `include`, nel pannello o nella documentazione, vale quello nuovo. Controllo: `ssh test dig @1.1.1.1 +short TXT spf.brevo.com` risponde con un record `v=spf1`.

Il record SPF creato da Email Routing si trova in «DNS» → «Records» filtrando i TXT (o cercando `spf1`). Se risulta bloccato da Email Routing (lucchetto), si sblocca dalle impostazioni di Email Routing della zona prima di modificarlo. Controllo: `ssh test dig @1.1.1.1 +short TXT foondaco.com` mostra un solo record che inizia con `v=spf1`.

### 7. DMARC (utente)

| Zona | Tipo | Nome | Valore |
|---|---|---|---|
| `foondaco.com` | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@foondaco.com` |
| `foondaco.it` | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@foondaco.com` |
| `foondaco.com` | TXT | `foondaco.it._report._dmarc` | `v=DMARC1` |

L'ultimo record autorizza `foondaco.com` a ricevere i rapporti di `foondaco.it` (RFC 7489 §7.1): senza, i ricevitori non mandano i rapporti della zona di test. Un solo record `_dmarc` per zona: se Cloudflare o Brevo ne hanno già creato uno, si modifica quello.

Per `_dmarc.foondaco.com`, `p=none` diventa `p=quarantine` dopo almeno due settimane di rapporti puliti, al più tardi durante COL-T01 (06 DOM-012). Lo fa l'utente modificando il record, e COL-T01 ne annota la data. Il DMARC di `foondaco.it` la specifica non lo nomina: resta `p=none`.

### 8. Autenticazione su Brevo e prova dell'inoltro (utente)

1. Su Brevo, per ciascun dominio, «Authenticate this email domain» (o «Verify»): entrambi devono risultare autenticati.
2. Dalla propria casella si manda un'email a `dmarc@foondaco.com`: deve arrivare nella casella di `ADMIN_ALERT_EMAIL`.

Chi fa il resto:
- i mittenti su Brevo («Senders, Domains & Dedicated IPs» → «Senders»), uno su `foondaco.com` e uno su `foondaco.it`, li crea l'utente (`AVVIO.md`, «Fuori da GitHub»);
- `EMAIL_FROM` nei `worker.env` dei server lo scrive l'utente in FON-T07b, con l'indirizzo del mittente di quel server;
- la prova di invio con `spf=pass`, `dkim=pass` e `dmarc=pass` è di FON-T10 (joo).

### Valori letti

Record pubblicati, letti da Claude con `ssh test dig @1.1.1.1 …` il 17/11/2026 (esiti in `docs/verifiche/dom-t01-esito.md`). Sono tutti valori pubblici.

Nameserver delle due zone: `jay.ns.cloudflare.com`, `princess.ns.cloudflare.com` (delega vista nel registro `.com` il 16/11/2026 e nel registro `.it` il 17/11/2026; nessun record DS rimasto da Hostinger).

**`foondaco.com`**

| Tipo | Nome | Valore |
|---|---|---|
| A / AAAA | `@`, `*`, `app`, `admin` | `91.108.122.251` / `2a02:4780:c:f90c::1` |
| MX | `@` | `31 route1.mx.cloudflare.net`, `34 route3.mx.cloudflare.net`, `88 route2.mx.cloudflare.net` (Email Routing) |
| TXT | `@` | `v=spf1 include:spf.brevo.com include:_spf.mx.cloudflare.net ~all` |
| TXT | `@` | `brevo-code:deb6e878db29b6ed66e2bd2fc5d772c9` |
| TXT | `cf2024-1._domainkey` | `v=DKIM1; h=sha256; k=rsa; p=…` (chiave di Email Routing, creata da Cloudflare) |
| CNAME | `brevo1._domainkey` | `b1.foondaco-com.dkim.brevo.com` |
| CNAME | `brevo2._domainkey` | `b2.foondaco-com.dkim.brevo.com` |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@foondaco.com` |
| TXT | `foondaco.it._report._dmarc` | `v=DMARC1` |

**`foondaco.it`**

| Tipo | Nome | Valore |
|---|---|---|
| A / AAAA | `@`, `*`, `app`, `admin` | `145.14.158.72` / `2a02:4780:d:8458::1` |
| TXT | `@` | `v=spf1 include:spf.brevo.com ~all` |
| TXT | `@` | `brevo-code:deb6e878db29b6ed66e2bd2fc5d772c9` |
| CNAME | `brevo1._domainkey` | `b1.foondaco-it.dkim.brevo.com` |
| CNAME | `brevo2._domainkey` | `b2.foondaco-it.dkim.brevo.com` |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@foondaco.com` |

Il codice di verifica di Brevo è lo stesso per i due domini: Brevo mostra entrambi «Authenticated» (17/11/2026), quindi lo accetta per tutti e due. I valori di `foondaco.it` l'utente li ha letti nel pannello di Brevo il 16/11/2026. Quelli di `foondaco.com` li ha copiati dal pannello nei record, e Claude li ha letti dal DNS. `foondaco.it` non ha record MX: non riceve posta, e i suoi rapporti DMARC vanno a `dmarc@foondaco.com`.

Nota: i record DKIM `CNAME` vanno «DNS only». Con il proxy (nuvola arancione) Cloudflare risponde con i propri indirizzi invece del `CNAME`, e il DKIM non si verifica.

### Punti lasciati ai compiti successivi

- **Intervalli IP dei webhook di Brevo** (06 §Caddy, [VERIFICA] del matcher `@email_webhook_foreign`). Non sono di DOM-T01: li controlla e li annota, con la data, DOM-T02, che scrive il Caddyfile. È una decisione del piano di DOM-T01, annotata anche in 06 accanto al [VERIFICA].
- **IPv6.** I due server hanno IPv6, quindi le zone hanno anche i record `AAAA`, come chiede 06 §DNS: i client IPv6 arriveranno ai server in IPv6. Da controllare in DOM-T02, prima che i server servano traffico vero:
  - HTTPS funziona anche in IPv6 (`curl -6` da fuori);
  - quale IP del client arriva a Caddy e all'app. Con una rete Compose solo IPv4, Docker inoltra le connessioni IPv6 con il suo proxy, e Caddy vedrebbe l'indirizzo del gateway invece di quello del client, da verificare sulla versione installata (Docker 29.9.3). Ne dipendono i limiti per IP (03 ACC-004) e il matcher `remote_ip` del webhook di Brevo;
  - se il firewall di Hostinger (FON-T07a) applica le stesse regole anche a IPv6.
  
  Se l'IP vero dei client IPv6 non arriva, DOM-T02 sceglie fra una rete Compose con IPv6 e la rimozione dei record `AAAA`. Il punto è annotato anche in 06 §DNS.
- **Formato dei token e modulo di Caddy.** I token di DOM-T01 hanno il formato nuovo di Cloudflare, che inizia con `cfut_` ed è più lungo di 50 caratteri. Il codice delle due versioni di `caddy-dns/cloudflare`, letto su GitHub il 17/11/2026, dice:
  - il modulo accetta questo formato dalla v0.2.4 (commit «Handle new CF tokens format (#123)», 23/03/2026);
  - fino alla v0.2.3 accetta solo token da 35 a 50 caratteri.

  Il `Dockerfile` di 06 §Caddy non fissa la versione del modulo, quindi `xcaddy` prende l'ultima; se DOM-T02 la fissa, non più vecchia della v0.2.4. Se il token non ha la forma attesa (versione vecchia del modulo, apici o spazi nel file di ambiente), il modulo ferma Caddy con l'errore «API token '…' appears invalid». L'errore contiene il token per intero, che così finisce nel log del container. In quel caso si corregge il file e il token si considera esposto: si rigenera («Valore perso», punto 2). Il punto è annotato anche in 06 §Caddy.

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
