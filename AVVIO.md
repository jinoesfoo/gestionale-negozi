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

**Solo su yoo, l'accesso a GHCR.** Le prime immagini le pubblica Claude a mano con `docker push` (l'immagine di prova di FON-T07a, Caddy in DOM-T02, PostgreSQL in OPS-T01a, l'app in FON-T07b). Prima di FON-T07a, nel tuo terminale: `docker login ghcr.io` con il tuo nome utente di GitHub e un token con il permesso `write:packages`. L'accesso resta nel portachiavi di Docker, che la gabbia non vede; Claude non lo tocca e non lo può fare al posto tuo (il token è un segreto, e `gh auth` è bloccato).

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

Apri la cartella `~/gestionale-negozi` in VS Code, avvia Claude Code e scrivi `/hooks`: devi vedere SessionStart, UserPromptSubmit, PreToolUse e Stop. All'apertura Claude deve ricevere il messaggio «[Metodo] Postazione joo» (o yoo).

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
- `git fetch origin` e `gh pr list`: devono **funzionare** dalla sandbox. Se non funzionano, fermati e non aggiungere git o gh agli `excludedCommands`: fuori dalla sandbox git potrebbe riscrivere i file del metodo. Di solito manca il passo `gh auth login --insecure-storage`.
- `bash .claude/hooks/gabbia.sh --prova`: tutte le righe devono cominciare con «ok». Se una dice «ERRORE», o se la gabbia non parte, fermati (di solito è il profilo AppArmor del passo 1).
- Dopo FON-T03, `docker compose -f infra/compose.dev.yml up -d` deve funzionare e, con il database avviato, `bash .claude/hooks/gabbia.sh test:int` deve raggiungerlo. Se un comando che serve ogni giorno non funziona, fermati e chiedi: non si aggiunge nulla agli `excludedCommands` senza averlo ragionato.
- La conferma per `prod` la vedrai al primo comando verso la produzione, dentro FON-T07a: Claude Code deve chiederti il permesso.

Se una delle risposte è diversa, fermati e non iniziare compiti.

## 7. Account esterni

