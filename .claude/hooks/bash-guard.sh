#!/usr/bin/env bash
# PreToolUse su Bash: blocca i comandi che aggirerebbero il metodo o metterebbero a rischio il repository.
# Il comando si scompone come lo legge bash (tokenizza.awk) e ogni comando semplice si controlla, comprese
# le sostituzioni $(…): dove scrive, con quali opzioni gira git o gh, verso quale server va, cosa monta Docker.
# È la guida, non il muro: il muro è la sandbox di Claude Code (e la gabbia per il codice che gira fuori),
# poi i controlli sul contenuto degli hook (docs/due-postazioni.md, «Protezione del metodo»).
# Più severo di tutto con i comandi che girano fuori dalla sandbox: docker, ssh, scp, rsync e la gabbia.
source "$(dirname "$0")/common.sh"

input="$(cat)"
cmd="$(echo "$input" | jq -r '.tool_input.command // ""')"
CWD="$(echo "$input" | jq -r '.cwd // ""')"; [ -z "$CWD" ] && CWD="$PROJECT_DIR"
CWD="$(canon_path "$CWD")"
# Su Windows: barre rovesciate e maiuscole non devono aggirare i controlli sui percorsi
# (jq di Windows scrive CRLF: via i CR; poi si uniscono le righe spezzate con la barra rovesciata; poi le barre diventano /)
[ "$ON_WINDOWS" = 1 ] && { cmd="${cmd//$'\r'/}"; cmd="${cmd//$'\\\n'/ }"; cmd="${cmd//\\//}"; cmd="${cmd,,}"; }

block() { echo "BLOCCATO dal metodo di lavoro: $*" >&2; exit 2; }
fase="$(current_phase)"
task="$(current_task)"
TOKENIZER="$HOOKS_DIR/tokenizza.awk"
[ -f "$TOKENIZER" ] || block "manca .claude/hooks/tokenizza.awk: i comandi non si possono controllare."
MSG_PROT="i file del metodo (.claude/, CLAUDE.md, AVVIO.md, docs/metodo.md, docs/due-postazioni.md, il registro, .git, le impostazioni di Claude Code, la cartella di stato degli hook) li cambia solo l'utente"
LIVELLO=0      # 1 = il comando scritto da Claude; più su = dentro bash -c o una sostituzione
ESCLUSO=""     # il comando del primo livello che gira fuori dalla sandbox (settings.json, excludedCommands)

echo "$cmd" | grep -Eq -- '--no-verify' && block "--no-verify salta i controlli e non è permesso."

variabile_vietata() { # $1 nome di una variabile assegnata davanti a un comando, con env o con export
  case "$1" in GIT_*|CLAUDE_PROJECT_DIR|GESTIONALE_STATO_DIR|HOME) block "la variabile $1 cambia il repository o la cartella degli hook: non si imposta." ;; esac
  return 0
}
UTENTE="${USER:-${LOGNAME:-$(id -un 2>/dev/null)}}"
casa_in_chiaro() { # $1 parola -> CC: ~utente, $HOME e ${HOME} come ~; $USER e $LOGNAME con il nome dell'utente
  CC="$1"
  case "$CC" in
    '$HOME'|'$HOME/'*) CC="~${CC:5}" ;;
    '${HOME}'|'${HOME}/'*) CC="~${CC:7}" ;;
    "~$UTENTE"|"~$UTENTE/"*) [ -n "$UTENTE" ] && CC="~${CC:$((${#UTENTE}+1))}" ;;
  esac
  if [ -n "$UTENTE" ] && [[ "$CC" == *'$'* ]]; then
    CC="${CC//'${USER}'/$UTENTE}"; CC="${CC//'${LOGNAME}'/$UTENTE}"; CC="${CC//'$USER'/$UTENTE}"; CC="${CC//'$LOGNAME'/$UTENTE}"
  fi
  return 0
}

# --- percorsi ---------------------------------------------------------------------------------------
risolvi() { # $1 percorso, $2 cartella base (facoltativa: altrimenti CWD) -> assoluto canonico, "?" se la base è ignota
  local base="${2:-$CWD}" t="$1"
  [ "$ON_WINDOWS" = 1 ] && t="${t//\\//}"      # anche i percorsi che non vengono dal comando (docker compose config)
  case "$t" in
    "~"|"~/"*) t="$HOME${t#\~}" ;;
    "~+"|"~+/"*) [ "$CWD" = "?" ] && { echo "?"; return; }; t="$CWD${t#\~+}" ;;
    "~"*) echo "?"; return ;;      # ~- e ~utente: cartelle che qui non si conoscono
  esac
  case "$t" in /*|[A-Za-z]:/*) canon_path "$t"; return ;; esac
  [ "$base" = "?" ] && { echo "?"; return; }
  canon_path "$base/$t"
}
classifica() { # $1 percorso assoluto canonico in cui un comando scrive
  local abs="$1" rel; rel="$(rel_path "$abs")"
  protetto "$rel" && block "$MSG_PROT ('$rel')."
  antenato_protetto "$abs" && block "il comando scriverebbe su '$rel', che contiene i file del metodo: indica il file preciso."
  case "$rel" in /*|[a-zA-Z]:/*) return 0 ;; esac      # fuori dal progetto: lì decide la sandbox
  is_secret_file "$rel" && return 0                     # i file di ambiente li controlla la regola sui segreti
  case "$fase" in
    test) is_test_file "$rel" || is_test_tooling_file "$rel" || is_free_file "$rel" || \
            block "in fase test da terminale si scrivono solo i test, la loro configurazione, le specifiche e i documenti ('$rel')." ;;
    codice|revisione)
      is_test_file "$rel" && block "in fase $fase i test non si modificano, nemmeno da terminale ('$rel')."
      is_check_config "$rel" && block "in fase $fase la configurazione dei controlli resta ferma come i test ('$rel'): se va cambiata, l'utente scrive TORNA AI TEST." ;;
    *) is_test_file "$rel" && block "in fase $fase i test e le liste di controllo non si modificano ('$rel')."
       is_free_file "$rel" || block "in fase $fase non si modificano file del progetto da terminale ('$rel')." ;;
  esac
  return 0
}
scrive() { # $1 percorso, $2 segni (d, g, b), $3 cartella base facoltativa
  local t="$1" s="$2" abs m
  case "$t" in /dev/null|/dev/stdout|/dev/stderr|/dev/tty|/dev/fd/*|-) return 0 ;; esac
  [[ "$s" == *d* ]] && block "un comando che scrive ha un percorso deciso da una variabile o da un comando annidato ('$t'): scrivi il percorso per intero."
  [[ "$s" == *b* ]] && block "le graffe {…} in un percorso di scrittura non si controllano ('$t'): scrivi i percorsi per intero."
  abs="$(risolvi "$t" "${3:-}")"
  [ "$abs" = "?" ] && block "dopo un cd che non si può risolvere, o con ~- e ~utente, un comando che scrive non si controlla: scrivi i percorsi per intero."
  if [[ "$s" == *g* ]]; then
    while IFS= read -r m; do [ -n "$m" ] && classifica "$(canon_path "$m")"; done < <(compgen -G "$abs" 2>/dev/null)
  fi
  classifica "$abs"
}

# --- commit -----------------------------------------------------------------------------------------
controlla_commit() { # il commit porta solo il lavoro del compito corrente
  local f vietati="" altre="" id cambiati
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    uguale_a_main "$f" || vietati="$vietati $f"     # una modifica identica a main (arrivata con l'unione) va bene
  done < <(git -C "$PROJECT_DIR" status --porcelain --untracked-files=all 2>/dev/null | cut -c4- | sed 's/.* -> //' | \
           grep -E '(^|/)\.claude/|CLAUDE(\.local)?\.md$|^\.mcp\.json$|^\.gitmodules$|^\.github/CODEOWNERS$|^\.vscode/|^\.idea/|^AVVIO\.md$|^docs/metodo\.md$|^docs/due-postazioni\.md$|^registro/' | grep -v -x -F "$LOG_REL")
  [ -n "$vietati" ] && block "il commit porterebbe modifiche a file che cambia solo l'utente (o al registro dell'altra postazione):$vietati. Non vanno nel commit: chiedi all'utente."
  for id in $(git -C "$PROJECT_DIR" diff --no-ext-diff HEAD -U0 -- specs 2>/dev/null | grep -oiE '^\+- \[x\] \*\*[A-Z]{3}-T[0-9]{2}[AB]?\*\*' | sed -E 's/.*\*\*(.*)\*\*/\1/' | grep -v -i -x -F "${task:-—}"); do
    sul_main "$id" || altre="$altre $id"
  done
  [ -n "$altre" ] && block "il commit spunterebbe compiti diversi da $task:$altre. Si spunta solo la casella del compito corrente."
  registro_alterato && block "il registro di questa postazione è diverso dalla copia degli hook ($LOG_COPY): così non va nel commit. Chiedi all'utente."
  cambiati="$(test_cambiati | tr '\n' ' ')"
  [ -n "${cambiati// /}" ] && block "i test o la configurazione dei controlli sono cambiati dopo la fase test: $cambiati. Il commit non li porta: l'utente decide (TORNA AL CODICE e poi TORNA AI TEST, se un test va davvero corretto)."
  return 0
}

