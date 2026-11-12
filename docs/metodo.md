# Come lavorare con Claude Code su questo progetto

Questo repository contiene un **metodo obbligatorio**: Claude Code ti guida un compito alla volta, e degli script (hook) gli impediscono di saltare i passaggi. Tu decidi quando si passa alla fase successiva.

## Installazione (una volta)

Il metodo è già nel repository: `CLAUDE.md`, la cartella `.claude/` (hook, impostazioni, comandi del metodo), `docs/metodo.md`, `docs/due-postazioni.md` e `AVVIO.md`. L'installazione su ciascun computer, con la prova finale, è in `AVVIO.md`. In breve:

1. Installa `jq` e `bubblewrap`, che gli hook usano (`AVVIO.md`, passo 1).
2. Dai il nome alla postazione, dal tuo terminale: `bash .claude/hooks/imposta-postazione.sh yoo` (oppure `joo`). Fase, postazione e copia del registro stanno fuori dal progetto, nella cartella di stato degli hook (`~/.local/state/gestionale-negozi/`); il registro delle approvazioni sta nel repository, in `registro/compiti-<postazione>.log`: è la traccia di cosa hai approvato e quando.
3. Apri Claude Code nella cartella del progetto e scrivi `/hooks`: devi vedere gli hook `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop` e `WorktreeCreate`. Se non li vedi, riavvia Claude Code.

## Il ciclo di ogni compito

| Fase | Cosa fa Claude | Cosa controlli tu | Per andare avanti scrivi |
|---|---|---|---|
| — | Con `/stato` ti dice qual è il prossimo compito | — | `INIZIA FON-T01` |
| piano | Legge le specifiche e scrive il piano (file, test, dubbi) | Il piano copre tutti i requisiti? I dubbi sono risolti? | `APPROVO` |
| test | Scrive i test (e la configurazione dei controlli) e ti mostra che falliscono; le prove del collaudo, COL-T01, solo le controlla, perché girano in produzione | Falliscono per il motivo giusto, non per un errore di battitura | `APPROVO` |
| codice | Scrive il codice finché lint, typecheck e test sono verdi | Leggi le differenze del compito (`git diff "$(git merge-base HEAD origin/main)"`, più i file nuovi, che `git status --short --untracked-files=all` segna con `??`: con l'allineamento il lavoro può essere già in un commit), soprattutto su dati, login, pagamenti | `APPROVO` (o `TORNA AI TEST`) |
| revisione | Con `/revisione` un revisore indipendente controlla tutto | Nessun problema critico o alto aperto | `APPROVO` |
| chiusura | Con `/chiudi-compito`: controlli completi, specifica aggiornata, commit, pull request | La pull request su GitHub: quando la CI è verde la unisci tu | `CHIUSO` (dopo l'unione) |

Altre parole chiave: `TORNA AI TEST` (un test va corretto, oppure va riapprovato perché l'allineamento a main ha unito le modifiche di tutte e due le postazioni: Claude ti mostra che cosa è cambiato), `TORNA AL PIANO` (la specifica o il piano vanno cambiati, per esempio dopo un controllo [VERIFICA] andato male), `TORNA AL CODICE` (dalla chiusura: il codice va corretto, per esempio per un conflitto con `main`; poi di nuovo revisione e chiusura), `ABBANDONA` (chiude il compito senza completarlo).

Con due computer valgono anche le regole di `docs/due-postazioni.md`: ogni compito è di una sola postazione, si inizia solo da ciò che è già su `main`, una pull request alla volta.

Le parole chiave vanno scritte **da sole sulla prima riga** del messaggio; eventuali note vanno a capo. "approvo ma cambia questo" non fa avanzare la fase (Claude esegue la richiesta restando nella fase attuale).

## Cosa viene impedito, e da chi

Gli hook fermano Claude, con un messaggio che spiega perché, quando prova a:
- modificare codice senza un compito aperto, o durante il piano;
- modificare il codice applicativo mentre si scrivono i test;
- **modificare i test, le liste di controllo o la configurazione dei controlli per farli passare**, durante la fase codice;
- chiudere una risposta con lint, typecheck o test rossi nelle fasi codice, revisione e chiusura;
- leggere o modificare i file `.env` con i segreti veri: sul tuo computer la sandbox non li lascia leggere ai comandi di Claude; sui server gli hook fermano i comandi che li nominano o li stampano, ma lì Claude ha i permessi dell'operatore, e un comando scritto apposta potrebbe arrivarci (`docs/due-postazioni.md`, «Limiti»);
- fare commit prima della fase codice, aprire la pull request fuori dalla chiusura (salvo da un ramo `prova-*`), spingere su `main`, usare `--force` o `--no-verify`, `git reset --hard`, unire pull request;
- cambiare da solo la fase o modificare il metodo.

Su GitHub, però, gli hook fermano solo i comandi scritti per intero: un programma scritto apposta potrebbe usare le tue credenziali. La difesa vera di `main` è la sua protezione su GitHub (nessuna spinta diretta, pull request obbligatoria; la CI verde obbligatoria dopo FON-T01) e un'identità per Claude che non può unire: si impostano nella parte sul collegamento a GitHub, prima di iniziare i compiti (`AVVIO.md`, §8).

Gli hook leggono il testo dei comandi, e un testo si può scrivere in mille modi: per questo dietro ci sono altre difese, che non dipendono da come è scritto il comando. La sandbox di Claude Code (su Linux) non lascia scrivere nei file del metodo, nella cartella di stato e fuori dal progetto; il codice del progetto che deve girare fuori dalla sandbox gira in una gabbia con le stesse pareti; gli hook tengono l'impronta dei test e confrontano i file del metodo con il commit a ogni parola chiave. I dettagli sono in `docs/due-postazioni.md`, «Protezione del metodo».

## Consigli

- **Una sessione per compito.** Quando chiudi un compito, usa `/clear` o apri una nuova sessione prima di `INIZIA` del successivo.
- **Leggi sempre il piano.** È il momento in cui una correzione costa meno.
- **Non approvare quello che non hai guardato.** `APPROVO` è la tua firma: finisce nel registro.
- Se un blocco ti sembra sbagliato (per esempio un file che dovrebbe essere modificabile in quella fase), puoi modificare tu gli script in `.claude/hooks/`: Claude non può farlo. Poi fai un commit su un ramo e apri una pull request; finché gli hook sono diversi dal commit corrente, nessuna fase avanza. Dopo l'unione, sull'altro computer porti tu la modifica nella cartella (`AVVIO.md`, in fondo).

## Limiti da conoscere

Gli hook controllano le azioni di Claude, non le tue: se modifichi i file a mano in VS Code, nessuno ti ferma. Dietro gli hook ci sono la sandbox, la gabbia e i controlli sul contenuto, ma restano alcuni limiti, scritti in `docs/due-postazioni.md` («Limiti»): Docker, che ha accesso pieno al computer, e il codice scritto apposta, che si vede solo leggendo. Per questo la tua lettura delle differenze, la revisione e la CI su GitHub restano una difesa necessaria.
