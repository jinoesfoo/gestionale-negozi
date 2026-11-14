# FON-T07a — Lista di controllo: preparazione di base dei due server

Compito senza test automatici (CLAUDE.md §1). Questa lista resta ferma dopo la fase test; gli esiti si scrivono in `docs/verifiche/fon-t07a-esito.md`.

Ogni controllo si fa **su entrambi i server**, prima `test` poi `prod` (per `prod` Claude Code chiede conferma a ogni comando). Le procedure complete, con i comandi, stanno in `infra/README.md`, sezioni FON-T07a.

Chi esegue: **C** = Claude (con `ssh test` / `ssh prod`), **U** = utente dal suo terminale o dal pannello.

Valori decisi nel piano: utente di Hostinger `root`; utente amministrativo `admin-personale`; proprietario GHCR `jinoesfoo`; immagine di prova `ghcr.io/jinoesfoo/gestionale-negozi-prova:1`.

## A. Prima di iniziare (U)

| # | Controllo | Esito atteso |
|---|---|---|
| A1 | `ssh test true` e `ssh prod true` dal terminale di yoo | Entrano come `root` senza chiedere password né conferma |
| A2 | Le quattro chiavi pubbliche (`gestionale-yoo`, `admin-personale`, `rilascio-test`, `rilascio-prod`) sono in `~/chiavi-pubbliche/` | Quattro file `.pub`, nessun file privato |
| A3 | `docker login ghcr.io` su yoo con un token `write:packages` | Fatto dall'utente; Claude non vede il token |

## B. Operazioni da root (C), nell'ordine