# --- git --------------------------------------------------------------------------------------------
RAMI_OK='^(main|[a-z]{3}-t[0-9]{2}[ab]?|prova-[a-z0-9-]+)$'
analizza_git() { # $1 indice di "git" in argv
  local i="$1" j a sub gdir="$CWD" k CMD_GIT
  git_cambiata && block "la cartella .git non è più quella registrata quando l'utente ha impostato la postazione: finché l'utente non controlla (AVVIO.md, passo 4), git non si usa."
  j=$((i+1))
  while [ "$j" -lt "$n" ]; do
    a="${argv[$j]}"
    # -c prima di -C: su Windows (nessuna differenza fra maiuscole) vince il blocco
    [[ "$a" == -c || "$a" == -c?* || "$a" == --config-env* ]] && [[ "$a" != -C* || "$ON_WINDOWS" = 1 ]] && \
      block "git -c e --config-env cambiano la configurazione di git per un comando: nel metodo non si usano."
    case "$a" in
      -C) [[ "${segni[$((j+1))]}" == *d* ]] && block "git -C con una cartella decisa da variabili non si controlla."
          gdir="$(risolvi "${argv[$((j+1))]}")"; j=$((j+2)); continue ;;
      --git-dir|--git-dir=*|--work-tree|--work-tree=*|--namespace|--namespace=*|--exec-path=*|--super-prefix*) block "git con --git-dir, --work-tree o simili non si usa nel metodo." ;;
      -*) j=$((j+1)); continue ;;
    esac
    break
  done
  [ "$j" -ge "$n" ] && return 0
  [[ "${segni[$j]}" == *d* ]] && block "il sottocomando di git viene da una variabile: scrivilo per intero."
  sub="${argv[$j]}"
  CMD_GIT="git ${argv[*]:$j}"
  local -a r=("${argv[@]:$((j+1))}") rs=("${segni[@]:$((j+1))}")
  ha() { local x; for x in "${r[@]}"; do [ "$x" = "$1" ] && return 0; done; return 1; }
  case "$sub" in
    push) git_push ;;
    commit)   # dalla fase codice: servono all'avvio a mano sul server di test e ai rami prova-*; la pull request solo in chiusura
      case "$fase" in codice|revisione|chiusura) ;; *) block "i commit si fanno dalla fase codice in poi (fase attuale: $fase)." ;; esac
      controlla_commit ;;
    merge) git_merge ;;
    pull) block "git pull non si usa nel metodo: git fetch origin, poi git merge --ff-only origin/main (oppure --no-edit, se il ramo ha già commit)." ;;
    rebase|cherry-pick|revert|am)
      { ha --abort || ha --quit; } && return 0
      block "git $sub non serve nel metodo: se serve davvero, lo esegue l'utente." ;;
    switch) git_ramo ;;
    branch) git_branch ;;
    checkout) if git_checkout_percorsi; then git_percorsi; else git_ramo; fi ;;
    restore) git_percorsi ;;
    reset) git_reset ;;
    stash) case "${r[0]:-push}" in store|create|branch|clear) block "git stash ${r[0]} non serve nel metodo." ;; esac ;;
    commit-tree|update-ref|replace|update-index|read-tree|write-tree|symbolic-ref|fast-import|filter-branch|filter-repo|mktree|mktag|unpack-objects|index-pack|notes)
      block "git $sub è un comando di basso livello: nel metodo non serve." ;;
    hash-object) ha -w && block "git hash-object -w scrive nel repository: nel metodo non serve." ;;
    credential|credential-*) block "git $sub legge o scrive le credenziali di GitHub (git credential fill le stampa): lo usa l'utente." ;;
    reflog) case "${r[0]:-}" in expire|delete) block "git reflog ${r[0]} cancella la storia locale: lo fa l'utente." ;; esac ;;
    worktree) case "${r[0]:-list}" in list) ;; *) block "git worktree non serve nel metodo." ;; esac ;;
    clone|init|submodule) block "git $sub non si usa nel metodo, qui né altrove: nel progetto creerebbe un repository annidato (o un sottomodulo), che git non attraversa; fuori non serve a nessun compito. Se serve davvero, lo fa l'utente nel suo terminale." ;;
    config) git_config ;;
    remote) for a in "${r[@]}"; do case "$a" in -*) ;; add|set-url|rename|remove|rm|set-head|set-branches|prune|update) block "i remoti di git li cambia l'utente." ;; *) break ;; esac; done ;;
    clean) for a in "${r[@]}"; do { [ "$a" = --force ] || [[ "$a" == -* && "$a" != --* && "$a" == *f* ]]; } && block "git clean -f è distruttivo: se serve davvero, lo esegue l'utente."; done ;;
    rm|mv) for k in "${!r[@]}"; do [[ "${r[$k]}" == -* ]] || percorso_git "$k"; done ;;
    apply) { ha --cached || ha --index; } && block "git apply --cached/--index modifica l'indice: nel metodo non serve."
           case "$fase" in nessuno|piano|chiusura) block "git apply modifica i file del progetto: non in fase $fase." ;; esac ;;
  esac
  return 0
}
percorso_git() { # $1 indice in r: un percorso che git scrive. I pathspec speciali no; i glob li espande git, anche tra apici
  local a="${r[$1]}" sg="${rs[$1]}"
  case "$a" in :*) block "i pathspec speciali di git (':(…)', ':/', ':!') non si usano: scrivi i percorsi per intero." ;; esac
  [[ "$a" == *[*?[]* ]] && sg="${sg}g"
  scrive "$a" "$sg" "$gdir"
}
metodo_in_arrivo() { # $1 commit verso cui va la cartella di lavoro: se cambia i file del metodo, Claude non può farlo
  local d
  [ "$gdir" = "?" ] && block "dopo un cd che non si può risolvere git non cambia ramo e non unisce: scrivi il comando dalla cartella del progetto."
  d="$(cd "$gdir" 2>/dev/null && MSYS_NO_PATHCONV=1 git diff --no-ext-diff --name-only HEAD "$1" -- "${METODO_PATHSPEC[@]}" 2>/dev/null | tr '\n' ' ')"
  [ -n "${d// /}" ] && block "così cambierebbero i file del metodo ($d): la sandbox non lascia scriverli a Claude, e git si fermerebbe a metà. Chiedi all'utente di eseguire lui, nel suo terminale, nella cartella del progetto: $CMD_GIT"
  return 0
}
git_branch() { # git branch: i rami si elencano o si cancellano in locale; si creano con git switch --no-track -c
  local k a canc=0 lista=0; local -a pos=()
  for k in "${!r[@]}"; do
    a="${r[$k]}"
    [[ "${rs[$k]}" == *d* ]] && block "git branch con argomenti decisi da variabili non si controlla: scrivili per intero."
    case "$a" in
      -t|--track|--track=*|-u|--set-upstream-to|--set-upstream-to=*|--unset-upstream)
        block "git branch $a scrive nella configurazione di git, che la sandbox protegge: i rami si creano con git switch --no-track -c <nome> origin/main." ;;
      -m|-M|--move|-c|-C|--copy|-f|--force|--edit-description) block "git branch $a non serve nel metodo: se serve, lo fa l'utente." ;;
      -d|-D|--delete) canc=1 ;;
      -l|--list|-a|--all|-r|--remotes|-v|-vv|--verbose|--show-current|--contains|--no-contains|--merged|--no-merged|--points-at|--sort|--sort=*|--format|--format=*|--column|--no-column|--color|--color=*|--no-color|-i|--ignore-case) lista=1 ;;
      -*) ;;
      *) pos+=("$a") ;;
    esac
  done
  { [ "${#pos[@]}" -eq 0 ] || [ "$canc" = 1 ] || [ "$lista" = 1 ]; } && return 0
  block "git branch con un nome crea un ramo senza i controlli del metodo (e da origin/main si fermerebbe a metà sulla configurazione di git): crea i rami con git switch --no-track -c <nome> origin/main, oppure git switch -c prova-<nome> dal ramo del compito."
}
git_ramo() { # switch e checkout di un ramo: si va su main o sul ramo di un compito, o si crea il ramo da origin/main
  local k a nuovo="" dest="" notrack=0; local -a pos=()
  for ((k=0; k<${#r[@]}; k++)); do
    a="${r[$k]}"
    [[ "${rs[$k]}" == *d* ]] && block "git $sub con argomenti decisi da variabili non si controlla: scrivili per intero."
    case "$a" in
      -c|-C|--create|--force-create|-b|-B) nuovo="${r[$((k+1))]:-}"; k=$((k+1)) ;;
      --create=*|--force-create=*) nuovo="${a#*=}" ;;
      --detach|-d|--orphan|--orphan=*|-f|--force|--discard-changes|--overwrite-ignore|-m|--merge)
        block "git $sub $a non serve nel metodo: se serve, lo esegue l'utente." ;;
      -t|--track|--track=*) block "git $sub $a scrive nella configurazione di git, che la sandbox protegge: crea il ramo con --no-track." ;;
      --no-track) notrack=1 ;;
      -) block "git $sub - torna al ramo precedente senza che l'hook sappia quale: scrivi il nome del ramo." ;;
      -*) ;;
      *) pos+=("$a") ;;
    esac
  done
  if [ -n "$nuovo" ]; then
    [[ "$nuovo" =~ $RAMI_OK ]] || block "il ramo di un compito si chiama come il compito, in minuscolo (per esempio fon-t01); per le prove prova-<nome>."
    dest="${pos[0]:-HEAD}"
    [ "$dest" = origin/main ] || [ "$dest" = HEAD ] || block "un ramo nuovo nasce da origin/main: git switch --no-track -c $nuovo origin/main."
    if [ "$dest" = origin/main ] && [ "$notrack" = 0 ]; then   # senza --no-track git scrive l'upstream in .git/config, che la sandbox nega, e si ferma a metà
      block "un ramo creato da origin/main vuole --no-track: senza, git scriverebbe l'upstream nella configurazione di git, che la sandbox protegge, e si fermerebbe a metà. Scrivi: git switch --no-track -c $nuovo origin/main."
    fi
  else
    dest="${pos[0]:-}"; [ -z "$dest" ] && return 0
    [[ "$dest" =~ $RAMI_OK ]] || block "si cambia ramo solo verso main o verso il ramo di un compito ('$dest' non lo è): andare su un commit qualsiasi lo fa l'utente."
  fi
  metodo_in_arrivo "$dest"
}
git_checkout_percorsi() { # vero se checkout lavora su percorsi e non cambia ramo
  local a k np=0 primo=""
  for k in "${!r[@]}"; do
    a="${r[$k]}"
    case "$a" in --) return 0 ;; -b|-B|--orphan|--detach) return 1 ;; -*) continue ;; esac
    np=$((np+1)); [ -z "$primo" ] && primo="$a"
  done
  [ "$np" -ge 2 ] && return 0
  [ -n "$primo" ] && [ -e "$(risolvi "$primo" "$gdir")" ] && return 0
  return 1
}
git_percorsi() { # checkout e restore: i percorsi sono scritture (dopo "--", o file che esistono; per restore sempre)
  local k=0 a dopo=0 tutti=0
  [ "$sub" = restore ] && tutti=1
  while [ "$k" -lt "${#r[@]}" ]; do
    a="${r[$k]}"
    if [ "$dopo" = 1 ]; then percorso_git "$k"; k=$((k+1)); continue; fi
    case "$a" in
      --) dopo=1 ;;
      --pathspec-from-file|--pathspec-from-file=*) block "git $sub --pathspec-from-file non si controlla: scrivi i percorsi per intero." ;;
      -b|-B|--orphan|-s|--source|--conflict) k=$((k+1)) ;;
      -*) ;;
      *) if [ "$tutti" = 1 ] || [ -e "$(risolvi "$a" "$gdir")" ] || [[ "$a" == :* ]]; then percorso_git "$k"; fi ;;
    esac
    k=$((k+1))
  done
  return 0
}
git_merge() { # ci si allinea solo con origin/main; un'unione che crea un commit solo da codice a chiusura
  local k a ff=0; local -a pos=()
  { ha --abort || ha --quit; } && return 0
  for k in "${!r[@]}"; do
    a="${r[$k]}"
    [[ "${rs[$k]}" == *d* ]] && block "git merge con argomenti decisi da variabili non si controlla."
    case "$a" in
      --ff-only) ff=1 ;;
      --no-edit|--continue|-q|--quiet|--stat|--no-stat|--log|--no-log) ;;
      -*) block "git merge $a non serve nel metodo: ci si allinea con git merge --ff-only origin/main, oppure --no-edit se il ramo ha già commit." ;;
      *) pos+=("$a") ;;
    esac
  done
  if ha --continue; then
    case "$fase" in codice|revisione|chiusura) controlla_commit; return 0 ;; esac
    block "un'unione si conclude nelle fasi codice, revisione o chiusura."
  fi
  { [ "${#pos[@]}" -eq 1 ] && [ "${pos[0]}" = origin/main ]; } || \
    block "ci si allinea solo con origin/main: git merge --ff-only origin/main (oppure --no-edit, se il ramo ha già commit)."
  metodo_in_arrivo origin/main
  [ "$ff" = 1 ] && return 0
  case "$fase" in codice|revisione|chiusura) ;; *) block "un git merge che crea un commit si fa solo nelle fasi codice, revisione e chiusura (fase attuale: $fase)." ;; esac
  controlla_commit
}
git_reset() { # reset senza commit (togliere file dall'indice) sì; spostare il ramo o riscrivere la cartella no
  local a k
  for k in "${!r[@]}"; do
    a="${r[$k]}"
    [ "$a" = -- ] && break
    case "$a" in
      --hard|--keep|--merge) block "git reset $a riscrive la cartella di lavoro: se serve davvero, lo esegue l'utente." ;;
      -*) continue ;;
    esac
    [[ "${rs[$k]}" == *d* ]] && block "git reset con argomenti decisi da variabili non si controlla."
    if [ "$a" != HEAD ] && [ ! -e "$(risolvi "$a" "$gdir")" ] && git -C "$gdir" rev-parse -q --verify "$a^{commit}" >/dev/null 2>&1; then
      block "git reset verso un commit sposta il ramo: se serve, lo esegue l'utente."
    fi
  done
  return 0
}
git_push() {
  local cur d s a k nopz=0; local -a pos=()
  cur="$(git -C "$gdir" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  [ "$cur" = main ] && block "sei su main: da qui non si spinge nulla. Spingi il ramo del compito."
  for k in "${!r[@]}"; do
    a="${r[$k]}"
    if [ "$nopz" = 1 ]; then nopz=0; continue; fi
    [[ "${rs[$k]}" == *d* ]] && block "git push con argomenti decisi da variabili non si controlla: scrivili per intero."
    case "$a" in
      --force|--force-with-lease|--force-with-lease=*|--force-if-includes|-f|--mirror|--all|--branches|--tags|--follow-tags|--delete|-d|--prune)
        block "git push $a non è permesso: si spinge solo il ramo del compito, senza forzare." ;;
      --repo|--repo=*|--receive-pack|--receive-pack=*|--exec|--exec=*) block "git push $a non si usa nel metodo." ;;
      -u|--set-upstream) block "git push -u scriverebbe nella configurazione di git, che la sandbox protegge: spingi con git push origin <ramo>." ;;
      -o|--push-option) nopz=1 ;;
      --*) ;;
      -*) [[ "$a" == *f* || "$a" == *d* || "$a" == *u* ]] && block "git push $a non è permesso: si spinge solo il ramo del compito, senza forzare, con git push origin <ramo>." ;;
      *) pos+=("$a") ;;
    esac
  done
  if [ "${#pos[@]}" -le 1 ]; then
    [ "$(git -C "$gdir" config --get push.default 2>/dev/null)" = matching ] && block "con push.default=matching un git push senza ramo spingerebbe anche main."
    d="$(git -C "$gdir" rev-parse --abbrev-ref --symbolic-full-name '@{push}' 2>/dev/null)"
    case "$d" in main|*/main) block "il ramo corrente si spingerebbe su main: spingilo con il suo nome (git push origin <ramo>)." ;; esac
  fi
  for a in "${pos[@]:1}"; do
    [[ "$a" == +* ]] && block "una destinazione con + forza la spinta: non è permesso."
    [[ "$a" == :* ]] && block "una destinazione senza sorgente cancella un ramo remoto: non è permesso."
    [[ "$a" == *'*'* ]] && block "una destinazione con * spingerebbe più rami: non è permesso."
    s="${a%%:*}"; s="${s#refs/heads/}"; s="${s#heads/}"   # la sorgente: solo HEAD o un ramo del metodo, mai stash o commit sciolti
    { [[ "${s^^}" == HEAD ]] || [[ "$s" =~ $RAMI_OK ]]; } || block "si spinge solo HEAD o un ramo del metodo, non '$s': stash, commit sciolti e altri riferimenti non passano dal controllo del commit."
    d="${a##*:}"; d="${d#refs/heads/}"; d="${d#heads/}"
    [ "$d" = main ] && block "non si spinge su main: si apre una pull request dal ramo del compito."
    case "$d" in refs/tags/*|tags/*|v[0-9]*) block "i tag di rilascio li crea l'utente." ;; esac
  done
  return 0
}
git_config() {
  local a lettura=0 nposit=0
  for a in "${r[@]}"; do
    case "$a" in
      --unset|--unset-all|--add|--replace-all|--rename-section|--remove-section|--edit|-e|set|unset|edit|rename-section|remove-section)
        block "la configurazione di git la cambia l'utente." ;;
      --get|--get-all|--get-regexp|--get-urlmatch|--get-color|--get-colorbool|--list|-l|get|list) lettura=1 ;;
      -*) ;;
      *) nposit=$((nposit+1)) ;;
    esac
  done
  [ "$lettura" = 1 ] || [ "$nposit" -le 1 ] || block "la configurazione di git la cambia l'utente."
  return 0
}

# --- gh ---------------------------------------------------------------------------------------------
analizza_gh() { # $1 indice di "gh" in argv
  local i="$1" j a k m=""; local -a p=() w=()
  for ((j=i+1; j<n; j++)); do
    a="${argv[$j]}"
    case "$a" in -R|--repo|--hostname) j=$((j+1)); continue ;; -R*|--repo=*|--hostname=*) continue ;; esac
    p+=("$a")
  done
  for a in "${p[@]}"; do [[ "$a" == -* ]] || w+=("$a"); done
  case "${w[0]:-}" in
    pr) for a in "${w[@]:1}"; do [ "$a" = merge ] && block "le pull request le unisce l'utente, su GitHub, dopo aver guardato la CI."; done
        if [ "${w[1]:-}" = create ] && [ "$fase" != chiusura ]; then   # una pull request di compito alla volta: la apre /chiudi-compito
          [[ "$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)" == prova-* ]] || \
            block "la pull request di un compito si apre in fase chiusura, con /chiudi-compito (fase attuale: $fase). Fuori dalla chiusura solo da un ramo prova-*."
        fi ;;
    api)
      for k in "${!p[@]}"; do
        a="${p[$k]}"
        case "$a" in
          -X|--method) m="${p[$((k+1))]:-}" ;;
          -X*) m="${a#-X}" ;;
          --method=*) m="${a#*=}" ;;
          -f|-F|--field|--raw-field|--input|-f?*|-F?*|--field=*|--raw-field=*|--input=*) block "gh api con campi o con un file in ingresso scrive: con l'API si legge e basta." ;;
        esac
      done
      m="${m^^}"; [ -n "$m" ] && [ "$m" != GET ] && block "gh api con il metodo $m scrive: con l'API si legge e basta." ;;
    repo) case "${w[1]:-}" in
            edit|delete|rename|archive|unarchive|set-default) block "le impostazioni del repository le cambia l'utente." ;;
            clone) block "gh repo clone non si usa nel metodo, come git clone: nel progetto creerebbe un repository annidato, che git non attraversa; fuori non serve a nessun compito. Se serve davvero, lo fa l'utente nel suo terminale." ;;
            create|fork) block "gh repo ${w[1]} crea un repository su GitHub (e con --clone lo clona qui): lo fa l'utente." ;;
            sync) block "gh repo sync aggiorna rami (anche con --force): nel metodo non serve." ;;
          esac ;;
    secret) case "${w[1]:-}" in set|delete|remove) block "i segreti di GitHub li scrive l'utente: i valori non passano da Claude." ;; esac ;;
    release) case "${w[1]:-}" in create|delete|edit|upload|delete-asset) block "i rilasci li decide e li crea l'utente." ;; esac ;;
    auth) block "gh auth lo usa l'utente: stampa o cambia le credenziali." ;;
    config) block "gh config lo usa l'utente: legge e cambia la configurazione di gh, accesso a GitHub compreso." ;;
    alias|extension) case "${w[1]:-}" in set|delete|import|install|upgrade|remove|create|exec|clear-cache) block "gh ${w[0]} ${w[1]} cambia gh: lo fa l'utente." ;; esac ;;
    ruleset|cache|codespace|gpg-key|ssh-key) case "${w[1]:-}" in list|view|check|"") ;; *) block "gh ${w[0]} ${w[1]}: lo fa l'utente." ;; esac ;;
  esac
  return 0
}

# --- server -----------------------------------------------------------------------------------------
host_ok() { # verso i server si va solo con i nomi test e prod della configurazione SSH: così vale la conferma per prod
  local h="${1#*@}"; h="${h%%:*}"
  case "$h" in test|prod) return 0 ;; esac
  block "verso i server si usano solo i nomi test e prod della configurazione SSH (AVVIO.md): '$1' non va bene."
}
OPZ_SSH_O='connecttimeout|batchmode|serveraliveinterval|serveralivecountmax|loglevel|requesttty|connectionattempts'
opzione_o() { # $1 testo dopo -o: solo le chiavi che non cambiano destinazione e non eseguono programmi
  local k="${1%%[= ]*}"; k="${k,,}"
  [[ "$k" =~ ^($OPZ_SSH_O)$ ]] || block "l'opzione -o ${1%%[= ]*} non si usa verso i server: sono ammesse solo ConnectTimeout, BatchMode, ServerAliveInterval, ServerAliveCountMax, LogLevel, RequestTTY e ConnectionAttempts."
  return 0
}
rsync_lunga() { # opzioni lunghe di rsync ammesse
  case "$1" in
    --archive|--verbose|--compress|--recursive|--links|--perms|--times|--group|--owner|--devices|--specials|--human-readable|\
    --dry-run|--checksum|--update|--progress|--partial|--itemize-changes|--quiet|--hard-links|--delete|--delete-after|--delete-delay|\
    --stats|--mkpath|--numeric-ids|--omit-dir-times|--no-perms|--no-owner|--no-group|--no-times) return 0 ;;
    --exclude=*|--include=*|--exclude-from=*|--include-from=*|--filter=*|--chmod=*|--chown=*|--rsync-path=*|--timeout=*|--contimeout=*|--info=*) return 0 ;;
  esac
  return 1
}
credenziali_server() { # $1 percorso sul server, $2 come l'ha scritto Claude, $3 "copia" se è la sorgente di una copia
  # chiavi private e token; authorized_keys, known_hosts e le chiavi pubbliche (*.pub) restano liberi: FON-T07a e OPS-T01b li usano
  case "$1" in
    *.pub) ;;
    *.ssh/id_*|*.ssh/*_key|*.ssh/*.pem|*ssh_host_*_key|*.docker/config.json|*.config/gh/*|*.gnupg/*|*.git-credentials|*.netrc|*.pgpass)
      block "il comando arriverebbe alle credenziali del server ('$2'): chiavi private e token non si leggono né si copiano." ;;
  esac
  if [ "${3:-}" = copia ]; then   # copiare la cartella intera porterebbe con sé le chiavi private (anche quelle dell'host)
    case "$1" in *.ssh|*.docker|*.config|*.config/gh|*.gnupg|/etc|/etc/|/etc/ssh|/etc/ssh/) block "la copia comprenderebbe le credenziali del server ('$2'): copia solo i file che servono." ;; esac
  fi
  return 0
}
credenziali_locali() { # $1 percorso assoluto canonico, $2 come l'ha scritto Claude, $3 "contiene" (facoltativo)
  tocca_credenziali "$1" "${3:-}" && \
    block "il comando arriverebbe alle credenziali di questo computer ('$2'): chiavi SSH e GPG, accessi di Docker, GitHub e Stripe, portachiavi, profili dei browser e accesso di Claude Code non si leggono, non si copiano e non si montano (docs/due-postazioni.md, «Protezione del metodo»)."
  return 0
}
fuori_progetto() { # vero se la cartella in cui gira il comando è nota e fuori dal progetto
  [ "$CWD" != "?" ] && [[ "$CWD" != "$PROJECT_DIR_SLASH" && "$CWD" != "$PROJECT_DIR_SLASH"/* ]]
}
parola_locale() { # $1 parola di un comando, $2 "contiene" se il programma legge le cartelle per intero (legge_cartelle):
                  # niente credenziali di questo computer; fuori dalla sandbox nemmeno sessioni salvate
  local w="$1" v abs modo scritto; local -a cand=()
  case "$w" in --*=*) w="${w#*=}" ;; -*) return 0 ;; esac
  cand+=("$w")
  [[ "$w" == *=* ]] && cand+=("${w#*=}")
  [[ "$w" =~ (^|,)(source|src)=([^,]+) ]] && cand+=("${BASH_REMATCH[3]}")
  for v in "${cand[@]}"; do
    [ -n "$ESCLUSO" ] && [[ "$v" == *playwright/.auth* ]] && \
      block "il comando gira fuori dalla sandbox e nomina una sessione salvata delle prove ('$v'): è una credenziale, la usano solo i test, nella gabbia."
    scritto="$v"; modo="${2:-}"
    [[ "$v" == file://* ]] && v="${v#file://}"   # curl file:///…
    casa_in_chiaro "$v"; v="$CC"                # $HOME/…, ${HOME}/…, ~utente/…, /home/$USER/…
    if [[ "$v" == *[*?[{]* ]]; then             # caratteri jolly o graffe: conta la cartella fissa che li precede, con ciò che contiene
      v="${v%%[*?[{]*}"
      case "$v" in */*) v="${v%/*}"; [ -z "$v" ] && v=/ ;; "~"*) ;; *) v=. ;; esac
      modo=contiene
    fi
    # un percorso relativo si controlla quando il comando gira fuori dal progetto (dopo un cd)
    [[ "$v" == /* || "$v" == "~"* || "$v" == *..* || "$v" == [A-Za-z]:/* ]] || fuori_progetto || continue
    abs="$(risolvi "$v")"; [ "$abs" = "?" ] && continue
    credenziali_locali "$abs" "$scritto" "$modo"
  done
  return 0
}
legge_cartelle() { # $1 indice del programma: vero se legge le cartelle per intero (grep -r, rg, find, tar, zip, cp -r, diff -r, ln)
  local j a p="${argv[$1]##*/}"
  case "$p" in
    rg|ripgrep|ag|ack|ack-grep|ugrep|ug|rgrep|find|fd|fdfind|tar|bsdtar|gtar|zip|7z|7za|7zr|ln) return 0 ;;
    grep|egrep|fgrep|zgrep|cp|diff) ;;
    *) return 1 ;;
  esac
  for ((j=$1+1; j<n; j++)); do
    a="${argv[$j]}"
    case "$a" in
      --) return 1 ;;
      --recursive|--dereference-recursive|--directories=recurse) return 0 ;;
      --archive) [ "$p" = cp ] && return 0 ;;
      recurse) [[ "$p" == *grep ]] && return 0 ;;   # grep -d recurse
      --*) ;;
      -*[rR]*) return 0 ;;                          # grep -r -R, cp -r -R, diff -r
      -*a*) [ "$p" = cp ] && return 0 ;;            # cp -a
    esac
  done
  return 1
}
sorgente_locale() { # $1 percorso di questo computer che un comando fuori dalla sandbox legge: sorgenti di scp e rsync, volumi e cp di docker, «<»
  local t="$1" abs rel x r
  [[ "$t" == *[*?[{]* ]] && block "nei percorsi che un comando fuori dalla sandbox legge niente caratteri jolly né graffe ('$t'): scrivi i nomi per intero."
  abs="$(risolvi "$t")"
  [ "$abs" = "?" ] && block "dopo un cd che non si può risolvere, o con ~- e ~utente, un percorso letto fuori dalla sandbox non si controlla ('$t'): scrivilo per intero."
  credenziali_locali "$abs" "$t" contiene
  rel="$(rel_path "$abs")"
  { is_secret_file "$rel" || [[ "$rel" == playwright/.auth || "$rel" == playwright/.auth/* ]]; } && \
    block "il comando gira fuori dalla sandbox e leggerebbe '$t', che contiene segreti (un file di ambiente o una sessione salvata): non si copia, non si monta e non si legge."
  [[ "$PROJECT_DIR_SLASH" == "${abs%/}" || "$PROJECT_DIR_SLASH" == "${abs%/}"/* ]] && \
    block "il comando gira fuori dalla sandbox e prenderebbe tutta la cartella del progetto ('$t'), con i file di ambiente e le sessioni salvate: indica solo le cartelle che servono."
  [ -d "$abs" ] || return 0
  while IFS= read -r x; do
    r="$(rel_path "$abs/${x#./}")"
    { is_secret_file "$r" || [[ "$x" == */playwright/.auth ]]; } && \
      block "la cartella '$t' contiene segreti ('$r'): il comando gira fuori dalla sandbox e li leggerebbe. Indica solo i file che servono."
  done < <(cd "$abs" 2>/dev/null && find . -maxdepth 8 -name node_modules -prune -o \( -name .env -o -name '.env.*' -o -name '*.env' -o -path '*/playwright/.auth' \) -print 2>/dev/null)
  return 0
}
legge_file() { # $1 file letto con «<»: niente file di ambiente reali né credenziali; per un comando fuori dalla sandbox, come le sue sorgenti
  local abs
  abs="$(risolvi "$1")"
  [ "$abs" != "?" ] && is_secret_file "$(rel_path "$abs")" && \
    block "il comando legge un file di ambiente reale ('$1'). Usa i file *.example; quelli dei server li gestisce l'utente."
  parola_locale "$1"
  [ -n "$ESCLUSO" ] && sorgente_locale "$1"
  return 0
}
contesto_docker() { # $1 contesto di costruzione: docker lo legge fuori dalla sandbox, quindi niente cartelle che contengono le credenziali
  local abs
  [ "$1" = - ] && return 0
  [[ "$1" == *://* ]] && return 0
  abs="$(risolvi "$1")"
  [ "$abs" = "?" ] && block "il contesto di docker build dopo un cd che non si può risolvere, o con ~- e ~utente, non si controlla ('$1'): scrivilo per intero."
  credenziali_locali "$abs" "$1" contiene
  return 0
}
segreti_remoti() { # $1 comando che gira sul server: non deve arrivare ai segreti (file di ambiente, variabili dei processi)
  local riga w s prec="" pezzo
  local re_dc="^(dc|compose|docker-compose)[[:space:]'\"]" re_cfg="(^|[[:space:]'\"])(config|convert)([[:space:]'\"<>]|\$)"
  local re_ok="(^|[[:space:]'\"])(--no-env-resolution|-q|--quiet|--services|--images|--volumes|--networks|--profiles)([[:space:]'\"<>]|\$)"
  local re_env="(^|[[:space:]'\"])env([[:space:]'\"<>]|\$)" re_insp="(^|[[:space:]'\"])inspect([[:space:]'\"<>]|\$)"
  local re_insp_ok="(image|imagetools|manifest|volume|network|buildx|builder|context|plugin)[[:space:]'\"]+inspect([[:space:]'\"<>]|\$)"
  printf '%s' "$1" | grep -Eq 'printenv|/environ|process\.env|os\.environ|getenv|ENV\[' && \
    block "il comando sul server stamperebbe le variabili d'ambiente, che contengono i segreti: non si usa."
  # Il testo si divide ai separatori e a ogni dc/compose, anche dentro sh -c '…', dove le parole tra apici
  # restano unite: in ogni pezzo niente env e niente docker inspect di un container; docker compose config
  # (anche /srv/app/dc config), che scrive i valori dei file di ambiente, ha bisogno di un'opzione che non li
  # legge (--no-env-resolution) o che non stampa la configurazione (-q, --services, …)
  while IFS= read -r pezzo; do
    [[ "$pezzo" =~ $re_env ]] && block "il comando sul server stamperebbe le variabili d'ambiente ('env'), che contengono i segreti: non si usa, nemmeno dentro sh -c."
    [[ "$pezzo" =~ $re_insp ]] && ! [[ "$pezzo" =~ $re_insp_ok ]] && \
      block "docker inspect di un container sul server mostrerebbe le sue variabili d'ambiente, che contengono i segreti: non si usa, nemmeno dentro sh -c (per lo stato: dc ps, dc logs)."
    [[ "$pezzo" =~ $re_dc ]] && [[ "$pezzo" =~ $re_cfg ]] || continue
    [[ "$pezzo" =~ $re_ok ]] || block "docker compose config sul server (anche /srv/app/dc config) scrive nell'uscita i valori dei file di ambiente dei servizi, cioè i segreti: aggiungi --no-env-resolution (oppure usa -q, --services, --images, --volumes)."
  done < <(printf '%s\n' "$1" | tr ';|&()' '\n\n\n\n\n' | sed -E "s#(^|[[:space:]/'\"(])(dc|compose|docker-compose)([[:space:]'\"])#\1\n\2\3#g")
  while IFS= read -r riga; do
    [ "${riga%%$'\t'*}" = W ] || { prec=""; continue; }
    w="${riga#W$'\t'}"; s="${w%%$'\t'*}"; w="${w#*$'\t'}"
    [[ "$s" == *d* ]] && block "nel comando sul server niente variabili né \$(…): il server le espanderebbe con i suoi valori, che possono essere segreti. Scrivi i valori per intero."
    [[ "$s" == *g* || "$s" == *b* ]] && block "nel comando sul server niente caratteri jolly fuori dagli apici ('$w'): potrebbero arrivare ai file di ambiente. Scrivi i nomi per intero."
    case "$w" in
      env) block "il comando sul server stamperebbe le variabili d'ambiente ('env'), che contengono i segreti: non si usa." ;;
      inspect) case "$prec" in image|imagetools|manifest|volume|network|buildx|builder|context|plugin) ;; *) block "docker inspect di un container sul server mostrerebbe le sue variabili d'ambiente, che contengono i segreti: non si usa (per lo stato: dc ps, dc logs)." ;; esac ;;
      /srv/app/env|/srv/app/env/*) block "il comando sul server tocca la cartella dei file di ambiente ('$w'): quei file li legge e li scrive solo l'utente." ;;
    esac
    credenziali_server "$w" "$w"
    prec="$w"
    [[ "$w" == *.example* ]] && continue
    [[ "$w" == *.env* || "$w" == */env/* || "$w" == env/* ]] && is_secret_file "$w" && \
      block "il comando sul server nomina un file di ambiente con i segreti ('$w'): quei file li legge e li scrive solo l'utente."
  done < <(printf '%s' "$1" | awk -f "$TOKENIZER")
  return 0
}
analizza_ssh() { # $1 indice, $2 programma. ssh, scp e rsync girano fuori dalla sandbox: opzioni solo da un elenco
  local i="$1" prog="$2" j a v; local -a pos=() psg=()
  [ "$prog" = sftp ] && block "sftp non si usa nel metodo (legge comandi da eseguire sul tuo computer): per copiare file verso i server usa scp."
  case "$fase" in codice|revisione|chiusura) ;; *) block "i comandi verso i server (ssh, scp, rsync) si usano solo dentro un compito, nelle fasi codice, revisione e chiusura (fase attuale: $fase). Per un controllo in sola lettura chiedi all'utente di eseguirlo." ;; esac
  for ((j=i+1; j<n; j++)); do
    a="${argv[$j]}"
    [[ "${segni[$j]}" == *d* ]] && block "un comando verso i server con argomenti decisi da variabili non si controlla: scrivili per intero."
    if [ "$prog" = ssh ] && [ "${#pos[@]}" -gt 0 ]; then pos+=("$a"); psg+=("${segni[$j]}"); continue; fi   # dopo il server: il comando remoto
    case "$prog:$a" in
      *:--) for ((j=j+1; j<n; j++)); do pos+=("${argv[$j]}"); psg+=("${segni[$j]}"); done; break ;;
      ssh:-p|scp:-P) j=$((j+1)); continue ;;
      ssh:-o|scp:-o) opzione_o "${argv[$((j+1))]:-}"; j=$((j+1)); continue ;;
      ssh:-o?*|scp:-o?*) opzione_o "${a#-o}"; continue ;;
      ssh:-[46CTtqvNnx]*) [[ "${a:1}" =~ ^[46CTtqvNnx]+$ ]] && continue ;;
      scp:-[346CpqrTOv]*) [[ "${a:1}" =~ ^[346CpqrTOv]+$ ]] && continue ;;
      rsync:-e|rsync:--rsh) [ "${argv[$((j+1))]:-}" = ssh ] || block "con rsync si usa solo «-e ssh»: niente altri programmi né opzioni."; j=$((j+1)); continue ;;
      rsync:-e?*|rsync:--rsh=*) v="${a#-e}"; v="${v#--rsh=}"; [ "$v" = ssh ] || block "con rsync si usa solo «-e ssh»: niente altri programmi né opzioni."; continue ;;
      rsync:--*) rsync_lunga "$a" && continue ;;
      rsync:-*) [[ "${a:1}" =~ ^[avzrlptgoDhncuPiqH]+$ ]] && continue ;;
    esac
    case "$a" in -*) block "l'opzione $a di $prog non è fra quelle ammesse verso i server (docs/due-postazioni.md, «Protezione del metodo»)." ;; esac
    pos+=("$a"); psg+=("${segni[$j]}")
  done
  if [ "$prog" = ssh ]; then
    [ "${#pos[@]}" -gt 0 ] && host_ok "${pos[0]}"
    [ "${#pos[@]}" -gt 1 ] && segreti_remoti "${pos[*]:1}"
    [ -n "$qui_testo" ] && segreti_remoti "$qui_testo"     # ssh test <<< '…': anche quello gira sul server
    return 0
  fi
  local k p ultimo_k=$(( ${#pos[@]} - 1 ))
  for k in "${!pos[@]}"; do
    a="${pos[$k]}"
    if ! [[ "$a" =~ ^([^/@:]+@)?[A-Za-z0-9._-]+: ]]; then   # un percorso di questo computer
      { [ "${#pos[@]}" -ge 2 ] && [ "$k" -eq "$ultimo_k" ]; } || sorgente_locale "$a"   # una sorgente: scp e rsync la leggono fuori dalla sandbox
      continue
    fi
    host_ok "${a%%:*}"
    [ "${#pos[@]}" -ge 2 ] && [ "$k" -eq "$ultimo_k" ] && continue   # la destinazione sul server: lì non si legge nulla
    p="${a#*:}"; p="${p%/}"                                       # una sorgente sul server: non deve portare con sé i segreti
    { [ -z "$p" ] || [ "$p" = "~" ] || [ "$p" = "." ] || [ "$p" = /root ] || [[ "$p" =~ ^/home/[^/]+$ ]]; } && \
      block "copiare tutta la cartella dell'utente del server ('$a') prenderebbe anche le sue credenziali: copia solo i file che servono."
    credenziali_server "$p" "$a" copia
    [[ "$p" == *[*?[]* ]] && block "nei percorsi del server niente caratteri jolly ('$a'): scrivi i nomi per intero."
    [[ "$p" == / || "/srv/app/env" == "$p" || "/srv/app/env" == "$p"/* ]] && \
      block "la copia comprenderebbe la cartella dei file di ambiente del server ('$a'): quei file li gestisce solo l'utente. Copia solo le cartelle che servono."
  done
  if [ "${#pos[@]}" -ge 2 ]; then   # destinazione locale (copia dal server o copia locale): è una scrittura
    a="${pos[-1]}"; [[ "$a" =~ ^([^/@:]+@)?[A-Za-z0-9._-]+: ]] || scrive "$a" "${psg[-1]}"
  fi
  return 0
}

# --- docker -----------------------------------------------------------------------------------------
monta() { # una cartella dell'host montata in un container non deve contenere i file del metodo né il socket di Docker
  local abs s; abs="$(risolvi "$1")"
  [ "$abs" = "?" ] && block "un volume Docker dopo un cd che non si può risolvere non si controlla: scrivi il percorso per intero."
  protetto "$(rel_path "$abs")" && block "monta in un container i file del metodo ('$1')."
  antenato_protetto "$abs" && block "monta in un container una cartella che contiene i file del metodo ('$1'): monta solo la sottocartella che serve."
  for s in /var/run/docker.sock /run/docker.sock; do
    [[ "$s" == "${abs%/}" || "$s" == "${abs%/}"/* ]] && block "montare il socket di Docker in un container gli dà il controllo del computer: nel metodo non si usa."
  done
  sorgente_locale "$1"   # niente credenziali, file di ambiente o sessioni salvate nel container
  return 0
}
volume() { # -v sorgente:destinazione, --mount type=bind,source=…
  local v="$1" src
  if [[ "$v" == *source=* || "$v" == *src=* ]]; then src="$(sed -n -E 's/.*(source|src)=([^,]+).*/\2/p' <<< "$v")"; else src="${v%%:*}"; fi
  case "$src" in /*|.*|~*|[A-Za-z]:/*) monta "$src" ;; esac   # un nome senza / è un volume di Docker, non una cartella
  return 0
}
uscita_docker() { # -o/--output di build, save, export: scrive sul computer
  local v="$1" d
  if [[ "$v" == *dest=* ]]; then d="$(sed -n -E 's/.*dest=([^,]+).*/\1/p' <<< "$v")"; scrive "$d" ""
  elif [[ "$v" != *type=* ]]; then scrive "$v" ""; fi
  return 0
}
compose_controlla() { # "docker compose config" in sola lettura: che cosa montano e con quali permessi girano i servizi
  local out src abs
  [ "$CWD" = "?" ] && block "docker compose dopo un cd che non si può risolvere non si controlla."
  out="$(cd "$CWD" 2>/dev/null && docker compose "$@" config --format json 2>/dev/null)" || out=""
  [ -n "$out" ] || block "non riesco a leggere la configurazione di docker compose (docker compose … config): senza, non si può controllare che cosa monta. Se il file è giusto, il comando lo esegue l'utente."
  while IFS= read -r src; do [ -n "$src" ] && monta "$src"; done < <(jq -r '.services[]?.volumes[]? | select(.type == "bind") | .source // empty' <<< "$out" 2>/dev/null | tr -d '\r')
  while IFS= read -r src; do [ -n "$src" ] && monta "$src"; done < <(jq -r '.volumes[]?.driver_opts.device // empty' <<< "$out" 2>/dev/null | tr -d '\r')
  # i file che compose legge fuori dalla sandbox per i container e per la costruzione: niente credenziali di questo computer
  # (tr -d '\r': jq di Windows scrive CRLF; su Ubuntu non cambia nulla)
  while IFS= read -r src; do [ -n "$src" ] && sorgente_locale "$src"; done < <(jq -r '[(.secrets // {})[]?, (.configs // {})[]?] | .[] | .file? // empty' <<< "$out" 2>/dev/null | tr -d '\r')
  while IFS= read -r src; do
    [ -n "$src" ] || continue
    abs="$(risolvi "$src")"; [ "$abs" != "?" ] && credenziali_locali "$abs" "$src"
  done < <(jq -r '.services[]?.env_file? // empty | (if type == "array" then .[] else . end) | (if type == "object" then .path else . end) // empty' <<< "$out" 2>/dev/null | tr -d '\r')
  while IFS= read -r src; do [ -n "$src" ] && contesto_docker "$src"; done < <(jq -r '.services[]?.build? | objects | (.context // empty), ((.additional_contexts // {})[]?)' <<< "$out" 2>/dev/null | tr -d '\r')
  jq -e '[.services[]?.build? | objects | (.ssh // []) | length > 0] | any' <<< "$out" >/dev/null 2>&1 && \
    block "un servizio del file compose porterebbe nella costruzione l'agente SSH di questo computer (build.ssh), con l'accesso ai server: nel metodo non si usa."
  jq -e '[.services[]? | (.privileged == true) or ((.cap_add // []) | length > 0) or ((.devices // []) | length > 0)
          or ((.security_opt // []) | length > 0) or (.pid == "host") or (.userns_mode == "host") or (.network_mode == "host")
          or ((.volumes_from // []) | length > 0)] | any' <<< "$out" >/dev/null 2>&1 && \
    block "un servizio del file compose ha permessi speciali sul computer (privileged, cap_add, devices, security_opt, pid, rete o volumi dell'host): nel metodo non si usano."
  return 0
}
analizza_docker() { # $1 indice. Docker gira fuori dalla sandbox e un container può tutto: volumi, file compose e opzioni si controllano
  local i="$1" j a v sub="" csub="" salta k g c; local -a pos=() cglob=()
  for ((j=i+1; j<n; j++)); do
    a="${argv[$j]}"
    [[ "${segni[$j]}" == *d* ]] && block "docker gira fuori dalla sandbox: niente argomenti decisi da variabili, scrivili per intero."
    if [ -z "$sub" ]; then   # opzioni globali di docker, poi il sottocomando
      case "$a" in
        -H|--host|--host=*|--context|--context=*|--config|--config=*) block "docker $a cambia il demone o la configurazione di Docker: nel metodo non si usa." ;;
        -*) continue ;;
        *) sub="$a"; continue ;;
      esac
    fi
    if [ "$sub" = compose ] && [ -z "$csub" ]; then   # opzioni di compose, poi il suo sottocomando
      case "$a" in
        -f|--file|-p|--project-name|--project-directory|--env-file|--profile|--ansi|--progress|--parallel) cglob+=("$a" "${argv[$((j+1))]:-}"); j=$((j+1)); continue ;;
        -*) cglob+=("$a"); continue ;;
        *) csub="$a"; continue ;;
      esac
    fi
    case "$a" in
      --privileged|--cap-add|--cap-add=*|--device|--device=*|--security-opt|--security-opt=*|--volumes-from|--volumes-from=*|\
      --pid=host|--userns=host|--ipc=host|--uts=host|--cgroupns=host|--network=host|--net=host)
        block "docker $a dà al container accesso al computer: nel metodo non si usa." ;;
      --pid|--userns|--ipc|--uts|--cgroupns|--network|--net)
        [ "${argv[$((j+1))]:-}" = host ] && block "docker $a host dà al container accesso al computer: nel metodo non si usa."
        j=$((j+1)); continue ;;
      -v|--volume|--mount) volume "${argv[$((j+1))]:-}"; j=$((j+1)); continue ;;
      -v?*|--volume=*|--mount=*) v="${a#-v}"; v="${v#--volume=}"; v="${v#--mount=}"; volume "$v"; continue ;;
      -o|--opt|--output)
        v="${argv[$((j+1))]:-}"; j=$((j+1))
        case "$sub" in
          volume) [[ "$v" == device=* ]] && monta "${v#device=}" ;;
          build|buildx|save|export|image) [ "$a" != --opt ] && uscita_docker "$v" ;;
        esac
        continue ;;
      --opt=device=*) monta "${a#--opt=device=}"; continue ;;
      --output=*) uscita_docker "${a#--output=}"; continue ;;
      --ssh|--ssh=*) block "docker $sub --ssh porterebbe nella costruzione l'agente SSH di questo computer, con l'accesso ai server: nel metodo non si usa." ;;
      --*) continue ;;
      -[a-zA-Z]*)   # opzioni corte in gruppo (-itv, -dv/x:/y): un -v può stare in fondo
        g="${a#-}"; salta=0
        for ((k=0; k<${#g}; k++)); do
          c="${g:$k:1}"
          case "$c" in
            [itdPq]) continue ;;
            v) if [ $((k+1)) -lt "${#g}" ]; then volume "${g:$((k+1))}"; else volume "${argv[$((j+1))]:-}"; salta=1; fi; break ;;
            *) break ;;   # il resto del gruppo è il valore di un'altra opzione
          esac
        done
        j=$((j+salta)); continue ;;
    esac
    pos+=("$a")
  done
  [ "$sub" = compose ] && case "$csub" in up|run|create|start|restart|watch) compose_controlla "${cglob[@]}" ;; esac
  if [ "$sub" = cp ] && [ "${#pos[@]}" -ge 2 ]; then
    if [[ "${pos[-1]}" != *:* ]]; then scrive "${pos[-1]}" ""   # dal container a questo computer: una scrittura
    else for ((k=0; k<${#pos[@]}-1; k++)); do [[ "${pos[$k]}" == *:* || "${pos[$k]}" == - ]] || sorgente_locale "${pos[$k]}"; done   # nel container: una lettura fuori dalla sandbox
    fi
  fi
  case "$sub" in   # il contesto di costruzione
    build) [ "${#pos[@]}" -ge 1 ] && contesto_docker "${pos[-1]}" ;;
    buildx|image|builder) [ "${pos[0]:-}" = build ] && [ "${#pos[@]}" -ge 2 ] && contesto_docker "${pos[-1]}" ;;
  esac
  return 0
}