- **Stripe:** una sandbox per ogni computer di sviluppo («sviluppo-joo» e «sviluppo-yoo»), più quella del server di test e la produzione. Ognuna ha le sue chiavi (`docs/due-postazioni.md`, «Stripe»). Quelle dei due server servono già a FON-T07b, che scrive nei server una chiave `sk_test_` vera; quelle di sviluppo a BIL-T01 (yoo) e a BIL-T02 (joo). La **Stripe CLI** va installata su tutti e due i computer (https://docs.stripe.com/stripe-cli) e collegata con `stripe login` alla sandbox di sviluppo di quel computer. Quando una prova ha bisogno dei webhook sul server di sviluppo (il checkout end-to-end di BIL-T06, una prova a mano), la lanci tu nel tuo terminale con `stripe listen --forward-to localhost:<porta del server di sviluppo>/api/webhooks/stripe`, e il segreto `whsec_…` che stampa lo scrivi tu in `STRIPE_WEBHOOK_SECRET` dei file di ambiente locali; Claude non la usa, e la gabbia non vede le sue credenziali (`~/.config/stripe`). Gli endpoint dei webhook delle sandbox dei due server li registri tu nel Dashboard, dopo l'unione di BIL-T02 (`docs/due-postazioni.md`, «Stripe»).
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
   - Rules: «Restrict deletions»; «Block force pushes»; «Require a pull request before merging» (approvazioni richieste 0, perché a unire sei tu); «Restrict updates», così solo chi è nella bypass list aggiorna `main`: l'account di Claude può spingere i suoi rami e aprire pull request, ma non unirle né spingere su `main`; «Require status checks to pass», che si compila dopo FON-T01 (passo 9), con «Require branches to be up to date before merging», così la CI ha girato sullo stato che unisci. Con questa opzione una pull request aperta diventa «out-of-date» appena `main` va avanti: non premere «Update branch», perché il ramo locale della postazione resterebbe indietro e l'hook non le lascerebbe riallinearlo; chiedi invece a quella postazione di rilanciare `/chiudi-compito`, che si riallinea con `git merge --no-edit origin/main` e spinge. Se l'hai premuto per sbaglio, nel terminale di quella postazione: `git merge --ff-only origin/<ramo>`; se intanto il ramo locale ha commit nuovi (per esempio dopo `TORNA AL CODICE`), `git merge --no-edit origin/<ramo>`, perché senza quell'unione `git push` sarebbe rifiutato.
   - Controlla subito che regga: entra nel sito come l'account di Claude, apri una pull request di prova da un ramo (una riga in un file di `docs/`) e verifica che per quell'account il pulsante di unione sia bloccato; poi chiudila. Se invece l'account di Claude potesse unire, aggiungi a «Require a pull request before merging» un'approvazione richiesta con «Require review from Code Owners», e un file `.github/CODEOWNERS` con la riga `* @<tuo-utente>`, che commetti tu: così senza la tua approvazione nessuno unisce.
5. **Le impostazioni generali.** Settings → General → Pull Requests: lascia attivo solo «Allow squash merging» (togli «Allow merge commits» e «Allow rebase merging»), e attiva «Automatically delete head branches». Il metodo unisce sempre con «Squash and merge», e il ramo di un compito già unito deve potersi ricreare con lo stesso nome (una prova in produzione che fallisce, una correzione dopo l'unione): se il ramo remoto restasse, la spinta non sarebbe un avanzamento rapido, e forzarla non è permesso.
6. **Actions.** Settings → Actions → General: permetti le azioni («Allow all actions and reusable workflows», o almeno quelle di GitHub e dei creatori verificati); Workflow permissions su «Read repository contents and packages permissions»: i flussi dichiarano da sé i permessi che gli servono. I segreti dei flussi (la chiave SSH di rilascio, `KNOWN_HOSTS`, gli altri che la pull request di FON-T08 elenca) li scrivi tu in Settings → Secrets and variables → Actions → Secrets, prima dell'unione di FON-T08; la variabile `TEST_DEPLOY_HOLD` la crea Claude dentro FON-T08 (un collaboratore può). I segreti di prova per i rami `prova-*` di FON-T08 li crei quando la pull request li nomina.
7. **I pacchetti (GHCR).** Prima di iniziare FON-T08, nelle impostazioni dei tre pacchetti su GitHub (Caddy, PostgreSQL e app, pubblicati a mano da DOM-T02, OPS-T01a e FON-T07b) il repository deve avere l'accesso dei flussi in scrittura. È automatico se il Dockerfile aveva già la label del repository alla prima pubblicazione (`docs/due-postazioni.md`, «Regole di struttura»); altrimenti lo dai tu, nella pagina del pacchetto, «Package settings» → «Manage Actions access». Senza, le prove di FON-T08 e poi i rilasci automatici non riescono a pubblicare le immagini.
8. **L'ambiente `production`.** Prima del primo rilascio `v*` (FON-T08): Settings → Environments → «New environment» → `production` → «Required reviewers»: tu. Se manca, GitHub lo crea da solo al primo rilascio, senza approvazione. Con la strada (c) segui invece ciò che è stato deciso per FON-007.
9. **I controlli obbligatori.** Dopo l'unione di FON-T01, che crea il primo `ci.yml` (prima non c'è nessuna CI, e le pull request di FON-T07a, DOM-T01 e OPS-T03 non si potrebbero unire): apri la regola `main` → «Require status checks to pass» → «Add checks» → il nome del job di `ci.yml`. GitHub sceglie i controlli per nome del job; i compiti successivi mettono i loro controlli in quel job, senza cambiargli nome. Quando un compito aggiunge un job nuovo (per esempio il clone pulito di FON-T08), la sua pull request te lo indica e tu lo aggiungi dopo l'unione.
10. **Dependabot.** Prima di OPS-T09: Settings → Code security → «Dependabot security updates» attivo, così una correzione di sicurezza arriva anche prima che OPS-T09 sia unito (`docs/due-postazioni.md`, «Pull request automatiche delle dipendenze»).

**Fuori da GitHub**, da avere prima del compito che li usa:
- i due server Ubuntu su Hostinger (test e produzione), con gli indirizzi in `~/.ssh/config` di yoo (§1): prima di FON-T07a;
- `docker login ghcr.io` su yoo (§1): prima di FON-T07a;
- i due domini (`{{DOMINIO}}` e `{{DOMINIO_TEST}}`) su Cloudflare, come due zone, con un token API per zona e l'Email Routing per l'indirizzo DMARC (06, DOM-T01): prima di DOM-T01;
- Brevo, con il dominio aggiunto, il mittente e il DKIM creati (il selettore DKIM lo dà Brevo, e DOM-T01 lo scrive nel DNS): prima di DOM-T01;
- l'account per l'archivio S3 dei backup (Hetzner, oppure Scaleway secondo il [VERIFICA] di OPS-T03): prima di OPS-T03;
- una VPS usa e getta nel data center UE per la prova di ripristino (OPS-004), che crei e distruggi a ogni prova, con credenziali S3 di sola lettura sul bucket dei backup di produzione create per la prova e revocate alla fine: la prima volta in OPS-T01b, poi in COL-T01 (C14; e C23, la ricostruzione completa, su un'altra VPS vuota) e ogni mese;
- Stripe (§7): le sandbox del server di test e di produzione prima di FON-T07b; la sandbox di sviluppo di yoo prima di BIL-T01, quella di joo prima di BIL-T02; la Stripe CLI collegata su joo prima di BIL-T06 (su yoo quando serve);
- Sentry e il servizio di controllo esterno (OPS-011: interroga i siti ogni minuto e manda gli avvisi sul telefono): prima di OPS-T04; il fornitore SDI, nella sua sandbox: prima di BIL-T11;
- il gestore di password dove stanno tutti i segreti (§7).

## 9. Si parte

Quando le sezioni da 1 a 7 e i passi da 1 a 6 di §8 sono fatti, regola su `main` verificata compresa (i passi 7, 8, 9 e 10 di §8 arrivano con i compiti indicati). Le tue pull request del metodo (hook, corsie, istruzioni, `CODEOWNERS`) uniscile quando nessuna pull request di compito è aperta: con «Require branches to be up to date» un'unione rende non aggiornate le pull request aperte.

- joo: `INIZIA FON-T01`
- yoo: `INIZIA FON-T07a`

Il metodo completo (fasi e parole chiave) è in `docs/metodo.md`. Le parole chiave (`INIZIA <ID>`, `APPROVO`, `TORNA AI TEST`, `TORNA AL PIANO`, `TORNA AL CODICE`, `CHIUSO`, `ABBANDONA`) vanno scritte da sole sulla prima riga del messaggio.

Per cambiare gli hook, le corsie o le istruzioni: modificali tu, fai un commit su un ramo e apri una pull request. Finché i file sono diversi dal commit corrente, nessuna fase avanza. Dopo l'unione, Claude non può portare i file del metodo nuovi nella sua cartella: quando prova ad allinearsi (o a creare il ramo del compito successivo), l'hook lo ferma e ti indica il comando, che esegui tu nel tuo terminale.
