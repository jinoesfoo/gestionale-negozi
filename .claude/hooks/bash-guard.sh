#!/usr/bin/env bash
# PreToolUse su Bash: blocca i comandi che aggirerebbero il metodo o metterebbero a rischio il repository.
source "$(dirname "$0")/common.sh"

input="$(cat)"
cmd="$(echo "$input" | jq -r '.tool_input.command // ""')"
# Su Windows: barre rovesciate e maiuscole non devono aggirare i controlli sui percorsi
[ "$ON_WINDOWS" = 1 ] && { cmd="${cmd//\\//}"; cmd="${cmd,,}"; }

block() { echo "BLOCCATO dal metodo di lavoro: $*" >&2; exit 2; }
fase="$(current_phase)"
task="$(current_task)"
S='(^|[[:space:];&|(])'   # inizio di un comando o di una parola
G='git([[:space:]]+(-[cC][[:space:]]+[^[:space:]]+|--(git-dir|work-tree)=[^[:space:]]+|--no-pager))*[[:space:]]+'   # git, anche con -C o -c

# File di stato, postazione, corsie, registro e hook: non si toccano da terminale
PROT='compito-corrente\.json|registro-compiti|\.claude/hooks|\.claude/settings\.json|\.claude/postazione|corsie\.txt'
MSG_PROT="il file di stato, la postazione, il registro, le corsie e gli hook del metodo non si modificano da terminale."
echo "$cmd" | grep -Eq "(>>?|tee([[:space:]]+-a)?)[[:space:]]*['\"]?[^[:space:]'\"]*($PROT)" && block "$MSG_PROT"
echo "$cmd" | grep -Eq "(>>?|tee)[[:space:]]*['\"]?(\./)?(postazione|compito-corrente\.json|corsie\.txt|registro-compiti[^[:space:]'\";|&]*)(['\"[:space:];|&]|$)" && block "$MSG_PROT"
if echo "$cmd" | grep -Eq "$PROT" && echo "$cmd" | grep -Eq "${S}(rm|mv|cp|chmod|chown|truncate|unlink|ln|install|dd|touch)[[:space:]]|sed[[:space:]]+(-[a-z]+[[:space:]]+)*-i|perl[[:space:]]+-[a-z]*i|${S}python[0-9.]*[[:space:]]|${S}node[[:space:]]+-e|${G}(checkout|restore|rm)[[:space:]]"; then
  block "$MSG_PROT"
fi
echo "$cmd" | grep -Eq 'hooks/imposta|imposta-postazione|imposta[*?[]' && block "il nome della postazione lo imposta l'utente, a mano, una volta sola."

# Segreti
if echo "$cmd" | grep -Eq '(^|[[:space:]/])(\.env(\.[a-z]+)?|[a-z]+\.env)([[:space:]]|$)' && ! echo "$cmd" | grep -q 'example'; then
  block "il comando legge o modifica un file di ambiente reale. Usa i file *.example."
fi

# Git pericolosi
echo "$cmd" | grep -Eq "${G}push[^|;&]*(--force|[[:space:]]-f([[:space:]]|$)|[[:space:]]\+[^[:space:]])" && block "git push forzato (--force, -f o una destinazione con +) non è permesso."
echo "$cmd" | grep -Eq "${G}push[^|;&]*--(all|mirror)" && block "git push --all o --mirror non è permesso: si spinge solo il ramo del compito."
echo "$cmd" | grep -Eq "${G}push[^|;&]*([[:space:]:+'\"]|refs/heads/)main(['\"[:space:];|&)]|$)" && block "non si spinge su main: si apre una pull request dal ramo del compito."
if echo "$cmd" | grep -Eq "${G}push([[:space:]]|$)" && [ "$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)" = "main" ]; then
  block "sei su main: da qui non si spinge nulla. Spingi il ramo del compito."
fi
echo "$cmd" | grep -Eq -- '--no-verify' && block "--no-verify salta i controlli e non è permesso."
echo "$cmd" | grep -Eq "${G}(reset[[:space:]]+--hard|clean[[:space:]]+-[a-z]*f)" && block "comando git distruttivo: chiedi all'utente di eseguirlo lui se serve davvero."