# --- comandi che scrivono file ----------------------------------------------------------------------
analizza_scritture() { # $1 indice, $2 programma
  local i="$1" prog="$2" j a k inplace=0 script_dato=0 dest="" dsg="" tdir="" tx=0 start
  local -a pos=() psg=()
  for ((j=i+1; j<n; j++)); do
    a="${argv[$j]}"
    if [ "$a" = -- ]; then for ((j=j+1; j<n; j++)); do pos+=("${argv[$j]}"); psg+=("${segni[$j]}"); done; break; fi
    case "$a" in
      -*)
        case "$prog" in
          sed) case "$a" in -e|--expression|-f|--file) script_dato=1; j=$((j+1)) ;; --expression=*|--file=*) script_dato=1 ;; -l|--line-length) j=$((j+1)) ;; --in-place*) inplace=1 ;; --*) ;; *i*) inplace=1 ;; esac ;;
          perl|ruby) case "$a" in --*) ;; *i*) inplace=1 ;; esac; case "$a" in -e|-E|-[a-zA-Z]*e|-[a-zA-Z]*E) script_dato=1; codice_in_linea "${argv[$((j+1))]:-}"; j=$((j+1)) ;; esac ;;
          cp|mv|ln|install) case "$a" in -t|--target-directory) dest="${argv[$((j+1))]:-}"; dsg="${segni[$((j+1))]}"; j=$((j+1)) ;; --target-directory=*) dest="${a#*=}" ;; -S|--suffix|-m|--mode|-o|--owner|-g|--group) j=$((j+1)) ;; esac ;;
          truncate) case "$a" in -s|--size|-r|--reference) j=$((j+1)) ;; esac ;;
          curl) case "$a" in -o|--output) scrive "${argv[$((j+1))]:-}" "${segni[$((j+1))]}"; j=$((j+1)) ;; -O|--remote-name|-J|--remote-header-name) scrive "." "" ;;
                  -H|-d|-X|-u|-A|-e|-b|-c|-F|-T|--header|--user|--url|--data|--data-raw|--data-binary|--form|--upload-file|--request|--cookie|--cookie-jar|--user-agent|--referer) j=$((j+1)) ;; esac ;;
          wget) case "$a" in -O|--output-document|-P|--directory-prefix) scrive "${argv[$((j+1))]:-}" "${segni[$((j+1))]}"; j=$((j+1)) ;; esac ;;
          tar) case "$a" in -C|--directory) tdir="${argv[$((j+1))]:-}"; j=$((j+1)) ;; --directory=*) tdir="${a#*=}" ;; --extract|--get) tx=1 ;; --*) ;; *x*) tx=1 ;; esac ;;
          unzip) case "$a" in -d) tdir="${argv[$((j+1))]:-}"; j=$((j+1)) ;; esac ;;
          python|python3|node|deno|bun|php) case "$a" in -c|-e|--eval|-r|-p|--print) codice_in_linea "${argv[$((j+1))]:-}"; j=$((j+1)) ;; esac ;;
        esac ;;
      *) pos+=("$a"); psg+=("${segni[$j]}") ;;
    esac
  done
  case "$prog" in
    rm|rmdir|unlink|touch|truncate|mkdir|shred|tee) for k in "${!pos[@]}"; do scrive "${pos[$k]}" "${psg[$k]}"; done ;;
    chmod|chown|chgrp|setfacl|chattr) for k in "${!pos[@]}"; do [ "$k" -eq 0 ] && continue; scrive "${pos[$k]}" "${psg[$k]}"; done ;;
    mv) for k in "${!pos[@]}"; do scrive "${pos[$k]}" "${psg[$k]}"; done; [ -n "$dest" ] && scrive "$dest" "$dsg" ;;
    cp|ln|install) if [ -n "$dest" ]; then scrive "$dest" "$dsg"; elif [ "${#pos[@]}" -ge 2 ]; then scrive "${pos[-1]}" "${psg[-1]}"; fi ;;
    sed|perl|ruby) if [ "$inplace" = 1 ]; then start=1; [ "$script_dato" = 1 ] && start=0
                     for k in "${!pos[@]}"; do [ "$k" -ge "$start" ] && scrive "${pos[$k]}" "${psg[$k]}"; done; fi ;;
    dd) for k in "${!pos[@]}"; do [[ "${pos[$k]}" == of=* ]] && scrive "${pos[$k]#of=}" "${psg[$k]}"; done ;;
    tar) [[ "${pos[0]:-}" == *x* && "${pos[0]:-}" != */* ]] && tx=1; [ "$tx" = 1 ] && scrive "${tdir:-.}" "" ;;
    unzip|patch) scrive "${tdir:-.}" "" ;;
  esac
  return 0
}
codice_in_linea() { # codice passato a python -c, node -e e simili, o in un heredoc: niente file del metodo, segreti, git e server
  local senza_esempi
  echo "$1" | grep -Eqi '\.claude|CLAUDE(\.local)?\.md|AVVIO\.md|metodo\.md|due-postazioni|compito-corrente|registro/|postazione|corsie\.txt|gestionale-negozi/|\.local/state|\.git/' && \
    block "un programma in linea che nomina i file del metodo non è permesso."
  echo "$1" | grep -Eqi '\.ssh/|\.gnupg|\.docker/|\.config/(gh|stripe|google-chrome|chromium|bravesoftware|microsoft-edge)|hosts\.yml|keyrings|\.password-store|\.mozilla|snap/(firefox|chromium|thunderbird)|\.thunderbird|\.git-credentials|\.netrc|\.pgpass|\.credentials\.json|playwright/\.auth' && \
    block "un programma in linea che nomina le credenziali di questo computer o le sessioni salvate delle prove non è permesso."
  senza_esempi="$(printf '%s' "$1" | sed -E 's/[A-Za-z0-9._/-]*\.example[A-Za-z0-9._-]*//g')"
  printf '%s' "$senza_esempi" | grep -Eqi '\.env|/env/' && \
    block "un programma in linea che nomina un file di ambiente non è permesso: i segreti non si leggono. Usa i file *.example."
  printf '%s' "$1" | grep -Eq '(^|[^A-Za-z0-9_.-])(git|gh|ssh|scp|rsync|sftp|docker|curl|wget|sudo)([^A-Za-z0-9_.-]|$)' && \
    block "un programma in linea che lancia git, gh, ssh, docker, curl o wget non si controlla: esegui quel comando per intero, da solo."
  return 0
}
analizza_find() { # $1 indice: find con -delete o -exec di un comando che scrive scrive nelle cartelle di partenza
  local i="$1" j a scrive_qui=0; local -a radici=() rsg=()
  for ((j=i+1; j<n; j++)); do a="${argv[$j]}"; case "$a" in -*|'('|'!'|')') break ;; *) radici+=("$a"); rsg+=("${segni[$j]}") ;; esac; done
  for ((; j<n; j++)); do
    case "${argv[$j]}" in
      -delete|-fprint|-fprint0|-fprintf|-fls) scrive_qui=1 ;;
      -exec|-execdir|-ok|-okdir)
        case "${argv[$((j+1))]##*/}" in
          gh|ssh|scp|rsync|sftp|docker|podman|sudo|eval|curl|wget) block "con find -exec non si lancia ${argv[$((j+1))]##*/}: scrivi il comando per intero, da solo." ;;
          rm|rmdir|unlink|mv|cp|ln|install|tee|truncate|touch|chmod|chown|chgrp|sed|perl|dd|shred|git|bash|sh|python|python3|node) scrive_qui=1 ;;
        esac ;;
    esac
  done
  if [ "$scrive_qui" = 1 ]; then
    [ "${#radici[@]}" -eq 0 ] && { radici=("."); rsg=(""); }
    for j in "${!radici[@]}"; do scrive "${radici[$j]}" "${rsg[$j]}"; done
  fi
  return 0
}
cambia_cartella() { # $1 indice di cd o pushd
  local j=$(( $1 + 1 ))
  while [ "$j" -lt "$n" ] && [[ "${argv[$j]}" == -* && "${argv[$j]}" != - ]]; do j=$((j+1)); done
  if [ "$j" -ge "$n" ]; then CWD="$(canon_path "$HOME")"; return 0; fi
  if [[ "${segni[$j]}" == *g* || "${segni[$j]}" == *b* || "${argv[$j]}" == - ]]; then CWD="?"; return 0; fi
  casa_in_chiaro "${argv[$j]}"   # cd $HOME, cd ~utente: la cartella è nota
  if [[ "${segni[$j]}" == *d* ]] && [[ "$CC" == *'$'* || "$CC" == *'`'* ]]; then CWD="?"; return 0; fi
  CWD="$(risolvi "$CC")"
  return 0
}
legge_stdin() { # $1 indice, $2 programma (shell o interprete): vero se non ha né uno script né il codice in un argomento
  local j a opz=""
  case "$2" in   # le opzioni che prendono un valore: il valore non è lo script
    bash|sh|zsh|dash|ksh) opz=' -o +o -O +O --rcfile --init-file ' ;;
    python|python3) opz=' -W -X ' ;;
    node|deno|bun) opz=' -r --require --import --loader --experimental-loader ' ;;
    perl) opz=' -I -M -x ' ;;
    ruby) opz=' -I -r ' ;;
    php) opz=' -d -c -z ' ;;
  esac
  for ((j=$1+1; j<n; j++)); do
    a="${argv[$j]}"
    case "$a" in
      -s|-) return 0 ;;
      -*|+*) [[ "$opz" == *" $a "* ]] && j=$((j+1)); continue ;;
      *) return 1 ;;
    esac
  done
  return 0
}
GABBIA_OK='^(test|test:int|test:e2e|dev|worker|db:migrate|cli|--prova)$'
gabbia_comando() { # bash .claude/hooks/gabbia.sh <comando>: esce dalla sandbox, quindi la forma è una sola
  local i="$1"
  { [ "$i" = 0 ] && [ "$LIVELLO" = 1 ]; } || block "la gabbia va lanciata da sola: bash .claude/hooks/gabbia.sh <comando>, senza niente davanti e non dentro altri comandi."
  { [ "${argv[$i]}" = bash ] && [ "${argv[$((i+1))]}" = .claude/hooks/gabbia.sh ]; } || block "la gabbia si lancia esattamente così: bash .claude/hooks/gabbia.sh <comando>."
  [[ "$CWD" == "$PROJECT_DIR_SLASH" ]] || block "la gabbia si lancia dalla cartella del progetto."
  [[ "${argv[$((i+2))]:-}" =~ $GABBIA_OK ]] || block "nella gabbia girano solo test, test:int, test:e2e, dev, worker, db:migrate e cli (e --prova)."
  ESCLUSO="la gabbia"
}
comandi_pnpm() { # i comandi che usano il database, il server di sviluppo o il browser girano nella gabbia; il comando
                 # lanciato con exec o dlx (pnpx è pnpm dlx) si controlla come se fosse scritto da solo
  local i="$1" j a t e=-1 salva
  if [ "${argv[$i]##*/}" = pnpx ]; then e="$i"
  else for ((j=i+1; j<n; j++)); do case "${argv[$j]}" in exec|dlx) e="$j"; break ;; esac; done   # anche dopo -C <cartella> o --filter
  fi
  if [ "$e" -ge 0 ]; then
    for ((j=e+1; j<n; j++)); do
      a="${argv[$j]}"
      case "$a" in
        -c|--shell-mode)   # il resto della riga è un comando per la shell
          for ((t=j+1; t<n; t++)); do [[ "${segni[$t]}" == *d* ]] && block "pnpm exec -c con un testo deciso da variabili o comandi annidati non si controlla: scrivi il comando per intero."; done
          [ $((j+1)) -lt "$n" ] || return 0
          salva="$CWD"; analizza_testo "${argv[*]:$((j+1))}"; CWD="$salva"; return 0 ;;
        -C|--dir|-F|--filter|--filter-prod|--reporter|--loglevel|--workspace-concurrency|--resume-from|--package) j=$((j+1)); continue ;;
        -*) continue ;;
        playwright) break ;;   # lo controlla il ciclo qui sotto
      esac
      analizza_da "$j"; return 0
    done
  fi
  for ((j=i+1; j<n; j++)); do
    a="${argv[$j]}"
    case "$a" in
      -*|run|exec|dlx) continue ;;
      test:int|test:e2e|dev|worker|db:migrate|cli|playwright)
        if [ "$a" = playwright ]; then
          case "${argv[$((j+1))]:-}" in
            install|install-deps|uninstall) block "i browser di Playwright li installa (e li toglie) l'utente nel suo terminale, dopo FON-T01 e dopo ogni aggiornamento di Playwright: pnpm exec playwright install --with-deps (AVVIO.md §1). Nella sandbox non si può (scrive in ~/.cache/ms-playwright) e nella gabbia non è ammesso." ;;
            ''|--version|-V|--help|-h|merge-reports) return 0 ;;   # sola lettura, nessun browser: passano
            test) a=test:e2e ;;
            *) block "pnpm exec playwright ${argv[$((j+1))]} non si usa dalla sandbox: apre un browser o un server locale (show-report, show-trace, codegen, open, screenshot, pdf) oppure scrive fuori dal progetto. Le prove girano nella gabbia, bash .claude/hooks/gabbia.sh test:e2e, e i rapporti si leggono come file (playwright-report/, test-results/)." ;;
          esac
        fi
        block "pnpm $a non funziona nella sandbox (sul suo localhost non c'è il database): lancialo nella gabbia, da solo, con bash .claude/hooks/gabbia.sh $a." ;;
    esac
    return 0
  done
  return 0
}

