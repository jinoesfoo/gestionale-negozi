---
name: stato
description: Mostra a che punto è lo sviluppo della fase 0 sulle due postazioni e qual è il prossimo compito di questa postazione.
disable-model-invocation: true
---

Mostra all'utente lo stato del lavoro, in italiano, in modo breve. Non modificare nessun file.

1. Leggi `.claude/postazione` (`yoo` o `joo`) e `.claude/compito-corrente.json` (se esiste): riporta postazione, compito e fase aperti. Se la postazione manca, dillo: l'utente esegue una volta `bash .claude/hooks/imposta-postazione.sh yoo` (oppure `joo`).
2. Esegui `git fetch origin main`. Se non riesce, dillo e prosegui con l'ultima copia nota di `origin/main`.
3. Leggi con lo strumento Read `.claude/hooks/corsie.txt`: per ogni compito, la postazione, l'ordine (l'ordine delle righe di quella postazione) e i prerequisiti dell'altra postazione.
4. Un compito è **fatto** quando la sua casella è spuntata nelle specifiche di `origin/main`, cioè quando la sua pull request è stata unita: `git grep -F -e "- [x] **<ID>**" origin/main -- specs` trova la riga. Conta per ciascuna postazione i compiti fatti e quelli da fare.
5. Indica il **prossimo compito di questa postazione**: il primo da fare nell'ordine della sua corsia. È **libero** se sono fatti tutti i compiti che lo precedono nella corsia e tutti i suoi prerequisiti; altrimenti è **bloccato**: scrivi quali compiti mancano, di quale postazione sono e se sono già in una pull request aperta.
6. Elenca le pull request aperte (`gh pr list --state open`): con due postazioni se ne tiene aperta una alla volta (`docs/due-postazioni.md`, «Il giro di un compito»).
7. Se il prossimo compito è bloccato, proponi il lavoro d'attesa adatto a questa postazione, dalla sezione «Quando aspetti» di `docs/due-postazioni.md`.
8. Mostra le ultime 10 righe del registro di questa postazione, `.claude/registro-compiti-<postazione>.log`, se esiste.
9. Chiudi con, in grassetto, cosa deve fare l'utente: se c'è un compito aperto, la parola chiave della fase corrente (`CLAUDE.md` sezione 1); se il prossimo compito è libero, `INIZIA <ID>`; se è bloccato, quale pull request va unita prima e di quale postazione.