| # | Controllo | Esito atteso |
|---|---|---|
| B1 | Versione del sistema (`/etc/os-release`) | Ubuntu LTS; versione annotata nell'esito |
| B2 | Utente `deploy` | Esiste; `id deploy` non mostra il gruppo `sudo`; nessuna password impostata |
| B3 | Utente `admin-personale` | Esiste; `id admin-personale` mostra il gruppo `sudo`; nessuna regola `NOPASSWD` in `/etc/sudoers` né in `/etc/sudoers.d/` |
| B4 | `authorized_keys` di `deploy` | Due righe: la chiave di yoo senza opzioni; la chiave di rilascio **di quel server** preceduta esattamente da `command="/srv/app/deploy.sh",no-port-forwarding,no-agent-forwarding,no-pty`; file 600 e cartella `.ssh` 700, proprietario `deploy` |
| B5 | `authorized_keys` di `admin-personale` | Una riga: la chiave personale dell'utente; file 600 e cartella `.ssh` 700, proprietario `admin-personale` |
| B6 | `ufw status verbose` | `Status: active`; `Default: deny (incoming)`; consentite solo `22/tcp`, `80/tcp`, `443/tcp` (e le stesse in IPv6); nessuna porta UDP |
| B7 | Docker dal repository ufficiale | `docker version` risponde con client e server; `docker compose version` ≥ 2.24 (versioni annotate nell'esito) |
| B8 | `deploy` nel gruppo `docker` | `id deploy` mostra `docker` |
| B9 | `loginctl show-user deploy --property=Linger` | `Linger=yes` |
| B10 | `unattended-upgrades` | Pacchetto installato; `/etc/apt/apt.conf.d/20auto-upgrades` con `Update-Package-Lists "1"` e `Unattended-Upgrade "1"` |
| B11 | Cartella `/srv/app` | Esiste, proprietario `deploy` |
| B12 | Chiave ed25519 dell'host | Riga `known_hosts` e impronta SHA256 annotate in `infra/README.md`; l'utente conferma che l'impronta coincide con quella della console di Hostinger |

## C. Prima della chiusura di SSH (U)

| # | Controllo | Esito atteso |
|---|---|---|
| C1 | `ssh -t test sudo passwd admin-personale` (e `prod`) | Password impostata dall'utente; Claude non la conosce |
| C2 | `ssh test-admin sudo -v` (e `prod-admin`) | Entra con la chiave personale; `sudo` chiede la password e la accetta |
| C3 | Accesso come `deploy` con la chiave di yoo (`ssh -i ~/.ssh/gestionale-yoo deploy@<indirizzo> true`) | Entra senza password |

Se C2 o C3 falliscono, la chiusura di SSH non si fa.

## D. Chiusura di SSH (C, ultimo comando da root)

| # | Controllo | Esito atteso |
|---|---|---|
| D1 | File `/etc/ssh/sshd_config.d/00-hardening.conf` con `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`; `sshd -t` | `sshd -t` senza errori, poi ricaricamento del servizio SSH |

## E. Dopo la chiusura

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| E1 | U | Rimette `User deploy` nei blocchi `test` e `prod` di `~/.ssh/config` | Fatto |
| E2 | C | `ssh test true`, `ssh prod true` | Entrano come `deploy` |
| E3 | C | `ssh test id` | `deploy`, gruppi senza `sudo`, con `docker` |
| E4 | U | `sudo sshd -T` da `admin-personale`, filtrato sulle tre opzioni | `permitrootlogin no`, `passwordauthentication no`, `kbdinteractiveauthentication no` |
| E5 | U | Accesso di `root` con la chiave (`ssh root@<indirizzo> true`) | Rifiutato (`Permission denied`) |
| E6 | U | Accesso con password: `ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password,keyboard-interactive deploy@<indirizzo>` | Rifiutato senza chiedere la password (`Permission denied (publickey)`) |
| E7 | U | Chiave di rilascio: `ssh -i ~/.ssh/rilascio-test -o IdentitiesOnly=yes deploy@<indirizzo del test> echo ciao` (e `rilascio-prod` verso prod) | Non si apre nessuna shell e `echo ciao` non viene eseguito: risponde il comando forzato (prima di FON-T08 `/srv/app/deploy.sh` non esiste: errore «No such file or directory») |
| E8 | U | Chiave di rilascio sul server sbagliato (`rilascio-test` verso prod) | Rifiutata (`Permission denied`) |
| E9 | U | `sudo ufw status verbose` da `admin-personale` | Come B6 |
| E10 | C | `ssh test docker run --rm hello-world` | Stampa «Hello from Docker!» come `deploy` |

## F. Firewall di Hostinger (U)

| # | Controllo | Esito atteso |
|---|---|---|
| F1 | Regole impostate nel pannello della VPS secondo `infra/README.md`, lette dall'utente e dettate a Claude | In ingresso accettate solo TCP 22, 80, 443; tutto il resto rifiutato; annotate nell'esito per ciascun server |

## G. GHCR

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| G1 | U | Come `deploy` (`sudo -iu deploy` da `admin-personale`): cartella `/srv/app/env` e file `ghcr-token` con un token classic `read:packages` | Cartella 700 e file 600, proprietario `deploy` (`sudo stat` li mostra) |
| G2 | U | `docker login ghcr.io` come `deploy`, con il token letto dal file | `Login Succeeded` |
| G3 | C | Pubblicazione da yoo di `ghcr.io/jinoesfoo/gestionale-negozi-prova:1` con la label `org.opencontainers.image.source=https://github.com/jinoesfoo/gestionale-negozi` | `docker push` riuscito |
| G4 | U | Pagina del pacchetto su GitHub | Visibilità **Private**; collegato al repository `gestionale-negozi` |
| G5 | C | `ssh test docker pull ghcr.io/jinoesfoo/gestionale-negozi-prova:1` e lo stesso con `prod` | Pull riuscito su entrambi i server, come `deploy` |
| G6 | C | `ssh test docker run --rm ghcr.io/jinoesfoo/gestionale-negozi-prova:1` (e `prod`) | Il container parte ed esce con codice 0 |
| G7 | U | Cancellazione del pacchetto di prova («Package settings» → «Delete this package») | Pacchetto non più presente |
| G8 | C | `ssh test docker image rm ghcr.io/jinoesfoo/gestionale-negozi-prova:1` (e `prod`) | Immagine rimossa dai server |

## Test del compito (01 FON-T07a)

- **Accesso SSH solo con chiave:** D1, E4, E5, E6 su entrambi i server.
- **Docker funzionante:** B7, E10 su entrambi i server.
- **`docker pull` come `deploy` di un'immagine privata del repository su GHCR riuscito su entrambi i server:** G4, G5.