# GitHub: unire, scrivere con l'API, cambiare il repository o i segreti spetta all'utente
echo "$cmd" | grep -Eq "${S}gh[[:space:]]+pr[[:space:]]+merge" && block "le pull request le unisce l'utente, su GitHub, dopo aver guardato la CI."
if echo "$cmd" | grep -Eiq "${S}gh[[:space:]]+api[^|;&]*(-x[[:space:]]*|--method[[:space:]=]+)(post|put|patch|delete)" || echo "$cmd" | grep -Eq "${S}gh[[:space:]]+api[^|;&]*[[:space:]](-f|-F|--field|--raw-field|--input)([[:space:]=]|$)"; then
  block "gh api in scrittura non è permesso: con l'API si legge e basta."
fi
echo "$cmd" | grep -Eq "${S}gh[[:space:]]+repo[[:space:]]+(edit|delete|rename|archive)" && block "le impostazioni del repository le cambia l'utente."
echo "$cmd" | grep -Eq "${S}gh[[:space:]]+secret[[:space:]]+(set|delete|remove)" && block "i segreti di GitHub li scrive l'utente: i valori non passano da Claude."

# Commit solo in fase chiusura, e solo con il lavoro del compito corrente
if echo "$cmd" | grep -Eq "${G}(commit|cherry-pick|revert|am)([[:space:]]|$)"; then
  [ "$fase" = "chiusura" ] || block "i commit si fanno in fase chiusura (fase attuale: $fase), con /chiudi-compito."
  me="$(postazione)"
  cambiati="$(git -C "$PROJECT_DIR" status --porcelain --untracked-files=all 2>/dev/null | cut -c4-)"
  vietati="$(printf '%s\n' "$cambiati" | grep -E '^\.claude/(hooks/|settings\.json|registro-compiti)' | grep -v -x -F ".claude/registro-compiti-$me.log")"
  [ -n "$vietati" ] && block "il commit porterebbe modifiche a file che cambia solo l'utente: $(echo $vietati). Non vanno nel commit: chiedi all'utente."
  altre="$(git -C "$PROJECT_DIR" diff HEAD -U0 -- specs 2>/dev/null | grep -oiE '^\+- \[x\] \*\*[A-Z]{3}-T[0-9]{2}[AB]?\*\*' | sed -E 's/.*\*\*(.*)\*\*/\1/' | grep -v -i -x -F "${task:-—}")"
  [ -n "$altre" ] && block "il commit spunterebbe compiti diversi da $task: $(echo $altre). Si spunta solo la casella del compito corrente."
fi
if echo "$cmd" | grep -Eq "${G}merge([[:space:]]|$)" && ! echo "$cmd" | grep -Eq -- '--ff-only|--abort'; then
  [ "$fase" = "chiusura" ] || block "un git merge che crea un commit si fa solo in chiusura; per allinearsi a main prima si usa git merge --ff-only origin/main."
fi

# Server: ssh, scp, rsync solo dentro un compito, quando si lavora davvero
if echo "$cmd" | grep -Eq "${S}(ssh|scp|rsync|sftp)[[:space:]]"; then
  case "$fase" in
    codice|revisione|chiusura) ;;
    *) block "i comandi verso i server (ssh, scp, rsync) si usano solo dentro un compito, nelle fasi codice, revisione e chiusura (fase attuale: $fase). Per un controllo in sola lettura chiedi all'utente di eseguirlo." ;;
  esac
fi

# Scrittura di file da terminale per aggirare le regole di fase (es. echo > src/...)
# (su Windows il comando è già in minuscolo: per questo [Dd]ockerfile)
W='(>|tee |sed -i|cp |mv )[^|&;]*'
if echo "$cmd" | grep -Eq "${W}(src/|drizzle/|tests/|infra/|\.github/|[Dd]ockerfile|package\.json|\.test\.ts)"; then
  case "$fase" in
    codice|revisione) echo "$cmd" | grep -Eq "${W}(tests/|\.test\.ts)" && block "in fase $fase i test non si modificano, nemmeno da terminale." ;;
    test) echo "$cmd" | grep -Eq "${W}(src/|drizzle/|[Dd]ockerfile)" && block "in fase test il codice non si modifica, nemmeno da terminale." ;;
    *) block "in fase $fase non si modificano file del progetto da terminale." ;;
  esac
fi

exit 0
