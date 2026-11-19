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

**Valore perso.** Se il valore di un token non è nel gestore di password, non si recupera: lo si rigenera. «API Tokens» → menu «⋯» della riga del token → «Roll» → «Confirm». Il token resta lo stesso (nome, permessi, zona), il valore vecchio non vale più e quello nuovo si vede una volta sola: si salva come al punto 6, poi si aggiornano «Token in uso» e «Rotazioni» (sotto). Se il token è già in `caddy.env`, invece del «Roll» si fa una rotazione (sotto), così Caddy non resta con un valore che non vale più. Un token esposto, invece, si rigenera subito (sotto).

**Token esposto.** Se il valore di un token è finito dove non deve (in un log, in chat, in un file del progetto, nell'output di un comando), si fa subito «Roll», anche se il token è già in `caddy.env`: il valore vecchio non vale più (documentazione di Cloudflare, `developers.cloudflare.com/fundamentals/api/how-to/roll-token/`, letta il 17/11/2026). Poi, in quest'ordine:
- il valore nuovo si salva come al punto 6, ma al posto di quello vecchio: nella stessa voce del gestore di password e nella copia sigillata (OPS-009);
- si prova il valore nuovo, come al punto 2 della rotazione;
- se il valore era finito nell'output di un errore di Caddy o di Compose, si toglie la causa («Punti lasciati ai compiti successivi», «Formato dei token e modulo di Caddy»), altrimenti anche il valore nuovo finisce nello stesso posto;
- se il token è in `caddy.env`, si fanno i punti 3 e 4 della rotazione, con i loro controlli;
- si aggiornano «Token in uso» e «Rotazioni».

Nel frattempo Caddy, se è in funzione, non può emettere né rinnovare i certificati di quella zona, ma continua a usare quelli che ha.

**Altri token.** Sull'account restano solo i token che servono. L'assistente AI del pannello («Ask AI», nella documentazione Agent Lee, prima «Cloudflare Agent») crea un token utente «Cloudflare Agent Token - <data>», con permessi ampi, quando gli si concede l'accesso (documentazione di Cloudflare, «Agent Lee» → «Manage access», letta il 17/11/2026). Se l'assistente non serve, quel token si cancella dall'elenco («⋯» → «Delete»). Se ricompare, si spegne l'assistente: «Configurations» → «Preferences» → «Cloudflare Agent». Alla richiesta di accesso di «Ask AI» non si risponde di sì, se l'assistente non serve.

Token in uso: `caddy-foondaco-com` e `caddy-foondaco-it`, creati il 17/11/2026 (DOM-T01). Copia fuori linea (OPS-009): nel gestore di password e nella copia sigillata, ultimo aggiornamento 17/11/2026.

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
3. Si scrive il token nuovo in `CF_API_TOKEN` di `/srv/app/env/caddy.env` del server di quella zona, con la procedura dei file di ambiente (copia del file e `mv`, «File di ambiente dei server»): una sola riga `CF_API_TOKEN=cfut_…`, senza apici né spazi. Controlli, che non stampano il valore:
   - `grep -c '^[^#]*CF_API_TOKEN' /srv/app/env/caddy.env` risponde `1`: c'è una sola riga del token, senza contare i commenti;
   - `grep -cE '^CF_API_TOKEN=cfut_[A-Za-z0-9_-]{32,256}$' /srv/app/env/caddy.env` risponde `1`: la riga ha la forma che il modulo di Caddy accetta.
4. Si ricrea il container di Caddy, perché rilegga il file: come `deploy`, `/srv/app/dc up -d --force-recreate caddy`. Un `restart` non basta: Compose rilegge `env_file` solo quando ricrea il container. Controllo: il comando finisce senza errori. Dopo una ventina di secondi, `/srv/app/dc ps caddy` mostra:
   - nella colonna «CREATED», un container di pochi secondi o di un minuto fa, non di ore o di giorni;
   - nella colonna «STATUS», «Up» da almeno 20 secondi, non «Restarting».

   Se il container non è stato ricreato, Caddy usa ancora il valore vecchio: non si passa al punto 5. Se un errore mostra il valore del token, non lo si copia in chat: vale «Token esposto».
5. Solo dopo, si cancella il token vecchio («API Tokens» → il token → «Delete»).
6. Ultimo passo: si aggiorna la copia fuori linea (gestore di password e copia sigillata, OPS-009), togliendo il token vecchio. Poi si aggiornano qui «Token in uso» (sopra: nome del token e data dell'ultimo aggiornamento della copia) e «Rotazioni» (sotto: una riga con la data).

Rotazioni, compresi i «Roll» di «Valore perso» e «Token esposto»:
- 17/11/2026: «Roll» di `caddy-foondaco-com` e `caddy-foondaco-it` (DOM-T01, «Valore perso»: il primo valore non era stato salvato).

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

Per `_dmarc.foondaco.com`, `p=none` diventa `p=quarantine` dopo almeno due settimane di rapporti puliti, al più tardi durante COL-T01 (06 DOM-012). Lo fa l'utente modificando il record, e COL-T01 ne annota la data. La stessa regola vale per `_dmarc.foondaco.it`: 06 §DNS vuole sulla zona di test i record di DOM-012, e i suoi rapporti arrivano anch'essi a `dmarc@foondaco.com`. La lista di COL-T01 controlla tutti e due i record (nota di DOM-T01 in 06, sotto DOM-012).

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
- **Formato dei token e modulo di Caddy.** I token di DOM-T01 hanno il formato nuovo di Cloudflare, che inizia con `cfut_` ed è più lungo di 50 caratteri. Il codice di `caddy-dns/cloudflare`, letto su GitHub il 17/11/2026, dice:
  - il modulo accetta questo formato dalla v0.2.4 (commit «Handle new CF tokens format (#123)», 23/03/2026), che è anche l'ultima versione;
  - fino alla v0.2.3 accetta solo token da 35 a 50 caratteri.

  Il `Dockerfile` di 06 §Caddy non fissa la versione del modulo, quindi `xcaddy` prende l'ultima. Conviene che DOM-T02 la fissi, non più vecchia della v0.2.4 (`--with github.com/caddy-dns/cloudflare@v0.2.4`): così un'immagine nuova non cambia il modulo da sola.

  Almeno due tipi di errore stampano il token per intero:
  - quello del modulo, «API token '…' appears invalid», che ferma Caddy e finisce nel log del container. Viene da un modulo più vecchio della v0.2.4 o da un valore con caratteri in più o in meno (per esempio troncato, o con un apice solo alla fine). La proposta di nasconderlo (PR #132 di `caddy-dns/cloudflare`) al 17/11/2026 non è unita;
  - quelli di Compose per una riga malformata in `caddy.env`, per esempio «unterminated quoted value …» (un apice aperto e non chiuso) o «unexpected character … in variable name …» (un apice prima del nome). Fermano `/srv/app/dc` prima di Caddy, e la riga del token compare nell'output del comando, anche in quello di `deploy.sh`, quindi nel log del rilascio. Gli apici chiusi e gli spazi attorno al valore, invece, Compose li toglie da sé.

  In quei casi il token è esposto: vale «Token esposto», nella sezione 2. Ne vengono due regole, per DOM-T02 e per ogni avvio di Caddy con un token nuovo o con un'immagine nuova, rotazione compresa:
  - prima dell'avvio si controllano la versione del modulo, a ogni immagine nuova, e la forma del valore in `caddy.env`, a ogni token nuovo. La versione si vede per esempio con `caddy list-modules --versions --skip-standard`, che elenca i moduli aggiunti con la loro versione. La forma la controlla l'utente con i comandi del punto 3 della rotazione, che non stampano il valore;
  - finché Caddy non è partito senza errori, Claude non mostra in chat senza filtro i log di Caddy, l'output dei comandi `/srv/app/dc` che leggono `caddy.env` (`up`, `create`, `run`) e i log dei rilasci falliti. Il filtro sostituisce con un segnaposto le righe che contengono `cfut_` o «appears invalid», e per i comandi sul server gira sul server, dopo `2>&1` (Caddy scrive su stderr). Così il segno dell'errore resta visibile, il token no.

  Il punto è annotato anche in 06 §Caddy.

## Caddy e certificati

### DOM-T02

_Da scrivere in DOM-T02:_ costruzione e prima pubblicazione dell'immagine Caddy, `/srv/app/infra/`, `/srv/app/.env`, `/srv/app/deploy-env`, installazione di `/srv/app/dc`, avvio del Caddy di bootstrap con Compose (volume `app_caddy_data`).

### FON-T07b

_Da scrivere in FON-T07b:_ revisione dell'immagine Caddy con `reverse_proxy` e aggiornamento di `CADDY_TAG`.

## Archivi S3 (OPS-T03)

Specifica: 08 OPS-004 (la parte delle chiavi), OPS-005, OPS-007, OPS-008, OPS-009 e il compito OPS-T03. Lista di controllo: `docs/verifiche/ops-t03.md`, le cui righe (A1–K5) sono le sigle usate qui. Esiti: `docs/verifiche/ops-t03-esito.md`.

Fornitore: **Hetzner Object Storage**, console https://console.hetzner.com. Una coppia di chiavi Hetzner vale per tutti i bucket del suo progetto. Per questo ogni unità ha un progetto suo, e le chiavi di sola lettura stanno in un progetto senza bucket (08 OPS-007). La sola lettura la dà la policy del bucket dei backup di produzione (08, [VERIFICA] di OPS-T03).

Serve un account Hetzner dell'utente (`AVVIO.md`, «Fuori da GitHub»): si crea su https://accounts.hetzner.com/login → «Register Now», con la valuta EUR, e si protegge con l'autenticazione a due fattori («Settings» → «Two-factor authentication»), con numero cliente e recovery key nel gestore di password. Object Storage ha un prezzo base per account, non per progetto: 6,49 € al mese più IVA (0,0104 € l'ora, fino a quel tetto), con 1 TB di spazio e 1 TB di traffico in uscita compresi, per tutti i bucket insieme. Oltre, lo spazio costa 0,0087 € l'ora per TB e il traffico in uscita 1 € per TB, IVA esclusa; caricamenti, traffico interno e richieste non si pagano. Si paga ogni ora in cui esiste almeno un bucket, anche vuoto: progetti e chiavi da soli non costano. I cinque bucket pagano quindi un solo prezzo base (pagina di Hetzner «Object Storage», letta il 19/11/2026; il 18/11 la documentazione dava ancora i 4,99 € del lancio).

| Progetto | id (B3) | Bucket | Luogo | Impostazioni | Chiave → dove va |
|---|---|---|---|---|---|
| `file-prod` | 16852034 | `foondaco-file` | Falkenstein, `fsn1` | versioning; versioni precedenti tenute 30 giorni | `file-prod` → `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY` della produzione (FON-T07b) |
| `backup-prod` | 16852084 | `foondaco-backup` | Falkenstein, `fsn1` | niente versioning né ciclo di vita; policy di sola lettura per le chiavi di `lettura-backup-prod` | `pgbackrest-prod` → `PGBACKREST_REPO1_S3_KEY` e `PGBACKREST_REPO1_S3_KEY_SECRET` di `postgres.env` della produzione (OPS-T01a) |
| `file-test` | 16852085 | `foondaco-file-test` | Falkenstein, `fsn1` | come `file-prod` | `file-test` → `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY` del server di test (FON-T07b) |
| `backup-test` | 16852086 | `foondaco-backup-test` | Falkenstein, `fsn1` | niente versioning né ciclo di vita | `pgbackrest-test` → `PGBACKREST_REPO1_S3_KEY` e `PGBACKREST_REPO1_S3_KEY_SECRET` di `postgres.env` del server di test (OPS-T01a) |
| `specchio` | 16852088 | `foondaco-specchio` | **Helsinki, `hel1`** | Object Lock con conservazione predefinita COMPLIANCE di 45 giorni; versioni precedenti e delete marker tolti dopo 45 giorni | `specchio-scrittura` → `MIRROR_DST_ACCESS_KEY_ID` e `MIRROR_DST_SECRET_ACCESS_KEY` di `backup-mirror.env` del server di test (OPS-T01b) |
| `lettura-backup-prod` | 16852089 | nessuno | — | — | `specchio-lettura` → `MIRROR_SRC_ACCESS_KEY_ID` e `MIRROR_SRC_SECRET_ACCESS_KEY` di `backup-mirror.env` del server di test (OPS-T01b); le chiavi temporanee `prova-ripristino-AAAAMMGG` della prova mensile (OPS-004), cancellate a fine prova (nel terminale delle chiavi si chiamano `prova-ripristino`) |

Indirizzi e regioni, che non sono segreti: `https://fsn1.your-objectstorage.com` con la regione `fsn1`, `https://hel1.your-objectstorage.com` con la regione `hel1`.

**Regole.**

- Le chiavi le crea l'utente nella console. Stanno solo nel gestore di password e nella copia sigillata (OPS-009): mai in chat, in git, in un file o in una schermata, nemmeno la sola Access key.
- Il client S3 è **AWS CLI v2, versione 2.39.4** (passo 1). Prende le chiavi solo dall'ambiente del terminale delle chiavi (passo 4). Non si usano mai:
  - `aws configure` in nessuna forma (nemmeno `aws configure agent-toolkit`, che l'installatore suggerisce) e `aws login`: scrivono in `~/.aws`;
  - `aws update`: installa l'ultima versione, non quella fissata;
  - l'opzione `--debug`: scrive nei messaggi la Access key.
- Valgono le regole scritte in alto nella lista di controllo: dei 15 minuti, della policy, del terminale delle chiavi, degli appunti e della lettura.
- I 15 minuti valgono anche per le riletture: prima, Hetzner può rispondere con la configurazione vecchia (FAQ di Hetzner «Buckets and objects», letta il 18/11/2026).
- Nella console non si usano mai «Reset visibility/policy» (menu «⋯» del bucket nell'elenco) né «Reset Bucket visibility» (menu «Actions» nella pagina del bucket): potrebbero sostituire la policy. Le chiavi si creano solo da «Security» → «S3 credentials». Anche «Generate credentials» del menu «⋯» di un bucket crea una chiave del progetto, che ne avrebbe così due.
- Stato del servizio: https://status.hetzner.com.
  - Il 18/11/2026 Object Storage risultava «partially degraded» a Helsinki (scritture lente o fallite, dal 13/11) e a Falkenstein (dal 14/11), tutti e due in «Monitoring».
  - Dal 18/11/2026 alle 14:32 UTC: «Object Storage HEL: Creation of new buckets temporarily unavailable». Lo specchio, a Helsinki, si crea solo quando l'avviso è chiuso; gli altri bucket non aspettano.
  - Il 02/12/2026, dalle 12 alle 24 ora italiana, c'è una manutenzione di Object Storage con brevi interruzioni: in quella finestra non si fanno i passi da D a J.
  - Un errore di rete o del fornitore non è un esito (lista di controllo, I, voce 1).
- Se la console è in tedesco: «Sicherheit» → «S3-Zugangsdaten» → «Zugangsdaten generieren»; «Bucket erstellen»; «Schutz aktivieren»; «Sichtbarkeit/Richtlinie zurücksetzen» (da non usare).

### 1. Client S3 (A2; A3 la fa Claude)

AWS CLI v2 **2.39.4**, del 04/11/2026: la più recente uscita entro il 04/11/2026, cioè con almeno due settimane alla data del piano. Si installa dall'archivio ufficiale con la versione nel nome, dopo averne verificato la firma. Claude ha verificato il 18/11/2026 archivio e firma: la firma è buona, fatta con la chiave qui sotto, e l'archivio ha lo SHA-256 `5153610ddd5dff13d43b2965c92d58f16e9f3f54164eea76d3abb29f38787597`.

In una finestra qualsiasi dell'applicazione «Terminal» (Terminale), sempre la stessa: qui non servono chiavi. Si incolla un blocco alla volta e si preme Invio.

**1.** Una cartella nuova e i due file:

```bash
D=$(mktemp -d) && cd "$D"
curl -fsSLO https://awscli.amazonaws.com/awscli-exe-linux-x86_64-2.39.4.zip
curl -fsSLO https://awscli.amazonaws.com/awscli-exe-linux-x86_64-2.39.4.zip.sig
```

**2.** La chiave pubblica con cui AWS firma il client, copiata dalla pagina di AWS «Installing or updating to the latest version of the AWS CLI». È la stessa che sta nello script ufficiale `install.sh` della versione 2.39.4 (lette e confrontate il 18/11/2026). Impronta `FB5D B77F D5C1 18B8 0511 ADA8 A631 0ACC 4672 475C`, scadenza 01/07/2027. Il comando la copia da questo README, dove è scritta qui sotto, nel file `aws-cli-team.asc`, così non si incolla a mano:

```bash
sed -n '/^-----BEGIN PGP PUBLIC KEY BLOCK-----$/,/^-----END PGP PUBLIC KEY BLOCK-----$/p' ~/gestionale-negozi/infra/README.md > aws-cli-team.asc
```

La chiave che il comando copia (è l'unica di questo README):

```text
-----BEGIN PGP PUBLIC KEY BLOCK-----

mQINBF2Cr7UBEADJZHcgusOJl7ENSyumXh85z0TRV0xJorM2B/JL0kHOyigQluUG
ZMLhENaG0bYatdrKP+3H91lvK050pXwnO/R7fB/FSTouki4ciIx5OuLlnJZIxSzx
PqGl0mkxImLNbGWoi6Lto0LYxqHN2iQtzlwTVmq9733zd3XfcXrZ3+LblHAgEt5G
TfNxEKJ8soPLyWmwDH6HWCnjZ/aIQRBTIQ05uVeEoYxSh6wOai7ss/KveoSNBbYz
gbdzoqI2Y8cgH2nbfgp3DSasaLZEdCSsIsK1u05CinE7k2qZ7KgKAUIcT/cR/grk
C6VwsnDU0OUCideXcQ8WeHutqvgZH1JgKDbznoIzeQHJD238GEu+eKhRHcz8/jeG
94zkcgJOz3KbZGYMiTh277Fvj9zzvZsbMBCedV1BTg3TqgvdX4bdkhf5cH+7NtWO
lrFj6UwAsGukBTAOxC0l/dnSmZhJ7Z1KmEWilro/gOrjtOxqRQutlIqG22TaqoPG
fYVN+en3Zwbt97kcgZDwqbuykNt64oZWc4XKCa3mprEGC3IbJTBFqglXmZ7l9ywG
EEUJYOlb2XrSuPWml39beWdKM8kzr1OjnlOm6+lpTRCBfo0wa9F8YZRhHPAkwKkX
XDeOGpWRj4ohOx0d2GWkyV5xyN14p2tQOCdOODmz80yUTgRpPVQUtOEhXQARAQAB
tCFBV1MgQ0xJIFRlYW0gPGF3cy1jbGlAYW1hem9uLmNvbT6JAlQEEwEIAD4CGwMF
CwkIBwIGFQoJCAsCBBYCAwECHgECF4AWIQT7Xbd/1cEYuAURraimMQrMRnJHXAUC
akV0ygUJDqP4lQAKCRCmMQrMRnJHXFHjD/9eyZLYcKuQOlLvtqSDtUBiEZf6ZZjM
i3ygYH8rJNtuToUH+HvSpe819urJCquXhDrlK6N+aqW0hCLtNABJG/vsafIgvIYJ
hSGgpgtNnQyMV1jViRWqPjbouw8OkYKBThUfT1i2Y+wn58ifs6ODBCmTexWtXspA
Si+Gt49xDOW0APmbOPnI+a4HJW6tVEo6MWS0WjzpiBayR3d1A4pt4YrPfSdDgpLo
h2SLQqlRqvvVZJaWBjhkErNFpfsBA06sDcPEOb0G8LBUbR4WOcdvhe5LubJbZuxC
AG9kNPCVeQP1ixwjgjXKysaxeQ6rv0VzIQgRp6tLVLWhy6AKDNvLjFSsmXZ1Wl08
Y/RlOHXlzLuQMRE6sR1wOdRxc9TsrNWTGiBK65cvSWOy03JeBkQQ8pesqltiyxI9
U21kkgiXtTSKNGfKK8pO27D81YANhRqPK7iTp6kuFiY2WtOg90KTMNlIT+Ff85Y2
b1rHj6Z0SrCkJujhWk3IBPic/wJgz01LEc/OAdUPlby90RJZcIBhSlWhT7mXnXIO
c0HWlNQrns2s3CTyYwZSiSlYe9ApeLwhjDo8NhbFuCAy61l6O5UsR4AfZxx/rGKv
2wFb1/RN/P4gNe6vmxZAPjR0AQcwD3tc2McimOLr/22kmPz8IH3I0X7WoSFr0Biz
E91G7bb0hOb/cA==
=knv7
-----END PGP PUBLIC KEY BLOCK-----
```

**3.** La verifica della firma e, solo se è buona, l'installazione e la versione:

```bash
gpg --homedir ./gnupg-vuota --dearmor < aws-cli-team.asc > aws-cli-team.gpg
gpgv --keyring ./aws-cli-team.gpg awscli-exe-linux-x86_64-2.39.4.zip.sig awscli-exe-linux-x86_64-2.39.4.zip && unzip -qo awscli-exe-linux-x86_64-2.39.4.zip && sudo ./aws/install && aws --version
```

La cartella `./gnupg-vuota` non esiste e non viene creata: serve solo a non toccare il portachiavi personale. `sudo` chiede la password dell'utente del computer. L'uscita, da incollare a Claude (A2), è questa:

```
gpgv: Signature made Wed 04 Nov 2026 09:17:39 PM CET
gpgv:                using RSA key FB5DB77FD5C118B80511ADA8A6310ACC4672475C
gpgv: Good signature from "AWS CLI Team <aws-cli@amazon.com>"
You can now run: /usr/local/bin/aws --version
Tip: run 'aws configure agent-toolkit' to set up AWS skills and the AWS MCP server for your AI coding agent(s).
aws-cli/2.39.4 Python/3.14.8 Linux/7.0.0-43-generic exe/x86_64.ubuntu.26
```

- Contano «Good signature» e l'impronta nella riga «using RSA key». La data di «Signature made» cambia forma con la lingua del computer.
- Il suggerimento «Tip» non si segue.
- In `aws --version` conta `aws-cli/2.39.4`: il resto dipende dal sistema.
- Con «BAD signature» o «Can't check signature» non si va avanti: il `&&` ferma l'installazione, e lo si dice a Claude.
- Se il blocco si ferma a `sudo` (password sbagliata, o Ctrl+C), nella stessa cartella si lancia solo `sudo ./aws/install && aws --version`. Se risponde «Found preexisting AWS CLI installation», un client c'è già: si lancia `aws --version` e si manda a Claude quello che stampa.

**4.** Pulizia:

```bash
cd ~ && rm -rf "$D"
```

A3 (Claude): `~/.aws/credentials` e `~/.aws/config` non esistono (controllo della sola esistenza). Il client può creare `~/.aws/cli/cache/session.db`, un numero di sessione senza chiavi. Il terminale delle chiavi lo spegne (`AWS_CLI_SESSION_ID_DISABLED=true`); lo script di I2, che toglie tutte le variabili `AWS_*`, no.

**Cambio di versione.** Si ripetono gli stessi passi con il numero nuovo; al posto di `sudo ./aws/install` si usa `sudo ./aws/install --bin-dir /usr/local/bin --install-dir /usr/local/aws-cli --update`. Dopo il 01/07/2027 la chiave pubblica si riprende dalla pagina di AWS, che pubblica la stessa chiave con la scadenza prolungata: l'impronta non cambia. Non si prende da un keyserver: `keyserver.ubuntu.com` ne ha una copia scaduta.

### 2. Progetti e chiavi (B1–B4) (utente)

**1. Progetti (A1, B1).** Prima di tutto (A1): https://console.hetzner.com/projects, con il proprio account Hetzner (se non c'è ancora, lo si crea come scritto in alto), e una schermata dell'elenco dei progetti. Poi «New project» (con l'elenco vuoto è il pulsante rosso al centro della pagina) → il nome → il pulsante di conferma (nella console precedente era «Add project»). I sei progetti, con questi nomi: `file-prod`, `backup-prod`, `file-test`, `backup-test`, `specchio`, `lettura-backup-prod`. Poi una schermata dell'elenco dei progetti.

Per entrare in un progetto: https://console.hetzner.com/projects → clic sul nome del progetto. Il progetto aperto si vede nella barra in alto e nell'indirizzo (`/projects/<id>/…`, con l'id della tabella in alto). Prima di ogni «Generate credentials» e di ogni «Create Bucket» si guardano tutti e due: il 19/11/2026 le sei chiavi sono state create tutte in `lettura-backup-prod`.

**2. Una chiave per progetto (B2, B4)**, con il nome della tabella: `file-prod`, `pgbackrest-prod`, `file-test`, `pgbackrest-test`, `specchio-scrittura`, `specchio-lettura`.

1. Nel progetto: menu a sinistra «Security» → scheda «S3 credentials» → «Generate credentials».
2. «Description»: il nome della chiave → «Generate credentials».
3. La finestra «Credentials generated» mostra «ACCESS KEY» e, dopo «Click to show», «SECRET KEY». La Secret key si vede **una volta sola**. Prima di chiudere la finestra:
   - nel gestore di password, una voce nuova `Hetzner S3 · <progetto> · <chiave>` con due campi, «Access key» e «Secret key», copiati dalla finestra;
   - si salva la voce, la si riapre e si controlla che ci siano i due valori (B4).

   Niente schermate di questa finestra.
4. Si chiude la finestra.

Secondo una fonte non di Hetzner, una chiave nuova può metterci qualche istante a funzionare: nel frattempo risponde come una chiave sbagliata (`InvalidAccessKeyId`).

Finite le sei chiavi, negli appunti resta l'ultima Secret key copiata. Prima di scrivere a Claude si copia una parola qualsiasi, per esempio il nome di un progetto, e prima di ogni invio si guarda la casella di Claude (regola degli appunti).

Poi, per ciascuna delle sei voci, una risposta scritta a Claude (B4), per esempio «voce `Hetzner S3 · backup-prod · pgbackrest-prod`: Access key e Secret key ci sono». Mai un «ok» per più voci insieme, e niente schermate delle voci: mostrano la Access key. La copia sigillata (OPS-009) si aggiorna alla fine, al passo 13 (K1), quando le chiavi non cambiano più.

**3. Controllo (B2).** Per ogni progetto, una risposta scritta a Claude con il nome della sua unica chiave (colonna «Description»). Il nome si scrive a mano: una riga copiata dalla tabella contiene anche la Access key. Niente schermate di questa pagina: la colonna «Access Key» mostra la chiave per intero.

Una chiave creata nel progetto sbagliato non si sposta. Nel progetto dove si trova: menu «⋯» alla fine della sua riga → «Delete» → conferma. Poi si cancella la sua voce nel gestore di password, e la chiave si rifà nel progetto giusto (punto 2), con una voce nuova. Dopo, B4 per le voci nuove e B2 per tutti i progetti.

**4. Id dei progetti (B3).** L'id è il numero subito dopo `/projects/` nell'indirizzo di una pagina del progetto (`https://console.hetzner.com/projects/<id>/…`). Nella pagina di un bucket c'è anche un secondo numero, dopo `/buckets/`: non è quello. I sei id vanno a Claude, perché non sono segreti: come testo, ciascuno con il nome del suo progetto, copiato dalla barra dell'indirizzo. Niente schermate per gli id: la pagina «Security» → «S3 credentials», dove si è appena stati, mostra le Access key. Claude scrive gli id nella tabella in alto, in `READ_PROJECT_ID` (passo 4) e nella policy di D5.

### 3. Bucket (C1–C5) (utente)

In ciascuno dei cinque progetti delle unità, non in `lettura-backup-prod` (si entra nel progetto e si guarda che sia quello giusto, come al passo 2):

1. Menu a sinistra «STORAGE» → «Object Storage» → «Create Bucket». Se «Object Storage» non si vede, un clic su «STORAGE» apre il gruppo.
2. «Location»: «Falkenstein» per i quattro bucket di file e backup, «Helsinki» per `foondaco-specchio`. Si guarda ogni volta: il 19/11/2026 la finestra di `foondaco-file-test` era compilata con «Nuremberg».
3. «Name/URL»: il nome del bucket. La parte grigia dopo il nome deve dire `.fsn1.your-objectstorage.com` (Falkenstein) o `.hel1.your-objectstorage.com` (Helsinki).
4. «Object Lock»: «Disabled», tranne per `foondaco-specchio`, dove si sceglie «Enabled». Dopo la creazione non si cambia più.
5. «Visibility»: «Private».
6. Prima del pulsante, una schermata della finestra compilata: è la schermata di C3 e, per lo specchio, anche di C4.
7. «Create & Buy now». La fattura di Object Storage parte dal primo bucket. Per lo specchio si annota l'ora (C4): da lì partono i 15 minuti.

Se un nome è già preso (i nomi sono unici fra tutti i clienti di Hetzner), ci si ferma e lo si dice a Claude, che sceglie con l'utente un nome nuovo e aggiorna il README.

Controlli:

- **C1.** In ogni progetto, «Object Storage» mostra un solo bucket, con il suo nome e il luogo (colonna «Location»: Falkenstein o Helsinki). Una schermata per progetto.
- **C2.** In `lettura-backup-prod`, «Object Storage» non mostra bucket («You don't have any Buckets yet»). L'elenco comprende tutti i luoghi. Una schermata.
- **C3.** La schermata della finestra di creazione, con «Private». Se la pagina del bucket mostra la visibilità, anche una schermata di quella. Le prove vere sono E8 (nessuna policy sugli altri bucket) e le richieste senza chiave di I2.
- **C5**, solo dopo che C1 è giusto. Un bucket nel progetto sbagliato, nel luogo sbagliato o con Object Lock sbagliato non si sposta e non si rinomina: si cancella finché è vuoto e senza protezione (menu «⋯» alla fine della sua riga → «Delete» → conferma), e si rifà. Con lo stesso proprietario il nome si può riusare subito; per gli altri clienti resta bloccato 14 giorni (FAQ di Hetzner «Buckets & objects», letta il 19/11/2026). Poi, nell'elenco di «Object Storage»: menu «⋯» alla fine della riga del bucket → «Enable protection». Accanto al bucket compare un lucchetto. Una schermata per bucket.

### 4. Terminale delle chiavi (A4) (utente)

Un terminale delle chiavi è sempre una finestra nuova dell'applicazione «Terminal» (Terminale), aperta apposta e mai usata per altro: dal menu delle applicazioni, oppure con Ctrl+Maiusc+N da una finestra del Terminale già aperta. Se ne apre una all'inizio di D, una per I2, e una nuova quando la precedente è stata chiusa; negli altri passi si continua in quella aperta, come dicono i passi.

- Non si usa il terminale di VS Code, e da questa finestra non si avvia Claude Code.
- Qui si lanciano solo i comandi di questa sezione.
- Si incolla con il tasto destro → «Paste» (Incolla) o con Ctrl+Maiusc+V; si copia con il tasto destro → «Copy» (Copia) o con Ctrl+Maiusc+C (regole del terminale e degli appunti).
- Ogni blocco si incolla tutto insieme, poi si preme Invio.

Il primo comando è tutto il blocco qui sotto, incollato in una volta sola, poi Invio. Se il Terminale chiede conferma per incollare più righe, si conferma. Il blocco stampa due righe, da incollare a Claude (A4):

```
cronologia: spenta
terminale: ptyxis-agent (shell 12345, 18/11/2026 16:10:00)
```

`ptyxis-agent` è il Terminale di Ubuntu 26.04 (Ptyxis). Se compare «cronologia: ACCESA», o la scritta che parla di VS Code, si chiude la finestra e se ne apre una nuova.

Per la lettura (D0), ecco cosa fa il blocco.

- Spegne la cronologia della shell e il suo file: nessun comando resta salvato.
- Toglie le variabili `AWS_*` ereditate e prepara il client:
  - nessun file di configurazione né di credenziali (`/dev/null`);
  - nessun pager, uscite in JSON, nessun numero di sessione;
  - checksum solo dove l'operazione li richiede;
  - quattro tentativi per ogni richiesta.
- Scrive le tabelle dei cinque bucket (nome, luogo, chiave proprietaria) e l'id di `lettura-backup-prod`.
- Definisce le funzioni:

| Funzione | Cosa fa | Righe |
|---|---|---|
| `load_key <nome>` | Chiede Access key e Secret key della voce `<nome>` del gestore di password, senza mostrarle (`read -rs`). Richiede le parti vuote o con spazi, e la Secret key se arriva di nuovo la Access key. Rifiuta, e allora la chiave resta non caricata: una parte uguale a una parte di un'altra chiave già caricata (appunti rimasti); una Secret key non più lunga della Access key (parti scambiate). Se prima della domanda era già arrivato del testo, incollato troppo presto, lo scarta, lo dice e si ferma: così non diventa una chiave. Caricata di nuovo, una chiave prende i valori nuovi. Tiene le chiavi nella memoria di questo terminale | tutte |
| `use_key <nome>` | Esporta la chiave `<nome>` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) per i comandi che seguono. Se `<nome>` non è caricata, non resta in uso nessuna chiave, e i comandi che seguono non usano nessuna chiave (in F e J2 la domanda di `compare_key` arriva lo stesso) | tutte |
| `s3 fsn1\|hel1 <operazione> …` | Un comando `aws s3api` verso Falkenstein o Helsinki, con la chiave in uso. Alla fine scrive luogo, nome della chiave, data, ora e codice di uscita (0 = riuscito) | D–J |
| `show_config <unità>` | Versioning, ciclo di vita, Object Lock e policy del bucket dell'unità, con la sua chiave | E |
| `show_policy <unità>` | La policy del bucket. Ogni Access key che conosce la mostra solo come nome tra parentesi quadre (`[specchio-lettura]`); ogni altro valore dopo `p<id>:`, e ogni sequenza di 16 o più maiuscole e cifre, come `[chiave sconosciuta]` | E7, F, J, 12 |
| `put_policy_keys <nome>…` | Manda la policy di `foondaco-backup` nella forma per chiave, con le Access key delle chiavi `<nome>` caricate. Prima prova ogni chiave chiedendo l'elenco dei suoi bucket a `fsn1` e a `hel1`: se la chiave non funziona (`InvalidAccessKeyId`, `SignatureDoesNotMatch`) o ha dei bucket, non manda niente. Poi mostra la policy con i nomi al posto delle chiavi e la manda: arriva al client da `/dev/stdin`, mai dalla riga di comando. Un messaggio di errore lo stampa con i nomi al posto delle Access key | F, J2, J6, 12 |
| `check_bucket_list` | I nomi dei bucket del progetto della chiave in uso, chiesti a `fsn1` e a `hel1`. Se ce n'è almeno uno lo dice e risponde con un errore: nel blocco di F, F1 e F2 non partono | F |
| `compare_key <nome>` | Chiede sempre di nuovo l'Access key della voce `<nome>`, senza mostrarla, e dice solo se è «uguale» o «diversa» da quella in uso. Se `<nome>` non è la chiave in uso (per esempio perché `load_key` ha rifiutato le due parti) dice «confronto non fatto». Con «diversa» o «confronto non fatto» risponde con un errore: nel blocco di F, F1 e F2 non partono; in quello di J2, lista e scrittura. Una risposta vuota, o la Secret key della chiave in uso (appunti rimasti), la richiede. Come `load_key`, scarta il testo arrivato prima della domanda | F, J2 |
| `test_ops005 file-prod\|file-test` | G1–G5: scrive due versioni di `prova-ops-005.txt`, le elenca, legge la prima, la recupera, poi cancella tutte le versioni | G |
| `test_lock` | H1–H5 sullo specchio, con il `VersionId` letto in H1, che stampa a ogni passo. Si ferma se H2 non è come atteso, e se H3 o H4 riescono davvero (il blocco non funziona). In H4 manda la data solo se è nel futuro e precedente a quella di H2. Risponde senza errore solo se arriva in fondo | H1–H5 |
| `test_h6` | H6: una scrittura senza `Content-MD5` né checksum, la lettura della sua conservazione, poi un delete marker | H6 |
| `watch_revocation` | J4, con la chiave `prova-ripristino` in uso: la lista di J2 subito e poi a 5, 10, … 60 minuti dall'inizio, finché due prove di fila sono rifiutate con `InvalidAccessKeyId`. Gli errori del client, della rete o del fornitore non contano; un altro codice si stampa e interrompe la serie. Le prove perse perché il computer era sospeso, o perché una chiamata è durata più di 5 minuti, non si recuperano: lo dice con «prove saltate» | J4 |
| `clean_leftovers <unità>` | Cancella gli oggetti rimasti sotto `check-bucket-isolation/` dopo un'interruzione di I2 | I |

Le chiavi non finiscono mai sullo schermo, in un file o sulla riga di un comando: arrivano solo, come variabili d'ambiente, ai programmi lanciati da questo terminale. `python3` legge solo le uscite del client, che non contengono chiavi. Gli unici file che il blocco scrive sono quelli di prova, in una cartella temporanea (`$WORK`).

```bash
# Terminale delle chiavi (infra/README.md, «Archivi S3 (OPS-T03)»): primo comando, incollato tutto insieme.
set +o history; unset HISTFILE
for v in $(compgen -e); do case $v in AWS_*) unset "$v" ;; esac; done
export AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_PAGER= \
  AWS_DEFAULT_OUTPUT=json AWS_CLI_AUTO_PROMPT=off AWS_EC2_METADATA_DISABLED=true \
  AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=4 AWS_CLI_SESSION_ID_DISABLED=true \
  AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
READ_PROJECT_ID=16852089   # id del progetto lettura-backup-prod (B3)
declare -A BUCKET=([file-prod]=foondaco-file [backup-prod]=foondaco-backup [file-test]=foondaco-file-test [backup-test]=foondaco-backup-test [specchio]=foondaco-specchio)
declare -A PLACE=([file-prod]=fsn1 [backup-prod]=fsn1 [file-test]=fsn1 [backup-test]=fsn1 [specchio]=hel1)
declare -A OWNER_KEY=([file-prod]=file-prod [backup-prod]=pgbackrest-prod [file-test]=file-test [backup-test]=pgbackrest-test [specchio]=specchio-scrittura)
declare -A KEY_ID=() KEY_SECRET=()
KEY_IN_USE= OUT= WORK=$(mktemp -d)

_now() { date '+%d/%m/%Y %H:%M:%S'; }
_aws() { local place=$1; shift; aws --endpoint-url "https://$place.your-objectstorage.com" --region "$place" s3api "$@"; }
_code() { printf '%s\n' "$1" | sed -n 's/.*An error occurred (\([A-Za-z0-9]*\)).*/\1/p' | head -n 1; }
_reason() { local c; c=$(_code "$1"); if [ -n "$c" ]; then printf '%s\n' "$c"; else printf '%s\n' "$1" | grep -v '^[[:space:]]*$' | tail -n 1; fi; }
_json() { printf '%s' "$OUT" | python3 -I -c 'import json, sys
d = json.loads(sys.stdin.read() or "{}")
for k in sys.argv[1:]:
    d = d.get(k) if isinstance(d, dict) else None
print("" if d is None else d)' "$@"; }
_versions_of() { printf '%s' "$OUT" | python3 -I -c 'import json, sys
d = json.loads(sys.stdin.read() or "{}")
for kind, label in (("Versions", "versione"), ("DeleteMarkers", "delete-marker")):
    for v in d.get(kind) or []:
        if v.get("Key") == sys.argv[1]:
            print(label, v.get("VersionId"), "più-recente" if v.get("IsLatest") else "-")' "$1"; }
_retention() { python3 -I -c 'import datetime as dt, sys
mode, until, t0 = sys.argv[1], sys.argv[2], int(sys.argv[3])
u = dt.datetime.fromisoformat(until.replace("Z", "+00:00")).astimezone(dt.timezone.utc)
want = dt.datetime.fromtimestamp(t0, dt.timezone.utc) + dt.timedelta(days=45)
ok = mode == "COMPLIANCE" and abs(u - want) <= dt.timedelta(days=1)
print(f"modo {mode}, scadenza {u:%Y-%m-%d %H:%M} UTC; attesa circa {want:%Y-%m-%d %H:%M} UTC (scrittura + 45 giorni):", "va bene" if ok else "NON va bene")
sys.exit(0 if ok else 1)' "$@"; }
_day_before() { python3 -I -c 'import datetime as dt, sys
u = dt.datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00")).astimezone(dt.timezone.utc)
d = (u - dt.timedelta(days=1)).date()
start = dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc)
if not dt.datetime.now(dt.timezone.utc) < start < u:
    sys.exit(1)
print(d.isoformat())' "$1"; }
_early_input() { # testo arrivato prima di una domanda (incollato troppo presto): lo scarta, così non diventa una chiave
  local junk seen=
  [ -t 0 ] || return 1
  while IFS= read -rs -t 0.05 -n 4096 junk; do [ -z "$junk" ] || seen=1; done
  [ -z "$junk" ] || seen=1
  [ -n "$seen" ] || return 1
  echo "ATTENZIONE: prima della domanda era già arrivato del testo, comparso sullo schermo: l'ho scartato e mi fermo."
  echo "Se era una parte di chiave, quella chiave è esposta (passo 12). Altrimenti si rilancia il blocco quando è tornato il prompt."
}

s3() { # s3 fsn1|hel1 <operazione> [opzioni]: un comando del client con la chiave in uso
  local place=${1:-} rc
  case $place in fsn1|hel1) ;; *) echo 'Uso: s3 fsn1|hel1 <operazione> [opzioni]'; return 2 ;; esac
  [ -n "$KEY_IN_USE" ] || { echo 'Nessuna chiave in uso: prima use_key <nome>'; return 2; }
  shift
  OUT=$(_aws "$place" "$@"); rc=$?
  [ -z "$OUT" ] || printf '%s\n' "$OUT"
  echo "[$place · chiave «$KEY_IN_USE» · $(_now)] codice di uscita: $rc"
  return "$rc"
}

load_key() { # load_key <nome>: chiede Access key e Secret key della voce <nome>, senza mostrarle
  local name=${1:-} part value id= secret= other was_in_use=
  [[ $name =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "Nome «$name» non valido: solo lettere minuscole, cifre e trattini, per esempio load_key file-prod. Nessuna chiave è stata chiesta: non incollarla ora."; return 2; }
  [ "$KEY_IN_USE" != "$name" ] || { was_in_use=1; unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; KEY_IN_USE=; }
  unset "KEY_ID[$name]" "KEY_SECRET[$name]"   # i valori di prima spariscono: restano solo quelli nuovi, se superano i controlli
  _early_input && return 1
  for part in 'Access key' 'Secret key'; do
    while :; do
      IFS= read -rs -p "$part di «$name» (incolla e premi Invio; non compare): " value ||
        { printf '\nInterrotto: «%s» non è caricata. Finito il blocco, lo si rilancia.\n' "$name"; return 1; }
      printf '\n'
      value=${value//$'\r'/}; value=${value#"${value%%[![:space:]]*}"}; value=${value%"${value##*[![:space:]]}"}
      if [ -z "$value" ]; then echo '  vuota: incollala di nuovo'
      elif [[ $value == *[[:space:]]* ]]; then echo '  contiene spazi: ricopiala dal gestore di password'
      elif [ "$part" = 'Secret key' ] && [ "$value" = "$id" ]; then echo '  è di nuovo la Access key: copia la Secret key dalla voce e incollala'
      else break; fi
    done
    if [ "$part" = 'Access key' ]; then id=$value; else secret=$value; fi
    echo '  ricevuta'
  done
  for other in "${!KEY_ID[@]}"; do
    if [ "${KEY_ID[$other]}" = "$id" ] || [ "${KEY_SECRET[$other]}" = "$id" ] || [ "${KEY_ID[$other]}" = "$secret" ] || [ "${KEY_SECRET[$other]}" = "$secret" ]; then
      echo "Una parte è uguale a una parte di «$other», già caricata (negli appunti c'era ancora quella chiave, oppure a «$other» sono andate per sbaglio le parti di questa voce): «$name» non è caricata. Alle domande che seguono si risponde con la voce che ciascuna nomina; finito il blocco, lo si rilancia copiando ogni campo dalla voce di «$name». Se torna, lo si dice a Claude (senza la chiave)."; return 1
    fi
  done
  if [ "${#secret}" -le "${#id}" ]; then
    echo "Le due parti sembrano scambiate (la Secret key è la più lunga): «$name» non è caricata. Alle domande che seguono si risponde con la voce che ciascuna nomina; finito il blocco, lo si rilancia, e per «$name» si incolla prima il campo «Access key». Se torna con i campi giusti, lo si dice a Claude (senza la chiave)."; return 1
  fi
  KEY_ID[$name]=$id KEY_SECRET[$name]=$secret
  if [ -n "$was_in_use" ]; then use_key "$name"; else echo "Chiave «$name» pronta in questo terminale; per usarla: use_key $name"; fi
}

use_key() { # use_key <nome>: la chiave <nome> diventa quella dei comandi che seguono
  local name=${1:-}
  if [ -z "$name" ] || [ -z "${KEY_ID[$name]:-}" ]; then
    unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; KEY_IN_USE=
    echo "La chiave «$name» non è caricata in questo terminale: prima load_key $name. Ora nessuna chiave è in uso."; return 1
  fi
  export AWS_ACCESS_KEY_ID="${KEY_ID[$name]}" AWS_SECRET_ACCESS_KEY="${KEY_SECRET[$name]}"
  KEY_IN_USE=$name
  echo "In uso la chiave «$name»."
}

compare_key() { # F, J2: compare_key <nome>: chiede sempre l'Access key della voce <nome>; «uguale» solo se <nome> è la chiave in uso e coincide
  local name=${1:-} value
  _early_input && return 1
  while :; do
    IFS= read -rs -p "Access key della voce di «$name» nel gestore di password (incolla e premi Invio; non compare): " value ||
      { printf '\nInterrotto\n'; return 1; }
    printf '\n'
    value=${value//$'\r'/}; value=${value#"${value%%[![:space:]]*}"}; value=${value%"${value##*[![:space:]]}"}
    if [ -z "$value" ]; then echo '  vuota: incollala di nuovo'
    elif [ -n "$name" ] && [ "$KEY_IN_USE" = "$name" ] && [ "$value" = "$AWS_SECRET_ACCESS_KEY" ]; then echo '  questa è la Secret key: copia la Access key dalla voce e incollala'
    else break; fi
  done
  if [ -z "$name" ] || [ "$KEY_IN_USE" != "$name" ]; then
    echo "confronto non fatto: «$name» non è la chiave in uso. Non incollare altro: si rilancia il blocco quando è tornato il prompt."; return 2
  fi
  if [ "$value" = "$AWS_ACCESS_KEY_ID" ]; then echo "confronto con la chiave in uso («$KEY_IN_USE»): uguale"
  else echo "confronto con la chiave in uso («$KEY_IN_USE»): diversa"; return 1; fi
}

check_bucket_list() { # F: solo i nomi dei bucket del progetto della chiave in uso, a fsn1 e a hel1; se ce n'è uno risponde 1
  local place out rc found=
  [ -n "$KEY_IN_USE" ] || { echo "Nessuna chiave in uso: l'elenco dei bucket non è stato chiesto."; return 2; }
  for place in fsn1 hel1; do
    out=$(_aws "$place" list-buckets --query 'Buckets[].Name' --output text 2>&1); rc=$?
    if [ "$rc" -ne 0 ]; then
      echo "$place: non riuscito (codice di uscita $rc): $(_reason "$out")"
    elif [ -z "$out" ] || [ "$out" = None ]; then echo "$place: nessun bucket"
    else echo "$place: $(printf '%s' "$out" | tr -s '[:space:]' ' ')"; found=1; fi
  done
  echo "[chiave «$KEY_IN_USE» · $(_now)]"
  [ -z "$found" ] || { echo "La chiave in uso («$KEY_IN_USE») ha dei bucket: non è una chiave di lettura-backup-prod."; return 1; }
}

show_policy() { # E7, E8: la policy del bucket di <unità>; ogni Access key compare solo come nome tra parentesi quadre
  local unit=${1:-} text rc name masked
  [ -n "$unit" ] && [ -n "${BUCKET[$unit]:-}" ] || { echo 'Uso: show_policy file-prod|backup-prod|file-test|backup-test|specchio'; return 2; }
  [ "$KEY_IN_USE" = "${OWNER_KEY[$unit]}" ] || { echo "Serve la chiave ${OWNER_KEY[$unit]}: use_key ${OWNER_KEY[$unit]}"; return 2; }
  text=$(_aws "${PLACE[$unit]}" get-bucket-policy --bucket "${BUCKET[$unit]}" --query Policy --output text); rc=$?
  if [ "$rc" -eq 0 ]; then
    for name in "${!KEY_ID[@]}"; do text=${text//"${KEY_ID[$name]}"/"[$name]"}; done
    masked=$(printf '%s\n' "$text" | sed -E 's#(p[0-9]+:)([^["][^"]*)#\1[chiave sconosciuta]#g; s#[A-Z0-9]{16,}#[chiave sconosciuta]#g')
    printf '%s\n' "$masked" | python3 -I -m json.tool 2>/dev/null || printf '%s\n' "$masked"
  fi
  echo "[${PLACE[$unit]} · chiave «$KEY_IN_USE» · $(_now)] codice di uscita: $rc"
  return "$rc"
}

_policy_text() { printf '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":%s},"Action":["s3:ListBucket","s3:GetObject"],"Resource":["arn:aws:s3:::foondaco-backup","arn:aws:s3:::foondaco-backup/*"]}]}' "$1"; }
put_policy_keys() { # F, J2, J6: la policy di foondaco-backup nella forma per chiave, per le chiavi <nome> di lettura-backup-prod
  local name place out rc err list= shown= sep=
  [[ $READ_PROJECT_ID =~ ^[0-9]+$ ]] || { echo "Manca l'id di lettura-backup-prod in READ_PROJECT_ID (B3)"; return 2; }
  [ "$KEY_IN_USE" = pgbackrest-prod ] || { echo 'Serve la chiave pgbackrest-prod: use_key pgbackrest-prod'; return 2; }
  [ "$#" -ge 1 ] || { echo 'Uso: put_policy_keys specchio-lettura [prova-ripristino]'; return 2; }
  for name in "$@"; do
    [ -n "$name" ] && [ -n "${KEY_ID[$name]:-}" ] || { echo "La chiave «$name» non è caricata in questo terminale. Policy non mandata: finito il blocco, lo si rilancia copiando le due parti dalla voce di «$name»."; return 1; }
    for place in fsn1 hel1; do # la chiave funziona e non ha bucket? Le chiavi vanno al client solo come variabili d'ambiente
      out=$(AWS_ACCESS_KEY_ID=${KEY_ID[$name]} AWS_SECRET_ACCESS_KEY=${KEY_SECRET[$name]} _aws "$place" list-buckets --query 'Buckets[].Name' --output text 2>&1); rc=$?
      if [ "$rc" -eq 0 ]; then
        [ -z "$out" ] || [ "$out" = None ] || { echo "Prova di «$name» a $place: ha dei bucket, quindi non è una chiave di lettura-backup-prod. Policy non mandata: finito il blocco, lo si rilancia copiando le due parti dalla voce di «$name»."; return 1; }
      else
        case $(_code "$out") in
          InvalidAccessKeyId|SignatureDoesNotMatch) echo "Prova di «$name» a $place: $(_code "$out"), la chiave non funziona. Policy non mandata: finito il blocco, lo si rilancia copiando le due parti dalla voce di «$name» (una chiave appena creata può metterci qualche minuto)."; return 1 ;;
          *) echo "Prova di «$name» a $place: non riuscita ($(_reason "$out")); vado avanti" ;;
        esac
      fi
    done
    list+="$sep\"arn:aws:iam:::user/p$READ_PROJECT_ID:${KEY_ID[$name]}\""
    shown+="$sep\"arn:aws:iam:::user/p$READ_PROJECT_ID:[$name]\""
    sep=,
  done
  [ "$#" -eq 1 ] || { list="[$list]"; shown="[$shown]"; }
  echo 'Policy che mando, con il nome delle chiavi al posto delle Access key:'
  _policy_text "$shown" | python3 -I -m json.tool
  err=$(_aws fsn1 put-bucket-policy --bucket foondaco-backup --policy file:///dev/stdin 2>&1 >/dev/null < <(_policy_text "$list")); rc=$?
  for name in "$@"; do err=${err//"${KEY_ID[$name]}"/"[$name]"}; done
  [ -z "$err" ] || printf '%s\n' "$err"
  echo "[fsn1 · chiave «$KEY_IN_USE» · $(_now)] codice di uscita: $rc"
  return "$rc"
}

show_config() { # E1–E8: versioning, ciclo di vita, Object Lock e policy del bucket di <unità>, con la sua chiave
  local unit=${1:-} b place
  [ -n "$unit" ] && [ -n "${BUCKET[$unit]:-}" ] || { echo 'Uso: show_config file-prod|backup-prod|file-test|backup-test|specchio'; return 2; }
  use_key "${OWNER_KEY[$unit]}" || return 1
  b=${BUCKET[$unit]} place=${PLACE[$unit]}
  echo "== E1: versioning di $b"; s3 "$place" get-bucket-versioning --bucket "$b"
  echo "== E2-E4: ciclo di vita di $b"; s3 "$place" get-bucket-lifecycle-configuration --bucket "$b"
  echo "== E5-E6: Object Lock di $b"; s3 "$place" get-object-lock-configuration --bucket "$b"
  echo "== E7-E8: policy di $b"; show_policy "$unit"
}

test_ops005() { # G1–G5: sovrascrittura e recupero di un file (test_ops005 file-prod, poi test_ops005 file-test)
  local unit=${1:-} b place k=prova-ops-005.txt v1 v2 id
  case $unit in file-prod|file-test) ;; *) echo 'Uso: test_ops005 file-prod oppure test_ops005 file-test'; return 2 ;; esac
  use_key "$unit" || return 1
  b=${BUCKET[$unit]} place=${PLACE[$unit]}
  s3 "$place" list-object-versions --bucket "$b" --prefix "$k" >/dev/null || return 1
  for id in $(_versions_of "$k" | cut -d ' ' -f 2); do
    echo "Prima di G1: tolgo la versione $id rimasta da una prova interrotta"
    s3 "$place" delete-object --bucket "$b" --key "$k" --version-id="$id"
  done
  printf 'versione 1\n' > "$WORK/v1.txt"; printf 'versione 2\n' > "$WORK/v2.txt"
  echo "== G1: due scritture di $k in $b"
  s3 "$place" put-object --bucket "$b" --key "$k" --body "$WORK/v1.txt" || return 1
  v1=$(_json VersionId)
  s3 "$place" put-object --bucket "$b" --key "$k" --body "$WORK/v2.txt" || return 1
  v2=$(_json VersionId)
  echo "G1: VersionId della prima scrittura «$v1», della seconda «$v2»"
  [ -n "$v1" ] && [ -n "$v2" ] && [ "$v1" != "$v2" ] || { echo 'G1: non ci sono due VersionId diversi: mi fermo (il versioning è attivo? E1)'; return 1; }
  echo "== G2: versioni di $k"
  s3 "$place" list-object-versions --bucket "$b" --prefix "$k" || return 1
  echo "G2: versioni $(_versions_of "$k" | grep -c '^versione '); la più recente è la seconda scrittura: $(_versions_of "$k" | grep -q "^versione $v2 più-recente" && echo sì || echo no)"
  echo "== G3: lettura della prima versione"
  s3 "$place" get-object --bucket "$b" --key "$k" --version-id="$v1" "$WORK/letto.txt" || return 1
  echo "G3: il file letto contiene «$(cat "$WORK/letto.txt")»"
  echo "== G4: recupero della prima versione, poi lettura senza --version-id"
  s3 "$place" copy-object --bucket "$b" --key "$k" --copy-source "$b/$k?versionId=$v1" || return 1
  s3 "$place" get-object --bucket "$b" --key "$k" "$WORK/letto.txt" || return 1
  echo "G4: il file letto contiene «$(cat "$WORK/letto.txt")»"
  s3 "$place" list-object-versions --bucket "$b" --prefix "$k" || return 1
  echo "G4: versioni $(_versions_of "$k" | grep -c '^versione ')"
  echo "== G5: pulizia, una versione alla volta"
  for id in $(_versions_of "$k" | cut -d ' ' -f 2); do
    s3 "$place" delete-object --bucket "$b" --key "$k" --version-id="$id"
  done
  s3 "$place" list-object-versions --bucket "$b" --prefix "$k" || return 1
  echo "G5: versioni e delete marker rimasti: $(_versions_of "$k" | wc -l)"
}

test_lock() { # H1–H5: le versioni bloccate dello specchio, con la chiave specchio-scrittura; risponde 0 solo se arriva in fondo
  local b=foondaco-specchio k=prova-blocco.txt md5 t0 vh1 until1 h4 verdict rc
  use_key specchio-scrittura || return 1
  printf 'prova del blocco, %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$WORK/blocco.txt"
  md5=$(openssl dgst -md5 -binary "$WORK/blocco.txt" | openssl base64 -A)
  echo "== H1: scrittura di $k con Content-MD5 $md5"
  t0=$(date +%s)
  s3 hel1 put-object --bucket "$b" --key "$k" --body "$WORK/blocco.txt" --content-md5 "$md5" || return 1
  vh1=$(_json VersionId)
  [ -n "$vh1" ] || { echo 'H1: la risposta non ha un VersionId: mi fermo'; return 1; }
  echo "H1: VersionId «$vh1»"
  echo "== H2: conservazione della versione $vh1"
  s3 hel1 get-object-retention --bucket "$b" --key "$k" --version-id="$vh1" || { echo 'H2: lettura non riuscita: mi fermo prima di H3'; return 1; }
  until1=$(_json Retention RetainUntilDate)
  verdict=$(_retention "$(_json Retention Mode)" "$until1" "$t0"); rc=$?
  echo "H2: $verdict"
  [ "$rc" -eq 0 ] || { echo 'H2: mi fermo prima di H3; si ripete E5'; return 1; }
  echo "== H3: cancellazione definitiva della versione $vh1 (attesa: AccessDenied)"
  s3 hel1 delete-object --bucket "$b" --key "$k" --version-id="$vh1"
  s3 hel1 list-object-versions --bucket "$b" --prefix "$k" || { echo 'H3: lista non riuscita: mi fermo'; return 1; }
  if _versions_of "$k" | grep -q "^versione $vh1 "; then echo "H3: la versione $vh1 c'è ancora: sì"
  else echo "H3: la versione $vh1 c'è ancora: no: il blocco non funziona, mi fermo"; return 1; fi
  echo "== H4: conservazione accorciata della versione $vh1 (attesa: AccessDenied)"
  h4=$(_day_before "$until1") || { echo "H4: il giorno prima di $until1 non è nel futuro o non è precedente: non lo mando"; return 1; }
  echo "H4: data di H2 $until1; data mandata $h4 (${h4}T00:00:00Z)"
  s3 hel1 put-object-retention --bucket "$b" --key "$k" --version-id="$vh1" --retention "Mode=COMPLIANCE,RetainUntilDate=${h4}T00:00:00Z"
  s3 hel1 get-object-retention --bucket "$b" --key "$k" --version-id="$vh1" || { echo 'H4: rilettura non riuscita: mi fermo'; return 1; }
  if [ "$(_json Retention RetainUntilDate)" = "$until1" ]; then echo "H4: la data della versione $vh1 è ancora quella di H2: sì"
  else echo "H4: la data della versione $vh1 è ancora quella di H2: no: il blocco non funziona, mi fermo"; return 1; fi
  echo "== H5: cancellazione senza --version-id, poi lettura della versione $vh1"
  s3 hel1 delete-object --bucket "$b" --key "$k"
  s3 hel1 list-object-versions --bucket "$b" --prefix "$k"
  echo "H5: la versione più recente è un delete marker: $(_versions_of "$k" | grep -q '^delete-marker .* più-recente' && echo sì || echo no)"
  s3 hel1 get-object --bucket "$b" --key "$k" --version-id="$vh1" "$WORK/letto.txt" &&
    echo "H5: la versione $vh1 si legge ancora e contiene «$(cat "$WORK/letto.txt")»"
}

test_h6() { # H6, solo informativo (OPS-T01b): scrittura nello specchio senza Content-MD5 e senza checksum
  local b=foondaco-specchio k=prova-senza-md5.txt t0 vid
  use_key specchio-scrittura || return 1
  printf 'prova senza Content-MD5, %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$WORK/senza-md5.txt"
  echo "== H6: scrittura di $k senza Content-MD5 né checksum (AWS_REQUEST_CHECKSUM_CALCULATION=$AWS_REQUEST_CHECKSUM_CALCULATION)"
  t0=$(date +%s)
  s3 hel1 put-object --bucket "$b" --key "$k" --body "$WORK/senza-md5.txt" || { echo 'H6: scrittura rifiutata (codice qui sopra)'; return 0; }
  vid=$(_json VersionId)
  if s3 hel1 get-object-retention --bucket "$b" --key "$k" --version-id="$vid"; then
    echo "H6: accettata; $(_retention "$(_json Retention Mode)" "$(_json Retention RetainUntilDate)" "$t0")"
  else
    echo 'H6: accettata, ma la lettura della conservazione non è riuscita (codice qui sopra)'
  fi
  echo 'H6: ora la nascondo con un delete marker, come in H5'
  s3 hel1 delete-object --bucket "$b" --key "$k"
}

watch_revocation() { # J4: con la chiave prova-ripristino, la lista di J2 subito e poi ogni 5 minuti, finché è rifiutata due volte di fila con InvalidAccessKeyId; al massimo 60 minuti
  local start n=0 now t out rc code refusals=0 last_ok= first_refusal=
  [ "$KEY_IN_USE" = prova-ripristino ] || { echo "J4 si fa con la chiave temporanea: use_key prova-ripristino (ora in uso: «${KEY_IN_USE:-nessuna}»)"; return 2; }
  start=$(date +%s)
  echo "J4: chiave «$KEY_IN_USE»; una prova subito e poi ogni 5 minuti, al massimo per 60 minuti. Per fermarla prima: Ctrl+C"
  while :; do
    now=$(date +%s)
    if [ "$now" -gt $((start + 300 * n + 60)) ]; then # in ritardo di più di un minuto: le prove perse non si recuperano
      n=$(( (now - start + 299) / 300 ))
      echo "$(date '+%H:%M:%S') prove saltate: il computer era sospeso, o una chiamata è durata più di 5 minuti"
      [ "$n" -le 12 ] || { echo 'J4: passati 60 minuti'; break; }
      while [ "$(date +%s)" -lt $((start + 300 * n)) ]; do sleep 5; done
      continue
    fi
    t=$(date '+%H:%M:%S')
    out=$(_aws fsn1 list-objects-v2 --bucket foondaco-backup --max-items 5 2>&1 >/dev/null); rc=$?
    code=$(_code "$out")
    if [ "$rc" -eq 0 ]; then echo "$t lista riuscita"; last_ok=$t refusals=0 first_refusal=
    elif [ "$code" = InvalidAccessKeyId ]; then
      refusals=$((refusals + 1)); [ "$refusals" -gt 1 ] || first_refusal=$t
      echo "$t lista rifiutata: $code"
    elif [ -n "$code" ] && ! [[ $code =~ ^(SlowDown|InternalError|ServiceUnavailable|RequestTimeout|RequestTimeTooSkewed|Throttling|TooManyRequests|429|5[0-9][0-9])$ ]]; then
      refusals=0 first_refusal=
      echo "$t lista rifiutata con un altro codice: $code (non è la revoca attesa)"
    else echo "$t errore del client, della rete o del fornitore, non conta: $(_reason "$out")"; fi
    [ "$refusals" -lt 2 ] || break
    n=$((n + 1))
    [ "$n" -le 12 ] || { echo 'J4: passati 60 minuti'; break; }
    while [ "$(date +%s)" -lt $((start + 300 * n)) ]; do sleep 5; done
  done
  if [ "$refusals" -ge 2 ]; then
    echo "J4: ultima lista riuscita alle ${last_ok:-(nessuna)}; prima delle due rifiutate di fila con InvalidAccessKeyId alle $first_refusal"
  else
    echo "J4: ultima lista riuscita alle ${last_ok:-(nessuna)}; due rifiuti di fila con InvalidAccessKeyId: nessuno"
  fi
}

clean_leftovers() { # avanzi di I2: cancella gli oggetti rimasti sotto check-bucket-isolation/ nel bucket di <unità>
  local unit=${1:-} b place key n=0 keys=()
  [ -n "$unit" ] && [ -n "${BUCKET[$unit]:-}" ] || { echo 'Uso: clean_leftovers file-prod|backup-prod|file-test|backup-test|specchio'; return 2; }
  use_key "${OWNER_KEY[$unit]}" || return 1
  b=${BUCKET[$unit]} place=${PLACE[$unit]}
  s3 "$place" list-objects-v2 --bucket "$b" --prefix check-bucket-isolation/ >/dev/null || return 1
  mapfile -t keys < <(printf '%s' "$OUT" | python3 -I -c 'import json, sys
for o in json.loads(sys.stdin.read() or "{}").get("Contents") or []:
    print(o["Key"])')
  for key in "${keys[@]}"; do
    case $key in check-bucket-isolation/?*) ;; *) continue ;; esac
    s3 "$place" delete-object --bucket "$b" --key "$key" >/dev/null && n=$((n + 1))
  done
  echo "$b: cancellati $n oggetti sotto check-bucket-isolation/ (nei bucket con le versioni restano nascosti da un delete marker)"
}

command -v aws >/dev/null || echo 'ATTENZIONE: il client aws non è installato (README, passo 1)'
if [[ -o history ]]; then echo 'cronologia: ACCESA: chiudi questo terminale e aprine uno nuovo'; else echo 'cronologia: spenta'; fi
if [ "${TERM_PROGRAM:-}" = vscode ] || compgen -e | grep -q '^VSCODE_'; then
  echo "terminale: $(ps -o comm= -p "$PPID"), ma è il terminale di VS Code o ne viene: chiudilo e apri il Terminale di Ubuntu"
else
  echo "terminale: $(ps -o comm= -p "$PPID") (shell $$, $(_now))"
fi
```

**Uso delle chiavi.**

- `load_key file-prod`. Il terminale chiede «Access key di «file-prod» (incolla e premi Invio; non compare)»: si apre la voce nel gestore di password, si copia l'Access key, la si incolla e si preme Invio. Non compare nulla, poi «ricevuta». Lo stesso per la Secret key.
- Una parte di chiave si incolla solo quando la sua domanda è già sullo schermo, e un blocco solo quando il terminale ha finito il precedente (è tornata la riga che finisce con `$`). Una chiave incollata altrove (prima della domanda, fuori da queste domande, o dentro un comando) compare sullo schermo ed è esposta: passo 12.
- `use_key file-prod`, poi i comandi.
- Ogni blocco carica con `load_key` le chiavi che usa, tranne D1–D5, che usano quelle del primo blocco di D, J4, che usa quella di J2, nello stesso terminale, e I2, dove le chiavi le chiede lo script. Se una chiave è già caricata in quella finestra, il suo `load_key` la chiede di nuovo: la si incolla di nuovo dalla stessa voce.
- Se `load_key` rifiuta le due parti (per esempio «sembrano scambiate» o «uguale a una parte di …»), o se a una sua domanda si è premuto Ctrl+C, quella chiave non è caricata. Le domande che seguono nel blocco arrivano lo stesso, compresa quella di `compare_key` in F e J2: si risponde a ciascuna con la voce che nomina (con Invio da solo la domanda torna), e finito il blocco lo si rilancia.
- Se un comando risponde `InvalidAccessKeyId` o `SignatureDoesNotMatch`, la chiave è incollata male: `load_key <nome>` di nuovo, ricopiando le due parti dalla voce, poi si ripete il comando o il blocco. Una chiave appena creata può non funzionare ancora: si riprova dopo qualche minuto. In J4, invece, `InvalidAccessKeyId` è l'esito atteso.
- Alla fine si chiude la finestra (`exit`): le chiavi spariscono con lei. Ogni chiusura si dice a Claude (K3).

**Come si leggono le uscite.**

- Un comando riuscito senza niente da dire stampa solo la riga finale, con «codice di uscita: 0». Succede per le modifiche di D e per il versioning di un bucket mai versionato.
- Un errore stampa una riga vuota, poi `aws: [ERROR]: An error occurred (<codice>) when calling the <operazione> operation: <testo>`, con il codice di uscita 254. Conta il codice tra parentesi: il testo dopo i due punti può essere `None`.
- Un errore di rete non ha il codice tra parentesi, per esempio `Could not connect to the endpoint URL`.
- Un comando scritto male non arriva al fornitore: il client risponde `aws: error: …` (per esempio `expected one argument`), con il codice di uscita 252. Non è un esito: lo si dice a Claude.

### 5. Configurazione (D0–D5) (utente)

**D0.** Prima di caricare la prima chiave, l'utente legge in questa sezione il blocco del passo 4 e i comandi dei passi 5–12, compreso il blocco di variabili di I2, e lo dice a Claude. Un comando cambiato dopo D0 si rilegge prima di lanciarlo (regola della lettura).

D3 e D4 si fanno almeno 15 minuti dopo la creazione dello specchio (C4): prima, la rilettura di D3 potrebbe dare la configurazione vecchia. In un terminale delle chiavi nuovo, dopo il blocco del passo 4:

```bash
load_key file-prod
load_key file-test
load_key specchio-scrittura
load_key pgbackrest-prod
```

**D1.** Versioning dei due bucket dei file:

```bash
use_key file-prod
s3 fsn1 put-bucket-versioning --bucket foondaco-file --versioning-configuration Status=Enabled
use_key file-test
s3 fsn1 put-bucket-versioning --bucket foondaco-file-test --versioning-configuration Status=Enabled
```

**D2.** Ciclo di vita dei due bucket dei file:

```bash
use_key file-prod
s3 fsn1 put-bucket-lifecycle-configuration --bucket foondaco-file --lifecycle-configuration '{"Rules":[{"ID":"versioni-precedenti","Status":"Enabled","Prefix":"","NoncurrentVersionExpiration":{"NoncurrentDays":30},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}},{"ID":"delete-marker-scaduti","Status":"Enabled","Prefix":"","Expiration":{"ExpiredObjectDeleteMarker":true}}]}'
use_key file-test
s3 fsn1 put-bucket-lifecycle-configuration --bucket foondaco-file-test --lifecycle-configuration '{"Rules":[{"ID":"versioni-precedenti","Status":"Enabled","Prefix":"","NoncurrentVersionExpiration":{"NoncurrentDays":30},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}},{"ID":"delete-marker-scaduti","Status":"Enabled","Prefix":"","Expiration":{"ExpiredObjectDeleteMarker":true}}]}'
```

**D3.** Conservazione predefinita dello specchio. Il comando dopo `use_key` prima rilegge la configurazione, per controllare C4: deve rispondere `"ObjectLockEnabled": "Enabled"` (la prima volta senza regola), e solo allora manda la modifica. Se il blocco si ripete dopo una modifica riuscita, la rilettura mostra già la regola e la modifica, uguale, parte di nuovo; dopo una modifica non riuscita la regola non c'è ancora. L'ora da annotare è quella dell'ultima modifica riuscita. Se risponde `ObjectLockConfigurationNotFoundError`, lo specchio è stato creato senza Object Lock: la modifica non parte, compare «D3: la modifica non è partita o non è riuscita», lo si dice a Claude e lo specchio si rifà (passo 3).

```bash
use_key specchio-scrittura
s3 hel1 get-object-lock-configuration --bucket foondaco-specchio &&
  [ "$(_json ObjectLockConfiguration ObjectLockEnabled)" = Enabled ] &&
  s3 hel1 put-object-lock-configuration --bucket foondaco-specchio --object-lock-configuration '{"ObjectLockEnabled":"Enabled","Rule":{"DefaultRetention":{"Mode":"COMPLIANCE","Days":45}}}' ||
  echo 'D3: la modifica non è partita o non è riuscita: lo si dice a Claude'
```

**D4.** Ciclo di vita dello specchio, a 45 giorni:

```bash
use_key specchio-scrittura
s3 hel1 put-bucket-lifecycle-configuration --bucket foondaco-specchio --lifecycle-configuration '{"Rules":[{"ID":"versioni-precedenti","Status":"Enabled","Prefix":"","NoncurrentVersionExpiration":{"NoncurrentDays":45},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}},{"ID":"delete-marker-scaduti","Status":"Enabled","Prefix":"","Expiration":{"ExpiredObjectDeleteMarker":true}}]}'
```

**D5.** Policy di `foondaco-backup`, nella forma per progetto: tutte le chiavi di `lettura-backup-prod` possono solo elencare e leggere.

```bash
use_key pgbackrest-prod
s3 fsn1 put-bucket-policy --bucket foondaco-backup --policy '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam:::user/p16852089"},"Action":["s3:ListBucket","s3:GetObject"],"Resource":["arn:aws:s3:::foondaco-backup","arn:aws:s3:::foondaco-backup/*"]}]}'
```

Ogni modifica stampa solo la riga finale, con «codice di uscita: 0». L'ora di quella riga è l'ora da annotare: l'uscita intera va a Claude. Con `InvalidAccessKeyId` o `SignatureDoesNotMatch` la chiave è incollata male: `load_key` di nuovo e si ripete quel passo («Uso delle chiavi»). Su `foondaco-backup-test` non si configura niente, e su `foondaco-backup` solo la policy. Se un comando di D risponde con un errore che parla di checksum, ci si ferma e lo si dice a Claude. Per queste modifiche il client manda sempre un checksum CRC64NVME, perché il protocollo lo richiede.

Le regole del ciclo di vita, nella forma della documentazione di Hetzner (`"Prefix": ""` vale per tutto il bucket):

- `versioni-precedenti`: una versione che non è più la corrente si cancella dopo 30 giorni (45 sullo specchio); un caricamento in più parti interrotto si cancella dopo 7 giorni.
- `delete-marker-scaduti`: un delete marker rimasto senza versioni si toglie.

Nessuna regola fa scadere le versioni correnti. Per le versioni precedenti Hetzner accetta solo `NoncurrentDays`.

### 6. Riletture (E1–E8) (utente)

Almeno 15 minuti dopo l'ultima ora di C4 e di D. Il blocco carica le cinque chiavi proprietarie: nel terminale di D, se è ancora aperto, chiede di nuovo anche quelle già caricate, e si incollano di nuovo. Nella forma per chiave (passo 7) serve anche `specchio-lettura`, che `show_policy` deve riconoscere: prima del blocco, `load_key specchio-lettura`.

```bash
load_key file-prod
load_key file-test
load_key specchio-scrittura
load_key pgbackrest-prod
load_key pgbackrest-test
show_config file-prod
show_config file-test
show_config specchio
show_config backup-prod
show_config backup-test
```

| Riga | `foondaco-file`, `foondaco-file-test` | `foondaco-specchio` | `foondaco-backup` | `foondaco-backup-test` |
|---|---|---|---|---|
| E1 versioning | `"Status": "Enabled"` (e `"MFADelete": "Disabled"`, normale su Hetzner) | `"Status": "Enabled"`: Object Lock lo accende da sé | nessuna uscita, solo la riga finale | nessuna uscita, solo la riga finale |
| E2–E4 ciclo di vita | le due regole di D2, con 30 giorni (elencate in ordine di nome) | le due regole di D4, con 45 giorni | `NoSuchLifecycleConfiguration` | `NoSuchLifecycleConfiguration` |
| E5–E6 Object Lock | `ObjectLockConfigurationNotFoundError` | `"ObjectLockEnabled": "Enabled"` e la regola `"Mode": "COMPLIANCE"`, `"Days": 45` | `ObjectLockConfigurationNotFoundError` | `ObjectLockConfigurationNotFoundError` |
| E7–E8 policy | `NoSuchBucketPolicy` | `NoSuchBucketPolicy` | il testo di D5, oppure quello della forma per chiave | `NoSuchBucketPolicy` |

E7: prima di incollare l'uscita, l'utente la guarda. Dopo `p<id>:` può esserci solo un nome tra parentesi quadre. Se c'è altro, non la incolla e lo dice a Claude a parole.

### 7. Prova della policy (F1–F2) (utente)

Subito dopo E, nello stesso terminale, con `specchio-lettura`. Il blocco controlla prima la chiave: `compare_key` chiede di nuovo l'Access key dalla voce `specchio-lettura` e dice «uguale» o «diversa»; `check_bucket_list` chiede i bucket del suo progetto, che non deve averne. F1 e F2 non partono se `compare_key` non dice «uguale» o se `check_bucket_list` trova un bucket. È anche il blocco di «F1–F2» della regola della policy, qui sotto, e di J2 e J6.

```bash
load_key specchio-lettura
use_key specchio-lettura
confronto=1; compare_key specchio-lettura && confronto=0
if check_bucket_list && [ "$confronto" -eq 0 ]; then
  s3 fsn1 list-objects-v2 --bucket foondaco-backup --max-items 5
  printf 'prova di sola lettura\n' > "$WORK/prova.txt"
  s3 fsn1 put-object --bucket foondaco-backup --key prova-sola-lettura.txt --body "$WORK/prova.txt"
else echo 'F1 e F2 non partono: il motivo è nelle righe qui sopra. Non incollare niente ora.'; fi
```

- Le domande sono sempre tre, tutte dalla voce `specchio-lettura`: Access key e Secret key per `load_key`, poi di nuovo l'Access key per `compare_key`. Dopo la terza le domande sono finite: alla riga che finisce con `$` non si incolla mai una parte di chiave, solo un blocco.
- `compare_key` deve dire «uguale», e `check_bucket_list` «fsn1: nessun bucket» e «hel1: nessun bucket». Con «diversa», con «confronto non fatto» (le due parti rifiutate da `load_key`) o con un bucket nell'elenco, F1 e F2 non partono: si rilancia il blocco, copiando con attenzione dalla voce `specchio-lettura`.
- Una riga «non riuscito» di `check_bucket_list` non ferma F1 e F2, ma il controllo non è completo e quel giro non vale per F: si segue il punto degli errori qui sotto, poi si rilancia il blocco; se resta, lo si dice a Claude.
- **F1**, la lista: codice di uscita 0.
- **F2**, la scrittura: `AccessDenied`.
- L'uscita va a Claude per intero, dalla prima domanda di `load_key` in poi: il controllo della chiave si incolla insieme a F1 (lista di controllo, F).
- Un errore di chiave (`InvalidAccessKeyId`, `SignatureDoesNotMatch`) o di rete non è un esito: si rilancia il blocco, che chiede di nuovo la chiave, oppure si aspetta qualche minuto e si ripete.
- Se F2 è riuscita, il file di prova si cancella:

```bash
load_key pgbackrest-prod
use_key pgbackrest-prod
s3 fsn1 delete-object --bucket foondaco-backup --key prova-sola-lettura.txt
```

**Forma per chiave.** Si usa se F1 è rifiutata con `AccessDenied`, oppure se F2 riesce (lista di controllo, F); nella forma per progetto anche in J2, se la lista della chiave temporanea è rifiutata con `AccessDenied`, ma lì con il primo blocco di J2 (lista di controllo, J2). Dopo F:

```bash
load_key pgbackrest-prod
load_key specchio-lettura
use_key pgbackrest-prod
put_policy_keys specchio-lettura
```

`put_policy_keys` prima prova `specchio-lettura`: se è rifiutata (`InvalidAccessKeyId`, `SignatureDoesNotMatch`) o ha dei bucket, non manda niente e dice perché; con un errore di rete o del fornitore lo scrive («vado avanti») e manda lo stesso. Poi mostra la policy con i nomi al posto delle chiavi e la manda. Il testo che manda, con un segnaposto al posto della Access key (16852089 è l'id di `lettura-backup-prod`):

```json
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam:::user/p16852089:<Access key di specchio-lettura>"},"Action":["s3:ListBucket","s3:GetObject"],"Resource":["arn:aws:s3:::foondaco-backup","arn:aws:s3:::foondaco-backup/*"]}]}
```

Con due chiavi (J2) il principale diventa un elenco: `"AWS":["arn:aws:iam:::user/p16852089:<Access key di specchio-lettura>","arn:aws:iam:::user/p16852089:<Access key della chiave temporanea>"]`.

Poi la **regola della policy**, che vale anche in J2, in J6 e al passo 12:

1. si annota l'ora della riga finale di `put_policy_keys`, e la sua uscita va a Claude;
2. si aspettano 15 minuti;
3. E7, nello stesso terminale: `use_key pgbackrest-prod`, poi `show_policy backup-prod`, che deve mostrare solo le chiavi attese in quel momento, ciascuna come nome tra parentesi quadre (qui `[specchio-lettura]`). Se quel terminale è stato chiuso, in uno nuovo, dopo il blocco del passo 4, in quest'ordine: `load_key pgbackrest-prod`, `load_key specchio-lettura`, fra J2 e J3 anche `load_key prova-ripristino`, poi `use_key pgbackrest-prod` e `show_policy backup-prod`. Una chiave della policy che non è caricata compare come `[chiave sconosciuta]`: la si carica e si ripete `show_policy`, senza aspettare altri 15 minuti, perché la policy non è cambiata. Prima di incollare l'uscita la si guarda, come in E7 (passo 6);
4. F1–F2, con il blocco di F qui sopra.

In «Valori letti» si annota quale forma è in uso.

### 8. OPS-005: sovrascrittura e recupero (G1–G5) (utente)

```bash
load_key file-prod
load_key file-test
test_ops005 file-prod
test_ops005 file-test
```

Le due chiavi si caricano all'inizio, così nessuna domanda arriva mentre una prova è in corso. Ogni prova stampa le parti «== G1» … «== G5», con le risposte del client e una riga di riepilogo per passo. L'uscita intera va a Claude. Il risultato atteso:

| Riga | Riepilogo atteso |
|---|---|
| G1 | due `VersionId` diversi |
| G2 | «versioni 2; la più recente è la seconda scrittura: sì» |
| G3 | «il file letto contiene «versione 1»» |
| G4 | «il file letto contiene «versione 1»» e «versioni 3». Su Hetzner la risposta di `copy-object` può non avere un `VersionId`: le versioni le conta la lista |
| G5 | «versioni e delete marker rimasti: 0» |

Con un errore la prova si ferma. Rilanciandola, prima di G1 toglie le versioni di `prova-ops-005.txt` rimaste dalla prova interrotta. Su Hetzner la cancellazione di una versione che non esiste non dà errore: G5 si giudica dalla lista finale.

### 9. Specchio: versioni bloccate (H1–H6) (utente)

Dopo E5, con `specchio-scrittura`, nello stesso terminale:

```bash
load_key specchio-scrittura
test_lock && test_h6
```

`test_h6` parte solo se `test_lock` è arrivata in fondo (H5): se `test_lock` si ferma, H6 non si fa (lista di controllo, H). L'uscita intera va a Claude.

| Riga | Cosa fa | Atteso |
|---|---|---|
| H1 | Scrive `prova-blocco.txt` con il `Content-MD5` calcolato da `openssl` | Riuscita, con il `VersionId` stampato |
| H2 | Legge la conservazione di quella versione. Il client stampa la data in UTC, così: `2027-01-02T14:56:31.344846+00:00` | «modo COMPLIANCE, scadenza …; attesa circa …: va bene». Con «NON va bene», o se la lettura non riesce, la prova si ferma prima di H3 e si ripete E5 (lista di controllo, H) |
| H3 | Cancellazione definitiva con il `VersionId` | `AccessDenied` (il testo dopo il codice può essere «forbidden by object lock»), poi «la versione … c'è ancora: sì». Con «no» il blocco non funziona: la prova si ferma (lista di controllo, H) |
| H4 | Calcola il giorno prima della data di H2 (`AAAA-MM-GG`) e lo mostra accanto a quella. Manda `Mode=COMPLIANCE,RetainUntilDate=<giorno>T00:00:00Z` solo se il giorno è nel futuro e precedente alla data di H2. Una data più lontana allungherebbe il blocco per sempre: per questo la calcola e la controlla la funzione, non si scrive a mano | `AccessDenied`, poi «la data della versione … è ancora quella di H2: sì». Con «no» la prova si ferma |
| H5 | Cancellazione senza `--version-id` | «la versione più recente è un delete marker: sì», poi la versione di H1 si legge ancora |
| H6 | Solo informativo, per OPS-T01b, e solo dopo H5. Una scrittura senza `Content-MD5` né checksum, la lettura della sua conservazione, poi un delete marker | Uno dei tre esiti della lista di controllo: «accettata; modo COMPLIANCE … va bene»; «accettata, ma la lettura della conservazione non è riuscita», con `ObjectLockConfigurationNotFoundError` (cioè accettata senza conservazione); «scrittura rifiutata», con il codice |

Le versioni scritte nello specchio restano 45 giorni e nessuno può cancellarle: è lo scopo del blocco. Dopo, il ciclo di vita le toglie.

### 10. Isolamento delle unità (I1–I2) (utente)

**I1.** Lettura di `infra/scripts/check-bucket-isolation.sh`, prima di I2; poi lo si dice a Claude.

**I2.** In un terminale delle chiavi **nuovo**, dopo il blocco del passo 4 e **senza** `load_key`:

```bash
cd ~/gestionale-negozi && git branch --show-current
export FILE_PROD_BUCKET=foondaco-file FILE_PROD_ENDPOINT=https://fsn1.your-objectstorage.com FILE_PROD_REGION=fsn1 \
  BACKUP_PROD_BUCKET=foondaco-backup BACKUP_PROD_ENDPOINT=https://fsn1.your-objectstorage.com BACKUP_PROD_REGION=fsn1 \
  FILE_TEST_BUCKET=foondaco-file-test FILE_TEST_ENDPOINT=https://fsn1.your-objectstorage.com FILE_TEST_REGION=fsn1 \
  BACKUP_TEST_BUCKET=foondaco-backup-test BACKUP_TEST_ENDPOINT=https://fsn1.your-objectstorage.com BACKUP_TEST_REGION=fsn1 \
  MIRROR_DST_BUCKET=foondaco-specchio MIRROR_DST_ENDPOINT=https://hel1.your-objectstorage.com MIRROR_DST_REGION=hel1
bash infra/scripts/check-bucket-isolation.sh
echo "codice di uscita: $?"
```

Il primo comando deve stampare `ops-t03`. Lo script chiede dodici parti, Access key e poi Secret key per ogni chiave, e dopo ognuna scrive «ricevuta»:

| Lo script chiede | Voce del gestore di password |
|---|---|
| «file di produzione» | `file-prod` |
| «backup di produzione» | `pgbackrest-prod` |
| «file di test» | `file-test` |
| «backup di test» | `pgbackrest-test` |
| «specchio» | `specchio-scrittura` |
| «sola lettura dello specchio» | `specchio-lettura` |

Poi lo script lavora da solo per qualche minuto. Atteso: ultima riga dello script `RIUSCITO: 148 controlli, nessuno fallito.`, poi la riga del blocco «codice di uscita: 0». L'utente incolla a Claude solo l'uscita dello script, dalla riga «check-bucket-isolation.sh: isolamento delle unità di archivio S3» alla sua ultima riga, quella subito prima di «codice di uscita: …»: «RIUSCITO …», oppure l'ultima delle righe «  - …» che seguono «FALLITO …», oppure la riga «Interrotto…», oppure la riga «ERRORE DI CONFIGURAZIONE…» o, se la seguono, la riga «Non incollare altre chiavi…». Se la riga «check-bucket-isolation.sh: …» non c'è, si incolla solo la riga «ERRORE DI CONFIGURAZIONE…». Prima la guarda (regola degli appunti): se contiene una riga che lo script non ha scritto, per esempio una chiave, non la incolla, lo dice a Claude a parole, e quella chiave è esposta (passo 12). Il numero di «codice di uscita» lo scrive a parole. Gli oggetti di prova cancellati restano nascosti da un delete marker nei bucket con le versioni. Il ciclo di vita li toglie dopo 30 giorni, o dopo 45 nello specchio, dove fino ad allora li tiene Object Lock.

**Avanzi.** Dopo un'interruzione, o se la pulizia dello script non è riuscita, in un terminale delle chiavi, tutto il blocco: prima carica le cinque chiavi, poi pulisce i cinque bucket (dove non c'è niente scrive «cancellati 0»).

```bash
load_key file-prod
load_key pgbackrest-prod
load_key file-test
load_key pgbackrest-test
load_key specchio-scrittura
clean_leftovers file-prod
clean_leftovers backup-prod
clean_leftovers file-test
clean_leftovers backup-test
clean_leftovers specchio
```

### 11. Chiave temporanea (J1–J6) (utente)

**J1.** Nella console, nel progetto `lettura-backup-prod` (si guarda che sia quello aperto, come al passo 2):

1. «Security» → «S3 credentials» → «Generate credentials», in alto a destra ora che c'è già una chiave;
2. «Description»: `prova-ripristino-AAAAMMGG`, con la data del giorno (per esempio `prova-ripristino-20261120`) → «Generate credentials»; quando compare la finestra «Credentials generated» si annota l'ora;
3. la voce `Hetzner S3 · lettura-backup-prod · prova-ripristino-AAAAMMGG`, con la stessa data, nel gestore di password, come al passo 2; poi si copia una parola qualsiasi, perché negli appunti resta una parte della chiave, e prima di inviare a Claude si guarda la casella (regola degli appunti).

Risposta a Claude: nell'elenco ci sono solo `specchio-lettura` e la chiave nuova.

Nel terminale delle chiavi questa chiave si chiama sempre `prova-ripristino`, senza data, così i comandi non cambiano da un mese all'altro. Alle domande «… di «prova-ripristino»» si copia dalla voce `… · prova-ripristino-AAAAMMGG` del giorno.

**J2, nella forma per chiave, prima di tutto.** La chiave nuova va aggiunta alla policy, in un terminale delle chiavi. Nella forma per progetto questo blocco serve solo se la lista di J2, qui sotto, è rifiutata con `AccessDenied` (lista di controllo, J2).

```bash
load_key pgbackrest-prod
load_key specchio-lettura
load_key prova-ripristino
use_key pgbackrest-prod
put_policy_keys specchio-lettura prova-ripristino
```

Una chiave appena creata può metterci qualche minuto a funzionare: se `put_policy_keys` dice che `prova-ripristino` non funziona, si aspetta qualche minuto e si rilancia il blocco. Poi la regola della policy (passo 7): ora annotata e uscita a Claude, 15 minuti, `show_policy backup-prod` che mostra `[specchio-lettura]` e `[prova-ripristino]`, F1–F2 con il blocco di F.

**J2, nelle due forme.** In un terminale delle chiavi che resta aperto fino a J4:

```bash
load_key prova-ripristino
use_key prova-ripristino
if compare_key prova-ripristino; then
  s3 fsn1 list-objects-v2 --bucket foondaco-backup --max-items 5
  printf 'prova di sola lettura\n' > "$WORK/prova.txt"
  s3 fsn1 put-object --bucket foondaco-backup --key prova-sola-lettura.txt --body "$WORK/prova.txt"
else echo 'Lista e scrittura non partono: il motivo è nelle righe qui sopra. Non incollare niente ora.'; fi
```

- Le domande sono sempre tre, tutte dalla voce `prova-ripristino-AAAAMMGG`: Access key e Secret key per `load_key`, poi di nuovo l'Access key per `compare_key`. Dopo la terza le domande sono finite: alla riga che finisce con `$` non si incolla mai una parte di chiave, solo un blocco.
- Atteso: «uguale», poi la lista riuscita, poi la scrittura rifiutata con `AccessDenied`. L'uscita intera va a Claude.
- Con «diversa» o «confronto non fatto», lista e scrittura non partono: si rilancia il blocco, copiando con attenzione dalla voce.
- Si annota il tempo da J1 alla prima lista riuscita.
- Un errore di chiave o di rete non è un esito: si rilancia il blocco, che chiede di nuovo la chiave, ogni 5 minuti, al massimo per 60 minuti da J1 (lista di controllo, J2).
- Lista rifiutata con `AccessDenied`: ci si ferma e lo si dice a Claude. Nella forma per progetto si passa alla forma per chiave con il primo blocco di J2 e la regola della policy, poi si rilancia questo blocco, entro 60 minuti da J1; nella forma per chiave si ricontrollano J1, E7 e i 15 minuti (lista di controllo, J2).
- Scrittura riuscita: il file di prova si cancella con `pgbackrest-prod`, come al passo 7; poi ci si ferma e lo si dice a Claude, prima di J3 (lista di controllo, J2).

**J3.** Nella console:

1. `lettura-backup-prod` → «Security» → «S3 credentials»;
2. nella riga la cui colonna «Description» dice `prova-ripristino-AAAAMMGG` (non `specchio-lettura`): menu «⋯» alla fine della riga → «Delete» → conferma;
3. si annota l'ora, subito dopo la conferma di «Delete»;
4. nell'elenco resta solo `specchio-lettura`: lo si dice a Claude a parole, con l'ora del punto 3. Niente schermate di questa pagina: come al passo 2, la colonna «Access Key» mostra per intero la chiave di `specchio-lettura`.

La documentazione di Hetzner non mostra questo menu. Se le voci sono diverse, le si scrive a Claude a parole, così come compaiono, senza schermate. J4 parte subito dopo la risposta del punto 4.

**J4.** Subito dopo J3, nel terminale di J2:

```bash
use_key prova-ripristino
watch_revocation
```

Stampa una riga per prova, subito e poi a 5, 10, … 60 minuti dall'inizio, e alla fine una riga di riepilogo; l'uscita intera va a Claude. Atteso: due rifiuti di fila con `InvalidAccessKeyId` entro 60 minuti dall'ora di J3. Le prove partono qualche minuto dopo J3: Claude ne confronta le ore con quella di J3.

- Le righe «non conta» (errori del client, della rete o del fornitore, per esempio `SlowDown`, `InternalError`, `ServiceUnavailable` o un numero 5xx) non interrompono la prova e non contano come rifiuti.
- Una riga «con un altro codice» interrompe la serie e si annota: se la chiave è sempre rifiutata così, si decide con `TORNA AI TEST`.
- Durante J4 il computer non si sospende. Se compare «prove saltate», alcune prove mancano: l'esito di J4 lo decide Claude.
- Se dopo 60 minuti la lista riesce ancora, nella forma per chiave si fa subito J6 e poi ci si ferma (lista di controllo, J4).

**J5.** Si cancella la voce della chiave temporanea nel gestore di password.

**J6, solo nella forma per chiave, dopo J4.** In un terminale delle chiavi:

```bash
load_key pgbackrest-prod
load_key specchio-lettura
use_key pgbackrest-prod
put_policy_keys specchio-lettura
```

Poi la regola della policy (passo 7): ora annotata e uscita a Claude, 15 minuti, `show_policy backup-prod` con solo `[specchio-lettura]`, F1–F2 con il blocco di F. Nella forma per progetto J6 non serve: lo si annota.

Per la prova mensile (OPS-004) la chiave temporanea si crea e si cancella nello stesso modo (J1, J3), con la data del giorno nella console e nel gestore di password; nel terminale si chiama sempre `prova-ripristino`. Nella forma per chiave, la policy cambia come in J2 e J6.

### 12. Chiave esposta o persa (utente)

**Chiave esposta**: comparsa sullo schermo, incollata in chat, oppure incollata fuori dalle domande senza eco (regola del terminale delle chiavi).

1. Si chiude subito quel terminale, senza incollarne l'uscita a Claude.
2. Nella console, nel progetto della chiave: «Security» → «S3 credentials» → menu «⋯» della riga → «Delete». Poi si crea una chiave nuova con lo stesso nome (passo 2). Una chiave temporanea esposta dopo J3 è già cancellata: non si rifà, e dei punti che seguono non serve nessuno. Lo si dice subito a Claude: se il terminale chiuso al punto 1 è quello di J2, Claude decide come finire J4, e annota l'esposizione per K3.
3. La voce del gestore di password prende i valori nuovi, al posto dei vecchi. Poi si copia una parola qualsiasi, perché negli appunti resta una parte della chiave, e prima di ogni invio a Claude si guarda la casella (regola degli appunti).
4. Se la policy è nella forma per chiave e nomina la chiave rifatta (`specchio-lettura`, oppure `prova-ripristino` fra J2 e J3), in un terminale delle chiavi nuovo si rimanda la policy con le chiavi che deve nominare in quel momento. Fra J2 e J3, finché la chiave temporanea esiste: il primo blocco di J2 (`put_policy_keys specchio-lettura prova-ripristino`). In ogni altro momento: il blocco della forma per chiave del passo 7 (`put_policy_keys specchio-lettura`), ma da J3 in poi solo a J4 finito, mai mentre gira (ne cambierebbe l'esito), e allora vale anche come J6. Poi la regola della policy (passo 7).
5. Se la chiave è già nel file di ambiente di un server (dopo OPS-T01a, FON-T07b od OPS-T01b), l'utente la aggiorna lì con la procedura dei file di ambiente.
6. Si ripetono le prove di quella chiave, e la data va in «Rotazioni delle chiavi», qui sotto.
7. Ultimo passo: si aggiorna la copia fuori linea (OPS-009), cioè la copia sigillata, con i valori nuovi al posto dei vecchi, e se ne annota la data in «Valori letti» (copia fuori linea) e in «Rotazioni delle chiavi». Prima del passo 13 le chiavi S3 non sono ancora nella copia sigillata: ce le mette il passo 13, con i valori di quel momento, e qui la data va solo in «Rotazioni delle chiavi».

**Valore perso**: la Secret key non è nel gestore di password. Non si recupera, perché la console la mostra una volta sola: si fanno i passi 2–7 qui sopra.

### 13. Chiusura (K1, K3) (utente)

1. Le sei chiavi (non la temporanea) vanno nella copia sigillata (OPS-009), con i valori che sono ora nel gestore di password. Se le si copia dal gestore di password, alla fine si copia una parola qualsiasi, perché negli appunti resta una parte di chiave, e prima di ogni invio a Claude si guarda la casella (regola degli appunti).
2. Per ciascuna delle sei voci, una risposta scritta a Claude: c'è nel gestore di password e nella copia sigillata. Niente schermate.
3. La data dell'aggiornamento della copia sigillata va a Claude, che la scrive in «Valori letti».
4. Tutti i terminali delle chiavi sono chiusi (`exit`), e ogni chiusura è stata detta a Claude (K3).

### 14. Valori letti

- Id dei progetti (B3): nella tabella in alto.
- Client: AWS CLI 2.39.4, installato il 18/11/2026. Chiave di firma di AWS `FB5D B77F D5C1 18B8 0511 ADA8 A631 0ACC 4672 475C`, con scadenza 01/07/2027.
- Bucket creati il _(C1)_; specchio creato alle _(C4)_.
- Forma della policy di `foondaco-backup` in uso: _(F)_.
- Tempo della revoca di una chiave cancellata: _(J4)_.
- Copia fuori linea delle sei chiavi (OPS-009): ultimo aggiornamento il _(K1)_.
- Rotazioni delle chiavi: nessuna.

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
