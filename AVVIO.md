# Come partire: due computer Ubuntu, yoo e joo

Chi fa cosa è spiegato in `docs/due-postazioni.md`. Qui ci sono solo i passi di installazione, in ordine.

## 1. Strumenti, su ciascuno dei due computer

```bash
sudo apt update && sudo apt install -y git jq curl bubblewrap socat    # bubblewrap e socat: la sandbox di Claude Code e la gabbia
# GitHub CLI dal repository ufficiale (quello di Ubuntu 22.04 è troppo vecchio): https://github.com/cli/cli/blob/trunk/docs/install_linux.md
# Node.js 24 con nvm, poi pnpm
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc && nvm install 24 && npm install -g pnpm
# Docker (database in locale, immagini, test di integrazione)
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker "$USER"
# Chi firma i commit (lo stesso nome su tutti e due i computer va bene)
git config --global user.name "Il tuo nome" && git config --global user.email "la-tua-email@esempio.it"
# GitHub: accesso via HTTPS e credenziali per git (servono anche agli hook, che fanno git fetch da soli).
# --insecure-storage: il token sta in un file leggibile solo da te (~/.config/gh/hosts.yml), non nel portachiavi
# del sistema, che i comandi di Claude, chiusi nella sandbox, non possono raggiungere.
gh auth login --git-protocol https --insecure-storage && gh auth setup-git
```

Dopo `usermod` esci dalla sessione e rientra, così Docker funziona senza `sudo`. Dopo FON-T01, una volta per computer: `pnpm exec playwright install --with-deps`.

**Ubuntu 24.04 e la sandbox.** Ubuntu 24.04 limita i «namespace utente» di cui hanno bisogno la sandbox di Claude Code e la gabbia degli hook. Controlla con `sysctl kernel.apparmor_restrict_unprivileged_userns`: se risponde `= 1`, crea il profilo AppArmor di bubblewrap, una volta sola:

```bash
sudo tee /etc/apparmor.d/bwrap >/dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>
profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/bwrap
```

Su Ubuntu 22.04 non serve. Senza questo passo Claude Code non parte (la sandbox è obbligatoria, `failIfUnavailable`).

**Claude Code.** In VS Code installa l'estensione Claude Code, in una versione recente: almeno la v2.1.310, che all'avvio controlla davvero la sandbox; gli hook che si fermano se si rompono (`onFailure`) esistono dalla v2.1.295.

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

Nel tuo terminale, non da Claude, nella cartella del progetto, una volta sola. Il nome finisce fuori dal progetto, in `~/.local/state/gestionale-negozi/`, dove i comandi di Claude non possono cambiarlo. Lo script registra anche l'impronta della cartella `.git`: se un giorno gli hook dicono che «la cartella del repository non è quella registrata», guarda che cosa è successo (per esempio un nuovo clone nella stessa cartella) e rilancia lo stesso comando, con lo stesso nome.

```bash
bash .claude/hooks/imposta-postazione.sh joo    # sul computer joo
bash .claude/hooks/imposta-postazione.sh yoo    # sul computer yoo
```

## 5. Claude Code

Apri la cartella `~/gestionale-negozi` in VS Code, avvia Claude Code e scrivi `/hooks`: devi vedere SessionStart, UserPromptSubmit, PreToolUse e Stop. All'apertura Claude deve ricevere il messaggio «[Metodo] Postazione joo» (o yoo).

I comandi che girano fuori dalla sandbox (Docker, `ssh`, `scp`, `rsync` e la gabbia, `bash .claude/hooks/gabbia.sh …`) passano dal normale permesso di Claude Code: se te lo chiede, guarda il comando prima di dire sì. Per la gabbia puoi rispondere «sì, sempre»; per Docker e i server conviene guardarli ogni volta.

## 6. Prova, prima di lavorare

Gli hook sono stati collaudati in una simulazione, e la sandbox esiste solo su Linux: questa prova verifica tutto su Ubuntu. Chiedi a Claude di eseguire i comandi, uno alla volta, e confronta la risposta.

- Su joo scrivi `INIZIA FON-T07a`: deve essere **rifiutato** («è della postazione yoo»).
- Su yoo scrivi `INIZIA FON-T01`: deve essere **rifiutato** («è della postazione joo»).
- In nessuna delle due risposte deve comparire «git fetch non è riuscito»: se compare, l'accesso a GitHub dal terminale non funziona (passo 1, `gh auth setup-git`).
- Su joo scrivi `/stato`: il prossimo compito deve essere FON-T01. Su yoo: FON-T07a.
- `touch .claude/prova-hook`: deve essere **bloccato dall'hook** («i file del metodo … li cambia solo l'utente»).
- Le prove della sandbox: l'hook le lascia passare, quindi devono **fallire per la sandbox**, con un errore di permesso («Permission denied» o «Read-only file system»). Se anche uno solo dei file cambia, la sandbox non è attiva: fermati.
  - `cd .claude && python3 -c "open('prova-sandbox','w')"`
  - `python3 -c "open('CLAU'+'DE.md','a')"`
  - `python3 -c "open('.gi'+'t/config','a')"`
  - `python3 -c "import os; open(os.path.expanduser('~/.local/sta'+'te/gestionale-'+'negozi/prova'),'w')"`
