---
name: stato
description: Mostra a che punto è lo sviluppo della fase 0 e qual è il prossimo compito da iniziare, secondo l'ordine delle specifiche.
disable-model-invocation: true
---

Mostra all'utente lo stato del lavoro, in italiano, in modo breve.

1. Leggi `.claude/compito-corrente.json` (se esiste) e riporta compito e fase aperti.
2. Leggi `specs/README.md` (ordine delle aree e eccezioni di ordine) e tutte le aree in `specs/`. Conta per ogni area i compiti spuntati (`- [x]`) e quelli da fare (`- [ ]`).
3. Indica il **prossimo compito** da iniziare: il primo non spuntato secondo l'ordine del README, rispettando le dipendenze scritte nei compiti (es. "dopo FON-T07a", "richiede prima ...") e l'eccezione d'ordine dell'area 01.
4. Mostra le ultime 10 righe di `.claude/registro-compiti.log`, se esiste.
5. Chiudi con, in grassetto, cosa deve scrivere l'utente: se c'è un compito aperto, la parola chiave della fase corrente (vedi `CLAUDE.md` sezione 1); altrimenti `INIZIA <ID del prossimo compito>`.

Non modificare nessun file.
