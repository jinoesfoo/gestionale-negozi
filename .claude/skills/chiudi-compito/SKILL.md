---
name: chiudi-compito
description: Controlli finali del compito corrente, allineamento a main, aggiornamento della specifica, commit e pull request.
disable-model-invocation: true
---

Chiudi il compito corrente. Rispondi all'utente in italiano.

1. Leggi `.claude/compito-corrente.json`. Se la fase non è `chiusura`, fermati e spiega che prima serve `APPROVO` dopo la revisione.
2. **Una pull request di compito alla volta.** Esegui `gh pr list --state open --json number,title,headRefName`. Contano solo i rami che hanno il nome di un compito (`^[a-z]{3}-t[0-9]{2}[ab]?$`) diverso da quello corrente: le pull request delle dipendenze e i rami di prova (`prova-*`) non contano. Se ce n'è una, fermati: l'utente la unisce o la chiude, poi rilancia `/chiudi-compito`. Così GitHub, al momento dell'unione, non trova mai due compiti in conflitto. Se la pull request di questo compito esiste già (per esempio dopo `TORNA AL CODICE`), vai avanti: al passo 9 basta spingere.
3. **Allineamento a main.** Esegui `git fetch origin`. Se `origin/main` è andato avanti rispetto alla base del ramo (`git merge-base HEAD origin/main` diverso da `git rev-parse origin/main`):
   - se il ramo non ha ancora commit propri: `git stash push -u`, `git merge --ff-only origin/main`, `git stash pop`;
   - se il ramo ha già un commit ed è già stato spinto: `git merge --no-edit origin/main` (niente rebase: richiederebbe una spinta forzata, che non è permessa; l'unione su GitHub è «Squash and merge», quindi il commit di unione non resta nella storia).
   Se compaiono conflitti:
   - solo in `specs/` o `docs/` (per esempio due caselle vicine spuntate dalle due postazioni): risolvili tenendo le modifiche di entrambe le parti, poi `git stash drop` se il conflitto è venuto da `git stash pop`;
   - in qualunque altro file: fermati, non toccare i file e spiega quali sono in conflitto. L'utente scrive `TORNA AL CODICE`: il conflitto si risolve in fase codice, poi servono di nuovo revisione e chiusura.
   Dopo l'allineamento, se sono cambiati `package.json` o `pnpm-lock.yaml`, esegui `pnpm install`.
4. Esegui, nell'ordine, e riporta l'esito reale di ciascuno: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int` (se il compito tocca database, permessi o lavori in background), `pnpm test:e2e` (se il compito tocca pagine o flussi). Dopo l'allineamento i controlli girano sul codice che verrà davvero unito. Se `package.json` non esiste ancora (compiti di yoo chiusi prima che FON-T01 sia su main), questi controlli non esistono: dillo e scrivilo nella pull request. Se un controllo fallisce, fermati: spiega cosa non va e indica all'utente di scrivere `TORNA AL CODICE` (codice da correggere) oppure, dopo `TORNA AL CODICE`, `TORNA AI TEST` se serve modificare i test.
5. Nella specifica del compito:
   - spunta la casella del compito (`- [ ]` → `- [x]`), e solo quella;
   - annota gli esiti dei punti [VERIFICA] del compito, se presenti;
   - annota ogni deviazione dalla specifica decisa durante il lavoro.
6. Verifica di essere sul ramo del compito (nome in minuscolo, es. `fon-t01`), non su `main`. Se sei su `main`, crea il ramo prima del commit.
7. Fai il commit con messaggio `<ID>: <titolo breve del compito>` e, nel corpo, l'elenco dei requisiti coperti. Il commit comprende anche il registro di questa postazione, `.claude/registro-compiti-<postazione>.log`. L'hook rifiuta un commit che porta modifiche agli hook, alle corsie, alle impostazioni o caselle di altri compiti.
8. Se dopo il commit `origin/main` è andato avanti di nuovo, ripeti il passo 3 con `git merge --no-edit origin/main` e il passo 4.
9. Spingi il ramo (`git push -u origin <ramo>`). Se la pull request non esiste ancora, aprila verso `main` con `gh pr create`: titolo uguale al commit; descrizione con postazione, requisiti coperti, test aggiunti, esito dei comandi ed eventuali nuove variabili d'ambiente da aggiungere a mano sui server **prima** dell'unione (dopo FON-T08 ogni unione su `main` arriva sul server di test).
10. Chiudi con, in grassetto: **"Controlla la pull request; quando la CI è verde uniscila con «Squash and merge», poi scrivi CHIUSO: l'hook lo accetta solo quando il compito è su main."**
