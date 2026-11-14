# FON-T07a — Esito della lista di controllo

Lista: `docs/verifiche/fon-t07a.md`. Eseguita il 13/11/2026. Server: test `srv2155002` (145.14.158.72), prod `srv1874119` (91.108.122.251). Esiti dei passi dell'utente scritti sotto sua dettatura (uscite incollate in chat).

## A. Prima di iniziare

| # | Esito |
|---|---|
| A1 | Riuscito dopo una correzione: all'inizio `ssh test` era rifiutato (la chiave di yoo non era installata per `root` sul server di test); l'utente l'ha aggiunta, poi `ssh -o BatchMode=yes test true` e `prod true` riusciti. |
| A2 | Riuscito: quattro file `.pub` in `~/chiavi-pubbliche/`, impronte ed25519 distinte (tabella in `infra/README.md`, «Accessi»). |
| A3 | Riuscito dopo una correzione: il primo `docker login` rispondeva `denied` (token non adatto); con un token classic `write:packages` `Login Succeeded` (verificato poi dal `docker push` di G3). |

## B. Operazioni da root

| # | test | prod |
|---|---|---|
| B1 | Ubuntu 26.04.1 LTS (`resolute`), x86_64; aggiornato e riavviato | uguale |
| B2 | `deploy` uid 1000, gruppi `deploy`, `users` (poi `docker`); nessun `sudo`; creato con `--disabled-password` | uguale |
| B3 | **Diverso dall'atteso alla lettera (deviazione).** `admin-personale` uid 1001, gruppo `sudo`, come atteso; ma in sudoers esiste una regola `NOPASSWD`: `root ALL=(ALL) NOPASSWD:ALL` di Hostinger (`90-cloud-init-users`). Vale solo per `root`, che non entra via SSH (D1, E5); nessuna regola `NOPASSWD` per `admin-personale` né per `deploy`, che è lo scopo del controllo. Lasciata com'è; annotata in `infra/README.md`, «Accessi». | uguale |
| B4 | Due righe: `gestionale-yoo` (SHA256:LqA3…a6E) senza opzioni; `rilascio-test` (SHA256:rWZX…MDU) con `command="/srv/app/deploy.sh",no-port-forwarding,no-agent-forwarding,no-pty`; `.ssh` 700, file 600, proprietario `deploy` | Due righe: `gestionale-yoo`; `rilascio-prod` (SHA256:Pgoc…jjo) con lo stesso comando forzato; 700/600, `deploy` |
| B5 | `admin-personale` (SHA256:GWB6…By4); 700/600, proprietario `admin-personale` | uguale |
| B6 | `Status: active`, `Default: deny (incoming)`, consentite solo 22/tcp, 80/tcp, 443/tcp (anche v6) | uguale |
| B7 | Docker Engine 29.9.3 (client e server), Compose v5.7.1; chiave apt con impronta `9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88` | uguale |
| B8 | `deploy` nel gruppo `docker` (gid 986) | uguale |
| B9 | `Linger=yes` | uguale |
| B10 | `unattended-upgrades` installato e `enabled`; `20auto-upgrades` con i due valori `"1"` | uguale |
| B11 | `/srv/app` proprietario `deploy`, 755 | uguale |
| B12 | `SHA256:QRERssGOclqZRqIWABgktHu/zmbfXS+R+fjkhGHKko4`; coincide con quella salvata dall'utente al primo collegamento (`ssh-keygen -lF`) e, il 14/11/2026, con quella letta dall'utente nella console di Hostinger (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`, accesso `admin-personale`) | `SHA256:i1i1PW6cBBzVEO8cn2KQNSlvCmDCssCr+RFZiMyBpcE`; coincide con il primo collegamento e con la console di Hostinger (14/11/2026) |

## C. Prima della chiusura di SSH

| # | Esito |
|---|---|
| C1 | Password di `admin-personale` impostata dall'utente su entrambi (`passwd -S`: stato `P`, 13/11/2026) |
| C2 | `sudo-ok` su entrambi (riferito dall'utente) |
| C3 | `deploy-ok` su entrambi, con la chiave di yoo |

## D. Chiusura di SSH

| # | test | prod |
|---|---|---|
| D1 | `00-hardening.conf` scritto; `sshd -t` senza errori; `sshd -T`: `permitrootlogin no`, `passwordauthentication no`, `kbdinteractiveauthentication no`, `pubkeyauthentication yes`; `systemctl reload ssh` riuscito | uguale |

## E. Dopo la chiusura

| # | Esito |
|---|---|
| E1 | `User deploy` rimesso dall'utente nei blocchi `test` e `prod` |
| E2 | `ssh test` e `ssh prod` entrano come `deploy` |
| E3 | `uid=1000(deploy)`, gruppi `deploy`, `users`, `docker`; niente `sudo` (test e prod) |
| E4 | `sudo sshd -T` da `admin-personale` (sudo con password): `permitrootlogin no`, `passwordauthentication no`, `kbdinteractiveauthentication no` su entrambi |
| E5 | `root@145.14.158.72: Permission denied (publickey).` e `root@91.108.122.251: Permission denied (publickey).` |
| E6 | Senza chiave: `deploy@145.14.158.72: Permission denied (publickey).` e lo stesso per 91.108.122.251, senza richiesta di password |
| E7 | `rilascio-test` verso test e `rilascio-prod` verso prod: `bash: line 1: /srv/app/deploy.sh: No such file or directory`; nessuna shell, `ciao` non stampato (risponde il comando forzato) |
| E8 | `rilascio-test` verso prod e `rilascio-prod` verso test: `Permission denied (publickey).` |
| E9 | Uscite incollate dall'utente per entrambi: `Status: active`, `Default: deny (incoming), allow (outgoing), deny (routed)`, consentite solo 22/tcp, 80/tcp, 443/tcp (anche v6). «routed» è passato a `deny` dopo l'installazione di Docker; non riguarda le porte in ingresso. |
| E10 | `docker run --rm hello-world` come `deploy`: «Hello from Docker!» su entrambi; immagine poi rimossa |

## F. Firewall di Hostinger

| # | Esito |
|---|---|
| F1 | Regole lette dall'utente nel pannello di Hostinger (14/11/2026), nell'ordine: `accept TCP 22 any`, `accept TCP 80 any`, `accept TCP 443 any`, `drop any any any`. Stesse regole associate a entrambe le VPS (test e prod), confermato dall'utente. |

## G. GHCR

| # | Esito |
|---|---|
| G1 | `sudo stat` da `admin-personale` su entrambi: `deploy 700 /srv/app/env`, `deploy 600 /srv/app/env/ghcr-token`. Nota: al primo tentativo il blocco `test-admin` di `~/.ssh/config` puntava all'indirizzo della produzione (i due `HostName` erano scambiati), quindi la cartella e il login del «test» erano finiti in produzione; corretto il file, ripetuto sul server di test (`hostname` `srv2155002`, `whoami` `deploy`). |
| G2 | `Login Succeeded` come `deploy` su entrambi |
| G3 | `ghcr.io/jinoesfoo/gestionale-negozi-prova:1` costruita da `busybox:1.37.0` con la label `org.opencontainers.image.source=https://github.com/jinoesfoo/gestionale-negozi`; `docker push` riuscito (digest `sha256:c684dcca…4bca`) |
| G4 | **Diverso dall'atteso (deviazione).** Visibilità **Private** (letta dall'utente), come atteso. **Non** collegato al repository, nonostante la label; il pacchetto `gestionale-negozi-prova` non è stato collegato, il collegamento a mano è stato provato solo su `-prova-a`: vedi «Nota sul collegamento dei pacchetti» qui sotto; deviazione annotata in 01 (§Servizi Docker Compose, nota di FON-T07a) e in `infra/README.md`. Il repository `jinoesfoo/gestionale-negozi` esiste ed è pubblico (`gh repo view`). |
| G5 | `docker pull` come `deploy` riuscito su prod e, dopo il login corretto, su test (stesso digest). Prima del login sul test: `unauthorized`, come atteso per un pacchetto privato senza credenziali. |
| G6 | `docker run --rm` stampa `prova-ghcr-ok` ed esce con 0 su entrambi |
| G7 | L'utente ha cancellato i tre pacchetti di prova (`gestionale-negozi-prova`, `-prova-a`, `-prova-b`); `docker pull` dal server di test risponde `not found` per tutti e tre (14/11/2026) |
| G8 | `docker image rm` riuscito su test e prod; tolte anche le immagini locali su yoo |

