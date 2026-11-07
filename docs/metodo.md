# Come lavorare con Claude Code su questo progetto

Questo repository contiene un **metodo obbligatorio**: Claude Code ti guida un compito alla volta, e degli script (hook) gli impediscono di saltare i passaggi. Tu decidi quando si passa alla fase successiva.

## Installazione (una volta)

1. Copia nella radice del repository: `CLAUDE.md`, la cartella `.claude/` e la cartella `docs/`. La cartella `specs/` deve già esserci.
2. Installa `jq`, che gli script usano per leggere i dati: `sudo apt install jq`
3. Rendi eseguibili gli script: `chmod +x .claude/hooks/*.sh`
4. Aggiungi a `.gitignore`: `.claude/compito-corrente.json` e `.claude/settings.local.json`. Il `registro-compiti.log` invece conviene salvarlo nel repository: è la traccia di cosa hai approvato e quando.
5. Apri Claude Code nella cartella del progetto e scrivi `/hooks`: devi vedere gli hook `SessionStart`, `UserPromptSubmit`, `PreToolUse` e `Stop`. Se non li vedi, riavvia Claude Code.

## Il ciclo di ogni compito

| Fase | Cosa fa Claude | Cosa controlli tu | Per andare avanti scrivi |
|---|---|---|---|
| — | Con `/stato` ti dice qual è il prossimo compito | — | `INIZIA FON-T01` |
| piano | Legge le specifiche e scrive il piano (file, test, dubbi) | Il piano copre tutti i requisiti? I dubbi sono risolti? | `APPROVO` |
| test | Scrive i test e ti mostra che falliscono | Falliscono per il motivo giusto, non per un errore di battitura | `APPROVO` |
| codice | Scrive il codice finché lint, typecheck e test sono verdi | Leggi le differenze (`git diff`), soprattutto su dati, login, pagamenti | `APPROVO` (o `TORNA AI TEST`) |
| revisione | Con `/revisione` un revisore indipendente controlla tutto | Nessun problema critico o alto aperto | `APPROVO` |
| chiusura | Con `/chiudi-compito`: controlli completi, specifica aggiornata, commit, pull request | La pull request su GitHub | `CHIUSO` |

Altre parole chiave: `TORNA AI TEST` (un test va corretto), `TORNA AL PIANO` (la specifica o il piano vanno cambiati, per esempio dopo un controllo [VERIFICA] andato male), `ABBANDONA` (chiude il compito senza completarlo).

Le parole chiave vanno scritte **da sole sulla prima riga** del messaggio; eventuali note vanno a capo. "approvo ma cambia questo" non fa avanzare la fase (Claude esegue la richiesta restando nella fase attuale).

## Cosa viene impedito, anche se Claude ci provasse

- Modificare codice senza un compito aperto, o durante il piano.
- Modificare il codice applicativo mentre si scrivono i test.
- **Modificare i test per farli passare** durante la fase codice.
- Chiudere una risposta con lint, typecheck o test rossi nelle fasi codice, revisione e chiusura.
- Leggere o modificare i file `.env` con i segreti veri.
- Fare commit fuori dalla fase chiusura, spingere su `main`, usare `--force` o `--no-verify`, `git reset --hard`.
- Cambiare da solo la fase o modificare gli hook.

## Consigli

- **Una sessione per compito.** Quando chiudi un compito, usa `/clear` o apri una nuova sessione prima di `INIZIA` del successivo.
- **Leggi sempre il piano.** È il momento in cui una correzione costa meno.
- **Non approvare quello che non hai guardato.** `APPROVO` è la tua firma: finisce nel registro.
- Se un blocco ti sembra sbagliato (per esempio un file che dovrebbe essere modificabile in quella fase), puoi modificare tu gli script in `.claude/hooks/`: Claude non può farlo.

## Limiti da conoscere

Gli hook controllano le azioni di Claude, non le tue: se modifichi i file a mano in VS Code, nessuno ti ferma. I controlli sui comandi da terminale riconoscono i casi comuni (`>`, `tee`, `sed -i`), non ogni modo possibile di scrivere un file: la difesa principale resta la tua lettura delle differenze e la revisione.
