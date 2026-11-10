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
# Chi firma i commit: il nome e l'email dell'account GitHub di Claude (§8, passo 2), uguali sui due computer
git config --global user.name "Claude (gestionale)" && git config --global user.email "<email dell'account di Claude>"
# GitHub: accesso via HTTPS con l'ACCOUNT DI CLAUDE (§8, passo 2), non con il tuo; le credenziali servono anche
# agli hook, che fanno git fetch da soli.
# --insecure-storage: il token sta in un file leggibile solo da te (~/.config/gh/hosts.yml), non nel portachiavi
# del sistema, che i comandi di Claude, chiusi nella sandbox, non possono raggiungere.
gh auth login --git-protocol https --insecure-storage && gh auth setup-git
```

Dopo `usermod` esci dalla sessione e rientra, così Docker funziona senza `sudo`. Dopo FON-T01, su ogni computer: `pnpm exec playwright install --with-deps`, da ripetere a ogni aggiornamento di Playwright (le pull request automatiche delle dipendenze, da OPS-T09): i browser nuovi non li può installare Claude, perché nella sandbox non si può e nella gabbia non è ammesso, e l'hook glielo ricorda.

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

All'inizio di FON-T07a, finché l'utente `deploy` non esiste, al posto di `deploy` va l'utente che ti ha dato Hostinger: FON-T07a lo spiega in `infra/README.md`. Nello stesso compito Claude crea per te, prima di chiudere l'accesso di root via SSH, un utente amministrativo con `sudo` e la **tua** chiave (non quella di yoo: la coppia la generi tu prima del compito e la pubblica la dai a Claude, «Fuori da GitHub»): `deploy` non ha `sudo`, quindi da lì in poi è con quell'utente che installi i pacchetti dell'host e fai la manutenzione («Fuori da GitHub»).

**Solo su yoo, l'accesso a GHCR.** Le prime immagini le pubblica Claude a mano con `docker push` (l'immagine di prova di FON-T07a, Caddy in DOM-T02, PostgreSQL in OPS-T01a, l'app in FON-T07b). Prima di FON-T07a, nel tuo terminale: `docker login ghcr.io` con il tuo nome utente di GitHub e un token con il permesso `write:packages`. L'accesso resta in `~/.docker/config.json`: senza un programma che lo custodisca, Docker lo tiene lì solo codificato, non cifrato. Claude non lo legge: `settings.json` lo nega allo strumento Read e alla sandbox, la gabbia non lo vede, e gli hook non lasciano copiare né montare quella cartella ai comandi che girano fuori dalla sandbox; i comandi `docker` lo usano senza mostrarlo. Il login non lo può fare Claude al posto tuo (il token è un segreto, e `gh auth` è bloccato).

## 2. Il repository su GitHub, una volta sola, da joo

Prima servono due cose dal sito di GitHub, con il tuo account: l'account di Claude e il repository vuoto `gestionale-negozi`, con l'account di Claude fra i collaboratori (§8, passi 2 e 3). Lo zip contiene `gestionale-negozi.bundle`, il repository con la sua storia. Da joo, nel tuo terminale e non da Claude (l'hook gli rifiuta `git remote` e ogni spinta su `main`), con `gh` già collegato all'account di Claude (§1), nella cartella in cui hai estratto lo zip:

```bash
git clone -b main gestionale-negozi.bundle ~/gestionale-negozi
cd ~/gestionale-negozi
git remote remove origin
git remote add origin https://github.com/<tuo-utente>/gestionale-negozi.git
git push origin main
```

Questa spinta di `main` è l'unica che l'account di Claude farà: subito dopo, con il passo 4 di §8, `main` si chiude e la aggiorni solo tu, unendo le pull request con «Squash and merge».

## 3. Il clone, da yoo (dopo il passo 2)

```bash
gh repo clone <tuo-utente>/gestionale-negozi ~/gestionale-negozi    # anche qui gh è collegato all'account di Claude (§1)
```

## 4. Il nome della postazione, su ciascun computer

Nel tuo terminale, non da Claude, nella cartella del progetto, una volta sola. Il nome finisce fuori dal progetto, in `~/.local/state/gestionale-negozi/`, dove i comandi di Claude non possono cambiarlo. Lo script registra anche l'impronta della cartella `.git`: se un giorno gli hook dicono che «la cartella del repository non è quella registrata», guarda che cosa è successo (per esempio un nuovo clone nella stessa cartella) e rilancia lo stesso comando, con lo stesso nome.

```bash
bash .claude/hooks/imposta-postazione.sh joo    # sul computer joo
bash .claude/hooks/imposta-postazione.sh yoo    # sul computer yoo
```

## 5. Claude Code

Apri la cartella `~/gestionale-negozi` in VS Code, avvia Claude Code e scrivi `/hooks`: devi vedere SessionStart, UserPromptSubmit, PreToolUse, Stop e WorktreeCreate. All'apertura Claude deve ricevere il messaggio «[Metodo] Postazione joo» (o yoo).

I comandi che girano fuori dalla sandbox (Docker, `ssh`, `scp`, `rsync` e la gabbia, `bash .claude/hooks/gabbia.sh …`) passano dal normale permesso di Claude Code: se te lo chiede, guarda il comando prima di dire sì. Per la gabbia puoi rispondere «sì, sempre»; per Docker e i server conviene guardarli ogni volta.

**Il modello.** Il kit fissa in `.claude/settings.json` il modello Opus 5.5 (`claude-opus-5-5`) per tutte e due le postazioni: è il modello più capace della famiglia, e quello con cui il kit è stato costruito e collaudato. Se una sessione raggiunge il limite del piano, con `/model` scegli per quella sessione Fable 5.1, l'altro modello di punta; Sonnet e Haiku non si usano per il codice del progetto. Due postazioni che lavorano insieme consumano il doppio: tieni d'occhio il limite settimanale del piano, perché quando si raggiunge il lavoro si ferma fino all'azzeramento.

## 6. Prova, prima di lavorare

Gli hook sono stati collaudati in una simulazione, e la sandbox esiste solo su Linux: questa prova verifica tutto su Ubuntu. Chiedi a Claude di eseguire i comandi, uno alla volta, e confronta la risposta.

- Scrivi `/model`: deve dire Opus 5.5 (`claude-opus-5-5`), il modello fissato dal kit. Se Claude Code non riconosce quel nome, fermati: il nome va corretto in `.claude/settings.json`.
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
- Le credenziali del computer. Crea tu, nel tuo terminale, due file di prova: `mkdir -p ~/.ssh ~/.docker && echo CREDENZIALE_DI_PROVA > ~/.ssh/prova-sandbox && echo CREDENZIALE_DI_PROVA > ~/.docker/prova-sandbox`. Poi chiedi a Claude `python3 -c "import os; print(open(os.path.expanduser('~/.ss'+'h/prova-sandbox')).read())"`, lo stesso con `'~/.doc'+'ker/prova-sandbox'`, e di aprire `~/.ssh/prova-sandbox` con lo strumento Read: nessuno dei tre deve mostrare la riga (permesso negato). Poi cancella tu i due file: `rm ~/.ssh/prova-sandbox ~/.docker/prova-sandbox`.
- `git fetch origin` e `gh pr list`: devono **funzionare** dalla sandbox. Se non funzionano, fermati e non aggiungere git o gh agli `excludedCommands`: fuori dalla sandbox git potrebbe riscrivere i file del metodo. Di solito manca il passo `gh auth login --insecure-storage`.
- `bash .claude/hooks/gabbia.sh --prova`: tutte le righe devono cominciare con «ok». Se una dice «ERRORE», o se la gabbia non parte, fermati (di solito è il profilo AppArmor del passo 1).
- Dopo FON-T03, con i file di ambiente locali creati da te copiando i cinque esempi («Fuori da GitHub»), `docker compose -f infra/compose.dev.yml up -d` deve funzionare e, con il database avviato, `bash .claude/hooks/gabbia.sh test:int` deve raggiungerlo. Se un comando che serve ogni giorno non funziona, fermati e chiedi: non si aggiunge nulla agli `excludedCommands` senza averlo ragionato.
- La conferma per `prod` la vedrai al primo comando verso la produzione, dentro FON-T07a: Claude Code deve chiederti il permesso.

Se una delle risposte è diversa, fermati e non iniziare compiti.

## 7. Account esterni

- **Stripe:** una sandbox per ogni computer di sviluppo («sviluppo-joo» e «sviluppo-yoo»), più quella del server di test e la produzione. Ognuna ha le sue chiavi (`docs/due-postazioni.md`, «Stripe»). Quelle dei due server servono già in FON-T07b, quando scrivi tu nei file di ambiente dei server la chiave `sk_test_` vera; quelle di sviluppo a BIL-T01 (yoo) e a BIL-T02 (joo), scritte da te in `STRIPE_SECRET_KEY` di `.env.test` di quel computer («Fuori da GitHub»; 01 §CI/CD). La **Stripe CLI** non serve ai compiti: le prove automatiche, compreso l'end-to-end del Checkout di BIL-T06, consegnano da sé gli eventi di Stripe al server avviato dal test (01 §CI/CD), su joo e su yoo. Installala (https://docs.stripe.com/stripe-cli) e collegala con `stripe login` alla sandbox di sviluppo di quel computer solo per una prova a mano con i webhook sul server di sviluppo: la lanci tu nel tuo terminale con `stripe listen --forward-to localhost:<porta del server di sviluppo>/api/webhooks/stripe`, e per quella prova scrivi il segreto `whsec_…` che stampa in `STRIPE_WEBHOOK_SECRET` di `.env.app`. Claude non la usa, e né la sandbox né la gabbia vedono le sue credenziali (`~/.config/stripe`). Gli endpoint dei webhook delle sandbox dei due server li registri tu nel Dashboard, dopo l'unione di BIL-T02 (`docs/due-postazioni.md`, «Stripe»).
- **I segreti** (chiavi Stripe, Cloudflare, S3, password dei server) non passano mai da git, dallo zip o dalla chat: si copiano da un computer all'altro con il gestore di password. I segreti di GitHub (Actions) e i file di ambiente dei server li scrivi tu.

## 8. Il collegamento a GitHub, passo per passo

Tutto dal sito di GitHub, con il tuo account, prima del primo compito. Le due postazioni lavorano nello stesso momento perché ciascuna spinge solo i propri rami e apre pull request: su `main` arriva soltanto ciò che unisci tu (`docs/due-postazioni.md`, «Perché le postazioni non si sovrappongono»).

1. **Il piano di GitHub, da decidere per primo.** Dalla documentazione di GitHub (verificata l'8/11/2026): su un repository privato la protezione dei rami e gli ambienti chiedono un piano a pagamento (GitHub Pro per un account personale, o Team per un'organizzazione); l'approvazione obbligatoria di un ambiente, che FON-007 usa per `production`, su un repository privato c'è solo con GitHub Enterprise. Le strade sono tre:
   - (a) un repository pubblico: tutto senza costi, ma il codice lo vede chiunque (i segreti no, non stanno nel repository);
   - (b) GitHub Enterprise: tutto sul repository privato, con il costo del piano;
   - (c) Pro o Team, con un'altra approvazione per la produzione (per esempio un rilascio in produzione che lanci tu a mano): va cambiata la specifica di FON-007 e di FON-T08.

   Enterprise e Team sono piani per le organizzazioni: con (b), o con Team nella (c), il repository nasce dentro un'organizzazione, prima di FON-T07a, che pubblica la prima immagine, e i nomi delle immagini diventano `ghcr.io/<organizzazione>/…` (`specs/01-fondamenta.md`, i servizi Docker Compose). Senza una di queste strade, FON-T08 non può provare né FON-005 (la CI che blocca l'unione) né FON-007. I prezzi si controllano sul sito di GitHub.
2. **Un account GitHub per Claude.** Crea un secondo account (per esempio `claude-<tuo-nome>`), con un'email tua e la verifica in due passaggi. È l'account che i due computer usano con `gh` e `git` (§1): così ciò che fa Claude, rami, pull request, variabili, avvii a mano, porta il suo nome, e tu resti l'unico che aggiorna `main`. Tu, sul sito, continui a usare il tuo account.
3. **Il repository.** Con il tuo account: «New repository», nome `gestionale-negozi`, privato (o pubblico, strada (a)), senza README, licenza né `.gitignore`. Poi Settings → Collaborators → «Add people»: l'account di Claude (in un repository personale i collaboratori hanno il permesso di scrittura). Accetta l'invito entrando nel sito come l'account di Claude, in una finestra privata del browser. Poi il passo §2.
4. **La regola su `main`.** Settings → Rules → Rulesets → «New ruleset» → «New branch ruleset»:
   - nome `main`, Enforcement status «Active»;
   - Bypass list → «Add bypass» → il ruolo «Repository admin», cioè tu;
   - Target branches → «Add target» → «Include default branch»;
   - Rules: «Restrict deletions»; «Block force pushes»; «Require a pull request before merging» (approvazioni richieste 0, perché a unire sei tu); «Restrict updates», così solo chi è nella bypass list aggiorna `main`: l'account di Claude può spingere i suoi rami e aprire pull request, ma non unirle né spingere su `main`; «Require status checks to pass», che si compila dopo FON-T01 (passo 9), con «Require branches to be up to date before merging», così la CI ha girato sullo stato che unisci. Con questa opzione una pull request aperta diventa «out-of-date» appena `main` va avanti: non premere «Update branch», perché il ramo locale della postazione resterebbe indietro e l'hook non le lascerebbe riallinearlo; chiedi invece a quella postazione di rilanciare `/chiudi-compito`, che si riallinea con `git merge --no-edit origin/main` e spinge. Se l'hai premuto per sbaglio, nel terminale di quella postazione: prima `git fetch origin` (gli hook aggiornano da soli solo `origin/main`: senza il fetch `origin/<ramo>` è ancora quello vecchio e il merge direbbe «Already up to date»), poi `git merge --ff-only origin/<ramo>`; se intanto il ramo locale ha commit nuovi (per esempio dopo `TORNA AL CODICE`), `git merge --no-edit origin/<ramo>`, perché senza quell'unione `git push` sarebbe rifiutato.
   - Controlla subito che regga: entra nel sito come l'account di Claude, apri una pull request di prova da un ramo (una riga in un file di `docs/`) e verifica che per quell'account il pulsante di unione sia bloccato; poi chiudila. Se invece l'account di Claude potesse unire, aggiungi a «Require a pull request before merging» un'approvazione richiesta con «Require review from Code Owners», e un file `.github/CODEOWNERS` con la riga `* @<tuo-utente>`, che commetti tu: così senza la tua approvazione nessuno unisce.
5. **Le impostazioni generali.** Settings → General → Pull Requests: lascia attivo solo «Allow squash merging» (togli «Allow merge commits» e «Allow rebase merging»), e attiva «Automatically delete head branches». Il metodo unisce sempre con «Squash and merge», e il ramo di un compito già unito deve potersi ricreare con lo stesso nome (una prova in produzione che fallisce, una correzione dopo l'unione): se il ramo remoto restasse, la spinta non sarebbe un avanzamento rapido, e forzarla non è permesso.
6. **Actions.** Settings → Actions → General: permetti le azioni («Allow all actions and reusable workflows», o almeno quelle di GitHub e dei creatori verificati); Workflow permissions su «Read repository contents and packages permissions»: i flussi dichiarano da sé i permessi che gli servono. I segreti dei flussi (la chiave SSH di rilascio, `KNOWN_HOSTS`, gli altri che la pull request di FON-T08 elenca) li scrivi tu in Settings → Secrets and variables → Actions → Secrets, prima dell'unione di FON-T08; la variabile `TEST_DEPLOY_HOLD` la crea Claude dentro FON-T08 (un collaboratore può). I segreti di prova per i rami `prova-*` di FON-T08 li crei quando la pull request li nomina.
7. **I pacchetti (GHCR).** Prima di iniziare FON-T08, nelle impostazioni dei tre pacchetti su GitHub (Caddy, PostgreSQL e app, pubblicati a mano da DOM-T02, OPS-T01a e FON-T07b) il repository deve avere l'accesso dei flussi in scrittura. È automatico se il Dockerfile aveva già la label del repository alla prima pubblicazione (`docs/due-postazioni.md`, «Regole di struttura»); altrimenti lo dai tu, nella pagina del pacchetto, «Package settings» → «Manage Actions access». Senza, le prove di FON-T08 e poi i rilasci automatici non riescono a pubblicare le immagini.
8. **L'ambiente `production`.** Prima del primo rilascio `v*` (FON-T08): Settings → Environments → «New environment» → `production` → «Required reviewers»: tu. Se manca, GitHub lo crea da solo al primo rilascio, senza approvazione. Con la strada (c) segui invece ciò che è stato deciso per FON-007.
9. **I controlli obbligatori.** Dopo l'unione di FON-T01, che crea il primo `ci.yml` (prima non c'è nessuna CI, e le pull request di FON-T07a, DOM-T01 e OPS-T03 non si potrebbero unire): apri la regola `main` → «Require status checks to pass» → «Add checks» → il nome del job di `ci.yml`. GitHub sceglie i controlli per nome del job; i compiti successivi mettono i loro controlli in quel job, senza cambiargli nome. Quando un compito aggiunge un job nuovo (per esempio il clone pulito di FON-T08), la sua pull request te lo indica e tu lo aggiungi dopo l'unione.
10. **Dependabot.** Prima di OPS-T09: Settings → Code security → «Dependabot security updates» attivo, così una correzione di sicurezza arriva anche prima che OPS-T09 sia unito (`docs/due-postazioni.md`, «Pull request automatiche delle dipendenze»). Dopo l'unione di OPS-T09, se la prima scansione non parte da sé, la lanci tu da Insights → Dependency graph → Dependabot → «Check for updates»: la chiusura del compito aspetta quella scansione riuscita, non la prima pull request, che arriva solo quando c'è qualcosa da aggiornare.

**Fuori da GitHub**, da avere prima del compito che li usa:
- i due server Ubuntu su Hostinger (test e produzione), con gli indirizzi in `~/.ssh/config` di yoo (§1): prima di FON-T07a;
- `docker login ghcr.io` su yoo (§1): prima di FON-T07a;
- le due coppie di chiavi SSH di rilascio (una per server), generate da te nel tuo terminale con `ssh-keygen -t ed25519 -f ~/.ssh/<nome>`, mai da Claude: prima di FON-T07a, che mette la chiave pubblica in `authorized_keys` di `deploy` con il comando forzato (01 §Rilascio; le pubbliche le dai a Claude come al punto qui sotto); la chiave privata la scrivi nei segreti dei flussi prima dell'unione di FON-T08 (§8 passo 6) e nella copia fuori linea dei segreti (OPS-009);
- la tua coppia di chiavi SSH personale, generata da te nel tuo terminale con `ssh-keygen -t ed25519`: prima di FON-T07a, che mette la pubblica in `authorized_keys` del tuo utente amministrativo (§1). Le chiavi pubbliche che servono a Claude su yoo in FON-T07a (la tua, le due di rilascio e quella di yoo, con cui Claude entra nei server) gliele dai incollandole in chat, oppure copiandole in una cartella fuori dal progetto e fuori da `~/.ssh` (`mkdir -p ~/chiavi-pubbliche && cp ~/.ssh/<nome>.pub ~/chiavi-pubbliche/`): le pubbliche non sono segreti, ma Claude non legge `~/.ssh` (`docs/due-postazioni.md`, «Protezione del metodo»). Le private restano in `~/.ssh`;
- i file di ambiente locali di ciascun computer (`.env.app`, `.env.worker`, `.env.migrate`, `.env.test`, `.env.test.owner`), che crei tu copiando i cinque esempi (`cp .env.app.example .env.app`, e così gli altri) e aggiorni a ogni variabile nuova e a ogni valore di sviluppo cambiato negli esempi, che la pull request dice (`docs/due-postazioni.md`, «Variabili e valori dei server»): su joo all'inizio di FON-T03, prima della sua fase test (gli esempi esistono da FON-T01), e di nuovo nella sua fase codice, quando Claude ti dice che `compose.dev.yml` e gli esempi sono pronti, perché le password di sviluppo e l'emulatore S3 li fissa FON-T03 (01); su yoo quando unisci FON-T03, insieme all'allineamento, prima di NEG-T04; la chiave `sk_test_` della sandbox di sviluppo di quel computer la scrivi in `STRIPE_SECRET_KEY` di `.env.test` prima di BIL-T01 su yoo e di BIL-T02 su joo (§7, 01 §CI/CD);
- i due domini (`{{DOMINIO}}` e `{{DOMINIO_TEST}}`) su Cloudflare, come due zone, con un token API per zona e l'Email Routing per l'indirizzo DMARC (06, DOM-T01): prima di DOM-T01;
- Brevo, con i due domini aggiunti (`{{DOMINIO}}` e `{{DOMINIO_TEST}}`: anche il server di test invia email vere, 06 §DNS), i mittenti e il DKIM creati (il selettore DKIM lo dà Brevo, e DOM-T01 lo scrive nelle due zone): prima di DOM-T01;
- l'account per l'archivio S3 dei backup (Hetzner, oppure Scaleway secondo il [VERIFICA] di OPS-T03): prima di OPS-T03; in OPS-T03 lanci tu dal tuo terminale `infra/scripts/check-bucket-isolation.sh`, con le chiavi di tutte le unità lette dal gestore di password, perché Claude non può averle e nessun server le ha tutte; Claude scrive l'esito in `docs/verifiche/ops-t03-esito.md`;
- una VPS usa e getta nel data center UE per la prova di ripristino (OPS-004), che crei e distruggi a ogni prova, con credenziali S3 di sola lettura sul bucket dei backup di produzione che crei tu nella console del fornitore per la prova e revochi alla fine (nel gestore di password finché servono): la prima volta in OPS-T01b, poi in COL-T01 (C14; e C23, la ricostruzione completa, su un'altra VPS vuota, nella forma di prova di 08 OPS-046 che non tocca la produzione: DNS invariato, Let's Encrypt di prova, archiviazione dei WAL spenta, worker fermo) e ogni mese; i comandi sulla VPS li esegui tu dal tuo terminale, perché Claude raggiunge con `ssh` solo i server `test` e `prod` e le credenziali temporanee sono segreti: Claude ti detta la lista di controllo, lancia su `test` il controllo dello specchio (`check-mirror-sync.sh`) e su `prod` i comandi `ops:*` della lista, e scrive l'esito;
- sull'host del server di test, `rclone` (prima delle prove di OPS-T01b) e `k6` (prima di C19, in COL-T01): pacchetti ufficiali, con la versione che Claude fissa in `infra/README.md`; li installi tu dal tuo terminale, con il tuo utente amministrativo (§1: quello che FON-T07a crea per te, con `sudo` e la tua chiave), perché servono i permessi di root e l'utente `deploy`, con cui Claude raggiunge i server, non ha `sudo` (FON-T07a); Claude controlla la versione con `ssh test rclone version` e `ssh test k6 version`. Prima di C19, sempre sul server di test, crei dal pannello un negozio di prova `is_test` con un utente di carico e il suo TOTP, e scrivi email, password e segreto TOTP in `/srv/app/env/load-test.env` (permessi 600, proprietario `deploy`): lo script k6 lo legge da sé ed entra una volta sola (09, C19); l'invito all'utente di carico arriva per email, perché il server di test invia email vere (06 §DNS); alla fine togli il file;
- il tuo utente amministratore del pannello sui due server (07 ADM-011), senza il quale dal pannello non si crea nulla: dopo l'unione di ADM-T01, sul server di test appena il rilascio di `main` lo contiene e in produzione con il primo rilascio `v*` che lo contiene (al più tardi prima di C01), dal server con il tuo utente amministrativo: `sudo -u deploy /srv/app/dc run --rm migrate node dist/cli.js admin:grant <la tua email>`, poi apri entro 30 minuti il link che stampa e registri la passkey. Lo fai tu, non Claude, perché il link è una credenziale e non passa dalla chat; serve prima del negozio di prova di C19 su test e di C01 in produzione (09, COL-T01);
- Stripe (§7): le sandbox del server di test e di produzione prima di FON-T07b; la sandbox di sviluppo di yoo prima di BIL-T01, quella di joo prima di BIL-T02; la Stripe CLI solo se vuoi fare una prova a mano con i webhook sul server di sviluppo (§7);
- Sentry e il servizio di controllo esterno (OPS-011: interroga i siti ogni minuto e manda gli avvisi sul telefono): prima di OPS-T04; il fornitore SDI, nella sua sandbox: prima di BIL-T11;
- per le prove automatiche del collaudo (09, introduzione), prima della fase codice di COL-T01: una casella di posta di prova che i test leggono via IMAP (per esempio un account dedicato che accetti gli indirizzi `+etichetta`), con server, utente e password per le applicazioni che scrivi tu in `.env.collaudo` su yoo (`COLLAUDO_IMAP_HOST`, `COLLAUDO_IMAP_USER`, `COLLAUDO_IMAP_PASSWORD`), un file che Claude non legge; e, subito prima di lanciare le prove, la sessione del tuo utente amministratore del pannello di produzione, che salvi dal tuo terminale su yoo con `pnpm exec playwright open --save-storage=playwright/.auth/admin.json https://admin.{{DOMINIO}}` (entri con la tua passkey e chiudi il browser), perché il pannello chiede la passkey e solo tu ce l'hai (07 ADM-001);
- il gestore di password dove stanno tutti i segreti (§7).