# --- un comando semplice ----------------------------------------------------------------------------
analizza_da() { # $1 indice del nome del comando in argv
  local i="$1" prog j a salva pth ric="" modello
  [[ "${segni[$i]}" == *d* ]] && block "il nome del comando viene da una variabile o da un comando annidato: scrivilo per intero."
  prog="${argv[$i]##*/}"
  ultimo="$prog"
  case "$prog" in   # i comandi esclusi dalla sandbox: Claude Code li lascia fuori solo se sono scritti da soli
    docker|podman|ssh|scp|rsync|sftp)
      [ "$i" = 0 ] || block "$prog gira fuori dalla sandbox: va scritto per primo, senza variabili o altri comandi davanti."
      [ "${argv[$i]}" = "$prog" ] || block "scrivi $prog e basta, senza il percorso del programma."
      [ "$LIVELLO" = 1 ] && ESCLUSO="$prog" ;;
  esac
  # in qualunque comando: il nome della postazione, le credenziali di questo computer e i file di ambiente reali
  if legge_cartelle "$i"; then   # un programma che legge le cartelle per intero: niente cartelle che contengono le credenziali
    ric=contiene; fuori_progetto && credenziali_locali "$CWD" "$CWD" contiene
  fi
  modello=-1   # grep e simili: il primo argomento che non è un'opzione è il testo da cercare, non un file
  case "$prog" in
    grep|egrep|fgrep|zgrep|rgrep|rg|ripgrep|ag|ack|ack-grep|ugrep|ug)
      for ((j=i+1; j<n; j++)); do
        case "${argv[$j]}" in
          --) modello=$((j+1)); break ;;
          -e|-e?*|--regexp|--regexp=*|-f|-f?*|--file|--file=*|--files|--type-list) break ;;   # il testo sta in un'opzione, o non c'è
          -*) ;;
          *) modello="$j"; break ;;
        esac
      done ;;
  esac
  for ((j=i; j<n; j++)); do
    a="${argv[$j]}"
    [ "$j" = "$modello" ] && continue
    case "$a" in *imposta-postazione*|*hooks/imposta*) block "il nome della postazione lo imposta l'utente, nel suo terminale, una volta sola." ;; esac
    [ "$prog" = ssh ] || parola_locale "$a" "$ric"   # (per ssh gli argomenti sono il comando remoto)
    [[ "$a" == -* || "$a" == *.example* ]] && continue
    [ "$prog" = ssh ] && continue    # per ssh gli argomenti sono il comando remoto: lo controlla segreti_remoti
    if [[ "$a" == *.env* || "$a" == */env/* ]]; then
      pth="$a"; [[ "$a" =~ ^([^/@:]+@)?[A-Za-z0-9._-]+:(/.*)$ ]] && pth="${BASH_REMATCH[2]}"   # server:percorso
      case "$pth" in /*) ;; *) pth="$(rel_path "$(risolvi "$pth")")" ;; esac
      is_secret_file "$pth" && block "il comando legge o modifica un file di ambiente reale ('$a'). Usa i file *.example; quelli dei server li gestisce l'utente."
    fi
  done
  case "$prog" in
    sudo|su|doas|pkexec|runuser) block "i comandi con sudo li esegue l'utente." ;;
    eval) block "eval non è permesso: scrivi il comando per intero." ;;
    export|declare|typeset|readonly|local)
      for ((j=i+1; j<n; j++)); do [[ "${argv[$j]}" == -* ]] || variabile_vietata "${argv[$j]%%=*}"; done; return 0 ;;
    env)
      j=$((i+1))
      while [ "$j" -lt "$n" ]; do
        a="${argv[$j]}"
        case "$a" in
          -u|-C|-S|--unset|--chdir|--split-string) j=$((j+2)); continue ;;
          -*) j=$((j+1)); continue ;;
        esac
        if [[ "$a" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then variabile_vietata "${a%%=*}"; j=$((j+1)); continue; fi
        break
      done
      [ "$j" -lt "$n" ] && analizza_da "$j"; return 0 ;;
    command|builtin|exec|nohup|time|setsid|chronic|unbuffer)
      j=$((i+1)); while [ "$j" -lt "$n" ] && [[ "${argv[$j]}" == -* ]]; do j=$((j+1)); done
      [ "$j" -lt "$n" ] && analizza_da "$j"; return 0 ;;
    nice|ionice|stdbuf|timeout|flock)
      j=$((i+1))
      while [ "$j" -lt "$n" ] && [[ "${argv[$j]}" == -* ]]; do case "${argv[$j]}" in -n|-c|-s|-k|-w|-E|-o|-i|-e|--signal|--kill-after) j=$((j+1)) ;; esac; j=$((j+1)); done
      case "$prog" in timeout|flock) j=$((j+1)) ;; esac
      [ "$j" -lt "$n" ] && analizza_da "$j"; return 0 ;;
    bash|sh|zsh|dash|ksh)
      [[ "${argv[$((i+1))]:-}" == *gabbia.sh ]] && { gabbia_comando "$i"; return 0; }
      for ((j=i+1; j<n; j++)); do
        if [[ "${argv[$j]}" == -* && "${argv[$j]}" != --* && "${argv[$j]}" == *c* ]]; then
          [ $((j+1)) -lt "$n" ] || return 0
          [[ "${segni[$((j+1))]}" == *d* ]] && block "bash -c con un testo deciso da variabili o comandi annidati non si controlla: scrivi il comando per intero."
          salva="$CWD"; analizza_testo "${argv[$((j+1))]}"; CWD="$salva"; return 0
        fi
      done
      if legge_stdin "$i" "$prog"; then   # i comandi arrivano da stdin: da un heredoc (il record H) o da una stringa, altrimenti no
        [ "$hd_qui" = 1 ] && return 0
        [ -n "$qui_testo" ] && { salva="$CWD"; analizza_testo "$qui_testo"; CWD="$salva"; return 0; }
        block "una shell che legge i comandi da stdin (da una pipe o da un file con <) non si controlla: scrivi i comandi per intero, o esegui lo script per nome (bash <file>)."
      fi
      return 0 ;;
    python|python3|node|deno|bun|perl|ruby|php)
      if legge_stdin "$i" "$prog"; then   # il codice arriva da stdin: da un heredoc (lo controlla codice_in_linea, record H) o da una stringa
        if [ "$hd_qui" != 1 ]; then
          [ -n "$qui_testo" ] || block "un interprete che legge il codice da stdin (da una pipe o da un file con <) non si controlla: esegui lo script per nome."
          codice_in_linea "$qui_testo"
        fi
      fi ;;
    xargs|parallel)
      for ((j=i+1; j<n; j++)); do
        case "${argv[$j]##*/}" in rm|rmdir|unlink|mv|cp|ln|install|tee|truncate|touch|chmod|chown|chgrp|sed|perl|dd|shred|git|gh|ssh|scp|rsync|docker|bash|sh)
          block "con xargs un comando che scrive riceve argomenti che non si possono controllare: scrivi i percorsi per intero." ;;
        esac
      done
      return 0 ;;
    pnpm|pnpx) comandi_pnpm "$i"; return 0 ;;
    npm|npx|yarn|yarnpkg|bunx|corepack) block "nel progetto si usa pnpm: al posto di $prog usa pnpm (pnpm exec, pnpm dlx, pnpm view). npm serve solo all'utente, per installare pnpm (AVVIO.md §1)." ;;
    cd|pushd) cambia_cartella "$i"; return 0 ;;
    popd) CWD="?"; return 0 ;;
    find) analizza_find "$i"; return 0 ;;
    git) analizza_git "$i"; return 0 ;;
    gh) analizza_gh "$i"; return 0 ;;
    ssh|scp|sftp|rsync) analizza_ssh "$i" "$prog"; return 0 ;;
    docker|podman) analizza_docker "$i"; return 0 ;;
  esac
  analizza_scritture "$i" "$prog"
  return 0
}
analizza_comando() { # usa argv, segni, redir, rsegni, iredir, ncmd del chiamante
  local n=${#argv[@]} i=0 k
  for k in "${!redir[@]}"; do scrive "${redir[$k]}" "${rsegni[$k]}"; done
  [ "$n" -eq 0 ] && return 0
  ncmd=$((ncmd+1))
  while [ "$i" -lt "$n" ] && [[ "${argv[$i]}" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; do
    variabile_vietata "${argv[$i]%%=*}"
    i=$((i+1))
  done
  [ "$i" -lt "$n" ] && analizza_da "$i"
  for k in "${!iredir[@]}"; do legge_file "${iredir[$k]}"; done   # i file letti con «<»
  return 0
}
analizza_testo() { # $1 testo con uno o più comandi
  local -a argv=() segni=() redir=() rsegni=() iredir=() isegni=()
  local riga tipo s v attesa="" ncmd=0 ops="" dyn=0 hd_libero=0 ultimo="" hd_qui=0 qui_testo="" salva_h
  LIVELLO=$((LIVELLO+1))
  while IFS= read -r riga; do
    tipo="${riga%%$'\t'*}"; v="${riga#*$'\t'}"
    case "$tipo" in
      S) dyn=1; analizza_testo "${v//$'\001'/$'\n'}"; continue ;;                  # una sostituzione è un comando anche lei
      H) v="${v//$'\001'/$'\n'}"                                                   # il testo di un heredoc, secondo chi lo legge
         case "$ultimo" in
           ssh) segreti_remoti "$v" ;;
           bash|sh|zsh|dash|ksh) salva_h="$CWD"; analizza_testo "$v"; CWD="$salva_h" ;;
           python|python3|node|deno|bun|perl|ruby|php) codice_in_linea "$v" ;;
         esac
         continue ;;
      O)
        case "$v" in
          '>'|'>>'|'>|'|'<'|'<<'|'<<<'|'>&'|'<&'|'>>&') attesa="$v" ;;
          *) ops="$ops$v"; analizza_comando; argv=(); segni=(); redir=(); rsegni=(); iredir=(); isegni=(); hd_qui=0; qui_testo="" ;;
        esac
        continue ;;
    esac
    s="${v%%$'\t'*}"; v="${v#*$'\t'}"
    [[ "$s" == *d* ]] && dyn=1
    if [ -n "$attesa" ]; then
      case "$attesa" in
        '>'|'>>'|'>|') redir+=("$v"); rsegni+=("$s") ;;
        '>&'|'>>&') [[ "$v" =~ ^([0-9]+|-)$ ]] || { redir+=("$v"); rsegni+=("$s"); } ;;
        '<') iredir+=("$v"); isegni+=("$s") ;;
        '<<') [[ "$s" == *q* ]] || hd_libero=1; hd_qui=1 ;;   # senza apici la shell espande il testo dell'heredoc
        '<<<') qui_testo="$v" ;;
      esac
      attesa=""; continue
    fi
    argv+=("$v"); segni+=("$s")
  done < <(printf '%s' "$1" | awk -f "$TOKENIZER")
  analizza_comando
  LIVELLO=$((LIVELLO-1))
  if [ "$LIVELLO" = 0 ] && [ -n "$ESCLUSO" ]; then   # fuori dalla sandbox gira tutto ciò che sta nella riga: solo il comando
    { [ "$ncmd" -gt 1 ] || [[ "$ops" == *[\|\&\(\)]* ]]; } && \
      block "$ESCLUSO gira fuori dalla sandbox: va scritto da solo, senza altri comandi nella stessa riga (niente ;, &&, |, &, parentesi)."
    [ "$dyn" = 1 ] && block "$ESCLUSO gira fuori dalla sandbox: niente variabili, \$(…) o \`…\` nel comando. Scrivi i valori per intero."
    [ "$hd_libero" = 1 ] && block "$ESCLUSO gira fuori dalla sandbox: un heredoc va scritto con il delimitatore tra apici (<<'EOF'), così la shell non esegue niente del suo testo."
  fi
  return 0
}

analizza_testo "$cmd"
exit 0
