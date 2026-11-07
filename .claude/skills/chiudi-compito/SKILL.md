---
name: chiudi-compito
description: Controlli finali del compito corrente, aggiornamento della specifica, commit e pull request.
disable-model-invocation: true
---

Chiudi il compito corrente. Rispondi all'utente in italiano.

1. Leggi `.claude/compito-corrente.json`. Se la fase non è `chiusura`, fermati e spiega che prima serve `APPROVO` dopo la revisione.
2. Esegui, nell'ordine, e riporta l'esito reale di ciascuno: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int` (se il compito tocca database, permessi o lavori in background), `pnpm test:e2e` (se il compito tocca pagine o flussi). Se uno fallisce, fermati: spiega cosa non va e indica all'utente di scrivere `TORNA AI TEST` se serve modificare i test, oppure di riaprire la fase codice.
3. Nella specifica del compito:
   - spunta la casella del compito (`- [ ]` → `- [x]`);
   - annota gli esiti dei punti [VERIFICA] del compito, se presenti;
   - annota ogni deviazione dalla specifica decisa durante il lavoro.
4. Verifica di essere sul ramo del compito (nome in minuscolo, es. `fon-t01`), non su `main`. Se sei su `main`, crea il ramo prima del commit.
5. Fai il commit con messaggio `<ID>: <titolo breve del compito>` e, nel corpo, l'elenco dei requisiti coperti.
6. Spingi il ramo e apri la pull request verso `main` con `gh pr create`: titolo uguale al commit, descrizione con requisiti coperti, test aggiunti, esito dei comandi, eventuali nuove variabili d'ambiente da aggiungere a mano sul server.
7. Chiudi con, in grassetto: **"Controlla la pull request e, se è tutto a posto, scrivi CHIUSO."**
