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
MSG_PROT="i file del metodo (.claude/, CLAUDE.md, CLAUDE.local.md, .mcp.json, .gitmodules, .github/CODEOWNERS, AVVIO.md, docs/metodo.md, docs/due-postazioni.md, il registro, .git, le impostazioni di Claude Code, la cartella di stato degli hook) li cambia solo l'utente"
LIVELLO=0      # 1 = il comando scritto da Claude; più su = dentro bash -c o una sostituzione
ESCLUSO=""     # il comando del primo livello che gira fuori dalla sandbox (settings.json, excludedCommands)

echo "$cmd" | grep -Eq -- '--no-verify' && block "--no-verify salta i controlli e non è permesso."

RE_ASSEGNA='^[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])?\+?='   # NOME=valore, anche con un indice (m[k]=v) e con «+=»
variabile_vietata() { # $1 nome di una variabile che il comando imposta: davanti a un comando, da sola, con env, export, declare e
                      # simili, come variabile di for e select, di read, mapfile e readarray, di printf -v; il nome vale anche
                      # scritto con «+» in fondo (NOME+=…) o con un indice (NOME[0]=…)
  local nome="${1%%[*}"; nome="${nome%+}"
  case "$nome" in
    GIT_*|GH_*|DOCKER_*|SSH_*|LD_*|CLAUDE_PROJECT_DIR|GESTIONALE_STATO_DIR|HOME|PATH|BASH_ENV|ENV|PS4|PROMPT_COMMAND|SHELLOPTS|BASHOPTS|\
    PAGER|MANPAGER|EDITOR|VISUAL|BROWSER)
      block "la variabile $nome cambia il repository, la cartella degli hook o il programma che un comando lancia (pager, editor, browser, file letti all'avvio della shell): non si imposta." ;;
  esac
  return 0
}
UTENTE="${USER:-${LOGNAME:-$(id -un 2>/dev/null)}}"
casa_in_chiaro() { # $1 parola -> CC: ~utente, $HOME e ${HOME} come ~; $PWD come ~+ e $OLDPWD come ~-; $XDG_CONFIG_HOME e
                   # $XDG_DATA_HOME con il loro valore su Ubuntu (~/.config, ~/.local/share); $USER e $LOGNAME con il nome dell'utente
  CC="$1"
  case "$CC" in
    '$HOME'|'$HOME/'*) CC="~${CC:5}" ;;
    '${HOME}'|'${HOME}/'*) CC="~${CC:7}" ;;
    '$PWD'|'$PWD/'*) CC="~+${CC:4}" ;;
    '${PWD}'|'${PWD}/'*) CC="~+${CC:6}" ;;
    '$OLDPWD'|'$OLDPWD/'*) CC="~-${CC:7}" ;;
    '${OLDPWD}'|'${OLDPWD}/'*) CC="~-${CC:9}" ;;
    '$XDG_CONFIG_HOME'|'$XDG_CONFIG_HOME/'*) CC="~/.config${CC:16}" ;;
    '${XDG_CONFIG_HOME}'|'${XDG_CONFIG_HOME}/'*) CC="~/.config${CC:18}" ;;
    '$XDG_DATA_HOME'|'$XDG_DATA_HOME/'*) CC="~/.local/share${CC:14}" ;;
    '${XDG_DATA_HOME}'|'${XDG_DATA_HOME}/'*) CC="~/.local/share${CC:16}" ;;
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
  case "$rel" in /*|[a-zA-Z]:/*)   # fuori dal progetto decide la sandbox, ma non per i comandi che girano fuori da lei
    tocca_credenziali "$abs" && block "il comando scriverebbe nelle credenziali di questo computer ('$rel'): non si scrivono, non si sostituiscono e non si cancellano (docs/due-postazioni.md, «Protezione del metodo»)."
    if [ -n "$ESCLUSO" ]; then case "$abs" in /tmp|/tmp/*|/dev/*) ;; *) block "$ESCLUSO gira fuori dalla sandbox: fuori dal progetto scrive solo in /tmp ('$rel'), perché lì nessun muro lo ferma." ;; esac; fi
    return 0 ;;
  esac
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
  [[ "${segni[$j]}" == *g* || "${segni[$j]}" == *b* ]] && block "il sottocomando di git ha caratteri jolly o graffe: scrivilo per intero."
  sub="${argv[$j]}"
  for ((k=j+1; k<n; k++)); do   # le opzioni che fanno eseguire a git un programma, e le uscite su file
    case "${argv[$k]}" in
      --upload-pack|--upload-pack=*|--receive-pack|--receive-pack=*|--exec|--exec=*|--extcmd|--extcmd=*|\
      --open-files-in-pager|--open-files-in-pager=*|--tool|--tool=*)
        block "git ${argv[$k]%%=*} fa eseguire a git un programma: nel metodo non si usa." ;;
      --output|--output-directory) scrive "${argv[$((k+1))]:-}" "${segni[$((k+1))]:-}" ;;
      --output=*|--output-directory=*) scrive "${argv[$k]#*=}" "" ;;
    esac
  done
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
    difftool|mergetool|send-email|instaweb|daemon|p4|svn|cvsimport|cvsexportcommit|cvsserver|archimport|quiltimport|\
    web--browse|imap-send|upload-pack|receive-pack|upload-archive|http-backend|shell|checkout-index)
      block "git $sub lancia programmi esterni o scrive file fuori dai controlli del metodo: nel metodo non si usa. Se serve, lo esegue l'utente." ;;
    bisect) [ "${r[0]:-}" = run ] && block "git bisect run esegue un comando a ogni passo: nel metodo non si usa." ;;
    grep) [ "$ON_WINDOWS" = 1 ] || for a in "${r[@]}"; do [[ "$a" == -O* ]] && block "git grep -O apre i file con un programma: nel metodo non si usa."; done ;;
    archive|format-patch) for k in "${!r[@]}"; do [ "${r[$k]}" = -o ] && scrive "${r[$((k+1))]:-}" "${rs[$((k+1))]:-}"; done ;;
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
  local i="$1" j a k m="" sg t; local -a p=() w=()
  for ((j=i+1; j<n; j++)); do
    a="${argv[$j]}"
    sg="${segni[$j]}"
    if [[ "$sg" == *g* ]]; then   # un carattere jolly conta solo se la parola potrebbe diventare un sottocomando (merg[e], m*): una
      t="$a"                     # parola con / . = : , @ fuori dalle parentesi quadre (un indirizzo con ?, un filtro di jq) no
      while [[ "$t" =~ ^(.*)\[[^]]*\](.*)$ ]]; do t="${BASH_REMATCH[1]}${BASH_REMATCH[2]}"; done
      [[ "$t" == *[/.=:,@]* ]] && sg="${sg//g/}"
    fi
    if [[ "$sg" == *[dgb]* ]]; then   # il titolo e il testo della pull request possono venire da un $(…); il resto no
      case "${argv[$((j-1))]}" in
        --title|-t|--body|-b) ;;
        *) case "$a" in --title=*|--body=*) ;; *) block "gh con argomenti decisi da variabili, comandi annidati, caratteri jolly o graffe non si controlla ('$a'): scrivili per intero (il testo della pull request può stare in --title, --body o in un file, con --body-file)." ;; esac ;;
      esac
    fi
    case "$a" in -R|--repo|--hostname) j=$((j+1)); continue ;; -R*|--repo=*|--hostname=*) continue ;; esac
    p+=("$a")
  done
  for a in "${p[@]}"; do [[ "$a" == -* ]] || w+=("$a"); done
  case "${w[0]:-}" in
    pr) for a in "${w[@]:1}"; do [ "$a" = merge ] && block "le pull request le unisce l'utente, su GitHub, dopo aver guardato la CI."; done
        [ "${w[1]:-}" = checkout ] && block "gh pr checkout cambia ramo come git switch, ma senza i controlli del metodo: usa git fetch origin e git switch."
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
    co) block "gh co è gh pr checkout: cambia ramo senza i controlli del metodo. Usa git fetch origin e git switch." ;;
    auth) block "gh auth lo usa l'utente: stampa o cambia le credenziali." ;;
    config) block "gh config lo usa l'utente: legge e cambia la configurazione di gh, accesso a GitHub compreso." ;;
    alias|extension) case "${w[1]:-}" in set|delete|import|install|upgrade|remove|create|exec|clear-cache) block "gh ${w[0]} ${w[1]} cambia gh: lo fa l'utente." ;; esac ;;
    ruleset|cache|codespace|gpg-key|ssh-key) case "${w[1]:-}" in list|view|check|"") ;; *) block "gh ${w[0]} ${w[1]}: lo fa l'utente." ;; esac ;;
  esac
  return 0
}

# --- server -----------------------------------------------------------------------------------------
host_ok() { # verso i server si va solo con i nomi test e prod della configurazione SSH, con il suo utente e la sua chiave:
           # così vale la conferma per prod, e Claude entra solo come deploy (AVVIO.md §1)
  local h="${1%%:*}"
  [[ "$h" == *@* ]] && block "verso i server non si sceglie l'utente ('$1'): lo decide la configurazione SSH (User deploy e la chiave di yoo, AVVIO.md §1). Scrivi solo test o prod."
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
    --stats|--mkpath|--numeric-ids|--omit-dir-times|--no-perms|--no-owner|--no-group|--no-times|--rsync-path=rsync) return 0 ;;
    --exclude=*|--include=*|--exclude-from=*|--include-from=*|--filter=*|--chmod=*|--chown=*|--timeout=*|--contimeout=*|--info=*) return 0 ;;
  esac
  return 1
}
credenziali_server() { # $1 percorso sul server, $2 come l'ha scritto Claude, $3 "copia" se è la sorgente di una copia
  # chiavi private e token; authorized_keys, known_hosts e le chiavi pubbliche (*.pub) restano liberi: FON-T07a e OPS-T01b li usano
  case "$1" in
    *.pub) ;;
    *.ssh/id_*|*.ssh/*_key|*.ssh/*.pem|*ssh_host_*_key|*.docker/config.json|*.config/gh/*|*.gnupg/*|*.git-credentials|*.netrc|*.pgpass|\
    */etc/pgbackrest|*/etc/pgbackrest/*|*pgbackrest.conf)
      block "il comando arriverebbe alle credenziali del server ('$2'): chiavi private, token e la configurazione di pgBackRest (chiavi S3 e cifratura) non si leggono né si copiano." ;;
  esac
  if [ "${3:-}" = copia ]; then   # copiare la cartella intera porterebbe con sé le chiavi private (anche quelle dell'host)
    case "$1" in *.ssh|*.docker|*.config|*.config/gh|*.gnupg|/etc|/etc/|/etc/ssh|/etc/ssh/) block "la copia comprenderebbe le credenziali del server ('$2'): copia solo i file che servono." ;; esac
  fi
  return 0
}
credenziali_locali() { # $1 percorso assoluto canonico, $2 come l'ha scritto Claude, $3 "contiene" (facoltativo), $4 una frase in più
  tocca_credenziali "$1" "${3:-}" && \
    block "il comando arriverebbe alle credenziali di questo computer ('$2'): chiavi SSH e GPG, accessi di Docker, GitHub e della Stripe CLI, portachiavi e password di pass, profili dei browser e della posta, file di credenziali di git, curl e PostgreSQL e accesso di Claude Code non si leggono, non si copiano e non si montano (docs/due-postazioni.md, «Protezione del metodo»).${4:+ $4}"
  return 0
}
MSG_NOME="Il nome intero di una credenziale non si scrive in nessun punto del comando, perché l'hook non distingue un comando che la legge da un testo che la cita: un testo così (una nota, una guida) scrivilo con Write o Edit, o con cat > file <<'EOF'; nel messaggio di un commit e nel titolo e nel testo di una pull request passa (-m, --message, --title, --body)."
fuori_progetto() { # vero se la cartella in cui gira il comando è nota e fuori dal progetto
  [ "$CWD" != "?" ] && [[ "$CWD" != "$PROJECT_DIR_SLASH" && "$CWD" != "$PROJECT_DIR_SLASH"/* ]]
}
coda_fissa() { # $1 parola con $(…), `…`, ${…} o $NOME -> la parte fissa che segue l'ultimo pezzo deciso al momento
  local r="$1" re='\$([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])(.*)$'
  [[ "$r" == *'$('* || "$r" == *'`'* || "$r" == *'${'* ]] && r="${r##*[)\`\}]}"
  while [[ "$r" =~ $re ]]; do r="${BASH_REMATCH[2]}"; done
  printf '%s' "$r"
}
coda_credenziali() { # $1 parte fissa di un percorso la cui base non si conosce (dopo un cd che non si può risolvere, con ~- o
                     # ~utente, o dopo una variabile o un $(…)), $2 come l'ha scritto Claude, $3 "contiene": si ferma se, con
                     # una base qualunque, porterebbe alle credenziali (gh/hosts.yml dopo un cd in ~/.config, .ssh/… dopo la casa)
  local r="$1" c t
  while :; do case "$r" in /*) r="${r#/}" ;; ./*) r="${r#./}" ;; ../*) r="${r#../}" ;; .|..) r="" ;; *) break ;; esac; done
  r="${r%/}"
  for c in "${CRED_LOCALI[@]}"; do
    [[ "$r" == */"$c" || "$r" == */"$c"/* ]] && credenziali_locali "$HOME_SLASH/$c" "$2"
    t="$c"
    while :; do   # la base può contenere la parte iniziale della credenziale: si confronta ogni sua coda
      [[ "$r" == "$t" || "$r" == "$t"/* ]] && credenziali_locali "$HOME_SLASH/$c" "$2"
      [ "${3:-}" = contiene ] && [ -n "$r" ] && [[ "$t" == "$r"/* ]] && credenziali_locali "$HOME_SLASH/$c" "$2"
      [[ "$t" == */* ]] || break
      t="${t#*/}"
    done
  done
  [ "${3:-}" = contiene ] && case "${r##*/}" in ""|home|"${HOME_SLASH##*/}") credenziali_locali "$HOME_SLASH" "$2" contiene ;; esac
  return 0
}
# Il nome intero di una credenziale di questo computer in un punto qualunque di una parola o di un testo: dopo un'opzione
# corta con «=» (-v=/…), dopo «@», «:», «,», in file://host/…, prima di una variabile (~/.config/gh/$f), in mezzo a una
# frase. La casa vale scritta per esteso, con ~, $HOME, ${HOME}, ~utente o /home/$USER; il percorso finisce al primo spazio,
# apice o operatore, e si prova intero e tagliato a ogni «:», «,», «;», «=», «$» e carattere jolly; «.», «..», le barre
# doppie e i collegamenti si risolvono. Con "testo" (un heredoc, che può essere lungo) contano solo i nomi scritti con la
# casa, senza risolvere i collegamenti.
FINE_PERCORSO=$' \t\n\'"`|&<>()'
PRIMA_PERCORSO=$' \t\n=:,;@<(\'"'
TAGLI_PERCORSO=':,;=$*?[{'
nomi_interi() { # $1 parola o testo, $2 "testo" (facoltativo)
  local t="$1" i n r c abs fatti=" "
  [[ "$t" == */* ]] || return 0
  if [[ "$t" == *'$'* ]]; then
    t="${t//'${HOME}'/$HOME_SLASH}"; t="${t//'$HOME'/$HOME_SLASH}"
    t="${t//'${XDG_CONFIG_HOME}'/$HOME_SLASH/.config}"; t="${t//'$XDG_CONFIG_HOME'/$HOME_SLASH/.config}"
    t="${t//'${XDG_DATA_HOME}'/$HOME_SLASH/.local/share}"; t="${t//'$XDG_DATA_HOME'/$HOME_SLASH/.local/share}"
    if [ -n "$UTENTE" ]; then t="${t//'${USER}'/$UTENTE}"; t="${t//'${LOGNAME}'/$UTENTE}"; t="${t//'$USER'/$UTENTE}"; t="${t//'$LOGNAME'/$UTENTE}"; fi
  fi
  [ -n "$UTENTE" ] && [[ "$t" == *"~$UTENTE/"* ]] && t="${t//"~$UTENTE/"/"~/"}"
  [ "${2:-}" = testo ] && [[ "$t" != *"$HOME_SLASH/"* && "$t" != *"~/"* ]] && return 0
  n=${#t}
  for ((i=0; i<n; i++)); do
    case "${t:i:1}" in
      '~') [[ "${t:i+1:1}" == / ]] || continue
           { [ "$i" = 0 ] || [[ "${t:i-1:1}" == ["$PRIMA_PERCORSO"] ]]; } || continue
           r="$HOME_SLASH${t:i+1}" ;;
      /) if [[ "${t:i:${#HOME_SLASH}+1}" == "$HOME_SLASH/" ]]; then r="${t:i}"   # la casa per esteso, in qualunque punto
         elif [ "${2:-}" != testo ] && { [ "$i" = 0 ] || [[ "${t:i-1:1}" == ["$PRIMA_PERCORSO"] ]]; }; then r="${t:i}"
         else continue; fi ;;
      *) continue ;;
    esac
    c="${r%%["$FINE_PERCORSO"]*}"
    while :; do   # il percorso intero, poi tagliato a ogni separatore, dall'ultimo al primo
      if [ -n "$c" ] && [[ "$fatti" != *" $c "* ]]; then
        fatti="$fatti$c "
        if [ "${2:-}" = testo ]; then abs="$(norm_path "$c")"; else abs="$(canon_path "$c")"; fi
        tocca_credenziali "$abs" && credenziali_locali "$abs" "$c" "" "$MSG_NOME"
      fi
      [[ "$c" == *["$TAGLI_PERCORSO"]* ]] || break
      c="${c%["$TAGLI_PERCORSO"]*}"
    done
  done
  return 0
}
parola_locale() { # $1 parola di un comando; $2 "contiene" se il programma legge le cartelle per intero (legge_cartelle),
                  # "antenati" per un programma qualunque (niente cartelle che contengono le credenziali; dopo una variabile conta
                  # solo la parte fissa), vuoto per uno che non legge il contenuto delle cartelle (SICURI); $3 i segni della
                  # parola: niente credenziali di questo computer; fuori dalla sandbox nemmeno sessioni salvate
  local w="$1" v abs modo scritto re_att='^-[A-Za-z0-9]+=?([/~@.$<].*)$'; local -a cand=() seg=()
  nomi_interi "$w"                              # il nome intero di una credenziale, in qualunque punto della parola
  case "$w" in
    --*=*) w="${w#*=}" ;;
    -*) [[ "$w" =~ $re_att ]] || return 0; w="${BASH_REMATCH[1]}" ;;   # il valore attaccato a un'opzione corta: -T/…, -C~/…, -v=/…
  esac
  cand+=("$w")
  if [[ "$w" == *=* ]]; then
    cand+=("${w#*=}")
    [[ "${w#*=}" == *:* ]] && { IFS=: read -ra seg <<< "${w#*=}"; cand+=("${seg[@]}"); }   # NOME=a:~/…: la shell espande ~ dopo i due punti
  fi
  [[ "$w" =~ (^|,)(source|src)=([^,]+) ]] && cand+=("${BASH_REMATCH[3]}")
  for v in "${cand[@]}"; do
    v="${v#[@<]}"                               # curl -d @file, curl -F campo=<file
    [ -n "$ESCLUSO" ] && [[ "$v" == *playwright/.auth* ]] && \
      block "il comando gira fuori dalla sandbox e nomina una sessione salvata delle prove ('$v'): è una credenziale, la usano solo i test, nella gabbia."
    scritto="$v"; modo="${2:-}"
    [[ "$v" == file://* ]] && v="${v#file://}"   # curl file:///…
    casa_in_chiaro "$v"; v="$CC"                # $HOME/…, ${HOME}/…, ~utente/…, /home/$USER/…, $PWD/…
    if [[ "${3:-}" == *d* ]] && [[ "$v" == *'$'* || "$v" == *'`'* ]]; then   # una parte decisa da una variabile o da un comando:
      coda_credenziali "$(coda_fissa "$v")" "$scritto" "${modo/antenati/}"; continue   # conta la parte fissa che la segue
    fi
    if [[ "$v" == *[*?[{]* ]]; then             # caratteri jolly o graffe: conta la cartella fissa che li precede, con ciò che contiene
      v="${v%%[*?[{]*}"
      case "$v" in */*) v="${v%/*}"; [ -z "$v" ] && v=/ ;; "~"*) ;; *) v=. ;; esac
      modo=contiene
    fi
    # un percorso relativo si controlla quando il comando gira fuori dal progetto (dopo un cd), o in una cartella che non si conosce
    [[ "$v" == /* || "$v" == "~"* || "$v" == *..* || "$v" == [A-Za-z]:/* ]] || fuori_progetto || [ "$CWD" = "?" ] || continue
    abs="$(risolvi "$v")"
    if [ "$abs" = "?" ]; then                   # la base non si conosce (dopo un cd che non si può risolvere, con ~- e ~utente)
      case "$v" in "~"*/*) v="${v#*/}" ;; "~"*) v="" ;; esac
      coda_credenziali "$v" "$scritto" "${modo/antenati/}"; continue
    fi
    credenziali_locali "$abs" "$scritto" "${modo/antenati/contiene}"
  done
  return 0
}
file_ambiente() { # $1 parola: niente file di ambiente reali, nemmeno come valore di un'opzione (--env-file=…, -f.env.app, src=…,
                  # @…) o prima di «:» e «,» (./.env.app:/x)
  local a="$1" v pth; local -a cand=()
  case "$a" in
    --*=*) cand+=("${a#*=}") ;;
    -*) [[ "$a" =~ ^-[A-Za-z0-9]+=?([./~].*)$ ]] && cand+=("${BASH_REMATCH[1]}") ;;
    *) cand+=("$a") ;;
  esac
  [[ "$a" =~ (^|[,=])(source|src)=([^,]+) ]] && cand+=("${BASH_REMATCH[3]}")
  for v in "${cand[@]}"; do [[ "$v" == ?*[:,]* ]] && cand+=("${v%%[:,]*}"); done
  for v in "${cand[@]}"; do
    v="${v#[@<]}"
    [[ "$v" == *.example* ]] && continue
    [[ "$v" == *.env* || "$v" == */env/* ]] || continue
    pth="$v"; [[ "$v" =~ ^([^/@:]+@)?[A-Za-z0-9._-]+:(/.*)$ ]] && pth="${BASH_REMATCH[2]}"   # server:percorso
    case "$pth" in /*) ;; *) pth="$(rel_path "$(risolvi "$pth")")" ;; esac
    is_secret_file "$pth" && block "il comando legge o modifica un file di ambiente reale ('$a'). Usa i file *.example; quelli dei server li gestisce l'utente."
  done
  return 0
}
testi_cercati() { # $1 indice da cui partono le opzioni, $2 programma (grep e simili): mette in SALTA gli indici dei testi da
                  # cercare, che non sono file (il valore di -e, o il primo argomento che non è un'opzione); il resto si controlla
  local j a g k c dato=0 corte lunghe
  case "$2" in
    rg|ripgrep) corte=efgtTmABCjMdEr
      lunghe=' --regexp --file --glob --iglob --type --type-not --type-add --max-count --after-context --before-context --context --threads --max-columns --max-depth --max-filesize --encoding --engine --pre --pre-glob --replace --sort --sortr --colors --context-separator --field-context-separator --field-match-separator --path-separator --ignore-file --dfa-size-limit --regex-size-limit ' ;;
    grep|egrep|fgrep|zgrep|rgrep) corte=efmABCdD
      lunghe=' --regexp --file --max-count --after-context --before-context --context --directories --devices --include --exclude --exclude-from --exclude-dir --label --binary-files --group-separator --max-depth --threads ' ;;
    *) corte=efmABCdDgGt
      lunghe=' --regexp --file --max-count --after-context --before-context --context --directories --devices --include --exclude --exclude-from --exclude-dir --label --glob --iglob --type --ignore-dir ' ;;
  esac
  for ((j=$1; j<n; j++)); do
    a="${argv[$j]}"
    case "$a" in
      --) [ "$dato" = 0 ] && SALTA="$SALTA$((j+1)) "; return 0 ;;
      --regexp) SALTA="$SALTA$((j+1)) "; dato=1; j=$((j+1)) ;;
      --regexp=*) SALTA="$SALTA$j "; dato=1 ;;
      --file|--file=*|--files|--type-list) dato=1; [ "$a" = --file ] && j=$((j+1)) ;;   # i testi in un file, che resta da controllare
      --*=*) ;;
      --*) [[ "$lunghe" == *" $a "* ]] && j=$((j+1)) ;;
      -?*)   # opzioni corte, anche in gruppo (-rne testo, -etesto): la prima che vuole un valore prende il resto o la parola dopo
        g="${a#-}"
        for ((k=0; k<${#g}; k++)); do
          c="${g:$k:1}"
          [[ "$corte" == *"$c"* ]] || continue
          if [ $((k+1)) -lt "${#g}" ]; then [ "$c" = e ] && { SALTA="$SALTA$j "; dato=1; }
          else [ "$c" = e ] && { SALTA="$SALTA$((j+1)) "; dato=1; }; j=$((j+1)); fi
          [ "$c" = f ] && dato=1
          break
        done ;;
      *) [ "$dato" = 0 ] && { SALTA="$SALTA$j "; dato=1; } ;;
    esac
  done
  return 0
}
testi_messaggio() { # $1 indice di git o di gh, $2 il programma: mette in SALTA il testo di un messaggio, che è una frase e non un
                    # percorso (git commit, tag, merge e stash con -m o --message; gh pr e gh issue con --title e --body)
  local j a sub=""
  for ((j=$1+1; j<n; j++)); do
    a="${argv[$j]}"
    if [ -z "$sub" ]; then
      case "$2:$a" in
        git:-C|gh:-R|gh:--repo|gh:--hostname) j=$((j+1)) ;;
        *:-*) ;;
        *) sub="$a"; case "$2:$sub" in git:commit|git:tag|git:merge|git:stash|gh:pr|gh:issue) ;; *) return 0 ;; esac ;;
      esac
      continue
    fi
    case "$2:$a" in
      *:--) return 0 ;;
      git:-m|git:--message|gh:-t|gh:--title|gh:-b|gh:--body) SALTA="$SALTA$((j+1)) "; j=$((j+1)) ;;
      git:--message=*|gh:--title=*|gh:--body=*) SALTA="$SALTA$j " ;;
      git:-[a-zA-Z]*m) SALTA="$SALTA$((j+1)) "; j=$((j+1)) ;;   # -am "…"
      git:-m?*) SALTA="$SALTA$j " ;;                            # -m"…"
    esac
  done
  return 0
}
separatori() { # $1 indice del programma, $2 le lettere delle opzioni corte che prendono un separatore, $3 le lunghe: il
               # separatore (cut -d/, sort -t /, paste -d,) va in SALTAP
  local j a g k
  for ((j=$1+1; j<n; j++)); do
    a="${argv[$j]}"
    case "$a" in
      --) return 0 ;;
      --*=*) [[ "$3" == *" ${a%%=*} "* ]] && SALTAP="$SALTAP$j " ;;
      --*) [[ "$3" == *" $a "* ]] && { SALTAP="$SALTAP$((j+1)) "; j=$((j+1)); } ;;
      -?*) g="${a#-}"
           for ((k=0; k<${#g}; k++)); do
             [[ "$2" == *"${g:$k:1}"* ]] || continue
             if [ $((k+1)) -lt "${#g}" ]; then SALTAP="$SALTAP$j "; else SALTAP="$SALTAP$((j+1)) "; j=$((j+1)); fi
             break
           done ;;
    esac
  done
  return 0
}
testi_non_percorsi() { # $1 indice del programma, $2 il programma: mette in SALTAP gli indici delle parole che per il programma sono
                       # un testo e non un percorso: lo script di sed, il programma di awk e il suo separatore, il codice in
                       # linea di un interprete, i separatori di cut, paste, sort, join e column, gli insiemi di tr, le parole
                       # di [[ … ]], i filtri di rsync. Lì una «/» iniziale e i caratteri jolly non indicano una cartella
                       # (sed -n '/^[0-9]/p', cut -d/, [[ $p == /* ]]); resta il controllo sui nomi interi delle credenziali
                       # e sui file di ambiente
  local j a dato=0
  case "$2" in
    '[['|'(('|tr) for ((j=$1+1; j<n; j++)); do SALTAP="$SALTAP$j "; done ;;
    cut|paste) separatori "$1" d ' --delimiter --delimiters --output-delimiter ' ;;
    sort) separatori "$1" t ' --field-separator ' ;;
    join) separatori "$1" t '' ;;
    column) separatori "$1" so ' --separator --output-separator ' ;;
    rsync) for ((j=$1+1; j<n; j++)); do case "${argv[$j]}" in --exclude=*|--include=*|--filter=*) SALTAP="$SALTAP$j " ;; esac; done ;;
    sed)
      for ((j=$1+1; j<n; j++)); do
        a="${argv[$j]}"
        case "$a" in
          --) [ "$dato" = 0 ] && SALTAP="$SALTAP$((j+1)) "; return 0 ;;
          -e|--expression) SALTAP="$SALTAP$((j+1)) "; dato=1; j=$((j+1)) ;;
          --expression=*) SALTAP="$SALTAP$j "; dato=1 ;;
          -f|--file) dato=1; j=$((j+1)) ;;
          --file=*) dato=1 ;;
          -l|--line-length) j=$((j+1)) ;;
          --*) ;;
          -*e) SALTAP="$SALTAP$((j+1)) "; dato=1; j=$((j+1)) ;;   # -ne '<script>'
          -*f) dato=1; j=$((j+1)) ;;
          -*) ;;
          *) [ "$dato" = 0 ] && { SALTAP="$SALTAP$j "; dato=1; } ;;
        esac
      done ;;
    awk|gawk|mawk|nawk)
      for ((j=$1+1; j<n; j++)); do
        a="${argv[$j]}"
        case "$a" in
          --) [ "$dato" = 0 ] && SALTAP="$SALTAP$((j+1)) "; return 0 ;;
          -F|--field-separator) SALTAP="$SALTAP$((j+1)) "; j=$((j+1)) ;;
          -F?*|--field-separator=*) SALTAP="$SALTAP$j " ;;
          -e|--source) SALTAP="$SALTAP$((j+1)) "; dato=1; j=$((j+1)) ;;
          -e?*|--source=*) SALTAP="$SALTAP$j "; dato=1 ;;
          -f|--file|-E|--exec) dato=1; j=$((j+1)) ;;
          -f?*|--file=*|--exec=*) dato=1 ;;
          -v|--assign|-i|--include|-l|--load|-W) j=$((j+1)) ;;
          -*) ;;
          *) [ "$dato" = 0 ] && SALTAP="$SALTAP$j "; return 0 ;;   # dopo il programma vengono i file e le assegnazioni
        esac
      done ;;
    perl|ruby)
      for ((j=$1+1; j<n; j++)); do
        case "${argv[$j]}" in --) return 0 ;; -e|-E|-[a-zA-Z]*e|-[a-zA-Z]*E) SALTAP="$SALTAP$((j+1)) "; j=$((j+1)) ;; esac
      done ;;
    python|python3|python3.[0-9]*|node|nodejs|deno|bun|php)
      for ((j=$1+1; j<n; j++)); do
        case "${argv[$j]}" in --) return 0 ;; -c|-e|--eval|-r|-p|--print) SALTAP="$SALTAP$((j+1)) "; j=$((j+1)) ;; esac
      done ;;
  esac
  return 0
}
legge_cartelle() { # $1 indice del programma: vero se legge le cartelle per intero (grep -r, rg, find, tar, zip, cp -r, diff -r, ln,
                   # git diff e git grep con --no-index)
  local j a p="${argv[$1]##*/}"
  case "$p" in
    rg|ripgrep|ag|ack|ack-grep|ugrep|ug|rgrep|find|fd|fdfind|tar|bsdtar|gtar|zip|7z|7za|7zr|ln) return 0 ;;
    git) for ((j=$1+1; j<n; j++)); do [ "${argv[$j]}" = --no-index ] && return 0; done; return 1 ;;
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
    { is_secret_file "$r" || [[ "$r" == playwright/.auth || "$r" == */playwright/.auth ]]; } && \
      block "la cartella '$t' contiene segreti ('$r'): il comando gira fuori dalla sandbox e li leggerebbe. Indica solo i file che servono."
  done < <(cd "$abs" 2>/dev/null && find . -maxdepth 8 -name node_modules -prune -o \( -name .env -o -name '.env.*' -o -name '*.env' -o -name .auth \) -print 2>/dev/null)
  return 0
}
legge_file() { # $1 file letto con «<», $2 i suoi segni: niente file di ambiente reali né credenziali; per un comando fuori
               # dalla sandbox, come le sue sorgenti
  local abs
  abs="$(risolvi "$1")"
  [ "$abs" != "?" ] && is_secret_file "$(rel_path "$abs")" && \
    block "il comando legge un file di ambiente reale ('$1'). Usa i file *.example; quelli dei server li gestisce l'utente."
  parola_locale "$1" "" "${2:-}"
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
MSG_CERCA="Se è il testo che cerchi con grep, cercalo con un grep semplice e da solo (ssh test 'grep -n <testo> <file>'), oppure scrivilo come 'en[v]': un grep da solo non esegue nulla, mentre in una pipe o dentro un altro comando l'hook non distingue il testo cercato da un comando."
grep_semplice() { # $1 comando che gira sul server: vero se è un solo grep (grep, egrep, fgrep), senza altri comandi, operatori,
                  # sostituzioni né heredoc: non esegue nulla, quindi le parole che cerca non sono comandi
  [ "$(printf '%s' "$1" | awk -f "$TOKENIZER" | awk -F'\t' '
        NR == 1 { p = ($1 == "W" && $2 !~ /[dgb]/) ? $3 : "" }
        $1 != "W" { altro = 1 }
        END { if (!altro && (p == "grep" || p == "egrep" || p == "fgrep")) print "si" }')" = si ]
}
segreti_remoti() { # $1 comando che gira sul server: non deve arrivare ai segreti (file di ambiente, variabili dei processi, chiavi)
  local riga w s prec="" pezzo piano testo inps=0 exec_visto=0 primo=1 solo_grep=0 wi=-1 ti=0 n=0 SALTA=" "; local -a argv=()
  local re_cartella_env='/srv/app/env([^A-Za-z0-9_.-]|$)'
  local re_dc="^(dc|compose|docker-compose)[[:space:]'\"]" re_cfg="(^|[[:space:]'\"])(config|convert)([[:space:]'\"<>]|\$)"
  local re_ok="(^|[[:space:]'\"])(--no-env-resolution|-q|--quiet|--services|--images|--volumes|--networks|--profiles)([[:space:]'\"<>]|\$)"
  local re_env="(^|[[:space:]'\"])env([[:space:]'\"<>]|\$)" re_insp="(^|[[:space:]'\"])inspect([[:space:]'\"<>]|\$)"
  # env scritto con il percorso (/usr/bin/env): va bene quando lancia un comando (la parola dopo non è un'opzione né
  # un'assegnazione), non quando stampa le variabili (in fondo, o con sole opzioni)
  local re_envp="(^|[[:space:]'\"])[^[:space:]'\"]*/env([[:space:]'\"<>]|\$)(.*)\$" re_lancia="^[[:space:]]+[A-Za-z0-9_./~][^[:space:]='\"]*([[:space:]'\"<>]|\$)"
  local resto dopo env_perc=""
  local MSG_ENVP="con il percorso (/usr/bin/env) 'env' si usa solo per lanciare un comando, scritto subito dopo: da solo, o con opzioni e assegnazioni, stamperebbe le variabili d'ambiente, che contengono i segreti."
  local re_insp_ok="(image|imagetools|manifest|volume|network|buildx|builder|context|plugin)[[:space:]'\"]+inspect([[:space:]'\"<>]|\$)"
  local re_elenco="(^|[[:space:]'\"])(export|declare|typeset|readonly)([[:space:]]+-[a-zA-Z]+)*[[:space:]'\"]*\$"
  local re_set="(^|[[:space:]'\"])set[[:space:]'\"]*\$" re_dollaro="\\\$[A-Za-z_{('\"]"
  # Il $ non si ammette in nessuna forma, nemmeno tra apici: sul server il testo può finire in una shell annidata (sh -c,
  # docker exec), che lo espanderebbe con i suoi valori
  [[ "$1" =~ $re_dollaro || "$1" == *'`'* ]] && \
    block "nel comando sul server niente \$NOME, \${…}, \$(…), \$'…' né \`…\`, nemmeno tra apici: il server, o una shell annidata (sh -c, docker exec), li espanderebbe con i suoi valori, che possono essere segreti. Scrivi i valori per intero."
  # I controlli sul testo valgono per il testo scritto e per come lo legge la shell del server (senza apici né barre
  # rovesciate: pr\intenv è printenv), una riga per comando. Il testo si divide ai separatori e a ogni dc/compose,
  # anche dentro sh -c '…', dove le parole tra apici restano unite: in ogni pezzo niente env, niente elenchi delle
  # variabili (export, declare, typeset, readonly senza nomi, set da solo) e niente docker inspect di un container;
  # docker compose config (anche /srv/app/dc config), che scrive i valori dei file di ambiente, ha bisogno di
  # un'opzione che non li legge (--no-env-resolution) o che non stampa la configurazione (-q, --services, …)
  # La cartella dei file di ambiente, in qualunque punto del testo: prima degli altri controlli, così il messaggio è il suo
  [[ "$1" =~ $re_cartella_env ]] && \
    block "il comando sul server tocca la cartella dei file di ambiente (/srv/app/env): quei file li legge e li scrive solo l'utente."
  # Un grep semplice e da solo non esegue nulla: le parole che cerca (env, inspect, printenv, process.env) non sono
  # comandi. Di quel grep i controlli sul testo guardano tutte le parole tranne quelle cercate (testi_cercati, SALTA):
  # il file letto resta controllato (grep -a . /proc/1/environ)
  if grep_semplice "$1"; then
    solo_grep=1
    while IFS= read -r riga; do w="${riga#W$'\t'}"; argv+=("${w#*$'\t'}"); done < <(printf '%s' "$1" | awk -f "$TOKENIZER")
    n=${#argv[@]}; testi_cercati 1 grep
    piano=""; for wi in "${!argv[@]}"; do [[ "$SALTA" == *" $wi "* ]] || piano="$piano${argv[$wi]} "; done
    wi=-1
  else
    piano="$(printf '%s' "$1" | awk -f "$TOKENIZER" | awk -F'\t' '$1 == "W" { printf "%s ", $3 } $1 == "O" { printf "\n" }')"
  fi
  for testo in "$1" "$piano"; do
    ti=$((ti+1)); [ "$solo_grep" = 1 ] && [ "$ti" = 1 ] && continue
    printf '%s' "$testo" | grep -Eq 'printenv|/environ|process\.env|(Deno|Bun)\.env|import\.meta\.env|os\.environ|getenv|ENV\[|%ENV|\$ENV\{|\$_ENV' && \
      block "il comando sul server contiene una parola che, come comando o in un programma, stampa le variabili d'ambiente, che contengono i segreti (printenv, /proc/…/environ, process.env, os.environ e simili): non si usa. $MSG_CERCA"
    while IFS= read -r pezzo; do
      [[ "$pezzo" =~ $re_env ]] && block "nel comando sul server la parola 'env' da sola non si usa, nemmeno dentro sh -c: come comando stamperebbe le variabili d'ambiente, che contengono i segreti, e come nome di cartella è quella dei file di ambiente, che legge e scrive solo l'utente. $MSG_CERCA"
      resto="$pezzo"
      while [[ "$resto" =~ $re_envp ]]; do   # ogni env scritto con il percorso, anche dentro sh -c
        dopo="${BASH_REMATCH[2]}${BASH_REMATCH[3]}"; resto="${BASH_REMATCH[3]}"
        [[ "$dopo" =~ $re_lancia ]] || block "nel comando sul server $MSG_ENVP"
      done
      [[ "$pezzo" =~ $re_elenco || "$pezzo" =~ $re_set ]] && \
        block "il comando sul server stamperebbe le variabili della shell (export, declare, typeset o readonly senza nomi, set da solo), che contengono i segreti: non si usa, nemmeno dentro sh -c."
      [[ "$pezzo" =~ $re_insp ]] && ! [[ "$pezzo" =~ $re_insp_ok ]] && \
        block "nel comando sul server la parola 'inspect' da sola non si usa, nemmeno dentro sh -c: docker inspect di un container mostrerebbe le sue variabili d'ambiente, che contengono i segreti (per lo stato: dc ps, dc logs). $MSG_CERCA"
      [[ "$pezzo" =~ $re_dc ]] && [[ "$pezzo" =~ $re_cfg ]] || continue
      [[ "$pezzo" =~ $re_ok ]] || block "docker compose config sul server (anche /srv/app/dc config) scrive nell'uscita i valori dei file di ambiente dei servizi, cioè i segreti: aggiungi --no-env-resolution (oppure usa -q, --services, --images, --volumes)."
    done < <(printf '%s\n' "$testo" | tr ';|&()' '\n\n\n\n\n' | sed -E "s#(^|[[:space:]/'\"(])(dc|compose|docker-compose)([[:space:]'\"])#\1\n\2\3#g")
  done
  while IFS= read -r riga; do
    if [ "${riga%%$'\t'*}" != W ]; then
      [ -n "$env_perc" ] && block "nel comando sul server $MSG_ENVP ('$env_perc')"
      prec=""; inps=0; exec_visto=0; primo=1; continue
    fi
    w="${riga#W$'\t'}"; s="${w%%$'\t'*}"; w="${w#*$'\t'}"; wi=$((wi+1))
    if [ -n "$env_perc" ]; then
      { [[ "$w" == -* ]] || [[ "$w" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; } && block "nel comando sul server $MSG_ENVP ('$env_perc $w')"
      env_perc=""
    fi
    [[ "$s" == *d* ]] && block "nel comando sul server niente variabili né \$(…): il server le espanderebbe con i suoi valori, che possono essere segreti. Scrivi i valori per intero."
    [[ "$s" == *g* || "$s" == *b* ]] && block "nel comando sul server niente caratteri jolly fuori dagli apici ('$w'): potrebbero arrivare ai file di ambiente. Scrivi i nomi per intero."
    # ps con l'opzione e (alla maniera BSD, senza trattino: ps e, ps auxe, ps eww) stampa l'ambiente dei processi
    if [ "$inps" = 1 ] && [[ "$w" =~ ^[a-zA-Z]*e[a-zA-Z]*$ ]]; then
      case "$prec" in
        -o|-O|-p|-q|-u|-U|-g|-G|-t|-C|-s|-k|--sort|--pid|--ppid|--user|--group|--tty|--format|--cols|--columns|--rows|--width|--quick-pid|--sid) ;;
        *) block "ps con l'opzione e mostra l'ambiente dei processi, che contiene i segreti: sul server non si usa (bastano ps aux o ps -ef)." ;;
      esac
    fi
    [ "${w##*/}" = ps ] && { [ "$primo" = 1 ] || [ "$exec_visto" = 1 ]; } && inps=1
    [ "$w" = exec ] && exec_visto=1
    primo=0
    if [[ "$SALTA" != *" $wi "* ]]; then   # non è il testo cercato da un grep semplice
      case "$w" in
        env) block "nel comando sul server la parola 'env' da sola non si usa: come comando stamperebbe le variabili d'ambiente, che contengono i segreti, e come nome di cartella è quella dei file di ambiente, che legge e scrive solo l'utente. $MSG_CERCA" ;;
        */env) env_perc="$w" ;;
        inspect) case "$prec" in image|imagetools|manifest|volume|network|buildx|builder|context|plugin) ;; *) block "nel comando sul server la parola 'inspect' da sola non si usa: docker inspect di un container mostrerebbe le sue variabili d'ambiente, che contengono i segreti (per lo stato: dc ps, dc logs). $MSG_CERCA" ;; esac ;;
      esac
    fi
    [[ "$w" =~ $re_cartella_env ]] && block "il comando sul server tocca la cartella dei file di ambiente ('$w'): quei file li legge e li scrive solo l'utente."
    credenziali_server "$w" "$w"
    prec="$w"
    [[ "$w" == *.example* ]] && continue
    [[ "$w" == *.env* || "$w" == */env/* || "$w" == env/* ]] && is_secret_file "$w" && \
      block "il comando sul server nomina un file di ambiente con i segreti ('$w'): quei file li legge e li scrive solo l'utente."
  done < <(printf '%s' "$1" | awk -f "$TOKENIZER")
  [ -n "$env_perc" ] && block "nel comando sul server $MSG_ENVP ('$env_perc')"
  letture_remote "$1" "~"
  return 0
}
parola_remota() { # $1 parola del comando sul server, $2 la cartella corrente sul server (~, un percorso, ? se non si sa): niente
                  # cartella né file di ambiente, niente credenziali del server, anche dopo un cd e con . e .. (la casa diventa
                  # /~). Si prova la parola intera e ogni suo pezzo che può essere un percorso: dopo «=», dopo «,» e «:», e
                  # tagliato al «:» o alla «,» che lo segue (-v ./env:/e, type=bind,source=/srv/app/env,target=/e)
  local w="$1" c t; local -a cand=() pezzi=()
  case "$w" in ""|-) return 0 ;; esac
  case "$w" in
    --*=*) w="${w#*=}" ;;
    -*) [[ "$w" =~ ^-[A-Za-z0-9]+=?([/~.].*)$ ]] || return 0; w="${BASH_REMATCH[1]}" ;;   # -v/srv/…, -f=/srv/…
  esac
  cand+=("$w")
  if [[ "$w" == *[=,:]* ]]; then
    IFS='=,' read -ra pezzi <<< "$w"
    for c in "${pezzi[@]}"; do
      [ -n "$c" ] && cand+=("$c")
      t="$c"; while [[ "$t" == *:* ]]; do t="${t%:*}"; [ -n "$t" ] && cand+=("$t"); done
    done
  fi
  for c in "${cand[@]}"; do percorso_remoto "$c" "$2" "$1"; done
  return 0
}
percorso_remoto() { # $1 percorso sul server, $2 la cartella corrente, $3 come l'ha scritto Claude
  local w="$1" p
  case "$w" in
    /*) p="$w" ;;
    "~"|"~/"*) p="/~${w#\~}" ;;
    "~"*) block "sul server niente ~utente ('$3'): scrivi il percorso per intero." ;;
    *) case "$2" in "?") return 0 ;; "~"|"~/"*) p="/~${2#\~}/$w" ;; *) p="$2/$w" ;; esac ;;
  esac
  p="$(norm_path "$p")"; [ -z "$p" ] && p=/
  case "$p" in /srv/app/env|/srv/app/env/*) block "il comando sul server tocca la cartella dei file di ambiente ('$3'): quei file li legge e li scrive solo l'utente." ;; esac
  case "$p" in
    */env.example/*|*.example|*.example.*) ;;
    *) is_secret_file "$p" && block "il comando sul server nomina un file di ambiente con i segreti ('$3'): quei file li legge e li scrive solo l'utente." ;;
  esac
  credenziali_server "$p" "$3"
  return 0
}
cartella_segreti_remota() { # $1 percorso normalizzato sul server (la casa è /~): vero se è una cartella che contiene i file di ambiente
                            # o le credenziali: /, /srv, /srv/app, /srv/app/env, /home, la cartella di un utente, /root, /etc
  case "$1" in /|/srv|/srv/app|/srv/app/env|/srv/app/env/*|/home|/root|/etc|/~) return 0 ;; esac
  [[ "$1" =~ ^/home/[^/]+$ ]]
}
LETTORI_REMOTI=' grep egrep fgrep zgrep rgrep rg ripgrep ag ack ack-grep find fd fdfind tar bsdtar gtar zip 7z 7za 7zr cp rsync scp gzip gunzip zcat zstd diff rclone '
SHELL_REMOTE=' sh bash dash zsh ksh mksh ash yash posh fish tcsh csh '
RISERVATE=' ! { } ( if then else elif fi do done while until esac time '
letture_remote() { # $1 comando che gira sul server, $2 la cartella in cui parte (~ se manca): ogni parola, risolta dalla cartella
                   # corrente (un cd la sposta), non porta alla cartella o ai file di ambiente né alle credenziali (parola_remota);
                   # una lettura per intero (grep -r, rg, find, tar, zip, cp -r, rsync), anche dentro sh -c '…' o docker exec, non
                   # parte da una cartella che li contiene (/, /srv, /srv/app, /home, la cartella di un utente, /root, /etc, le
                   # cartelle delle chiavi), né senza percorso dalla cartella corrente; tar -C sposta i nomi
  local riga w primo prog="" ric=0 dato=0 salta=0 dazione=0 tdir=0 tbase="" espr=0 shell=0 testo=0 inizio=1 ainizio=0 rcwd="~"
  local -a parole=()
  [ -n "${2:-}" ] && rcwd="$2"
  while IFS= read -r riga; do
    if [ "${riga%%$'\t'*}" != W ]; then [ "$prog" = cd ] && rcwd="~"; lettura_finita; inizio=1; shell=0; continue; fi   # cd da solo: la casa
    w="${riga#W$'\t'}"; w="${w#*$'\t'}"
    primo="$inizio"; inizio=0
    if [ "$testo" = 1 ]; then testo=0; letture_remote "$w" "$rcwd"; continue; fi   # sh -c '…': il testo è un altro comando
    parola_remota "$w" "$rcwd"
    if [ "$primo" = 1 ] && [[ "$RISERVATE" == *" $w "* ]]; then inizio=1; continue; fi   # if, then, do, !, {: il comando viene dopo
    if [ "$salta" = 1 ]; then salta=0; continue; fi                         # il valore di un'opzione
    if [ "$dazione" = 1 ]; then dazione=0; [ "$w" = recurse ] && ric=1; continue; fi   # grep -d recurse
    if [ "$tdir" = 1 ]; then tdir=0; tbase="$w"                             # tar -C <cartella>; su Windows -C e -c (crea) sono
      [ "$ON_WINDOWS" = 1 ] && [[ "$w" != -* ]] && parole+=("$w")            # la stessa parola: vale per tutte e due
      continue
    fi
    if [ "$primo" = 1 ]; then
      case "$w" in
        cd|pushd) prog=cd; continue ;;
        popd) block "sul server niente popd: scrivi cd con la cartella per intero." ;;
      esac
    fi
    if [ "$prog" = cd ]; then
      case "$w" in
        -) block "sul server niente cd -: scrivi la cartella per intero." ;;
        -*) continue ;;
        /*|"~"|"~/"*) rcwd="$w" ;;
        "~"*) block "sul server niente cd ~utente: scrivi la cartella per intero." ;;
        *) [ "$rcwd" = "?" ] || rcwd="$rcwd/$w" ;;
      esac
      [[ "$w" == *'$'* || "$w" == *'`'* ]] && rcwd="?"
      prog=""; continue
    fi
    if [ -z "$prog" ]; then   # fuori dagli argomenti di un lettore: una shell con -c, o un lettore (anche dopo docker exec, nice, xargs)
      [[ "$SHELL_REMOTE" == *" ${w##*/} "* ]] && { shell=1; continue; }
      if [ "$shell" = 1 ] && [[ "$w" =~ ^-[a-zA-Z]*c[a-zA-Z]*$ ]]; then testo=1; shell=0; continue; fi
      if [[ "$LETTORI_REMOTI" == *" ${w##*/} "* ]]; then
        prog="${w##*/}"; ainizio="$primo"
        case "$prog" in grep|egrep|fgrep|zgrep|cp|scp|gzip|gunzip|zcat|zstd|diff) ric=0 ;; *) ric=1 ;; esac   # questi solo con -r
      fi
      continue
    fi
    if [[ "$w" == -* ]]; then
      case "$prog" in
        grep|egrep|fgrep|zgrep|rgrep|rg|ripgrep|ag|ack|ack-grep) opzione_lettore "$w" ;;
        cp) [[ "$w" == --recursive || "$w" == --archive || "$w" =~ ^-[a-zA-Z]*[rRa] ]] && ric=1 ;;
        scp|gzip|gunzip|zcat|zstd|diff) [[ "$w" == --recursive || "$w" =~ ^-[a-zA-Z0-9]*[rR] ]] && ric=1 ;;
        tar|bsdtar|gtar) case "$w" in
                           -C|--directory) tdir=1 ;;
                           --directory=*) tbase="${w#*=}" ;;
                           -C?*) if [ "$ON_WINDOWS" = 0 ] || [[ "${w:2}" == [/~.]* ]]; then tbase="${w:2}"; fi ;;   # su Windows -czf è -c
                         esac ;;
        find) case "$w" in -L|-H|-P) ;; *) espr=1 ;; esac ;;   # dopo i percorsi viene l'espressione
      esac
      continue
    fi
    case "$prog" in
      grep|egrep|fgrep|zgrep|rgrep|rg|ripgrep|ag|ack|ack-grep|fd|fdfind) [ "$dato" = 0 ] && { dato=1; continue; } ;;   # il testo da cercare
      find) [ "$w" = '!' ] || [ "$w" = '(' ] && espr=1; [ "$espr" = 1 ] && continue ;;                        # l'espressione non è un percorso
    esac
    parole+=("$w")
  done < <(printf '%s' "$1" | awk -f "$TOKENIZER")
  lettura_finita
  return 0
}
opzione_lettore() { # $1 opzione di grep o rg sul server (usa le variabili di letture_remote): -r, -d recurse, il testo dopo -e e
                    # dopo -f, i valori delle altre opzioni, che non sono percorsi
  local w="$1" g k c corte=efmABCdD
  case "$prog" in rg|ripgrep) corte=efgtTmABCjMdEr ;; esac
  case "$w" in
    --recursive|--dereference-recursive|--directories=recurse) ric=1; return 0 ;;
    --regexp|--file) dato=1; salta=1; return 0 ;;
    --regexp=*|--file=*) dato=1; return 0 ;;
    --directories) dazione=1; return 0 ;;
    --max-count|--after-context|--before-context|--context|--include|--exclude|--exclude-from|--exclude-dir|--label|--binary-files|\
    --group-separator|--glob|--iglob|--type|--type-not|--type-add|--threads|--max-columns|--max-depth|--max-filesize|--encoding|\
    --engine|--pre|--pre-glob|--replace|--sort|--sortr|--colors|--ignore-file) salta=1; return 0 ;;
    --*) return 0 ;;
  esac
  g="${w#-}"
  for ((k=0; k<${#g}; k++)); do
    c="${g:$k:1}"
    case "$prog" in rg|ripgrep) ;; *) [[ "$c" == [rR] ]] && { ric=1; continue; } ;; esac
    [[ "$corte" == *"$c"* ]] || continue
    if [ $((k+1)) -lt "${#g}" ]; then   # il valore attaccato all'opzione
      case "$c" in e|f) dato=1 ;; d) [ "${g:$((k+1))}" = recurse ] && ric=1 ;; esac
    else                                # il valore è la parola dopo
      case "$c" in e|f) dato=1; salta=1 ;; d) case "$prog" in rg|ripgrep) salta=1 ;; *) dazione=1 ;; esac ;; *) salta=1 ;; esac
    fi
    return 0
  done
  return 0
}
lettura_finita() { # usa prog, ric, parole, tbase, ainizio e rcwd di letture_remote: controlla le cartelle lette, poi riparte da zero
  local x
  if [ "$ric" = 1 ]; then
    if [ "${#parole[@]}" -eq 0 ] && [ "$ainizio" = 1 ]; then
      case "$prog" in grep|egrep|fgrep|zgrep|rgrep|rg|ripgrep|ag|ack|ack-grep|find|fd|fdfind) lettura_remota . "$prog senza percorso, cioè la cartella corrente" ;; esac
    fi
    for x in "${parole[@]}"; do
      [ -n "$tbase" ] && case "$x" in /*|"~"|"~/"*) ;; *) x="$tbase/$x" ;; esac   # tar -C <cartella>: i nomi partono da lì
      lettura_remota "$x" "$x"
    done
  fi
  prog=""; ric=0; dato=0; salta=0; dazione=0; tdir=0; tbase=""; espr=0; ainizio=0; parole=()
}
lettura_remota() { # $1 cartella del server letta per intero, $2 come l'ha scritta Claude
  local p="$1"
  case "$p" in
    /*) ;;
    "~"|"~/"*) p="/~${p#\~}" ;;
    *) case "$rcwd" in
         "?") block "sul server, dopo un cd che non si può risolvere, una lettura per intero non si controlla ('$2'): scrivi la cartella per intero." ;;
         "~"|"~/"*) p="/~${rcwd#\~}/$p" ;;
         *) p="$rcwd/$p" ;;
       esac ;;
  esac
  p="$(norm_path "$p")"; p="${p%/}"; [ -z "$p" ] && p=/
  cartella_segreti_remota "$p" && \
    block "una lettura per intero di '$2' sul server arriverebbe ai file di ambiente o alle credenziali (/srv/app/env, le chiavi, il token di GHCR): indica la cartella che serve (per esempio /srv/app/infra)."
  credenziali_server "$p" "$2" copia
  return 0
}
analizza_ssh() { # $1 indice, $2 programma. ssh, scp e rsync girano fuori dalla sandbox: opzioni solo da un elenco
  local i="$1" prog="$2" j a v rcmd=0; local -a pos=() psg=()
  [ "$prog" = sftp ] && block "sftp non si usa nel metodo (legge comandi da eseguire sul tuo computer): per copiare file verso i server usa scp."
  case "$fase" in codice|revisione|chiusura) ;; *) block "i comandi verso i server (ssh, scp, rsync) si usano solo dentro un compito, nelle fasi codice, revisione e chiusura (fase attuale: $fase). Per un controllo in sola lettura chiedi all'utente di eseguirlo." ;; esac
  for ((j=i+1; j<n; j++)); do
    a="${argv[$j]}"
    [[ "${segni[$j]}" == *d* ]] && block "un comando verso i server con argomenti decisi da variabili non si controlla: scrivili per intero."
    if [ "$prog" = ssh ] && [ "${#pos[@]}" -gt 0 ]; then   # dopo il server OpenSSH legge ancora le opzioni, fino al comando remoto
      if [ "$rcmd" = 1 ] || [[ "$a" != -* ]]; then rcmd=1; pos+=("$a"); psg+=("${segni[$j]}"); continue; fi
    fi
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
  # scp e rsync prendono per un server ogni argomento che ha i due punti prima della prima barra ([prod]:/x, root@[test]:/x,
  # @test:/x, scp://test/x): qui si ammettono solo test:<percorso> e prod:<percorso>, così valgono i controlli sul percorso
  # e la conferma per la produzione
  local k p ultimo_k=$(( ${#pos[@]} - 1 )) re_server='^[A-Za-z0-9._-]+:([^:]|$)'
  for k in "${!pos[@]}"; do
    a="${pos[$k]}"
    if [[ "${a%%/*}" != *:* ]]; then   # un percorso di questo computer
      { [ "${#pos[@]}" -ge 2 ] && [ "$k" -eq "$ultimo_k" ]; } || sorgente_locale "$a"   # una sorgente: scp e rsync la leggono fuori dalla sandbox
      continue
    fi
    [[ "$a" == *@* ]] && host_ok "${a%%:*}"   # il messaggio sull'utente
    [[ "$a" =~ $re_server ]] || \
      block "verso i server si scrive solo test:<percorso> o prod:<percorso> ('$a'): niente parentesi quadre, «@», doppi due punti né indirizzi (scp://, rsync://), che $prog legge come un server ma che il metodo non controlla."
    host_ok "${a%%:*}"
    [[ "${a#*:}" == *[*?[]* ]] && block "nei percorsi del server niente caratteri jolly ('$a'): scrivi i nomi per intero."
    p="${a#*:}"   # il percorso sul server, normalizzato: relativo alla casa dell'utente (/~), con . e .. risolti
    case "$p" in /*) ;; "~"|"~/"*) p="/~${p#\~}" ;; *) p="/~/$p" ;; esac
    p="$(norm_path "$p")"; [ -z "$p" ] && p=/
    case "$p" in /srv/app/env|/srv/app/env/*) block "il percorso '$a' è nella cartella dei file di ambiente del server: quei file li legge e li scrive solo l'utente." ;; esac
    case "$p" in
      */env.example/*|*.example|*.example.*) ;;
      *) is_secret_file "$p" && block "il percorso '$a' è un file di ambiente con i segreti: quei file li legge e li scrive solo l'utente." ;;
    esac
    if [ "${#pos[@]}" -ge 2 ] && [ "$k" -eq "$ultimo_k" ]; then credenziali_server "$p" "$a"; continue; fi   # la destinazione sul server
    { [ "$p" = /~ ] || [ "$p" = /root ] || [[ "$p" =~ ^/home/[^/]+$ ]]; } && \
      block "copiare tutta la cartella dell'utente del server ('$a') prenderebbe anche le sue credenziali: copia solo i file che servono."
    credenziali_server "$p" "$a" copia   # una sorgente sul server: non deve portare con sé i segreti
    cartella_segreti_remota "$p" && \
      block "la copia comprenderebbe i file di ambiente o le credenziali del server ('$a'): quei file li gestisce solo l'utente. Copia solo le cartelle che servono (per esempio test:/srv/app/infra)."
  done
  if [ "${#pos[@]}" -ge 2 ]; then   # destinazione locale (copia dal server o copia locale): è una scrittura
    a="${pos[-1]}"; [[ "${a%%/*}" == *:* ]] || scrive "$a" "${psg[-1]}"
  fi
  return 0
}

# --- docker -----------------------------------------------------------------------------------------
monta() { # una cartella dell'host montata in un container: solo una sottocartella del progetto (o un volume con nome), senza
          # i file del metodo, i file di ambiente e le sessioni salvate; fuori dal progetto ci sono le credenziali, gli agenti
          # SSH e GPG, i socket del computer (Docker, il server grafico, tmux) e i file di avvio della shell
  local abs; abs="$(risolvi "$1")"
  [ "$abs" = "?" ] && block "un volume Docker dopo un cd che non si può risolvere non si controlla: scrivi il percorso per intero."
  [[ "$abs" == "$PROJECT_DIR_SLASH"/* ]] || \
    block "un volume Docker monta solo sottocartelle del progetto, o un volume con nome ('$1'): fuori dal progetto ci sono le credenziali, gli agenti SSH e GPG e i socket del computer."
  protetto "$(rel_path "$abs")" && block "monta in un container i file del metodo ('$1')."
  antenato_protetto "$abs" && block "monta in un container una cartella che contiene i file del metodo ('$1'): monta solo la sottocartella che serve."
  sorgente_locale "$1"   # niente file di ambiente o sessioni salvate nel container
  return 0
}
NOME_VOLUME='^[A-Za-z0-9][A-Za-z0-9_.-]*$'
sorgente_volume() { # $1 la sorgente di un volume, $2 il valore intero: una cartella del computer (per Docker comincia con / o con .;
                    # qui anche con ~, che la shell espande), che si controlla, oppure il nome di un volume di Docker (lettere,
                    # cifre, «_», «.», «-»); ogni altra forma ferma il comando
  case "$1" in
    /*|.*|"~"*) monta "$1" ;;
    *) [[ "$1" =~ $NOME_VOLUME ]] || block "il volume '$2' non è né una sottocartella del progetto (./cartella) né un volume con nome (lettere, cifre, «_», «.», «-»): scrivilo in una di queste due forme." ;;
  esac
  return 0
}
volume() { # -v sorgente:destinazione[:opzioni]; senza i due punti è un volume anonimo, che sta solo nel container
  [[ "$1" == *:* ]] || return 0
  sorgente_volume "${1%%:*}" "$1"
}
campi_docker() { # $1 un valore «chiave=valore,chiave=valore», poi i nomi di una chiave -> CAMPI, tutti i suoi valori; vero se ce
                 # n'è almeno uno. Le chiavi non distinguono le maiuscole, come le legge Docker (Src= vale src=); di una chiave
                 # ripetuta Docker tiene l'ultimo valore, e qui si controllano tutti
  local campo ch nome t="$1"; local -a pezzi=()
  CAMPI=(); shift
  IFS=, read -ra pezzi <<< "$t"
  for campo in "${pezzi[@]}"; do
    [[ "$campo" == *=* ]] || continue
    ch="${campo%%=*}"; ch="${ch,,}"
    for nome in "$@"; do [ "$ch" = "$nome" ] && CAMPI+=("${campo#*=}"); done
  done
  [ "${#CAMPI[@]}" -gt 0 ]
}
valore_a_campi() { # $1 opzione, $2 il suo valore a campi: Docker lo legge come una riga CSV, dove le virgolette racchiudono un campo
                   # con le virgole, e di un valore su più righe legge solo la prima. Niente virgolette né spazi: così l'hook lo
                   # divide come Docker
  [[ "$2" == *'"'* || "$2" == *[[:space:]]* ]] && \
    block "docker $1: nel valore niente virgolette né spazi ('$2'). Docker lo legge a campi separati da virgole, e l'hook deve dividerlo allo stesso modo."
  return 0
}
montaggio() { # --mount chiave=valore,…: solo le chiavi di un elenco; type=bind e ogni sorgente che è una cartella si controllano
  local campo ch val tipo="" v; local -a pezzi=() sorgenti=()
  valore_a_campi --mount "$1"
  IFS=, read -ra pezzi <<< "$1"
  for campo in "${pezzi[@]}"; do
    ch="${campo%%=*}"; ch="${ch,,}"; val=""; [[ "$campo" == *=* ]] && val="${campo#*=}"
    case "$ch" in
      type) tipo="${val,,}" ;;
      source|src) sorgenti+=("$val") ;;
      target|dst|destination|readonly|ro|consistency|bind-propagation|bind-nonrecursive|bind-recursive|bind-create-src|volume-nocopy|volume-label|volume-subpath|tmpfs-size|tmpfs-mode) ;;
      volume-opt|volume-driver) block "--mount con volume-opt o volume-driver può legare una cartella del computer a un volume: nel metodo non si usa." ;;
      *) block "--mount con la chiave '${campo%%=*}' non è fra quelle che il metodo usa (type, source, target, readonly e simili)." ;;
    esac
  done
  case "$tipo" in
    bind) [ "${#sorgenti[@]}" -gt 0 ] || block "--mount type=bind senza la sorgente non si controlla."
          for v in "${sorgenti[@]}"; do monta "$v"; done ;;
    ""|volume) for v in "${sorgenti[@]}"; do sorgente_volume "$v" "$1"; done ;;
    tmpfs) ;;
    *) block "--mount type=$tipo non è fra i tipi che il metodo usa (bind, volume, tmpfs)." ;;
  esac
  return 0
}
uscita_docker() { # -o/--output di build: una cartella, «-» (l'uscita del comando) oppure «type=…,dest=…»: docker scrive sul computer
  local v
  [ "$1" = - ] && return 0
  if [[ "$1" != *=* ]]; then scrive "$1" ""; return 0; fi
  valore_a_campi --output "$1"
  campi_docker "$1" dest && for v in "${CAMPI[@]}"; do [ "$v" = - ] || scrive "$v" ""; done
  return 0
}
cache_docker() { # $1 --cache-to o --cache-from, $2 il valore: una cache locale è una cartella del computer, scritta o letta da docker
  local v
  [[ "$2" == *=* ]] || return 0   # il nome di un'immagine
  valore_a_campi "$1" "$2"
  if [ "$1" = --cache-to ]; then campi_docker "$2" dest && for v in "${CAMPI[@]}"; do scrive "$v" ""; done
  else campi_docker "$2" src source && for v in "${CAMPI[@]}"; do sorgente_locale "$v"; done; fi
  return 0
}
contesto_aggiuntivo() { # --build-context nome=valore: un'immagine o un indirizzo vanno bene; una cartella si controlla come il contesto
  local v="${1#*=}"
  case "$v" in *://*|target:*) return 0 ;; esac
  contesto_docker "$v"
}
segreto_docker() { # --secret id=…,src=… (o source=): docker legge il file fuori dalla sandbox, come una sorgente; senza src e senza
                   # env il file è quello che ha il nome dell'id
  local v
  valore_a_campi --secret "$1"
  if campi_docker "$1" src source; then for v in "${CAMPI[@]}"; do sorgente_locale "$v"; done
  elif ! campi_docker "$1" env && campi_docker "$1" id; then for v in "${CAMPI[@]}"; do sorgente_locale "$v"; done; fi
  return 0
}
opzione_driver() { # -o/--opt chiave=valore di volume create e network create: device= lega una cartella (o un disco) del computer
  local ch="${1%%=*}"
  [[ "$1" == *=* ]] && [ "${ch,,}" = device ] && monta "${1#*=}"
  return 0
}
rete_host() { # $1 comando e opzione, $2 valore: la rete, i processi e gli altri spazi dell'host danno al container accesso al computer
  [ "${2,,}" = host ] && block "docker $1 host dà al container, o alla costruzione, accesso al computer: nel metodo non si usa."
  return 0
}
copia_locale() { # vero se un argomento di docker cp è di questo computer, come lo legge Docker: un percorso assoluto, o che comincia
                 # con «.» (o con ~, che la shell espande), anche se contiene i due punti; oppure uno senza i due punti
  case "$1" in -) return 1 ;; /*|.*|"~"*) return 0 ;; *:*) return 1 ;; esac
  return 0
}
compose_config() { # $1 indice del sottocomando: docker compose config scrive nell'uscita i valori dei file di ambiente dei servizi
  local k
  for ((k=$1+1; k<n; k++)); do case "${argv[$k]}" in --no-env-resolution|-q|--quiet|--services|--images|--volumes|--networks|--profiles) return 0 ;; esac; done
  block "docker compose config scrive nell'uscita i valori dei file di ambiente dei servizi: aggiungi --no-env-resolution (oppure usa -q, --services, --images, --volumes)."
}
compose_controlla() { # "docker compose config" in sola lettura: che cosa montano e con quali permessi girano i servizi
  local out src abs
  [ "$CWD" = "?" ] && block "docker compose dopo un cd che non si può risolvere non si controlla."
  out="$(cd "$CWD" 2>/dev/null && docker compose "$@" config --format json 2>/dev/null)" || out=""
  [ -n "$out" ] || block "non riesco a leggere la configurazione di docker compose (docker compose … config): senza, non si può controllare che cosa monta. Se il file è giusto, il comando lo esegue l'utente."
  while IFS= read -r src; do [ -n "$src" ] && monta "$src"; done < <(jq -r '.services[]?.volumes[]? | select(.type == "bind") | .source // empty' <<< "$out" 2>/dev/null | tr -d '\r')
  while IFS= read -r src; do [ -n "$src" ] && monta "$src"; done < <(jq -r '.volumes[]?.driver_opts.device // empty' <<< "$out" 2>/dev/null | tr -d '\r')
  # i file che compose legge fuori dalla sandbox per i container e per la costruzione, e quelli che docker compose watch
  # copia nei container: niente credenziali di questo computer (tr -d '\r': jq di Windows scrive CRLF; su Ubuntu non cambia nulla)
  while IFS= read -r src; do [ -n "$src" ] && sorgente_locale "$src"; done < <(jq -r '[(.secrets // {})[]?, (.configs // {})[]?] | .[] | .file? // empty' <<< "$out" 2>/dev/null | tr -d '\r')
  while IFS= read -r src; do [ -n "$src" ] && sorgente_locale "$src"; done < <(jq -r '.services[]?.develop?.watch[]?.path? // empty' <<< "$out" 2>/dev/null | tr -d '\r')
  while IFS= read -r src; do
    [ -n "$src" ] || continue
    abs="$(risolvi "$src")"; [ "$abs" != "?" ] && credenziali_locali "$abs" "$src"
  done < <(jq -r '.services[]?.env_file? // empty | (if type == "array" then .[] else . end) | (if type == "object" then .path else . end) // empty' <<< "$out" 2>/dev/null | tr -d '\r')
  while IFS= read -r src; do [ -n "$src" ] && contesto_docker "$src"; done < <(jq -r '.services[]?.build? | objects | (.context // empty), ((.additional_contexts // {})[]?)' <<< "$out" 2>/dev/null | tr -d '\r')
  jq -e '[.services[]?.build? | objects | (.ssh // []) | length > 0] | any' <<< "$out" >/dev/null 2>&1 && \
    block "un servizio del file compose porterebbe nella costruzione l'agente SSH di questo computer (build.ssh), con l'accesso ai server: nel metodo non si usa."
  jq -e '[.services[]? | (.privileged == true) or ((.cap_add // []) | length > 0) or ((.devices // []) | length > 0)
          or ((.device_cgroup_rules // []) | length > 0) or ((.security_opt // []) | length > 0) or (.pid == "host")
          or (.ipc == "host") or (.uts == "host") or (.cgroup == "host") or (.userns_mode == "host") or (.network_mode == "host")
          or ((.volumes_from // []) | length > 0)
          or (if (.build | type) == "object" then (.build.privileged == true) or (.build.network == "host")
              or ((.build.entitlements // []) | length > 0) else false end)] | any' <<< "$out" >/dev/null 2>&1 && \
    block "un servizio del file compose ha permessi speciali sul computer (privileged, cap_add, devices, security_opt, pid, ipc, rete o volumi dell'host, una costruzione privilegiata): nel metodo non si usano."
  return 0
}
DOCKER_SUB=' attach build builder buildx commit compose container context cp create diff events exec export history image images import info inspect kill load login logout logs manifest network pause plugin port ps pull push rename restart rm rmi run save search start stats stop system tag top trust unpause update version volume wait '
COMPOSE_SUB=' attach build config convert cp create down events exec images kill logs ls pause port ps pull push restart rm run scale start stats stop top unpause up version volumes wait watch '
docker_secondo() { # $1 comando di gestione di docker, $2 il suo sottocomando: vero se è fra quelli che il metodo usa
  case "$1:$2" in
    container:attach|container:commit|container:cp|container:create|container:diff|container:exec|container:export|\
    container:inspect|container:kill|container:logs|container:ls|container:list|container:ps|container:pause|container:port|\
    container:prune|container:rename|container:restart|container:rm|container:run|container:start|container:stats|container:stop|\
    container:top|container:unpause|container:update|container:wait|\
    image:build|image:history|image:import|image:inspect|image:load|image:ls|image:list|image:prune|image:pull|image:push|\
    image:rm|image:save|image:tag|builder:build|builder:prune|builder:ls|builder:inspect|builder:du|\
    buildx:build|buildx:b|buildx:ls|buildx:inspect|buildx:version|buildx:du|buildx:prune|\
    volume:create|volume:inspect|volume:ls|volume:list|volume:prune|volume:rm|\
    network:connect|network:create|network:disconnect|network:inspect|network:ls|network:list|network:prune|network:rm|\
    system:df|system:events|system:info|system:prune|context:ls|context:list|context:inspect|context:show|\
    plugin:ls|plugin:list|plugin:inspect|trust:inspect|manifest:inspect) return 0 ;;
  esac
  return 1
}
docker_chiave() { # $1 comando di docker, $2 il suo sottocomando (vuoto se non ne ha) -> CHIAVE, il nome del comando in docker_tabella
  case "$1:$2" in
    *:) CHIAVE="$1" ;;
    container:ls|container:list|container:ps) CHIAVE=ps ;;
    container:inspect|container:prune|image:inspect|image:prune) CHIAVE="$1 $2" ;;
    container:*) CHIAVE="$2" ;;
    image:build|builder:build|buildx:build|buildx:b) CHIAVE=build ;;
    image:ls|image:list) CHIAVE=images ;;
    image:rm) CHIAVE=rmi ;;
    image:*) CHIAVE="$2" ;;
    builder:ls|builder:inspect|builder:du) CHIAVE="buildx $2" ;;
    volume:list|network:list|context:list|plugin:list) CHIAVE="$1 ls" ;;
    system:events|system:info) CHIAVE="$2" ;;
    *) CHIAVE="$1 $2" ;;
  esac
}
docker_opzione() { # $1 comando (come in docker_tabella), $2 opzione, $3 il suo valore: i controlli sui valori che toccano questo
                   # computer (cartelle montate, file letti e scritti, rete e processi dell'host)
  local c="$1"
  [ "$c" = create ] && c=run
  case "$c:$2" in
    run:-v|run:--volume|"compose run:-v"|"compose run:--volume"|"compose run:--volumes") volume "$3" ;;
    run:--mount) montaggio "$3" ;;
    run:--network|run:--net|run:--pid|run:--ipc|run:--uts|run:--cgroupns|run:--userns|build:--network) rete_host "$1 $2" "$3" ;;
    run:--cidfile|build:--iidfile|build:--metadata-file|save:-o|save:--output|export:-o|export:--output|"compose config:-o"|"compose config:--output")
      scrive "$3" "" ;;
    run:--env-file|run:--label-file|exec:--env-file|"compose run:--env-from-file"|load:-i|load:--input|build:-f|build:--file|\
    compose:-f|compose:--file|compose:--env-file)
      [ "$3" = - ] || sorgente_locale "$3" ;;   # docker lo legge fuori dalla sandbox («-» è stdin)
    build:-o|build:--output) uscita_docker "$3" ;;
    build:--cache-to|build:--cache-from) cache_docker "$2" "$3" ;;
    build:--build-context) contesto_aggiuntivo "$3" ;;
    build:--secret) segreto_docker "$3" ;;
    compose:--project-directory|compose:--workdir) contesto_docker "$3" ;;
    "volume create:-o"|"volume create:--opt"|"network create:-o"|"network create:--opt") opzione_driver "$3" ;;
  esac
  return 0
}
docker_vietata() { # $1 comando, $2 un'opzione che non sta in docker_tabella
  case "$2" in
    --privileged|--cap-add|--device|--device-cgroup-rule|--security-opt|--volumes-from|--volume-driver|--allow|--gpus|--runtime|--use-api-socket|--cgroup-parent)
      block "docker $1 $2 dà al container, o alla costruzione, accesso al computer: nel metodo non si usa." ;;
    --ssh) block "docker $1 --ssh porterebbe nella costruzione l'agente SSH di questo computer, con l'accesso ai server: nel metodo non si usa." ;;
  esac
  block "docker $1 $2 non è fra le opzioni che il metodo usa con questo comando: l'hook legge le opzioni come le legge Docker, da un elenco, e un'opzione che non conosce nasconderebbe il resto del comando. Se serve, il comando lo esegue l'utente."
}
docker_leggi() { # $1 indice della prima parola da leggere, $2 il comando (come in docker_tabella): legge le opzioni come le legge
                 # Docker (--nome=valore, --nome valore, -x valore, -xvalore, -x=valore, le corte in gruppo), solo quelle della
                 # tabella. Per ogni opzione con un valore chiama docker_opzione. Mette in pos gli argomenti, in DINERTI gli indici
                 # delle opzioni e dei loro valori, in DFINE l'indice della prima parola che Docker non legge più (dopo l'immagine
                 # di run o il container di exec viene il comando del container), altrimenti n
  local j="$1" chiave="$2" a g k c v
  docker_tabella "$chiave" || block "docker $chiave: l'hook non ha l'elenco delle opzioni di questo comando, quindi non lo può controllare. Se serve, lo esegue l'utente."
  pos=(); DFINE="$n"
  while [ "$j" -lt "$n" ]; do
    a="${argv[$j]}"
    [[ "${segni[$j]}" == *d* ]] && block "docker gira fuori dalla sandbox: niente argomenti decisi da variabili, scrivili per intero."
    case "$a" in
      --)   # chiude le opzioni: il resto sono argomenti
        DINERTI="$DINERTI$j "; j=$((j+1))
        if [ "$DINT" = 0 ]; then
          if [ "$j" -lt "$n" ]; then pos+=("${argv[$j]}"); DFINE=$((j+1)); fi
        else
          for ((; j<n; j++)); do pos+=("${argv[$j]}"); done
        fi
        return 0 ;;
      -test.*) block "docker $chiave $a: una parola che comincia con «-test.» Docker la scarta in silenzio: non si usa." ;;
      --*=*)
        DINERTI="$DINERTI$j "; c="${a%%=*}"
        if [[ "$DLV" == *" $c "* ]]; then docker_opzione "$chiave" "$c" "${a#*=}"
        elif [[ "$DLB" != *" $c "* ]]; then docker_vietata "$chiave" "$c"; fi ;;
      --?*)
        DINERTI="$DINERTI$j "
        if [[ "$DLV" == *" $a "* ]]; then   # il valore è la parola dopo, qualunque sia
          j=$((j+1)); [ "$j" -lt "$n" ] || block "docker $chiave $a vuole un valore."
          [[ "${segni[$j]}" == *d* ]] && block "docker gira fuori dalla sandbox: niente argomenti decisi da variabili, scrivili per intero."
          DINERTI="$DINERTI$j "; docker_opzione "$chiave" "$a" "${argv[$j]}"
        elif [[ "$DLB" != *" $a "* ]]; then docker_vietata "$chiave" "$a"; fi ;;
      -?*)
        DINERTI="$DINERTI$j "; g="${a#-}"
        # prima del sottocomando di compose le parole le divide cobra, che vede il valore nella parola dopo solo per
        # un'opzione corta scritta da sola (-f <file>): lì niente gruppi di opzioni corte
        [ "$chiave" = compose ] && [ "${#g}" -gt 1 ] && [[ "$DCB" == *"${g:0:1}"* ]] && \
          block "docker compose $a: prima del sottocomando le opzioni corte si scrivono una per volta (-f <file> -p <nome>)."
        for ((k=0; k<${#g}; k++)); do
          c="${g:$k:1}"
          if [[ "$c" == [A-Za-z0-9] && "$DCV" == *"$c"* ]]; then   # con un valore: il resto del gruppo, senza l'«=» iniziale, o la parola dopo
            v="${g:$((k+1))}"
            if [ -n "$v" ]; then [[ "$v" == =?* ]] && v="${v#=}"
            else
              j=$((j+1)); [ "$j" -lt "$n" ] || block "docker $chiave -$c vuole un valore."
              [[ "${segni[$j]}" == *d* ]] && block "docker gira fuori dalla sandbox: niente argomenti decisi da variabili, scrivili per intero."
              DINERTI="$DINERTI$j "; v="${argv[$j]}"
            fi
            docker_opzione "$chiave" "-$c" "$v"; break
          elif [[ "$c" == [A-Za-z0-9] && "$DCB" == *"$c"* ]]; then
            [[ "${g:$((k+1))}" == =?* ]] && break   # -x=true: il resto del gruppo è il valore di questa opzione
          else
            docker_vietata "$chiave" "-$c"
          fi
        done ;;
      *)
        pos+=("$a")
        if [ "$DINT" = 0 ]; then DFINE=$((j+1)); return 0; fi ;;
    esac
    j=$((j+1))
  done
  return 0
}
docker_tabella() { # $1 comando di Docker, con il nome che gli dà docker_chiave -> le sue opzioni: DCB le corte senza valore, DCV le corte
                   # con un valore, DLB le lunghe senza valore, DLV le lunghe con un valore, DINT 0 se valgono solo prima del primo
                   # argomento. Elenco generato dai sorgenti di docker/cli, docker/buildx e docker/compose (letti l'11/11/2026),
                   # meno le opzioni che il metodo non ammette. Un'opzione che qui manca ferma il comando
  DINT=1
  case "$1" in
    run) DCB=Pdiqt; DCV=ehlmpuvw; DINT=0
      DLB=" --detach --help --init --interactive --no-healthcheck --publish-all --quiet --read-only --rm --sig-proxy --tty "
      DLV=" --add-host --attach --cgroupns --cidfile --cpus --detach-keys --dns --entrypoint --env --env-file --expose --health-cmd --health-interval --health-retries --health-start-period --health-timeout --hostname --ipc --label --label-file --memory --memory-swap --mount --name --net --network --network-alias --pid --pids-limit --platform --publish --pull --restart --shm-size --stop-signal --stop-timeout --tmpfs --ulimit --user --userns --uts --volume --workdir " ;;
    create) DCB=Piqt; DCV=ehlmpuvw; DINT=0
      DLB=" --help --init --interactive --no-healthcheck --publish-all --quiet --read-only --rm --tty "
      DLV=" --add-host --attach --cgroupns --cidfile --cpus --dns --entrypoint --env --env-file --expose --health-cmd --health-interval --health-retries --health-start-period --health-timeout --hostname --ipc --label --label-file --memory --memory-swap --mount --name --net --network --network-alias --pid --pids-limit --platform --publish --pull --restart --shm-size --stop-signal --stop-timeout --tmpfs --ulimit --user --userns --uts --volume --workdir " ;;
    exec) DCB=dhit; DCV=euw; DINT=0
      DLB=" --detach --help --interactive --tty "
      DLV=" --detach-keys --env --env-file --user --workdir " ;;
    cp) DCB=Lahq; DCV=""; DINT=1
      DLB=" --archive --follow-link --help --quiet "
      DLV=" " ;;
    attach) DCB=h; DCV=""; DINT=1
      DLB=" --help --no-stdin --sig-proxy "
      DLV=" --detach-keys " ;;
    commit) DCB=hp; DCV=acm; DINT=0
      DLB=" --help --no-pause --pause "
      DLV=" --author --change --message " ;;
    export) DCB=h; DCV=o; DINT=1
      DLB=" --help "
      DLV=" --output " ;;
    update) DCB=h; DCV=cm; DINT=1
      DLB=" --help "
      DLV=" --blkio-weight --cpu-period --cpu-quota --cpu-rt-period --cpu-rt-runtime --cpu-shares --cpus --cpuset-cpus --cpuset-mems --kernel-memory --memory --memory-reservation --memory-swap --pids-limit --restart " ;;
    logs) DCB=fht; DCV=n; DINT=1
      DLB=" --details --follow --help --timestamps "
      DLV=" --since --tail --until " ;;
    ps) DCB=ahlqs; DCV=fn; DINT=1
      DLB=" --all --help --latest --no-trunc --quiet --size "
      DLV=" --filter --format --last " ;;
    rm) DCB=fhlv; DCV=""; DINT=1
      DLB=" --force --help --link --volumes "
      DLV=" " ;;
    stop) DCB=h; DCV=st; DINT=1
      DLB=" --help "
      DLV=" --signal --time --timeout " ;;
    start) DCB=ahi; DCV=""; DINT=1
      DLB=" --attach --help --interactive "
      DLV=" --detach-keys " ;;
    restart) DCB=h; DCV=st; DINT=1
      DLB=" --help "
      DLV=" --signal --time --timeout " ;;
    kill) DCB=h; DCV=s; DINT=1
      DLB=" --help "
      DLV=" --signal " ;;
    "container inspect") DCB=hs; DCV=f; DINT=1
      DLB=" --help --size "
      DLV=" --format " ;;
    inspect) DCB=hs; DCV=f; DINT=1
      DLB=" --help --size "
      DLV=" --format --type " ;;
    stats) DCB=ah; DCV=""; DINT=1
      DLB=" --all --help --no-stream --no-trunc "
      DLV=" --format " ;;
    top) DCB=h; DCV=""; DINT=0
      DLB=" --help "
      DLV=" " ;;
    wait) DCB=h; DCV=""; DINT=1
      DLB=" --help "
      DLV=" " ;;
    port) DCB=h; DCV=""; DINT=1
      DLB=" --help "
      DLV=" " ;;
    rename) DCB=h; DCV=""; DINT=1
      DLB=" --help "
      DLV=" " ;;
    pause) DCB=h; DCV=""; DINT=1
      DLB=" --help "
      DLV=" " ;;
    unpause) DCB=h; DCV=""; DINT=1
      DLB=" --help "
      DLV=" " ;;
    diff) DCB=h; DCV=""; DINT=1
      DLB=" --help "
      DLV=" " ;;
    "container prune") DCB=fh; DCV=""; DINT=1
      DLB=" --force --help "
      DLV=" --filter " ;;
    build) DCB=Dhq; DCV=cfmot; DINT=1
      DLB=" --check --compress --debug --disable-content-trust --force-rm --help --load --no-cache --pull --push --quiet --rm --squash "
      DLV=" --add-host --annotation --attest --build-arg --build-context --builder --cache-from --cache-to --call --cpu-period --cpu-quota --cpu-shares --cpuset-cpus --cpuset-mems --file --iidfile --label --memory --memory-swap --metadata-file --network --no-cache-filter --output --platform --progress --provenance --resource --sbom --secret --shm-size --tag --target --ulimit " ;;
    pull) DCB=ahq; DCV=""; DINT=1
      DLB=" --all-tags --disable-content-trust --help --quiet "
      DLV=" --platform " ;;
    push) DCB=ahq; DCV=""; DINT=1
      DLB=" --all-tags --disable-content-trust --help --quiet "
      DLV=" --platform " ;;
    tag) DCB=h; DCV=""; DINT=0
      DLB=" --help "
      DLV=" " ;;
    images) DCB=ahq; DCV=f; DINT=1
      DLB=" --all --digests --help --no-trunc --quiet --tree "
      DLV=" --filter --format " ;;
    rmi) DCB=fh; DCV=""; DINT=1
      DLB=" --force --help --no-prune "
      DLV=" --platform " ;;
    save) DCB=h; DCV=o; DINT=1
      DLB=" --help "
      DLV=" --output --platform " ;;
    load) DCB=hq; DCV=i; DINT=1
      DLB=" --help --quiet "
      DLV=" --input --platform " ;;
    import) DCB=h; DCV=cm; DINT=1
      DLB=" --help "
      DLV=" --change --message --platform " ;;
    history) DCB=Hhq; DCV=""; DINT=1
      DLB=" --help --human --no-trunc --quiet "
      DLV=" --format --platform " ;;
    "image inspect") DCB=h; DCV=f; DINT=1
      DLB=" --help "
      DLV=" --format --platform " ;;
    "image prune") DCB=afh; DCV=""; DINT=1
      DLB=" --all --force --help "
      DLV=" --filter " ;;
    search) DCB=h; DCV=f; DINT=1
      DLB=" --help --no-trunc "
      DLV=" --filter --format --limit " ;;
    "manifest inspect") DCB=hv; DCV=""; DINT=1
      DLB=" --help --insecure --verbose "
      DLV=" " ;;
    "trust inspect") DCB=h; DCV=""; DINT=1
      DLB=" --help --pretty "
      DLV=" " ;;
    "buildx ls") DCB=Dh; DCV=""; DINT=1
      DLB=" --debug --help --no-trunc "
      DLV=" --builder --format --timeout " ;;
    "buildx inspect") DCB=Dh; DCV=""; DINT=1
      DLB=" --bootstrap --debug --help "
      DLV=" --builder --timeout " ;;
    "buildx version") DCB=Dh; DCV=""; DINT=1
      DLB=" --debug --help "
      DLV=" --builder " ;;
    "buildx du") DCB=Dh; DCV=""; DINT=1
      DLB=" --debug --help --verbose "
      DLV=" --builder --filter --format --timeout " ;;
    "buildx prune") DCB=Dafh; DCV=""; DINT=1
      DLB=" --all --debug --force --help --verbose "
      DLV=" --builder --filter --keep-storage --max-used-space --min-free-space --reserved-space --timeout " ;;
    "builder prune") DCB=Dafh; DCV=""; DINT=1
      DLB=" --all --debug --force --help --verbose "
      DLV=" --builder --filter --keep-storage --max-used-space --min-free-space --reserved-space --timeout " ;;
    "volume create") DCB=h; DCV=do; DINT=1
      DLB=" --help "
      DLV=" --driver --label --name --opt " ;;
    "volume inspect") DCB=h; DCV=f; DINT=1
      DLB=" --help "
      DLV=" --format " ;;
    "volume ls") DCB=hq; DCV=f; DINT=1
      DLB=" --cluster --help --quiet "
      DLV=" --filter --format " ;;
    "volume prune") DCB=afh; DCV=""; DINT=1
      DLB=" --all --force --help "
      DLV=" --filter " ;;
    "volume rm") DCB=fh; DCV=""; DINT=1
      DLB=" --force --help "
      DLV=" " ;;
    "network connect") DCB=h; DCV=""; DINT=1
      DLB=" --help "
      DLV=" --alias --driver-opt --gw-priority --ip --ip6 --link --link-local-ip " ;;
    "network create") DCB=h; DCV=do; DINT=1
      DLB=" --attachable --config-only --help --ingress --internal --ipv4 --ipv6 "
      DLV=" --aux-address --config-from --driver --gateway --ip-range --ipam-driver --ipam-opt --label --opt --scope --subnet " ;;
    "network disconnect") DCB=fh; DCV=""; DINT=1
      DLB=" --force --help "
      DLV=" " ;;
    "network inspect") DCB=hv; DCV=f; DINT=1
      DLB=" --help --verbose "
      DLV=" --format " ;;
    "network ls") DCB=hq; DCV=f; DINT=1
      DLB=" --help --no-trunc --quiet "
      DLV=" --filter --format " ;;
    "network prune") DCB=fh; DCV=""; DINT=1
      DLB=" --force --help "
      DLV=" --filter " ;;
    "network rm") DCB=fh; DCV=""; DINT=1
      DLB=" --force --help "
      DLV=" " ;;
    "system df") DCB=hv; DCV=""; DINT=1
      DLB=" --help --verbose "
      DLV=" --format " ;;
    "system prune") DCB=afh; DCV=""; DINT=1
      DLB=" --all --force --help --volumes "
      DLV=" --filter " ;;
    events) DCB=h; DCV=f; DINT=1
      DLB=" --help "
      DLV=" --filter --format --since --until " ;;
    info) DCB=h; DCV=f; DINT=1
      DLB=" --help "
      DLV=" --format " ;;
    version) DCB=h; DCV=f; DINT=1
      DLB=" --help "
      DLV=" --format " ;;
    "context ls") DCB=hq; DCV=""; DINT=1
      DLB=" --help --quiet "
      DLV=" --format " ;;
    "context inspect") DCB=h; DCV=f; DINT=1
      DLB=" --help "
      DLV=" --format " ;;
    "context show") DCB=h; DCV=""; DINT=1
      DLB=" --help "
      DLV=" " ;;
    "plugin ls") DCB=hq; DCV=f; DINT=1
      DLB=" --help --no-trunc --quiet "
      DLV=" --filter --format " ;;
    "plugin inspect") DCB=h; DCV=f; DINT=1
      DLB=" --help "
      DLV=" --format " ;;
    compose) DCB=hv; DCV=fp; DINT=0
      DLB=" --all-resources --compatibility --dry-run --help --no-ansi --verbose --version "
      DLV=" --ansi --env-file --file --insecure-registry --parallel --profile --progress --project-directory --project-name --workdir " ;;
    "compose attach") DCB=h; DCV=""; DINT=1
      DLB=" --dry-run --help --no-stdin --sig-proxy "
      DLV=" --detach-keys --index " ;;
    "compose build") DCB=hq; DCV=m; DINT=1
      DLB=" --check --compress --dry-run --force-rm --help --no-cache --no-rm --parallel --print --pull --push --quiet --with-dependencies "
      DLV=" --build-arg --builder --memory --progress --provenance --sbom " ;;
    "compose config") DCB=hq; DCV=o; DINT=1
      DLB=" --dry-run --help --images --lock-image-digests --models --networks --no-consistency --no-env-resolution --no-interpolate --no-normalize --no-path-resolution --profiles --quiet --resolve-image-digests --services --variables --volumes "
      DLV=" --format --hash --output " ;;
    "compose cp") DCB=Lah; DCV=""; DINT=1
      DLB=" --all --archive --dry-run --follow-link --help "
      DLV=" --index " ;;
    "compose create") DCB=hy; DCV=""; DINT=1
      DLB=" --build --dry-run --force-recreate --help --no-build --no-recreate --quiet-pull --remove-orphans --y --yes "
      DLV=" --pull --scale " ;;
    "compose down") DCB=hv; DCV=t; DINT=1
      DLB=" --dry-run --help --remove-orphans --volume --volumes "
      DLV=" --rmi --timeout " ;;
    "compose events") DCB=h; DCV=""; DINT=1
      DLB=" --dry-run --help --json "
      DLV=" --since --until " ;;
    "compose exec") DCB=Tdhit; DCV=euw; DINT=0
      DLB=" --detach --dry-run --help --interactive --no-TTY --no-tty --tty "
      DLV=" --env --index --user --workdir " ;;
    "compose images") DCB=hq; DCV=""; DINT=1
      DLB=" --dry-run --help --quiet "
      DLV=" --format " ;;
    "compose kill") DCB=h; DCV=s; DINT=1
      DLB=" --dry-run --help --remove-orphans "
      DLV=" --signal " ;;
    "compose logs") DCB=fht; DCV=n; DINT=1
      DLB=" --dry-run --follow --help --no-color --no-log-prefix --timestamps "
      DLV=" --index --since --tail --until " ;;
    "compose ls") DCB=ahq; DCV=""; DINT=1
      DLB=" --all --dry-run --help --quiet "
      DLV=" --filter --format " ;;
    "compose pause") DCB=h; DCV=""; DINT=1
      DLB=" --dry-run --help "
      DLV=" " ;;
    "compose port") DCB=h; DCV=""; DINT=1
      DLB=" --dry-run --help "
      DLV=" --index --protocol " ;;
    "compose ps") DCB=ahq; DCV=""; DINT=1
      DLB=" --all --dry-run --help --no-trunc --orphans --quiet --services "
      DLV=" --filter --format --status " ;;
    "compose pull") DCB=hq; DCV=""; DINT=1
      DLB=" --dry-run --help --ignore-buildable --ignore-pull-failures --include-deps --no-parallel --parallel --quiet "
      DLV=" --policy " ;;
    "compose push") DCB=hq; DCV=""; DINT=1
      DLB=" --dry-run --help --ignore-missing --ignore-push-failures --include-deps --quiet "
      DLV=" " ;;
    "compose restart") DCB=h; DCV=t; DINT=1
      DLB=" --dry-run --help --no-deps "
      DLV=" --timeout " ;;
    "compose rm") DCB=afhsv; DCV=""; DINT=1
      DLB=" --all --dry-run --force --help --stop --volumes "
      DLV=" " ;;
    "compose run") DCB=PTdhiqt; DCV=elpuvw; DINT=0
      DLB=" --build --detach --dry-run --help --interactive --no-TTY --no-deps --no-recreate --no-tty --quiet --quiet-build --quiet-pull --remove-orphans --rm --service-ports --tty --use-aliases "
      DLV=" --entrypoint --env --env-from-file --label --labels --name --publish --pull --user --volume --volumes --workdir " ;;
    "compose scale") DCB=h; DCV=""; DINT=1
      DLB=" --dry-run --help --no-deps "
      DLV=" " ;;
    "compose start") DCB=h; DCV=""; DINT=1
      DLB=" --dry-run --help --wait "
      DLV=" --wait-timeout " ;;
    "compose stats") DCB=ah; DCV=""; DINT=1
      DLB=" --aggregate --all --all-projects --dry-run --help --no-stream --no-trunc "
      DLV=" --format " ;;
    "compose stop") DCB=h; DCV=t; DINT=1
      DLB=" --dry-run --help "
      DLV=" --timeout " ;;
    "compose top") DCB=h; DCV=""; DINT=1
      DLB=" --dry-run --help "
      DLV=" " ;;
    "compose unpause") DCB=h; DCV=""; DINT=1
      DLB=" --dry-run --help "
      DLV=" " ;;
    "compose up") DCB=Vdhwy; DCV=t; DINT=1
      DLB=" --abort-on-container-exit --abort-on-container-failure --always-recreate-deps --attach-dependencies --build --detach --dry-run --force-recreate --help --menu --no-build --no-color --no-deps --no-log-prefix --no-recreate --no-start --quiet-build --quiet-pull --remove-orphans --renew-anon-volumes --timestamps --wait --watch --y --yes "
      DLV=" --attach --exit-code-from --no-attach --pull --scale --timeout --wait-timeout " ;;
    "compose version") DCB=h; DCV=f; DINT=1
      DLB=" --dry-run --help --short "
      DLV=" --format " ;;
    "compose volumes") DCB=hq; DCV=""; DINT=1
      DLB=" --dry-run --help --quiet "
      DLV=" --format " ;;
    "compose wait") DCB=h; DCV=""; DINT=1
      DLB=" --down-project --dry-run --help "
      DLV=" " ;;
    "compose watch") DCB=h; DCV=""; DINT=1
      DLB=" --dry-run --help --no-up --prune --quiet "
      DLV=" " ;;
    *) return 1 ;;
  esac
  return 0
}
analizza_docker() { # $1 indice. Docker gira fuori dalla sandbox e un container può tutto: solo i sottocomandi di un elenco e, prima,
                    # solo le opzioni globali -D e -l; di ogni comando solo le opzioni della tabella, lette come le legge Docker;
                    # volumi, montaggi, file letti e scritti, contesti, copie e file compose si controllano. Lascia in DFINE
                    # l'indice della prima parola che va al container e in DINERTI gli indici delle opzioni e dei loro valori
                    # (li usa analizza_da)
  local i="$1" j a sub sec="" k cj CHIAVE="" DCB DCV DLB DLV DINT; local -a pos=() cglob=() CAMPI=()
  DFINE="$n"; DINERTI=" "
  j=$((i+1))
  while [ "$j" -lt "$n" ]; do   # le opzioni globali di docker (solo -D e -l)
    a="${argv[$j]}"
    [[ "${segni[$j]}" == *d* ]] && block "docker gira fuori dalla sandbox: niente argomenti decisi da variabili, scrivili per intero."
    case "$a" in
      -D|--debug|--help|--version|--log-level=*|-l?*) DINERTI="$DINERTI$j "; j=$((j+1)); continue ;;
      -l|--log-level) DINERTI="$DINERTI$j $((j+1)) "; j=$((j+2)); continue ;;
      -H*|--host|--host=*|-c*|--context|--context=*|--config|--config=*|--tls*) block "docker $a cambia il demone, la configurazione o le chiavi di Docker: nel metodo non si usa." ;;
      -*) block "docker $a: prima del sottocomando il metodo ammette solo -D e -l (--log-level), perché un'opzione sconosciuta con il suo valore nasconderebbe il sottocomando." ;;
    esac
    break
  done
  [ "$j" -lt "$n" ] || return 0
  [[ "${segni[$j]}" == *d* ]] && block "docker gira fuori dalla sandbox: niente argomenti decisi da variabili, scrivili per intero."
  sub="${argv[$j]}"; j=$((j+1))
  case "$sub" in login|logout) block "docker $sub lo fa l'utente, nel suo terminale: l'accesso a GHCR è un segreto (AVVIO.md §1)." ;; esac
  [[ "$DOCKER_SUB" == *" $sub "* ]] || block "docker $sub non è fra i comandi di Docker che il metodo usa: se serve, lo esegue l'utente."
  if [ "$sub" = compose ]; then   # le opzioni di compose, poi il suo sottocomando, da un elenco
    k="$j"; docker_leggi "$j" compose
    [ "${#pos[@]}" -gt 0 ] || return 0
    cj=$((DFINE-1)); sec="${pos[0]}"; cglob=("${argv[@]:$k:$((cj-k))}")
    [[ "$COMPOSE_SUB" == *" $sec "* ]] || block "docker compose $sec non è fra i comandi di Compose che il metodo usa: se serve, lo esegue l'utente."
    [ "$sec" = convert ] && sec=config
    CHIAVE="compose $sec"
    docker_leggi $((cj+1)) "$CHIAVE"
    case "$sec" in
      up|run|create|start|restart|watch|build|scale) compose_controlla "${cglob[@]}" ;;
      config) compose_config "$cj" ;;
    esac
  else
    case "$sub" in
      container|image|builder|buildx|context|plugin|trust|volume|network|system|manifest)
        while [ "$j" -lt "$n" ]; do   # docker buildx --builder <nome> <sottocomando>
          a="${argv[$j]}"
          [[ "${segni[$j]}" == *d* ]] && block "docker gira fuori dalla sandbox: niente argomenti decisi da variabili, scrivili per intero."
          case "$sub:$a" in
            buildx:--builder) DINERTI="$DINERTI$j $((j+1)) "; j=$((j+2)); continue ;;
            buildx:--builder=*|*:--help) DINERTI="$DINERTI$j "; j=$((j+1)); continue ;;
            *:-*) block "docker $sub $a: prima del sottocomando non si usano opzioni (tranne docker buildx --builder)." ;;
          esac
          break
        done
        [ "$j" -lt "$n" ] || return 0
        sec="${argv[$j]}"; j=$((j+1))
        if ! docker_secondo "$sub" "$sec"; then
          case "$sub" in
            context) block "docker context $sec cambia il demone a cui parla Docker, come -H: nel metodo non si usa." ;;
            plugin|trust) block "docker $sub $sec cambia Docker o le sue chiavi: lo fa l'utente." ;;
            buildx) [ "$sec" = bake ] && block "docker buildx bake legge da un file contesti, segreti e l'agente SSH, che l'hook non controlla: nel metodo non si usa (docker build, oppure docker compose build)." ;;
          esac
          block "docker $sub $sec non è fra i comandi di Docker che il metodo usa: se serve, lo esegue l'utente."
        fi ;;
    esac
    docker_chiave "$sub" "$sec"
    docker_leggi "$j" "$CHIAVE"
  fi
  case "$CHIAVE" in   # gli argomenti che sono file o cartelle di questo computer
    cp|"compose cp")   # la sorgente si legge fuori dalla sandbox; la destinazione è una scrittura
      if [ "${#pos[@]}" -ge 2 ]; then
        for ((k=0; k<${#pos[@]}-1; k++)); do copia_locale "${pos[$k]}" && sorgente_locale "${pos[$k]}"; done
        copia_locale "${pos[-1]}" && scrive "${pos[-1]}" ""
      fi ;;
    build) for a in "${pos[@]}"; do contesto_docker "$a"; done ;;   # il contesto di costruzione, in qualunque posizione
    import) [ "${#pos[@]}" -ge 1 ] && case "${pos[0]}" in -|*://*) ;; *) sorgente_locale "${pos[0]}" ;; esac ;;
  esac
  return 0
}

# --- comandi che scrivono file ----------------------------------------------------------------------
analizza_scritture() { # $1 indice, $2 programma
  local i="$1" prog="$2" j a k inplace=0 script_dato=0 dest="" dsg="" tdir="" start TX TDIR
  local -a pos=() psg=()
  for ((j=i+1; j<n; j++)); do
    a="${argv[$j]}"
    if [ "$a" = -- ]; then for ((j=j+1; j<n; j++)); do pos+=("${argv[$j]}"); psg+=("${segni[$j]}"); done; break; fi
    case "$a" in
      -*)
        case "$prog" in
          sed) case "$a" in
                 -e|--expression) script_dato=1; sed_esegue "${argv[$((j+1))]:-}"; j=$((j+1)) ;;
                 -f|--file) script_dato=1; j=$((j+1)) ;;
                 --expression=*) script_dato=1; sed_esegue "${a#*=}" ;;
                 --file=*) script_dato=1 ;;
                 -l|--line-length) j=$((j+1)) ;; --in-place*) inplace=1 ;; --*) ;; *i*) inplace=1 ;;
               esac ;;
          perl|ruby) case "$a" in --*) ;; *i*) inplace=1 ;; esac; case "$a" in -e|-E|-[a-zA-Z]*e|-[a-zA-Z]*E) script_dato=1; codice_in_linea "${argv[$((j+1))]:-}"; j=$((j+1)) ;; esac ;;
          cp|mv|ln|install) case "$a" in -t|--target-directory) dest="${argv[$((j+1))]:-}"; dsg="${segni[$((j+1))]}"; j=$((j+1)) ;; --target-directory=*) dest="${a#*=}" ;; -S|--suffix|-m|--mode|-o|--owner|-g|--group) j=$((j+1)) ;; esac ;;
          truncate) case "$a" in -s|--size|-r|--reference) j=$((j+1)) ;; esac ;;
          curl) case "$a" in -o|--output) scrive "${argv[$((j+1))]:-}" "${segni[$((j+1))]}"; j=$((j+1)) ;; -O|--remote-name|-J|--remote-header-name) scrive "." "" ;;
                  -H|-d|-X|-u|-A|-e|-b|-c|-F|-T|--header|--user|--url|--data|--data-raw|--data-binary|--form|--upload-file|--request|--cookie|--cookie-jar|--user-agent|--referer) j=$((j+1)) ;; esac ;;
          wget) case "$a" in -O|--output-document|-P|--directory-prefix) scrive "${argv[$((j+1))]:-}" "${segni[$((j+1))]}"; j=$((j+1)) ;; esac ;;
          unzip) case "$a" in -d) tdir="${argv[$((j+1))]:-}"; j=$((j+1)) ;; -*[ltvZzpc]*) inplace=2 ;; esac ;;   # -l, -t, -v, -Z, -z, -p, -c: elenca, prova o stampa, non estrae
          python|python3|python3.[0-9]*|node|nodejs|deno|bun|php) case "$a" in -c|-e|--eval|-r|-p|--print) codice_in_linea "${argv[$((j+1))]:-}"; j=$((j+1)) ;; esac ;;
        esac ;;
      *) pos+=("$a"); psg+=("${segni[$j]}") ;;
    esac
  done
  [ "$prog" = sed ] && [ "$script_dato" = 0 ] && [ "${#pos[@]}" -gt 0 ] && sed_esegue "${pos[0]}"   # lo script senza -e
  case "$prog" in
    rm|rmdir|unlink|touch|truncate|mkdir|shred|tee) for k in "${!pos[@]}"; do scrive "${pos[$k]}" "${psg[$k]}"; done ;;
    chmod|chown|chgrp|setfacl|chattr) for k in "${!pos[@]}"; do [ "$k" -eq 0 ] && continue; scrive "${pos[$k]}" "${psg[$k]}"; done ;;
    mv) for k in "${!pos[@]}"; do scrive "${pos[$k]}" "${psg[$k]}"; done; [ -n "$dest" ] && scrive "$dest" "$dsg" ;;
    cp|ln|install) if [ -n "$dest" ]; then scrive "$dest" "$dsg"; elif [ "${#pos[@]}" -ge 2 ]; then scrive "${pos[-1]}" "${psg[-1]}"; fi ;;
    sed|perl|ruby) if [ "$inplace" = 1 ]; then start=1; [ "$script_dato" = 1 ] && start=0
                     for k in "${!pos[@]}"; do [ "$k" -ge "$start" ] && scrive "${pos[$k]}" "${psg[$k]}"; done; fi ;;
    dd) for k in "${!pos[@]}"; do [[ "${pos[$k]}" == of=* ]] && scrive "${pos[$k]#of=}" "${psg[$k]}"; done ;;
    tar) tar_estrae "$i"; [ "$TX" = 1 ] && scrive "${TDIR:-.}" "" ;;
    unzip) [ "$inplace" = 2 ] || scrive "${tdir:-.}" "" ;;
    patch) scrive "${tdir:-.}" "" ;;
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
sed_esegue() { # $1 script di sed: GNU sed esegue un comando con «e» (e <comando>, o il flag e di s///): allora lo script si
               # controlla come un programma in linea
  { printf '%s' "$1" | grep -Eq '(^|[;{}[:space:]0-9$!/,])e([[:space:]]|;|$)' || printf '%s' "$1" | grep -Eq 's(.).*\1.*\1[gpiImM0-9w]*e'; } && \
    codice_in_linea "$1"
  return 0
}
LETTORI_EXEC=' grep egrep fgrep cat head tail wc ls stat file sha256sum sha1sum md5sum du echo printf test [ basename dirname realpath readlink sort uniq cut tr diff cmp '
SCRITTORI_EXEC=' rm rmdir unlink mv cp ln install tee truncate touch chmod chown chgrp dd shred '
analizza_find() { # $1 indice: find con -delete o -exec di un comando che scrive scrive nelle cartelle di partenza; con -exec si
                  # lanciano solo comandi semplici di un elenco (sed con lo script controllato), non programmi che eseguono altro
  local i="$1" j k a p scrive_qui=0; local -a radici=() rsg=()
  for ((j=i+1; j<n; j++)); do a="${argv[$j]}"; case "$a" in -*|'('|'!'|')') break ;; *) radici+=("$a"); rsg+=("${segni[$j]}") ;; esac; done
  for ((; j<n; j++)); do
    case "${argv[$j]}" in
      -delete|-fprint|-fprint0|-fprintf|-fls) scrive_qui=1 ;;
      -exec|-execdir|-ok|-okdir)
        a="${argv[$j]}"; p="${argv[$((j+1))]:-}"
        [[ "${segni[$((j+1))]:-}" == *[dgb]* ]] && block "con find $a il comando viene da una variabile o ha caratteri jolly: scrivilo per intero."
        p="${p##*/}"
        if [[ "$SCRITTORI_EXEC" == *" $p "* ]]; then scrive_qui=1
        elif [ "$p" = sed ]; then
          scrive_qui=1
          for ((k=j+2; k<n; k++)); do
            case "${argv[$k]}" in
              ';'|'+') break ;;
              -e|--expression) sed_esegue "${argv[$((k+1))]:-}"; k=$((k+1)) ;;
              --expression=*) sed_esegue "${argv[$k]#*=}" ;;
              -*) ;;
              *) sed_esegue "${argv[$k]}" ;;
            esac
          done
        elif [[ "$LETTORI_EXEC" != *" $p "* ]]; then
          block "con find $a si lanciano solo comandi semplici che leggono (grep, cat, head, wc, ls, stat, sha256sum…) o che scrivono (rm, mv, cp, chmod, touch, sed…): '$p' scrivilo per intero, da solo."
        fi ;;
    esac
  done
  if [ "$scrive_qui" = 1 ]; then
    [ "${#radici[@]}" -eq 0 ] && { radici=("."); rsg=(""); }
    for j in "${!radici[@]}"; do scrive "${radici[$j]}" "${rsg[$j]}"; done
  fi
  return 0
}
nuova_cwd() { # $1 cartella in cui va un comando (cd, env -C, pnpm -C), $2 i suoi segni -> CWD, "?" se non si può risolvere
  if [[ "${2:-}" == *g* || "${2:-}" == *b* || "$1" == - ]]; then CWD="?"; return 0; fi
  casa_in_chiaro "$1"   # cd $HOME, cd ~utente: la cartella è nota
  if [[ "${2:-}" == *d* ]] && [[ "$CC" == *'$'* || "$CC" == *'`'* ]]; then CWD="?"; return 0; fi
  CWD="$(risolvi "$CC")"
  return 0
}
cambia_cartella() { # $1 indice di cd o pushd
  local j=$(( $1 + 1 ))
  while [ "$j" -lt "$n" ] && [[ "${argv[$j]}" == -* && "${argv[$j]}" != - ]]; do j=$((j+1)); done
  if [ "$j" -ge "$n" ]; then CWD="$(canon_path "$HOME")"; return 0; fi
  nuova_cwd "${argv[$j]}" "${segni[$j]}"
}
legge_stdin() { # $1 indice, $2 programma (shell o interprete): 0 se non ha né uno script né il codice in un argomento, e quindi
                # legge da stdin; 1 se ce l'ha (SCRIPT_I è il suo indice, altrimenti -1); 2 se stampa soltanto la versione o
                # l'aiuto ed esce (node -v, python3 --version, bash --version): le opzioni sono quelle di ciascun programma,
                # perché «bash -v» e «python3 -v» invece leggono da stdin
  local j a opz="" info=""
  SCRIPT_I=-1
  case "$2" in   # opz: le opzioni che prendono un valore (il valore non è lo script); info: quelle che stampano ed escono
    bash|sh|zsh|dash|ksh|mksh|ash|yash|posh|fish|tcsh|csh) opz=' -o +o -O +O --rcfile --init-file '; info=' --version --help ' ;;
    python|python3|python3.[0-9]*) opz=' -W -X '; info=' -V -VV --version -h -? --help ' ;;
    node|nodejs) opz=' -r --require --import --loader --experimental-loader '; info=' -v --version -h --help --v8-options ' ;;
    deno) opz=' -r --require --import --loader --experimental-loader '; info=' -V --version -h --help ' ;;
    bun) opz=' -r --require --import --loader --experimental-loader '; info=' -v --version -h --help --revision ' ;;
    perl) opz=' -I -M -x '; info=' -v --version -V -h --help ' ;;
    ruby) opz=' -I -r '; info=' --version -h --help ' ;;
    php) opz=' -d -c -z '; info=' -v --version -h --help -m --ini ' ;;
  esac
  for ((j=$1+1; j<n; j++)); do
    a="${argv[$j]}"
    case "$a" in
      -s|-) return 0 ;;
      -*|+*) [[ "$info" == *" $a "* ]] && return 2
             [[ "$opz" == *" $a "* ]] && j=$((j+1)); continue ;;
      *) SCRIPT_I="$j"; return 1 ;;
    esac
  done
  return 0
}
tar_estrae() { # $1 indice di tar -> TX (1 se estrae) e TDIR (la cartella di -C). Le opzioni come le legge tar: la prima parola
               # senza trattino è un gruppo alla vecchia maniera (tar xzf a.tgz), le altre stanno in gruppo, con il valore
               # attaccato o nella parola dopo; il nome dell'archivio non è un'opzione (tar -czf fixtures.tar.gz …)
  local j=$(( $1 + 1 )) a g k c primo=1 presi
  TX=0; TDIR=""
  while [ "$j" -lt "$n" ]; do
    a="${argv[$j]}"
    if [ "$primo" = 1 ] && [[ "$a" != -* ]]; then   # tar xfC a.tgz dir: i valori sono le parole dopo, nell'ordine delle lettere
      primo=0; presi=0
      for ((k=0; k<${#a}; k++)); do
        c="${a:$k:1}"
        [ "$c" = x ] && TX=1
        case "$c" in f|b|C|T|X|L|N|V|H|I|K|F|g) presi=$((presi+1)); [ "$c" = C ] && TDIR="${argv[$((j+presi))]:-}" ;; esac
      done
      j=$((j+1+presi)); continue
    fi
    primo=0
    case "$a" in
      --) break ;;
      --extract|--get) TX=1 ;;
      --directory) TDIR="${argv[$((j+1))]:-}"; j=$((j+1)) ;;
      --directory=*) TDIR="${a#*=}" ;;
      --*) ;;
      -?*) g="${a#-}"
           for ((k=0; k<${#g}; k++)); do
             c="${g:$k:1}"
             [ "$c" = x ] && TX=1
             case "$c" in
               f|b|C|T|X|L|N|V|H|I|K|F|g)
                 if [ $((k+1)) -lt "${#g}" ]; then [ "$c" = C ] && TDIR="${g:$((k+1))}"
                 else [ "$c" = C ] && TDIR="${argv[$((j+1))]:-}"; j=$((j+1)); fi
                 break ;;
             esac
           done ;;
    esac
    j=$((j+1))
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
PNPM_INTERNI=' add approve-builds audit bin c cache cat-file cat-index config create dedupe deploy dlx docs doctor env exec fetch find-hash get help i ignored-builds import info init install install-test it la licenses link list ll ln login logout ls m multi outdated pack patch patch-commit patch-remove pm prune publish rb rebuild recursive remove repo rm root run run-script sbom search self-update server set setup show start store t test tst un uni uninstall unlink up update upgrade view whoami why '
PNPM_VALORE='^(-C|--dir|-F|--filter|--filter-prod|--test-pattern|--changed-files-ignore-pattern|--loglevel|--reporter|--workspace-concurrency|--resume-from|--package|--allow-build|--cpu|--os|--libc)$'
PNPM_SOLE='^(-r|--recursive|-w|--workspace-root|--include-workspace-root|-s|--silent|--parallel|--stream|--aggregate-output|--use-stderr|--color|--no-color|--report-summary|--reverse|--sort|--no-sort|--bail|--no-bail|--if-present|--fail-if-no-match|--no-reporter-hide-prefix|-h|--help)$'
script_pnpm() { # $1 cartella di pnpm -C (vuota: quella del comando), $2 i suoi segni -> i nomi degli script di package.json
  local salva="$CWD" d f
  [ -n "${1:-}" ] && nuova_cwd "$1" "${2:-}"
  d="$CWD"; CWD="$salva"
  [ "$d" = "?" ] && return 0
  f="$d/package.json"; [ -f "$f" ] || f="$PROJECT_DIR/package.json"
  jq -r '(.scripts // {}) | keys[]' "$f" 2>/dev/null | tr -d '\r'
}
playwright_pnpm() { # $1 indice di playwright, lanciato da pnpm
  case "${argv[$(( $1 + 1 ))]:-}" in
    install|install-deps|uninstall) block "i browser di Playwright li installa (e li toglie) l'utente nel suo terminale, dopo FON-T01 e dopo ogni aggiornamento di Playwright: pnpm exec playwright install --with-deps (AVVIO.md §1). Nella sandbox non si può (scrive in ~/.cache/ms-playwright) e nella gabbia non è ammesso." ;;
    ''|--version|-V|--help|-h|merge-reports) return 0 ;;   # sola lettura, nessun browser: passano
    test) block "pnpm test:e2e non funziona nella sandbox (sul suo localhost non c'è il database): lancialo nella gabbia, da solo, con bash .claude/hooks/gabbia.sh test:e2e." ;;
    *) block "pnpm exec playwright ${argv[$(( $1 + 1 ))]} non si usa dalla sandbox: apre un browser o un server locale (show-report, show-trace, codegen, open, screenshot, pdf) oppure scrive fuori dal progetto. Le prove girano nella gabbia, bash .claude/hooks/gabbia.sh test:e2e, e i rapporti si leggono come file (playwright-report/, test-results/)." ;;
  esac
}
comandi_pnpm() { # $1 indice di pnpm, pn, pnpx o pnx. pnpm lancia un comando qualsiasi con exec e dlx (pnpx e pnx sono pnpm dlx), e
                 # anche con pnpm <nome>, se <nome> non è un comando di pnpm né uno script di package.json (pnpm.io/cli/exec); legge
                 # le sue opzioni prima e dopo exec, fino al nome del comando. Il comando lanciato si controlla come se fosse scritto
                 # da solo (con -c come un testo per la shell, con -C nella sua cartella), e quando pnpm lancia un comando valgono
                 # solo le opzioni di un elenco. I comandi che usano il database, il server di sviluppo o il browser girano nella gabbia
  local i="$1" j a g t e=-1 shell=0 dir="" dsg="" salva cmd=-1 sotto="" ignota="" ripiego=0
  case "${argv[$i]##*/}" in pnpx|pnx) e="$i" ;; esac
  for ((j=i+1; j<n; j++)); do
    a="${argv[$j]}"
    if [[ "$a" != -* ]]; then
      [ "$e" -ge 0 ] && { cmd="$j"; break; }                        # il comando lanciato da exec, dlx, pnpx o pnx
      [[ "${segni[$j]}" == *g* || "${segni[$j]}" == *b* ]] && block "pnpm con un comando scritto con caratteri jolly o graffe ('$a') non si controlla: scrivilo per intero."
      case "$a" in
        exec|dlx) e="$j"; continue ;;
        recursive|multi|m) continue ;;                            # pnpm recursive <comando> è pnpm -r <comando>
        with) j=$((j+1)); continue ;;                             # pnpm with <versione> <argomenti>: un altro pnpm, stessi argomenti
      esac
      sotto="$a"
      if [ "$a" = run ] || [ "$a" = run-script ]; then               # pnpm run <script>
        for ((t=j+1; t<n; t++)); do [[ "${argv[$t]}" == -* ]] || { sotto="${argv[$t]}"; break; }; done
      elif [[ "$PNPM_INTERNI" != *" $a "* ]]; then                   # pnpm <nome>: uno script, oppure un comando lanciato come con exec
        case "$a" in test:int|test:e2e|dev|worker|db:migrate|cli) ;; *) script_pnpm "$dir" "$dsg" | grep -qxF -- "$a" || { cmd="$j"; ripiego=1; } ;; esac
      fi
      break
    fi
    case "$a" in
      --) [ "$e" -ge 0 ] && [ $((j+1)) -lt "$n" ] && cmd=$((j+1)); break ;;
      -c|--shell-mode)   # su Windows -C (--dir) arriva come -c: prima di exec, con una parola dopo, vale per tutte e due
        if [ "$ON_WINDOWS" = 1 ] && [ "$a" = -c ] && [ "$e" -lt 0 ] && [ $((j+1)) -lt "$n" ] && [[ "${argv[$((j+1))]}" != -* ]] && [[ ! "${argv[$((j+1))]}" =~ ^(exec|dlx)$ ]]; then
          dir="${argv[$((j+1))]}"; dsg="${segni[$((j+1))]}"; j=$((j+1))
        fi
        shell=1; continue ;;
      -C|--dir) dir="${argv[$((j+1))]:-}"; dsg="${segni[$((j+1))]}"; j=$((j+1)); continue ;;
      --dir=*) dir="${a#*=}"; dsg="${segni[$j]}"; continue ;;
    esac
    [[ "$a" =~ $PNPM_VALORE ]] && { j=$((j+1)); continue; }
    [[ "$a" =~ $PNPM_SOLE || "${a%%=*}" =~ $PNPM_VALORE ]] && continue
    if [[ "$a" =~ ^-[a-zA-Z]+$ ]]; then g="${a#-}"; [[ "$g" =~ ^[rwsc]+$ ]] && { [[ "$g" == *c* ]] && shell=1; continue; }; fi   # -rc = -r -c
    [ -z "$ignota" ] && ignota="$a"
  done
  if [ "$cmd" -ge 0 ]; then
    [ -n "$ignota" ] && block "pnpm lancia un comando, e l'opzione $ignota non è fra quelle che l'hook conosce: con un'opzione sconosciuta il comando lanciato non si riconosce. Toglila, o lancia il comando da solo."
    salva="$CWD"; [ -n "$dir" ] && nuova_cwd "$dir" "$dsg"
    if [ "$shell" = 1 ]; then
      for ((t=cmd; t<n; t++)); do [[ "${segni[$t]}" == *d* ]] && block "pnpm -c con un testo deciso da variabili o comandi annidati non si controlla: scrivi il comando per intero."; done
      analizza_testo "${argv[*]:$cmd}"
    elif [ "${argv[$cmd]##*/}" = playwright ]; then
      playwright_pnpm "$cmd"
    else
      analizza_da "$cmd"
      if [ "$ripiego" = 1 ]; then   # pnpm.io: senza uno script con quel nome pnpm esegue il comando «as a shell script»: anche come testo
        for ((t=cmd; t<n; t++)); do [[ "${segni[$t]}" == *d* ]] && block "pnpm <nome> con argomenti decisi da variabili o comandi annidati non si controlla: senza uno script con quel nome pnpm li passerebbe a una shell. Scrivili per intero, oppure lancia il comando con pnpm exec <nome>, che non passa da una shell."; done
        analizza_testo "${argv[*]:$cmd}"
      fi
    fi
    CWD="$salva"; return 0
  fi
  case "$sotto" in
    test:int|test:e2e|dev|worker|db:migrate|cli) block "pnpm $sotto non funziona nella sandbox (sul suo localhost non c'è il database): lancialo nella gabbia, da solo, con bash .claude/hooks/gabbia.sh $sotto." ;;
  esac
  return 0
}

