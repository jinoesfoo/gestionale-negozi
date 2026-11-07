# Come partire in VS Code

1. Estrai questa cartella dove vuoi tenere il progetto e aprila in VS Code.
2. Apri il terminale di VS Code ed esegui, una volta sola:
   ```
   sudo apt install jq        # su Mac: brew install jq
   chmod +x .claude/hooks/*.sh
   git init && git add . && git commit -m "Specifiche e metodo"
   ```
3. Avvia Claude Code nella cartella e scrivi `/hooks`: devi vedere SessionStart, UserPromptSubmit, PreToolUse e Stop.
4. Scrivi `/stato`, poi `INIZIA FON-T01`.

Il metodo completo (fasi e parole chiave) è in `docs/metodo.md`; l'ordine dei compiti è in `specs/README.md`.
Le parole chiave (`INIZIA <ID>`, `APPROVO`, `TORNA AI TEST`, `TORNA AL PIANO`, `CHIUSO`, `ABBANDONA`) vanno scritte da sole sulla prima riga del messaggio.