## 9. Si parte

Quando le sezioni da 1 a 7 e i passi da 1 a 6 di §8 sono fatti, regola su `main` verificata compresa (i passi 7, 8, 9 e 10 di §8 arrivano con i compiti indicati). Le tue pull request del metodo (hook, corsie, istruzioni, `CODEOWNERS`) uniscile quando nessuna pull request di compito è aperta: con «Require branches to be up to date» un'unione rende non aggiornate le pull request aperte.

- joo: `INIZIA FON-T01`
- yoo: `INIZIA FON-T07a`

Il metodo completo (fasi e parole chiave) è in `docs/metodo.md`. Le parole chiave (`INIZIA <ID>`, `APPROVO`, `TORNA AI TEST`, `TORNA AL PIANO`, `TORNA AL CODICE`, `CHIUSO`, `ABBANDONA`) vanno scritte da sole sulla prima riga del messaggio.

Per cambiare gli hook, le corsie o le istruzioni: modificali tu, fai un commit su un ramo e apri una pull request. Finché i file sono diversi dal commit corrente, nessuna fase avanza. Dopo l'unione, Claude non può portare i file del metodo nuovi nella sua cartella: quando prova ad allinearsi (o a creare il ramo del compito successivo), l'hook lo ferma e ti indica il comando, che esegui tu nel tuo terminale.