- I segreti. Crea tu, nel tuo terminale, un file di prova: `echo SEGRETO_DI_PROVA=1 > .env.test`. Poi chiedi a Claude `grep -r SEGRETO_DI_PROVA .` e `python3 -c "print(open('.en'+'v.test').read())"`: nessuno dei due deve mostrare la riga (permesso negato). Poi cancella tu il file: `rm .env.test`.
- `git fetch origin` e `gh pr list`: devono **funzionare** dalla sandbox. Se non funzionano, fermati e non aggiungere git o gh agli `excludedCommands`: fuori dalla sandbox git potrebbe riscrivere i file del metodo. Di solito manca il passo `gh auth login --insecure-storage`.
- `bash .claude/hooks/gabbia.sh --prova`: tutte le righe devono cominciare con «ok». Se una dice «ERRORE», o se la gabbia non parte, fermati (di solito è il profilo AppArmor del passo 1).
- Dopo FON-T03, `bash .claude/hooks/gabbia.sh test:int` deve raggiungere il database; dopo FON-T06, `docker compose -f infra/compose.dev.yml up -d` deve funzionare. Se un comando che serve ogni giorno non funziona, fermati e chiedi: non si aggiunge nulla agli `excludedCommands` senza averlo ragionato.
- La conferma per `prod` la vedrai al primo comando verso la produzione, dentro FON-T07a: Claude Code deve chiederti il permesso.

Se una delle risposte è diversa, fermati e non iniziare compiti.

## 7. Account esterni

- **Stripe:** una sandbox per ogni computer di sviluppo («sviluppo-joo» e «sviluppo-yoo»), più quella del server di test e la produzione. Ognuna ha le sue chiavi (`docs/due-postazioni.md`, «Stripe»).
- **I segreti** (chiavi Stripe, Cloudflare, S3, password dei server) non passano mai da git, dallo zip o dalla chat: si copiano da un computer all'altro con il gestore di password. I segreti di GitHub (Actions) e i file di ambiente dei server li scrivi tu.

## 8. Si parte

Prima del primo compito, nella parte sul collegamento a GitHub:
- la protezione di `main`: nessuna spinta diretta, pull request obbligatoria. La CI verde come controllo obbligatorio si aggiunge dopo l'unione di FON-T01, che crea il primo `ci.yml`: prima non c'è nessuna CI, e le pull request di FON-T07a, DOM-T01 e OPS-T03 non si potrebbero unire;
- un'identità per Claude che non può unire le pull request. Senza, un programma scritto apposta potrebbe spingere su `main` con le tue credenziali (`docs/due-postazioni.md`, «Limiti»);
- prima del primo rilascio `v*` (FON-T08), l'ambiente `production` di GitHub con l'approvazione obbligatoria, che crei tu: se manca, GitHub lo crea da solo al primo rilascio, senza approvazione;
- **il piano di GitHub, da decidere qui.** Dalla documentazione di GitHub (verificata l'8/11/2026): su un repository privato la protezione dei rami e gli ambienti chiedono un piano a pagamento (GitHub Pro per un account personale, o Team per un'organizzazione); l'approvazione obbligatoria di un ambiente, che FON-007 usa per `production`, su un repository privato c'è solo con GitHub Enterprise. Le strade sono tre:
  - (a) un repository pubblico: tutto senza costi, ma il codice lo vede chiunque (i segreti no, non stanno nel repository);
  - (b) GitHub Enterprise: tutto sul repository privato, con il costo del piano;
  - (c) Pro o Team, con un'altra approvazione per la produzione (per esempio un rilascio in produzione che lanci tu a mano): va cambiata la specifica di FON-007 e di FON-T08.

  Senza una di queste, FON-T08 non può provare FON-007. I prezzi si controllano sul sito di GitHub.

- joo: `INIZIA FON-T01`
- yoo: `INIZIA FON-T07a`

Il metodo completo (fasi e parole chiave) è in `docs/metodo.md`. Le parole chiave (`INIZIA <ID>`, `APPROVO`, `TORNA AI TEST`, `TORNA AL PIANO`, `TORNA AL CODICE`, `CHIUSO`, `ABBANDONA`) vanno scritte da sole sulla prima riga del messaggio.

Per cambiare gli hook, le corsie o le istruzioni: modificali tu, fai un commit su un ramo e apri una pull request. Finché i file sono diversi dal commit corrente, nessuna fase avanza. Dopo l'unione, Claude non può portare i file del metodo nuovi nella sua cartella: quando prova ad allinearsi (o a creare il ramo del compito successivo), l'hook lo ferma e ti indica il comando, che esegui tu nel tuo terminale.
