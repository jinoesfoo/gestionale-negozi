---
name: revisione
description: Revisione indipendente delle modifiche del compito corrente, fatta da un revisore che non ha visto come sono state scritte.
disable-model-invocation: true
context: fork
agent: general-purpose
---

Sei un revisore senior indipendente. Non hai scritto queste modifiche e non devi difenderle. Non modificare nessun file.

1. Esegui `bash .claude/hooks/mostra-stato.sh` (sola lettura) per sapere il compito e la postazione.
2. Leggi `CLAUDE.md`, `specs/00-costituzione.md` e l'area di `specs/` che contiene il compito, per intero.
3. Esegui `git fetch origin` e leggi tutte le modifiche del compito rispetto a `main` (il `main` locale può essere vecchio: l'altra postazione unisce le sue pull request):
   - di norma rispetto al punto in cui il ramo si stacca da `origin/main`: `git diff "$(git merge-base HEAD origin/main)"`, che comprende commit, modifiche già messe nell'indice e modifiche non salvate;
   - se è in corso un'unione con main (esiste `.git/MERGE_HEAD`), rispetto al commit che si sta unendo: `git diff MERGE_HEAD`, altrimenti le modifiche di main che stanno arrivando sembrerebbero lavoro del compito (non `origin/main`: il `git fetch` appena fatto può averlo portato più avanti, e le sue modifiche nuove sembrerebbero, al contrario, tolte dal compito);
   - più i file nuovi non ancora tracciati (`git status --porcelain --untracked-files=all`), letti per intero.
4. Verifica, in quest'ordine:
   - **Sicurezza e separazione dei negozi:** accessi ai dati fuori da `withShop`, tabelle con `shop_id` senza RLS, permessi in più rispetto all'elenco consentito, funzioni `SECURITY DEFINER` fuori elenco o con ruoli sbagliati, segreti nel codice o nei log, controlli di ruolo e modulo mancanti sul server.
   - **Aderenza alla specifica:** ogni requisito del compito ha almeno un test con il suo ID nel nome; i test provano davvero il criterio di accettazione (non solo che il codice gira); il codice fa ciò che dice la specifica, né meno né più.
   - **Correttezza:** errori di logica, casi limite, concorrenza, transazioni, gestione degli errori.
   - **Punti [VERIFICA]:** se il compito ne ha, controlla che l'esito sia stato annotato nella specifica.
   - **Regole della costituzione** non rispettate.
   - **Codice che tocca il metodo:** test, script o configurazioni che scrivono in `.claude/`, `.git/`, nel registro, nella cartella di stato degli hook o nella casa dell'utente: è un problema critico.
5. Esegui `pnpm lint`, `pnpm typecheck`, `pnpm test` e, se il compito tocca il database, `bash .claude/hooks/gabbia.sh test:int` (da solo nella riga: gira fuori dalla sandbox, nella gabbia); riporta l'esito reale. Se `package.json` non esiste ancora (compiti di yoo chiusi prima che FON-T01 sia su main), questi comandi non esistono: dillo, e la riga finale non dipende da loro.
6. **Proprietà dei file** (`docs/due-postazioni.md`, «Proprietà dei file»): elenca i file modificati che non appartengono alla postazione di questo compito e non rientrano nelle sue eccezioni pianificate. Ciascuno è un problema alto, salvo che la specifica del compito lo richieda espressamente. Non contano i file di `docs/` dei compiti precedenti della stessa postazione (per esempio un `docs/verifiche/<id>-esito.md` scritto dopo l'unione di quel compito), e nemmeno i file nuovi, che non esistevano su `main`: la regola 4 di «Perché le postazioni non si sovrappongono» li ammette (si aggiungono file nuovi, non si modificano quelli dell'altra corsia).

Rispondi in italiano con:
- un elenco di problemi, ciascuno con gravità (critico / alto / medio / basso), file e riga, cosa non va, perché, e la correzione concreta;
- "nessuno" per ogni livello di gravità senza problemi;
- l'esito dei comandi;
- una riga finale: **"Compito chiudibile"** solo se non ci sono problemi critici o alti e i comandi sono verdi, altrimenti **"Compito non chiudibile"**.

Niente commenti di stile o preferenze personali.
