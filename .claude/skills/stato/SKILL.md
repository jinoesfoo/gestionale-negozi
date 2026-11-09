---
name: stato
description: Mostra a che punto è lo sviluppo della fase 0 sulle due postazioni e qual è il prossimo compito di questa postazione.
disable-model-invocation: true
---

Mostra all'utente lo stato del lavoro, in italiano, in modo breve. Non modificare nessun file.

1. Esegui `bash .claude/hooks/mostra-stato.sh` (sola lettura: postazione, compito e fase stanno nella cartella di stato degli hook, fuori dal progetto) e riporta postazione, compito e fase aperti. Se la postazione manca, dillo: l'utente esegue una volta, nel suo terminale, `bash .claude/hooks/imposta-postazione.sh yoo` (oppure `joo`).
2. Esegui `git fetch origin main`. Se non riesce, dillo e prosegui con l'ultima copia nota di `origin/main`.
3. Leggi la tabella delle corsie **di main**, la stessa che usano gli hook: `git show origin/main:.claude/hooks/corsie.txt`. Per ogni compito: la postazione, l'ordine (l'ordine delle righe di quella postazione) e i prerequisiti dell'altra postazione. Le parti dopo `#` sono commenti.
4. Un compito è **fatto** quando la sua casella è spuntata nelle specifiche di `origin/main`, cioè quando la sua pull request è stata unita: `git grep -F -e "- [x] **<ID>**" origin/main -- specs` trova la riga. Conta per ciascuna postazione i compiti fatti e quelli da fare.
5. Indica il **prossimo compito di questa postazione**: il primo da fare nell'ordine della sua corsia. È **libero** se sono fatti tutti i compiti che lo precedono nella corsia e tutti i suoi prerequisiti; altrimenti è **bloccato**: scrivi quali compiti mancano, di quale postazione sono e se sono già in una pull request aperta.
6. Elenca le pull request aperte (`gh pr list --state open`): con due postazioni se ne tiene aperta una alla volta fra quelle dei compiti (`docs/due-postazioni.md`, «Il giro di un compito»). Se questa postazione ha un compito in chiusura con la pull request già unita, ricorda all'utente di scrivere `CHIUSO`, dopo le eventuali prove sui server da fare dopo l'unione («Il server di test condiviso»).
   Poi `gh variable get TEST_DEPLOY_HOLD` (esiste da FON-T08): se vale `1`, il fermo dei rilasci è attivo e le unioni non arrivano sul server di test; dillo, e ricorda che lo toglie il compito di yoo che l'ha attivato, dopo la sua unione; se l'ha lasciato un compito di yoo già chiuso o abbandonato, lo toglie l'utente dal sito di GitHub e rilancia il rilascio di `main` (su yoo può chiederlo a Claude). Su joo non si tocca.
7. Se il prossimo compito è bloccato, proponi il lavoro d'attesa adatto a questa postazione, dalla sezione «Quando aspetti» di `docs/due-postazioni.md`.
8. Mostra le ultime 10 righe del registro di questa postazione, `registro/compiti-<postazione>.log`, se esiste.
9. Chiudi con, in grassetto, cosa deve fare l'utente: se c'è un compito aperto, la parola chiave della fase corrente (`CLAUDE.md` sezione 1); se il prossimo compito è libero, `INIZIA <ID>`; se è bloccato, quale pull request va unita prima e di quale postazione.
