# Come partire: due computer Ubuntu, yoo e joo

Chi fa cosa è spiegato in `docs/due-postazioni.md`. Qui ci sono solo i passi di installazione, in ordine.

## 1. Strumenti, su ciascuno dei due computer

```bash
sudo apt update && sudo apt install -y git jq curl bubblewrap socat    # bubblewrap e socat: la sandbox di Claude Code
# GitHub CLI dal repository ufficiale (quello di Ubuntu 22.04 è troppo vecchio): https://github.com/cli/cli/blob/trunk/docs/install_linux.md
# Node.js 24 con nvm, poi pnpm
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc && nvm install 24 && npm install -g pnpm
# Docker (database in locale, immagini, test di integrazione)
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker "$USER"
# Chi firma i commit (lo stesso nome su tutti e due i computer va bene)
git config --global user.name "Il tuo nome" && git config --global user.email "la-tua-email@esempio.it"
# GitHub: accesso via HTTPS e credenziali per git (servono anche agli hook, che fanno git fetch da soli)
gh auth login --git-protocol https && gh auth setup-git
```

Dopo `usermod` esci dalla sessione e rientra, così Docker funziona senza `sudo`. In VS Code installa l'estensione Claude Code, in una versione recente: gli hook che si fermano se si rompono (`onFailure`) esistono da Claude Code v2.1.295. Dopo FON-T01, una volta per computer: `pnpm exec playwright install --with-deps`.

**Solo su yoo, i nomi dei server.** Gli hook lasciano andare verso i server solo con due nomi fissi, `test` e `prod`, e per `prod` Claude Code ti chiede conferma a ogni comando. Quando hai gli indirizzi dei due server, aggiungi a `~/.ssh/config`:

```text
Host test
  HostName <indirizzo del server di test>
  User deploy
Host prod
  HostName <indirizzo del server di produzione>
  User deploy
```

All'inizio di FON-T07a, finché l'utente `deploy` non esiste, al posto di `deploy` va l'utente che ti ha dato Hostinger: FON-T07a lo spiega in `infra/README.md`.

## 2. Il repository su GitHub, una volta sola, da joo

Lo zip contiene `gestionale-negozi.bundle`, il repository con la sua storia. Da joo, nella cartella in cui hai estratto lo zip:

```bash
git clone -b main gestionale-negozi.bundle ~/gestionale-negozi
cd ~/gestionale-negozi
git remote remove origin
gh repo create gestionale-negozi --private --source . --remote origin --push
```

Le impostazioni del repository su GitHub (come si uniscono le pull request, la protezione di `main`) si decidono insieme nella parte sul collegamento a GitHub. Fino ad allora: unisci le pull request solo con «Squash and merge».

## 3. Il clone, da yoo (dopo il passo 2)

```bash
gh repo clone gestionale-negozi ~/gestionale-negozi    # con lo stesso account GitHub di joo
```

## 4. Il nome della postazione, su ciascun computer

Nel tuo terminale, non da Claude, nella cartella del progetto, una volta sola. Il nome finisce fuori dal progetto, in `~/.local/state/gestionale-negozi/`, dove i comandi di Claude non possono cambiarlo.

```bash
bash .claude/hooks/imposta-postazione.sh joo    # sul computer joo
bash .claude/hooks/imposta-postazione.sh yoo    # sul computer yoo
```

## 5. Claude Code

Apri la cartella `~/gestionale-negozi` in VS Code, avvia Claude Code e scrivi `/hooks`: devi vedere SessionStart, UserPromptSubmit, PreToolUse e Stop. All'apertura Claude deve ricevere il messaggio «[Metodo] Postazione joo» (o yoo).

## 6. Prova, prima di lavorare

Gli hook sono stati collaudati in una simulazione, e la sandbox esiste solo su Linux: questa prova verifica tutto su Ubuntu.

- Su joo scrivi `INIZIA FON-T07a`: deve essere **rifiutato** («è della postazione yoo»).
- Su yoo scrivi `INIZIA FON-T01`: deve essere **rifiutato** («è della postazione joo»).
- In nessuna delle due risposte deve comparire «git fetch non è riuscito»: se compare, l'accesso a GitHub dal terminale non funziona (passo 1, `gh auth setup-git`).
- Su joo scrivi `/stato`: il prossimo compito deve essere FON-T01. Su yoo: FON-T07a.
- Chiedi a Claude di eseguire `touch .claude/prova-hook`: deve essere **bloccato dall'hook** («i file del metodo … li cambia solo l'utente»).
- Chiedi a Claude di eseguire `cd .claude && python3 -c "open('prova-sandbox','w')"`: l'hook lo lascia passare, quindi deve **fallire per la sandbox**, con un errore di permesso. Se invece il file nasce, la sandbox non è attiva: fermati.
- Chiedi a Claude di eseguire `git fetch origin` e `gh pr list`: devono **funzionare**. Se la rete o le credenziali non passano dalla sandbox, aggiungi tu `"git fetch *"`, `"git push *"` e `"gh *"` agli `excludedCommands` di `.claude/settings.json`, con un commit su un ramo e una pull request.
- Dopo FON-T03, `pnpm test:int` deve raggiungere il database; dopo FON-T06, `docker compose` deve funzionare. Se un comando che serve ogni giorno non funziona nella sandbox, si aggiunge allo stesso modo agli `excludedCommands`, e lo si scrive in `docs/due-postazioni.md`.

Se una delle risposte è diversa, fermati e non iniziare compiti.

## 7. Account esterni

- **Stripe:** una sandbox per ogni computer di sviluppo («sviluppo-joo» e «sviluppo-yoo»), più quella del server di test e la produzione. Ognuna ha le sue chiavi (`docs/due-postazioni.md`, «Stripe»).
- **I segreti** (chiavi Stripe, Cloudflare, S3, password dei server) non passano mai da git, dallo zip o dalla chat: si copiano da un computer all'altro con il gestore di password. I segreti di GitHub (Actions) li scrivi tu.

## 8. Si parte

- joo: `INIZIA FON-T01`
- yoo: `INIZIA FON-T07a`

Il metodo completo (fasi e parole chiave) è in `docs/metodo.md`. Le parole chiave (`INIZIA <ID>`, `APPROVO`, `TORNA AI TEST`, `TORNA AL PIANO`, `TORNA AL CODICE`, `CHIUSO`, `ABBANDONA`) vanno scritte da sole sulla prima riga del messaggio.
