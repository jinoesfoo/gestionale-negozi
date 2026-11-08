# Come partire: due computer Ubuntu, yoo e joo

Chi fa cosa è spiegato in `docs/due-postazioni.md`. Qui ci sono solo i passi di installazione, in ordine.

## 1. Strumenti, su ciascuno dei due computer

```bash
sudo apt update && sudo apt install -y git jq curl gh
# Node.js 24 con nvm, poi pnpm
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc && nvm install 24 && npm install -g pnpm
# Docker (database in locale, immagini, test di integrazione)
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker "$USER"
# GitHub: accesso e credenziali per git (servono anche agli hook, che fanno git fetch da soli)
gh auth login && gh auth setup-git
```

Dopo `usermod` esci dalla sessione e rientra, così Docker funziona senza `sudo`. In VS Code installa l'estensione Claude Code.

## 2. Il repository su GitHub, una volta sola, da joo

Lo zip contiene `gestionale-negozi.bundle`, il repository con la sua storia. Da joo, nella cartella in cui hai estratto lo zip:

```bash
git clone gestionale-negozi.bundle ~/gestionale-negozi
cd ~/gestionale-negozi
git remote remove origin
gh repo create gestionale-negozi --private --source . --remote origin --push
```

Su GitHub, in Settings › General › Pull Requests, lascia attivo solo «Allow squash merging» e attiva «Automatically delete head branches». Dopo FON-T08, quando la CI completa esiste, conviene proteggere `main` (Settings › Branches): pull request obbligatoria e controlli della CI verdi.

## 3. Il clone, da yoo (dopo il passo 2)

```bash
gh repo clone gestionale-negozi ~/gestionale-negozi    # con lo stesso account GitHub di joo
```

## 4. Il nome della postazione, su ciascun computer

Nella cartella del progetto, una volta sola:

```bash
bash .claude/hooks/imposta-postazione.sh joo    # sul computer joo
bash .claude/hooks/imposta-postazione.sh yoo    # sul computer yoo
```

## 5. Claude Code

Apri la cartella `~/gestionale-negozi` in VS Code, avvia Claude Code e scrivi `/hooks`: devi vedere SessionStart, UserPromptSubmit, PreToolUse e Stop. All'apertura Claude deve ricevere il messaggio «[Metodo] Postazione joo» (o yoo).

## 6. Prova, prima di lavorare

Gli hook sono stati collaudati in una simulazione, non ancora su un Ubuntu vero: questa prova lo verifica.

- Su joo scrivi `INIZIA FON-T07a`: deve essere **rifiutato** («è della postazione yoo»).
- Su yoo scrivi `INIZIA FON-T01`: deve essere **rifiutato** («è della postazione joo»).
- Su joo scrivi `/stato`: il prossimo compito deve essere FON-T01. Su yoo: FON-T07a.

Se una delle tre risposte è diversa, fermati e non iniziare compiti.

## 7. Si parte

- joo: `INIZIA FON-T01`
- yoo: `INIZIA FON-T07a`

I segreti (chiavi Stripe, Cloudflare, S3, password dei server) non passano mai da git, dallo zip o dalla chat: si copiano da un computer all'altro con il gestore di password.

Il metodo completo (fasi e parole chiave) è in `docs/metodo.md`. Le parole chiave (`INIZIA <ID>`, `APPROVO`, `TORNA AI TEST`, `TORNA AL PIANO`, `TORNA AL CODICE`, `CHIUSO`, `ABBANDONA`) vanno scritte da sole sulla prima riga del messaggio.