### Nota sul collegamento dei pacchetti

`docs/due-postazioni.md` («Regole di struttura») e 01 si aspettano che un pacchetto pubblicato con la label `org.opencontainers.image.source` nasca collegato al repository. Non è successo, il 13 e 14/11/2026, pubblicando da yoo con `docker push` e il token classic `write:packages` dell'utente:

- `gestionale-negozi-prova:1`, costruzione predefinita (indice con attestazione di provenienza): non collegato;
- `gestionale-negozi-prova:2`, nello stesso pacchetto, con `--provenance=false --sbom=false` (manifest singolo, label nella configurazione): non collegato;
- `gestionale-negozi-prova-a:1`, pacchetto nuovo, manifest singolo: non collegato;
- `gestionale-negozi-prova-b:1`, pacchetto nuovo, indice con attestazione: non collegato (letto dall'utente insieme ad `-a`).

Il collegamento manuale («Connect Repository» nella pagina del pacchetto, repository `gestionale-negozi`) funziona (provato dall'utente su `-prova-a`). Conseguenza per DOM-T02, OPS-T01a e FON-T07b: dopo la prima pubblicazione a mano l'utente controlla la pagina del pacchetto e, se non è collegato, lo collega a mano e dà al repository l'accesso dei flussi in scrittura («Manage Actions access», `AVVIO.md` §8 passo 7). Annotato in `infra/README.md`, «Accesso a GHCR dai server».

## Test del compito

- Accesso SSH solo con chiave: riuscito (D1, E4, E5, E6 su entrambi i server).
- Docker funzionante: riuscito (B7, E10).
- `docker pull` come `deploy` di un'immagine privata su GHCR, su entrambi i server: riuscito (G4 Private, G5; senza login il pull rispondeva `unauthorized`).

Tutti i controlli della lista sono stati eseguiti. Nell'esito finale nessuno è fallito, tranne due diversi dall'atteso e dichiarati come deviazioni: G4 (pacchetto non collegato al repository; il test del compito resta soddisfatto da G4 Private e G5) e B3 (regola `NOPASSWD` di Hostinger per il solo `root`). Due correzioni durante l'esecuzione, entrambe di configurazione sul computer dell'utente (A1: chiave di yoo mancante sul server di test; G1: `HostName` scambiati fra `test-admin` e `prod-admin`).
