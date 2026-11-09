# Istruzioni per Claude Code

Progetto: piattaforma SaaS multi-negozio (gestionale, moduli e siti per negozi indipendenti). Lingua dell'interfaccia e delle risposte all'utente: italiano. Lingua del codice: inglese.

## 1. Metodo di lavoro obbligatorio

Ogni modifica al codice avviene dentro un **compito** delle specifiche (`specs/`), che attraversa cinque fasi in ordine. Il tuo compito, oltre a scrivere codice, è **guidare l'utente** attraverso le fasi e non saltarne nessuna.

La fase corrente sta nella cartella di stato degli hook, fuori dal progetto: la vedi nel messaggio `[Metodo]` che gli hook aggiungono a ogni messaggio dell'utente, oppure con `bash .claude/hooks/mostra-stato.sh`. **Tienine conto in ogni risposta.** Non puoi modificarla: lo cambiano solo le parole chiave che scrive l'utente (vedi tabella). Gli hook in `.claude/hooks/` bloccano le azioni non permesse nella fase corrente: se un'azione viene bloccata, non cercare di aggirare il blocco, spiega all'utente cosa serve per proseguire.

| Fase | Cosa fai | Cosa NON puoi fare | Per passare alla fase successiva l'utente scrive |
|---|---|---|---|
| nessun compito | Proponi il prossimo compito di questa postazione secondo `.claude/hooks/corsie.txt` (usa `/stato`) | Modificare codice, test, migrazioni, infrastruttura | `INIZIA <ID>` (es. `INIZIA FON-T01`) |
| `piano` | Leggi `specs/00-costituzione.md` e **tutta** l'area del compito. Scrivi un piano: requisiti coperti, file da creare o modificare, test da scrivere, punti [VERIFICA] da controllare, dubbi e ambiguità della specifica. Per controllare i punti [VERIFICA] puoi installare le dipendenze (`pnpm add`) e leggerne la documentazione o il codice in `node_modules`, annotando l'esito nella specifica. Poi fermati e chiedi l'approvazione. | Modificare file fuori da `specs/` e `docs/` (le dipendenze installate restano) | `APPROVO` |
| `test` | Scrivi i test dai criteri di accettazione (ogni test porta l'ID del requisito nel nome) e la configurazione dei controlli che serve (tsconfig, Vitest, Playwright, ESLint, `.npmrc`, `ci.yml`, script di `package.json` dei controlli). Eseguili e mostra all'utente che **falliscono** per il motivo giusto (funzione mancante, non errore di sintassi). Poi fermati. | Modificare codice applicativo (`src/`, `drizzle/`, `infra/` tranne gli script di controllo) | `APPROVO`, oppure `TORNA AL PIANO` |
| `codice` | Scrivi il codice minimo per far passare i test. Esegui lint, typecheck e test finché sono verdi. Se un test ti sembra sbagliato rispetto alla specifica, **fermati e chiedilo**: non modificarlo. | Modificare i test e la configurazione dei controlli (restano fermi dall'`APPROVO` della fase test) | `APPROVO` (dopo che i controlli sono verdi), `TORNA AI TEST` oppure `TORNA AL PIANO` |
| `revisione` | Esegui `/revisione`: un revisore indipendente legge le modifiche. Riporta all'utente i problemi trovati e correggili (le correzioni al codice sono permesse; ai test solo dopo `TORNA AI TEST`). | Chiudere il compito con problemi critici o alti aperti | `APPROVO`, `TORNA AI TEST` oppure `TORNA AL PIANO` |
| `chiusura` | Esegui `/chiudi-compito`: allineamento a main, controlli completi, casella spuntata nella specifica, commit e pull request. | Spingere su `main`, unire la pull request (la unisce l'utente); modificare file fuori da `specs/` e `docs/` | `CHIUSO` (dopo che l'utente ha unito la pull request: l'hook lo accetta solo quando il compito è su main), oppure `TORNA AL CODICE` (CI rossa, conflitto con main) |

In ogni fase l'utente può scrivere `ABBANDONA`: il compito si chiude senza essere completato e le modifiche restano nella cartella di lavoro.

Regole di comportamento:
- **Ad ogni fermata** di fine fase scrivi in fondo alla risposta, in grassetto, cosa deve scrivere l'utente per proseguire, e cosa deve controllare prima (es. "leggi il piano", "guarda che i test falliscano", "leggi le differenze").
- Non dichiarare mai una fase completata se un controllo non è passato. Riporta l'esito reale dei comandi.
- Se l'utente chiede una modifica fuori da un compito, proponi di aprire un compito (anche piccolo, aggiungendolo alla specifica) invece di modificare il codice direttamente.
- Se una specifica è ambigua, contraddittoria o sbagliata: fermati, spiega il problema e proponi la correzione della specifica. Non inventare il comportamento. Le note sugli esiti dei [VERIFICA] e le correzioni di dettaglio si possono scrivere nella specifica in qualsiasi fase; se la correzione cambia un requisito o il piano, chiedi all'utente di scrivere `TORNA AL PIANO` e rifai il piano.
- Compiti senza test automatici (configurazione dei server, DNS, verifiche manuali): nella fase `test` scrivi la lista di controllo con l'esito atteso in `docs/verifiche/<id>.md` (oppure uno script `check-*` in `infra/scripts/`) e mostrala all'utente; dopo la fase test la lista non cambia più, come un test. Nella fase `codice` esegui o fai eseguire i passi; l'esito si annota in `docs/verifiche/<id>-esito.md` (lo scrive l'utente, o tu sotto sua dettatura) prima di `APPROVO`.
- Un compito per ramo git: nome del ramo `<id-in-minuscolo>` (es. `fon-t01`). Dalla fase codice puoi fare commit sul ramo del compito e spingerlo con `git push origin <ramo>` (serve all'avvio a mano sul server di test e ai rami `prova-*`); la pull request del compito la apre solo `/chiudi-compito`, in chiusura.

## 2. Prima di ogni compito
1. Leggi `specs/00-costituzione.md` (regole non negoziabili).
2. Leggi l'area del compito in `specs/` per intero, non solo il compito.
3. Se il compito ha un segno **[VERIFICA]**, controlla la documentazione della versione installata della libreria prima di scrivere codice e annota l'esito nella specifica.

## 3. Regole che non si discutono (dettagli in `specs/00-costituzione.md`)
- Nessun accesso ai dati di un negozio fuori da `withShop()`. Nessun import del client del database fuori da `src/server/db/` (eccezioni: `src/server/db/auth-adapter.ts`, `src/server/db/auth-counters.ts` (importabile da `src/server/auth/**`), `src/server/db/owner-client.ts` per migrate, CLI e controllo di separazione, e i test in `tests/**`).
- Ogni tabella con `shop_id` ha RLS abilitata e forzata, una policy di separazione, ed è coperta dal test di separazione automatico.
- Segreti solo in variabili d'ambiente. Mai nel codice, nei log, nei test, nella chat. Non leggere i file `.env*` reali (sono bloccati): usa i file `*.example`.
- Ogni requisito ha almeno un test che ne porta l'ID nel nome.

## 4. Comandi
- `pnpm dev` — sviluppo locale (prima `docker compose -f infra/compose.dev.yml up -d` e `pnpm db:migrate`); `pnpm worker` per i lavori in background
- `pnpm lint && pnpm typecheck` — controlli statici
- `pnpm test` — test unitari
- `pnpm test:int` — test di integrazione su PostgreSQL reale
- `pnpm test:e2e` — test end-to-end con Playwright
- `pnpm db:generate` / `pnpm db:migrate` — migrazioni (il migrate usa il ruolo proprietario)
- `pnpm cli <comando>` — comandi di manutenzione (`src/cli.ts`, variabili di `.env.migrate`)

Nella sandbox di Claude Code `localhost` è privato e il database non si raggiunge: `pnpm test:int`, `test:e2e`, `dev`, `worker`, `db:migrate` e `cli` li esegui nella gabbia, con `bash .claude/hooks/gabbia.sh <comando> [argomenti]` (per esempio `bash .claude/hooks/gabbia.sh test:int`), scritto da solo nella riga, dalla cartella del progetto. Lo stesso per `pnpm test`, se i test unitari hanno bisogno di un file di ambiente: nella sandbox i file di ambiente reali non si leggono. `docker compose -f infra/compose.dev.yml up -d` e gli altri comandi Docker girano fuori dalla sandbox: anche loro da soli nella riga. Uno script che chiama Docker al suo interno (anche attraverso `/srv/app/dc`) in locale non lo puoi eseguire, né nella sandbox né nella gabbia: lo esegue l'utente nel suo terminale (`docs/due-postazioni.md`, «Regole di struttura»).

Comandi del metodo: `/stato` (dove siamo e qual è il prossimo compito), `/revisione` (revisore indipendente), `/chiudi-compito` (controlli finali, commit, pull request).

## 5. Un compito è finito quando
lint, typecheck e tutti i test passano, i nuovi test coprono i requisiti del compito, la revisione non ha problemi critici o alti aperti, la casella del compito è spuntata nella specifica, ogni deviazione dalla specifica è stata scritta nella specifica e la pull request è aperta.

## 6. Due postazioni (yoo e joo)
Il progetto si sviluppa su due computer. Il nome di questa postazione, la fase e la copia del registro stanno fuori dal progetto, nella cartella di stato degli hook (`~/.local/state/gestionale-negozi/`); il registro delle approvazioni sta in `registro/compiti-<postazione>.log`. Chi fa cosa, e perché, sta in `docs/due-postazioni.md`, da leggere prima di ogni piano.
- I tuoi comandi girano nella sandbox di Claude Code: nei file del metodo (`.claude/`, `CLAUDE.md`, `AVVIO.md`, `docs/metodo.md`, `docs/due-postazioni.md`) e fuori dal progetto non scrivi, e nemmeno git, che gira anche lui nella sandbox. Fuori dalla sandbox girano solo Docker, `ssh`, `scp`, `rsync` e la gabbia (§4): scrivili da soli nella riga, senza variabili, `$(…)` o altri comandi. Se un comando che serve al compito fallisce per la sandbox, non cercare un'altra strada: dillo all'utente.
- Se un `git switch` o un `git merge` porterebbe modifiche ai file del metodo (l'utente ha cambiato hook, corsie o istruzioni su `main`), l'hook lo ferma: quel comando lo esegue l'utente nel suo terminale, poi si riprende.
- Dalla fine della fase test gli hook tengono l'impronta dei test, delle liste di controllo e della configurazione dei controlli: un cambiamento, con qualunque comando, ferma `APPROVO` e il commit. I file del metodo si confrontano con il commit a ogni parola chiave.
- Ogni compito è di una sola postazione (`.claude/hooks/corsie.txt`, vale la copia su `main`). `INIZIA` rifiuta i compiti dell'altra postazione e quelli i cui compiti precedenti o prerequisiti non sono ancora su `main`.
- Primo passo del piano: `git switch --no-track -c <id-in-minuscolo> origin/main` (l'hook ha appena fatto `git fetch`), senza altre modifiche nella cartella di lavoro: possono restare il registro di questa postazione e i file di `docs/` dei suoi compiti, nuovi o modificati (per esempio un esito scritto dopo l'unione), che partono con il prossimo commit. Poi `pnpm install` se esiste `package.json`.
- Migrazioni, elenco dei permessi e fixture di `src/server/db/isolation/` li scrive solo joo. Se un compito di yoo ne ha bisogno, fermati e dillo all'utente.
- Non modificare i file esistenti che appartengono all'altra postazione (tabella «Proprietà dei file»), tranne le eccezioni pianificate scritte lì. Se ti serve farlo, fermati e dillo all'utente: diventa una correzione dell'altra postazione.
- Prima di chiedere `APPROVO` in fase codice, allinea il ramo a `main`: `git fetch origin`; se `origin/main` è avanzato, `git stash push -u` (se ci sono modifiche), poi `git merge --ff-only origin/main` se il ramo non ha commit propri, oppure `git merge --no-edit origin/main` se li ha (dopo `TORNA AL CODICE`), poi `git stash pop`. Risolvi i conflitti, esegui `pnpm install` se sono cambiate le dipendenze e rilancia lint, typecheck e test. Un conflitto in un test o nella configurazione dei controlli: fermati, l'utente scrive `TORNA AI TEST`. Un'unione con main rimasta aperta (esiste `.git/MERGE_HEAD`) la concludi con `git commit --no-edit`, anche in fase codice.
- Una pull request di compito aperta alla volta fra le due postazioni: lo controlla `/chiudi-compito`. Le pull request le unisce l'utente.
- I comandi verso i server (`ssh`, `scp`, `rsync`) si usano solo nelle fasi codice, revisione e chiusura di un compito, solo con i nomi `test` e `prod` della configurazione SSH, e solo con le opzioni ammesse dall'hook; `sftp` no. Per `prod` Claude Code chiede conferma all'utente a ogni comando. I file di ambiente dei server (`/srv/app/env/`) non si leggono e non si scrivono: li gestisce l'utente. Per lo stesso motivo `docker compose config` sul server (anche `/srv/app/dc config`) si usa solo con `--no-env-resolution`. Sul server di test segui le regole di «Il server di test condiviso» in `docs/due-postazioni.md`.
- Le variabili d'ambiente nuove vanno nella descrizione della pull request: sui server le scrive l'utente prima dell'unione (i valori che nascono dopo l'unione, come quelli di `stripe:seed`, dopo l'unione e prima di `CHIUSO`). Il fermo dei rilasci (`TEST_DEPLOY_HOLD`) lo attivano e lo tolgono solo i compiti di yoo: quello che lo attiva lo toglie prima di `CHIUSO`. Se un compito chiuso o abbandonato l'ha lasciato attivo, lo toglie l'utente, oppure su yoo Claude quando l'utente glielo chiede, e poi si rilancia il rilascio di `main`. Niente segreti fra le postazioni via git o chat; i segreti di GitHub li scrive l'utente.
- Se il prossimo compito è bloccato, proponi il lavoro d'attesa della sezione «Quando aspetti» di `docs/due-postazioni.md`, senza toccare il codice.