# --- un comando semplice ----------------------------------------------------------------------------
# Programmi che non leggono il contenuto delle cartelle che ricevono (o che lanciano un altro comando, controllato da sé):
# a tutti gli altri non si passa una cartella che contiene le credenziali, come a grep -r (parola_locale, «antenati»).
# Ci sono anche i programmi di testo che aprono solo file e non eseguono niente (cut, tr, sort, sed…): awk no, perché il
# suo programma può eseguire comandi
SICURI=' ls dir vdir du df stat file tree namei realpath readlink dirname basename echo printf test [ [[ (( true false pwd type which hash cat head tail wc less more mkdir rmdir touch chmod chown chgrp cd pushd popd export declare typeset readonly local unset alias command builtin exec nohup time setsid chronic unbuffer nice ionice stdbuf timeout flock env xargs trap cut tr sort uniq paste sed column join comm nl tac rev fold fmt expand unexpand '
LETTORI_XARGS=' grep egrep fgrep cat head tail wc ls stat file sha256sum sha1sum md5sum du echo printf test basename dirname realpath readlink sort uniq cut tr diff cmp '
LANCIATORI_VIETATI=' script watch parallel strace ltrace gdb valgrind xvfb-run ssh-agent dbus-run-session taskset chrt prlimit numactl sg newgrp unshare nsenter chroot systemd-run faketime fakeroot fakechroot firejail bwrap proot busybox catchsegv at batch crontab '
EDITORI=' vim vi nvim view vimdiff ex ed emacs nano '
lanciatore() { # $1 indice del programma, $2 le sue opzioni corte senza valore, $3 quelle con un valore, $4 le lunghe (" --a --b= ":
               # con "=" vogliono un valore) -> J, l'indice della prima parola dopo le opzioni. Le opzioni si leggono come le legge
               # il programma (in gruppo, con il valore attaccato o nella parola dopo); una che l'hook non conosce, o
               # un'abbreviazione, ferma il comando, perché nasconderebbe il comando lanciato
  local j=$(( $1 + 1 )) a g k c p="${argv[$1]##*/}"
  while [ "$j" -lt "$n" ]; do
    a="${argv[$j]}"
    case "$a" in
      --) J=$((j+1)); return 0 ;;
      --*=*) [[ "$4" == *" ${a%%=*}= "* ]] || block "$p ${a%%=*}: l'opzione non è fra quelle che l'hook conosce, scritte per intero: nasconderebbe il comando lanciato. Toglila, o lancia il comando da solo."
             j=$((j+1)); continue ;;
      --*) if [[ "$4" == *" $a "* ]]; then j=$((j+1)); elif [[ "$4" == *" $a= "* ]]; then j=$((j+2))
           else block "$p $a: l'opzione non è fra quelle che l'hook conosce, scritte per intero: nasconderebbe il comando lanciato. Toglila, o lancia il comando da solo."; fi
           continue ;;
      -[0-9]*) [ "$p" = nice ] || block "$p $a: l'opzione non è fra quelle che l'hook conosce: nasconderebbe il comando lanciato."
               j=$((j+1)); continue ;;   # nice -10
      -?*) g="${a#-}"
           for ((k=0; k<${#g}; k++)); do
             c="${g:$k:1}"
             if [ -n "$3" ] && [[ "$3" == *"$c"* ]]; then [ $((k+1)) -ge "${#g}" ] && j=$((j+1)); break; fi
             [ -n "$2" ] && [[ "$2" == *"$c"* ]] || block "$p -$c: l'opzione non è fra quelle che l'hook conosce: nasconderebbe il comando lanciato. Toglila, o lancia il comando da solo."
           done
           j=$((j+1)); continue ;;
    esac
    break
  done
  J="$j"
}
analizza_da() { # $1 indice del nome del comando in argv
  local i="$1" prog j a k g c t s0 salva ric="" SALTA=" " SALTAP=" " edir="" esg="" etesto="" ets=0 J SCRIPT_I=-1 DFINE="" DINERTI=" "
  [[ "${segni[$i]}" == *d* ]] && block "il nome del comando viene da una variabile o da un comando annidato: scrivilo per intero."
  [[ "${segni[$i]}" == *g* || "${segni[$i]}" == *b* ]] && [ "${argv[$i]}" != "[" ] && [ "${argv[$i]}" != "[[" ] &&     block "il nome del comando ha caratteri jolly o graffe ('${argv[$i]}'): la shell lo sceglierebbe fra i file. Scrivilo per intero."
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
    ric=contiene
    [ "$CWD" = "?" ] && block "dopo un cd che non si può risolvere (con una variabile, \$(…), cd - o popd), $prog legge le cartelle per intero e non si controlla: fai il cd con il percorso scritto per intero, o scrivi per intero le cartelle da leggere."
    fuori_progetto && credenziali_locali "$CWD" "$CWD" contiene
  elif [[ "$SICURI" != *" $prog "* ]]; then
    ric=antenati   # un programma qualunque può leggere per intero una cartella che riceve (gzip -r, python -m tarfile, …)
  fi
  case "$prog" in   # grep e simili, anche git grep: il testo da cercare non è un file; nemmeno il messaggio di un commit
    grep|egrep|fgrep|zgrep|rgrep|rg|ripgrep|ag|ack|ack-grep|ugrep|ug) testi_cercati $((i+1)) "$prog" ;;
    git) j=$((i+1)); while [ "$j" -lt "$n" ] && [[ "${argv[$j]}" == -* ]]; do [ "${argv[$j]}" = -C ] && j=$((j+1)); j=$((j+1)); done
         [ "${argv[$j]:-}" = grep ] && testi_cercati $((j+1)) grep
         testi_messaggio "$i" git ;;
    gh) testi_messaggio "$i" gh ;;
  esac
  testi_non_percorsi "$i" "$prog"
  case "$prog" in docker|podman) analizza_docker "$i" ;; esac   # le sue opzioni, dalla tabella; lascia DFINE e DINERTI
  for ((j=i; j<n; j++)); do
    a="${argv[$j]}"
    [[ "$SALTA" == *" $j "* ]] && continue
    case "$a" in *imposta-postazione*|*hooks/imposta*) block "il nome della postazione lo imposta l'utente, nel suo terminale, una volta sola." ;; esac
    [ "$prog" = ssh ] && continue    # per ssh gli argomenti sono il comando remoto: lo controlla segreti_remoti
    case "$prog" in scp|rsync) [[ "${a%%/*}" == *:* ]] && continue ;; esac   # un percorso del server: lo controlla analizza_ssh
    if [ -n "$DFINE" ] && { [ "$j" -ge "$DFINE" ] || [[ "$DINERTI" == *" $j "* ]]; }; then
      # docker: le opzioni e i loro valori hanno già il loro controllo (docker_opzione), e le parole dopo l'immagine o il
      # container sono il comando del container: non sono percorsi di questo computer. Resta il nome intero di una
      # credenziale e, nel comando del container, il nome di un file di ambiente
      nomi_interi "$a"; [ "$j" -ge "$DFINE" ] && file_ambiente "$a"
      continue
    fi
    if [[ "$SALTAP" == *" $j "* ]]; then nomi_interi "$a"; else parola_locale "$a" "$ric" "${segni[$j]}"; fi
    file_ambiente "$a"
  done
  case "$prog" in
    sudo|su|doas|pkexec|runuser) block "i comandi con sudo li esegue l'utente." ;;
    eval) block "eval non è permesso: scrivi il comando per intero." ;;
    export|declare|typeset|readonly|local)
      for ((j=i+1; j<n; j++)); do [[ "${argv[$j]}" == -* ]] || variabile_vietata "${argv[$j]%%=*}"; done; return 0 ;;
    alias)   # alias nome='testo': il testo è un comando, che la shell esegue quando si usa il nome
      for ((j=i+1; j<n; j++)); do
        a="${argv[$j]}"; [[ "$a" == *=* ]] || continue
        [[ "${segni[$j]}" == *d* ]] && block "un alias con un testo deciso da variabili o comandi annidati non si controlla: scrivi il comando per intero."
        salva="$CWD"; analizza_testo "${a#*=}"; CWD="$salva"
      done
      return 0 ;;
    mapfile|readarray)
      for ((j=i+1; j<n; j++)); do
        [[ "${argv[$j]}" == -C* ]] && block "$prog -C esegue un comando a ogni gruppo di righe: scrivi il comando per intero."
        [[ "${argv[$j]}" == -* ]] || variabile_vietata "${argv[$j]}"   # il nome dell'elenco che riempie
      done
      return 0 ;;
    read) for ((j=i+1; j<n; j++)); do [[ "${argv[$j]}" == -* ]] || variabile_vietata "${argv[$j]}"; done; return 0 ;;   # le variabili che riempie
    printf)   # printf -v NOME: scrive in una variabile
      for ((j=i+1; j<n; j++)); do
        case "${argv[$j]}" in -v) variabile_vietata "${argv[$((j+1))]:-}" ;; -v?*) variabile_vietata "${argv[$j]#-v}" ;; -*) continue ;; esac
        break
      done ;;
    trap)    # trap '<comando>' SEGNALE: il testo è un comando, che la shell esegue quando arriva il segnale
      j=$((i+1))
      while [ "$j" -lt "$n" ] && [[ "${argv[$j]}" == -?* ]]; do [ "${argv[$j]}" = -- ] && { j=$((j+1)); break; }; j=$((j+1)); done
      if [ "$j" -lt "$n" ] && [ "${argv[$j]}" != - ]; then
        [[ "${segni[$j]}" == *d* ]] && block "trap con un testo deciso da variabili o comandi annidati non si controlla: scrivi il comando per intero."
        salva="$CWD"; analizza_testo "${argv[$j]}"; CWD="$salva"
      fi
      return 0 ;;
    env)   # le opzioni come le legge env: in gruppo (-iC <cartella>, -vS '<testo>') e con il valore attaccato; le lunghe solo
           # scritte per intero (un'abbreviazione la capisce env, non l'hook). -C porta il comando in un'altra cartella, -S
           # '<testo>' è una riga di comando intera
      j=$((i+1))
      while [ "$j" -lt "$n" ]; do
        a="${argv[$j]}"
        case "$a" in
          -|-i|--ignore-environment|-0|--null|-v|--debug|--list-signal-handling|--block-signal|--default-signal|--ignore-signal|\
          --block-signal=*|--default-signal=*|--ignore-signal=*|--unset=*|--argv0=*|--help|--version) j=$((j+1)); continue ;;
          --unset|--argv0) j=$((j+2)); continue ;;
          --chdir) edir="${argv[$((j+1))]:-}"; esg="${segni[$((j+1))]:-}"; j=$((j+2)); continue ;;
          --chdir=*) edir="${a#*=}"; esg="${segni[$j]}"; j=$((j+1)); continue ;;
          --split-string) etesto="${argv[*]:$((j+1))}"; ets=1; for ((k=j+1; k<n; k++)); do [[ "${segni[$k]}" == *d* ]] && ets=2; done; break ;;
          --split-string=*) etesto="${a#*=} ${argv[*]:$((j+1))}"; ets=1; for ((k=j; k<n; k++)); do [[ "${segni[$k]}" == *d* ]] && ets=2; done; break ;;
          --) j=$((j+1)); break ;;
          --*) block "env $a: l'opzione non è fra quelle che l'hook conosce, scritte per intero (--ignore-environment, --null, --unset, --chdir, --split-string, --debug, …): un'abbreviazione o un'opzione sconosciuta nasconderebbe il comando lanciato." ;;
          -?*) g="${a#-}"; t=0; s0=-1
               for ((k=0; k<${#g}; k++)); do
                 c="${g:$k:1}"
                 case "$c" in
                   C) if [ $((k+1)) -lt "${#g}" ]; then edir="${g:$((k+1))}"; esg="${segni[$j]}"; else edir="${argv[$((j+1))]:-}"; esg="${segni[$((j+1))]:-}"; t=1; fi
                      break ;;
                   S) if [ $((k+1)) -lt "${#g}" ]; then etesto="${g:$((k+1))} ${argv[*]:$((j+1))}"; s0="$j"; else etesto="${argv[*]:$((j+1))}"; s0=$((j+1)); fi
                      break ;;
                   u|a) [ $((k+1)) -ge "${#g}" ] && t=1; break ;;
                   i|0|v) continue ;;
                   *) block "env -$c: l'opzione non è fra quelle che l'hook conosce (-i, -0, -v, -u, -a, -C, -S): nasconderebbe il comando lanciato." ;;
                 esac
               done
               if [ "$s0" -ge 0 ]; then ets=1; for ((k=s0; k<n; k++)); do [[ "${segni[$k]}" == *d* ]] && ets=2; done; break; fi
               j=$((j+1+t)); continue ;;
        esac
        if [[ "$a" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then variabile_vietata "${a%%=*}"; j=$((j+1)); continue; fi
        break
      done
      [ "$ets" = 2 ] && block "env -S con un testo deciso da variabili o comandi annidati non si controlla: scrivi il comando per intero."
      salva="$CWD"; [ -n "$edir" ] && nuova_cwd "$edir" "$esg"
      if [ "$ets" = 1 ]; then analizza_testo "$etesto"; elif [ "$j" -lt "$n" ]; then analizza_da "$j"; fi
      CWD="$salva"; return 0 ;;
    command)  # command -v e -V non lanciano niente: dicono solo dove sta il programma
      lanciatore "$i" pvV "" " --help "
      for ((k=i+1; k<J; k++)); do [[ "${argv[$k]}" == -*[vV]* ]] && return 0; done
      [ "$J" -lt "$n" ] && analizza_da "$J"; return 0 ;;
    builtin) lanciatore "$i" "" "" ""; [ "$J" -lt "$n" ] && analizza_da "$J"; return 0 ;;
    exec) lanciatore "$i" cl a ""; [ "$J" -lt "$n" ] && analizza_da "$J"; return 0 ;;
    nohup) lanciatore "$i" "" "" " --help --version "; [ "$J" -lt "$n" ] && analizza_da "$J"; return 0 ;;
    time) lanciatore "$i" apvq of " --append --portability --verbose --quiet --output= --format= --help --version "; [ "$J" -lt "$n" ] && analizza_da "$J"; return 0 ;;
    setsid) lanciatore "$i" cfw "" " --ctty --fork --wait --help --version "; [ "$J" -lt "$n" ] && analizza_da "$J"; return 0 ;;
    chronic) lanciatore "$i" ev "" ""; [ "$J" -lt "$n" ] && analizza_da "$J"; return 0 ;;
    unbuffer) lanciatore "$i" p "" ""; [ "$J" -lt "$n" ] && analizza_da "$J"; return 0 ;;
    nice) lanciatore "$i" "" n " --adjustment= --help --version "; [ "$J" -lt "$n" ] && analizza_da "$J"; return 0 ;;
    ionice) lanciatore "$i" t cnpPu " --class= --classdata= --pid= --pgid= --uid= --ignore --help --version "; [ "$J" -lt "$n" ] && analizza_da "$J"; return 0 ;;
    stdbuf) lanciatore "$i" "" ioe " --input= --output= --error= --help --version "; [ "$J" -lt "$n" ] && analizza_da "$J"; return 0 ;;
    timeout) lanciatore "$i" v sk " --signal= --kill-after= --preserve-status --foreground --verbose --help --version "
             J=$((J+1)); [ "$J" -lt "$n" ] && analizza_da "$J"; return 0 ;;   # dopo le opzioni la durata, poi il comando
    flock)   # flock <file> <comando>, oppure flock <file> -c '<testo>', che va a una shell
      lanciatore "$i" sexnuoF wE " --shared --exclusive --unlock --nonblock --nonblocking --nb --close --no-fork --verbose --timeout= --wait= --conflict-exit-code= --help --version "
      J=$((J+1))
      if [ "$J" -lt "$n" ] && { [ "${argv[$J]}" = -c ] || [ "${argv[$J]}" = --command ]; }; then
        [[ "${segni[$((J+1))]:-}" == *d* ]] && block "flock -c con un testo deciso da variabili o comandi annidati non si controlla: scrivi il comando per intero."
        salva="$CWD"; analizza_testo "${argv[$((J+1))]:-}"; CWD="$salva"; return 0
      fi
      [ "$J" -lt "$n" ] && analizza_da "$J"; return 0 ;;
    xargs)   # le opzioni come le legge xargs; il comando lanciato solo da un elenco di comandi che leggono
      j=$((i+1))
      while [ "$j" -lt "$n" ]; do
        a="${argv[$j]}"
        case "$a" in
          --) j=$((j+1)); break ;;
          --null|--no-run-if-empty|--verbose|--exit|--interactive|--open-tty|--show-limits|--help|--version|--replace|--eof|--max-lines|\
          --arg-file=*|--delimiter=*|--max-args=*|--max-lines=*|--max-procs=*|--max-chars=*|--replace=*|--eof=*|--process-slot-var=*) j=$((j+1)); continue ;;
          --arg-file|--delimiter|--max-args|--max-procs|--max-chars|--process-slot-var) j=$((j+2)); continue ;;
          --*) block "xargs $a: l'opzione non è fra quelle che l'hook conosce, scritte per intero: nasconderebbe il comando lanciato." ;;
          -?*) g="${a#-}"; t=0
               for ((k=0; k<${#g}; k++)); do
                 c="${g:$k:1}"
                 case "$c" in
                   a|d|E|I|L|n|P|s) [ $((k+1)) -ge "${#g}" ] && t=1; break ;;
                   e|i|l) break ;;   # il valore, se c'è, è attaccato
                   0|o|p|r|t|x) continue ;;
                   *) block "xargs -$c: l'opzione non è fra quelle che l'hook conosce: nasconderebbe il comando lanciato." ;;
                 esac
               done
               j=$((j+1+t)); continue ;;
        esac
        break
      done
      [ "$j" -lt "$n" ] || return 0   # senza comando: echo
      [[ "$LETTORI_XARGS" == *" ${argv[$j]##*/} "* ]] || \
        block "con xargs si lanciano solo comandi che leggono (grep, cat, head, wc, ls, stat, sha256sum…): '${argv[$j]}' riceverebbe argomenti che non si possono controllare. Scrivi il comando per intero, con i percorsi."
      analizza_da "$j"; return 0 ;;
    bash|sh|zsh|dash|ksh|mksh|ash|yash|posh|fish|tcsh|csh)
      [[ "${argv[$((i+1))]:-}" == *gabbia.sh ]] && { gabbia_comando "$i"; return 0; }
      for ((j=i+1; j<n; j++)); do
        if [[ "${argv[$j]}" == -* && "${argv[$j]}" != --* && "${argv[$j]}" == *c* ]]; then
          [ $((j+1)) -lt "$n" ] || return 0
          [[ "${segni[$((j+1))]}" == *d* ]] && block "bash -c con un testo deciso da variabili o comandi annidati non si controlla: scrivi il comando per intero."
          salva="$CWD"; analizza_testo "${argv[$((j+1))]}"; CWD="$salva"; return 0
        fi
      done
      legge_stdin "$i" "$prog"
      case $? in
        0)   # i comandi arrivano da stdin: da un heredoc (il record H) o da una stringa, altrimenti no
          [ "$hd_qui" = 1 ] && return 0
          [ -n "$qui_testo" ] && { salva="$CWD"; analizza_testo "$qui_testo"; CWD="$salva"; return 0; }
          block "una shell che legge i comandi da stdin (da una pipe o da un file con <) non si controlla: scrivi i comandi per intero, o esegui lo script per nome (bash <file>)." ;;
        1) [[ "${segni[$SCRIPT_I]}" == *d* ]] && block "lo script di $prog viene da una variabile o da una sostituzione (<(…), \$(…)): il suo testo non si controlla. Esegui uno script scritto in un file, per nome." ;;
      esac
      return 0 ;;
    source|.)   # uno script per nome sì; uno che viene da una sostituzione (source <(…)) no
      for ((j=i+1; j<n; j++)); do [[ "${argv[$j]}" == -* ]] || break; done
      [ "$j" -lt "$n" ] && [[ "${segni[$j]}" == *d* ]] && block "$prog con un file deciso da variabili o da una sostituzione (<(…), \$(…)) non si controlla: esegui uno script scritto in un file, per nome."
      return 0 ;;
    python|python3|python3.[0-9]*|node|nodejs|deno|bun|perl|ruby|php)
      legge_stdin "$i" "$prog"
      case $? in
        0)   # il codice arriva da stdin: da un heredoc (lo controlla codice_in_linea, record H) o da una stringa
          if [ "$hd_qui" != 1 ]; then
            [ -n "$qui_testo" ] || block "un interprete che legge il codice da stdin (da una pipe o da un file con <) non si controlla: esegui lo script per nome."
            codice_in_linea "$qui_testo"
          fi ;;
        1) [[ "${segni[$SCRIPT_I]}" == *d* ]] && block "lo script o il codice di $prog viene da una variabile o da una sostituzione (<(…), \$(…)): non si controlla. Esegui uno script scritto in un file, per nome." ;;
      esac ;;
    awk|gawk|mawk|nawk)   # il programma in linea si controlla come quello di python -c; gawk -i inplace scrive nei file
      j=$((i+1)); t=0; s0=0
      while [ "$j" -lt "$n" ]; do
        a="${argv[$j]}"
        case "$a" in
          --) j=$((j+1)); break ;;
          -F|--field-separator|-v|--assign|-W) j=$((j+2)); continue ;;
          -F?*|--field-separator=*|--assign=*) j=$((j+1)); continue ;;
          -e|--source) codice_in_linea "${argv[$((j+1))]:-}"; t=1; j=$((j+2)); continue ;;
          --source=*) codice_in_linea "${a#*=}"; t=1; j=$((j+1)); continue ;;
          -e?*) codice_in_linea "${a#-e}"; t=1; j=$((j+1)); continue ;;
          -i|--include) [[ "${argv[$((j+1))]:-}" == inplace* ]] && s0=1; j=$((j+2)); continue ;;
          --include=*) [[ "${a#*=}" == inplace* ]] && s0=1; j=$((j+1)); continue ;;
          -i?*) [[ "${a#-i}" == inplace* ]] && s0=1; j=$((j+1)); continue ;;
          -f|--file|-E|--exec|-l|--load) t=1; j=$((j+2)); continue ;;
          -f?*|--file=*|--exec=*|--load=*) t=1; j=$((j+1)); continue ;;
          -*) j=$((j+1)); continue ;;
        esac
        break
      done
      if [ "$t" = 0 ] && [ "$j" -lt "$n" ]; then codice_in_linea "${argv[$j]}"; j=$((j+1)); fi
      if [ "$s0" = 1 ]; then for ((; j<n; j++)); do [[ "${argv[$j]}" == *=* ]] || scrive "${argv[$j]}" "${segni[$j]}"; done; fi
      return 0 ;;
    pnpm|pnpx|pn|pnx) comandi_pnpm "$i"; return 0 ;;
    npm|npx|yarn|yarnpkg|bunx|corepack) block "nel progetto si usa pnpm: al posto di $prog usa pnpm (pnpm exec, pnpm dlx, pnpm view). npm serve solo all'utente, per installare pnpm (AVVIO.md §1)." ;;
    cd|pushd) cambia_cartella "$i"; return 0 ;;
    popd) CWD="?"; return 0 ;;
    find) analizza_find "$i"; return 0 ;;
    git) analizza_git "$i"; return 0 ;;
    gh) analizza_gh "$i"; return 0 ;;
    ssh|scp|sftp|rsync) analizza_ssh "$i" "$prog"; return 0 ;;
    docker|podman) return 0 ;;   # già letto, prima delle parole
  esac
  [[ "$LANCIATORI_VIETATI" == *" $prog "* ]] && \
    block "$prog lancia altri comandi, o li esegue da un testo, in un modo che l'hook non controlla: nel metodo non si usa. Scrivi il comando per intero, da solo."
  [[ "$EDITORI" == *" $prog "* ]] && block "$prog è un editor che può anche eseguire comandi: da terminale non si usa. Per modificare un file usa Edit o Write."
  analizza_scritture "$i" "$prog"
  return 0
}
testo_in_ingresso() { # $1 il testo di «<<<», $2 i suoi segni: chi lo riceve può prenderlo per un elenco di nomi (xargs cat <<< ~/…)
  parola_locale "$1" antenati "$2"
  file_ambiente "$1"
}
analizza_comando() { # usa argv, segni, redir, rsegni, iredir, isegni, ncmd, hd_qui, qui_testo, qui_segni, hd_coda, caso, modello e
                     # inizio_caso del chiamante
  local n=${#argv[@]} i=0 k cwd0="$CWD" cwd1 qui_prog="" inerte=0
  if [ "$n" -eq 0 ]; then   # solo redirezioni, come in $(< file): il file letto e quello scritto si controllano lo stesso
    for k in "${!iredir[@]}"; do legge_file "${iredir[$k]}" "${isegni[$k]}"; done
    for k in "${!redir[@]}"; do scrive "${redir[$k]}" "${rsegni[$k]}"; done
    [ -n "$qui_testo" ] && testo_in_ingresso "$qui_testo" "$qui_segni"
    [ "$hd_qui" = 1 ] && hd_coda+=("|0")
    return 0
  fi
  ncmd=$((ncmd+1))
  for k in "${!segni[@]}"; do   # le graffe che la shell espande ({a,b}, {1..3}) cambiano le parole del comando
    [[ "${segni[$k]}" == *b* ]] && block "le graffe che la shell espande ('${argv[$k]}') cambiano le parole del comando, che così non si controllano: scrivi le parole per intero."
  done
  while [ "$i" -lt "$n" ]; do   # le parole riservate della shell: il comando viene dopo (if gh …, ! gh …, { gh …; }, do gh …)
    case "${argv[$i]}" in
      '!'|'{'|'}'|if|then|else|elif|fi|do|done|while|until) i=$((i+1)) ;;
      'esac') [ "$caso" -gt 0 ] && caso=$((caso-1)); modello=0; i=$((i+1)) ;;   # finito un case: quello che segue è di nuovo un comando
      function) i=$((i+2)); [ "${argv[$i]:-}" = '{' ] && i=$((i+1)) ;;
      coproc) i=$((i+1)); [ "${argv[$((i+1))]:-}" = '{' ] && i=$((i+2)) ;;
      for|select)   # for x in a b c: qui nessun comando, ma le parole dell'elenco sono i nomi che il ciclo passa ai suoi comandi
                    # (for f in ~/.config/gh/*; do cat "$f"; done): si controllano come gli argomenti di un programma qualunque
        variabile_vietata "${argv[$((i+1))]:-}"   # la variabile del ciclo
        if [ "${argv[$((i+2))]:-}" = in ]; then
          for ((k=i+3; k<n; k++)); do parola_locale "${argv[$k]}" antenati "${segni[$k]}"; file_ambiente "${argv[$k]}"; done
        fi
        i="$n" ;;
      case)   # case x in <modello>: qui nessun comando, e nessun file letto (le $(…) si controllano da sé). Si annota che è
              # cominciato un case: da qui i modelli dei rami non sono comandi (analizza_testo). Tra apici 'case' non è la
              # parola riservata, ma un comando qualunque
        [[ "${segni[$i]}" == *q* ]] && break
        [ "${argv[$((n-1))]}" = esac ] || inizio_caso=1   # «case x in esac» è già finito
        i="$n" ;;
      *) break ;;
    esac
  done
  while [ "$i" -lt "$n" ] && [[ "${argv[$i]}" =~ $RE_ASSEGNA ]]; do
    variabile_vietata "${argv[$i]%%=*}"
    parola_locale "${argv[$i]}" "" "${segni[$i]}"   # il valore: F=~/.config/gh/hosts.yml; cat $F
    file_ambiente "${argv[$i]}"
    i=$((i+1))
  done
  if [ "$i" -lt "$n" ]; then analizza_da "$i"; qui_prog="$ultimo"; fi
  # il testo di «<<<» è l'ingresso del comando: per ssh gira sul server (lo controlla analizza_ssh); per gli altri è un testo
  # che il comando può prendere per un elenco di nomi (xargs cat <<< ~/…; while read f; do cat "$f"; done <<< ~/…)
  [ -n "$qui_testo" ] && [ "$qui_prog" != ssh ] && testo_in_ingresso "$qui_testo" "$qui_segni"
  if [ "$hd_qui" = 1 ]; then   # il testo dell'heredoc arriva dopo (record H): qui si annota chi lo riceve, e se lo scrive soltanto
    if [ "$i" -lt "$n" ]; then
      case "${argv[$i]##*/}" in
        git|gh) inerte=1 ;;                                    # il messaggio di un commit, il testo di una pull request
        cat) [ "${#redir[@]}" -gt 0 ] && inerte=1 ;;           # cat > file <<'EOF': il testo va nel file
        tee) for ((k=i+1; k<n; k++)); do [[ "${argv[$k]}" == -* ]] || inerte=1; done ;;   # tee file <<'EOF'
      esac
    fi
    hd_coda+=("$qui_prog|$inerte")
  fi
  # le redirezioni dopo il comando, dalla cartella in cui è partito: se gira fuori dalla sandbox (ESCLUSO), anche loro
  cwd1="$CWD"; CWD="$cwd0"
  for k in "${!redir[@]}"; do scrive "${redir[$k]}" "${rsegni[$k]}"; done
  for k in "${!iredir[@]}"; do legge_file "${iredir[$k]}" "${isegni[$k]}"; done   # i file letti con «<»
  CWD="$cwd1"
  return 0
}
analizza_testo() { # $1 testo con uno o più comandi
  local -a argv=() segni=() redir=() rsegni=() iredir=() isegni=()
  local riga tipo s v attesa="" ncmd=0 ops="" dyn=0 hd_libero=0 ultimo="" hd_qui=0 qui_testo="" qui_segni="" salva_h hp hi
  local caso=0 modello=0 inizio_caso=0   # quanti case sono aperti; 1 se la prossima parola è il modello di un ramo
  local elenco=0 k                       # 1 dentro NOME=( … ): le parole sono un elenco, non un comando
  local -a hd_coda=()   # chi riceve ogni heredoc della riga, nell'ordine: "programma|1" se il testo viene soltanto scritto
  LIVELLO=$((LIVELLO+1))
  while IFS= read -r riga; do
    tipo="${riga%%$'\t'*}"; v="${riga#*$'\t'}"
    case "$tipo" in
      S) dyn=1; analizza_testo "${v//$'\001'/$'\n'}"; continue ;;                  # una sostituzione è un comando anche lei
      H) v="${v//$'\001'/$'\n'}"                                                   # il testo di un heredoc, secondo chi lo riceve
         if [ "${#hd_coda[@]}" -gt 0 ]; then hp="${hd_coda[0]%|*}"; hi="${hd_coda[0]##*|}"; hd_coda=("${hd_coda[@]:1}"); else hp="$ultimo"; hi=0; fi
         case "$hp" in
           ssh) segreti_remoti "$v" ;;
           bash|sh|zsh|dash|ksh|mksh|ash|yash|posh|fish|tcsh|csh) salva_h="$CWD"; analizza_testo "$v"; CWD="$salva_h" ;;
           python|python3|python3.[0-9]*|node|nodejs|deno|bun|perl|ruby|php|awk|gawk|mawk|nawk) codice_in_linea "$v" ;;
         esac
         # chi riceve un heredoc può prenderne le righe per nomi di file (xargs cat <<EOF): niente nomi interi delle credenziali
         # di questo computer, tranne dove il testo viene soltanto scritto (cat > file, tee file, i messaggi di git e gh) o
         # gira sul server (ssh)
         [ "$hp" != ssh ] && [ "$hi" != 1 ] && nomi_interi "$v" testo
         continue ;;
      O)
        case "$v" in
          '>'|'>>'|'>|'|'<'|'<<'|'<<<'|'>&'|'<&'|'>>&') attesa="$v" ;;
          '=(')   # NOME=( … ): comincia un elenco. Ciò che lo precede (l'assegnazione, o declare -a NOME=) si controlla qui
            ops="$ops$v"; analizza_comando
            argv=(); segni=(); redir=(); rsegni=(); iredir=(); isegni=(); hd_qui=0; qui_testo=""; qui_segni=""; elenco=1 ;;
          '=)')   # le parole dell'elenco non sono un comando: si controllano come gli argomenti di un programma qualunque
            ops="$ops$v"
            if [ "$elenco" = 1 ]; then
              for k in "${!argv[@]}"; do parola_locale "${argv[$k]}" antenati "${segni[$k]}"; file_ambiente "${argv[$k]}"; done
              for k in "${!redir[@]}"; do scrive "${redir[$k]}" "${rsegni[$k]}"; done
              for k in "${!iredir[@]}"; do legge_file "${iredir[$k]}" "${isegni[$k]}"; done
            else analizza_comando; fi
            argv=(); segni=(); redir=(); rsegni=(); iredir=(); isegni=(); hd_qui=0; qui_testo=""; qui_segni=""; elenco=0 ;;
          *) ops="$ops$v"; elenco=0
             if [ "$modello" = 1 ] && [[ "$v" == ')' || "$v" == '|' || "$v" == '(' ]] && [ "${#argv[@]}" -le 1 ] && \
                [ "${#redir[@]}" = 0 ] && [ "${#iredir[@]}" = 0 ] && [ -z "$qui_testo" ] && [ "$hd_qui" = 0 ]; then
               # il modello di un ramo di case: una parola sola, chiusa da «)» (o da «|», se ne segue un altro). Non è un
               # comando; due parole, o una redirezione, non sono un modello, e si controllano come un comando
               [ "$v" = ')' ] && modello=0
             else
               inizio_caso=0; analizza_comando
               if [ "$inizio_caso" = 1 ]; then caso=$((caso+1)); modello=1; [ "$v" = ')' ] && modello=0; fi
             fi
             [ "$v" = ';;' ] && [ "$caso" -gt 0 ] && modello=1   # dopo «;;» viene il modello del ramo successivo, o esac
             argv=(); segni=(); redir=(); rsegni=(); iredir=(); isegni=(); hd_qui=0; qui_testo=""; qui_segni="" ;;
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
        '<<<') qui_testo="$v"; qui_segni="$s" ;;
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
