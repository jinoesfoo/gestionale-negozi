#!/usr/bin/env bash
# PreToolUse su Bash: blocca i comandi che aggirerebbero il metodo o metterebbero a rischio il repository.
# Il comando si scompone come lo legge bash (tokenizza.awk) e ogni comando semplice si controlla:
# dove scrive, con quali opzioni gira git o gh, verso quale server va, cosa monta Docker, cosa porta un commit.
# È la prima rete. La seconda è la sandbox di Claude Code, la terza i controlli sul contenuto degli hook
# (docs/due-postazioni.md, «Protezione del metodo»).
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
MSG_PROT="i file del metodo (.claude/, CLAUDE.md, impostazioni di Claude Code, cartella di stato degli hook) li cambia solo l'utente"

echo "$cmd" | grep -Eq -- '--no-verify' && block "--no-verify salta i controlli e non è permesso."

# --- percorsi ---------------------------------------------------------------------------------------
risolvi() { # $1 percorso, $2 cartella base (facoltativa: altrimenti CWD) -> assoluto canonico, "?" se la base è ignota
  local base="${2:-$CWD}" t="$1"
  case "$t" in "~"|"~/"*) t="$HOME${t#\~}" ;; esac
  case "$t" in /*|[A-Za-z]:/*) canon_path "$t"; return ;; esac
  [ "$base" = "?" ] && { echo "?"; return; }
  canon_path "$base/$t"
}
classifica() { # $1 percorso assoluto canonico in cui un comando scrive
  local abs="$1" rel; rel="$(rel_path "$abs")"
  protetto "$rel" && block "$MSG_PROT ('$rel')."
  antenato_protetto "$abs" && block "il comando scriverebbe su '$rel', che contiene i file del metodo: indica il file preciso."
  case "$rel" in /*|[a-zA-Z]:/*) return 0 ;; esac      # fuori dal progetto
  is_secret_file "$rel" && return 0                     # i file di ambiente li controlla la regola sui segreti
  is_free_file "$rel" && return 0
  case "$fase" in
    test) is_test_file "$rel" || is_test_tooling_file "$rel" || block "in fase test da terminale si scrivono solo i test e la loro configurazione ('$rel')." ;;
    codice|revisione) is_test_file "$rel" && block "in fase $fase i test non si modificano, nemmeno da terminale ('$rel')." ;;
    *) block "in fase $fase non si modificano file del progetto da terminale ('$rel')." ;;
  esac
  return 0
}
scrive() { # $1 percorso, $2 segni (d, g), $3 cartella base facoltativa
  local t="$1" s="$2" abs m
  case "$t" in /dev/null|/dev/stdout|/dev/stderr|/dev/tty|/dev/fd/*|-) return 0 ;; esac
  [[ "$s" == *d* ]] && block "un comando che scrive ha un percorso deciso da una variabile o da un comando annidato ('$t'): scrivi il percorso per intero."
  abs="$(risolvi "$t" "${3:-}")"
  [ "$abs" = "?" ] && block "dopo un cd che non si può risolvere, un comando che scrive non si controlla: scrivi i percorsi per intero."
  if [[ "$s" == *g* ]]; then
    while IFS= read -r m; do [ -n "$m" ] && classifica "$(canon_path "$m")"; done < <(compgen -G "$abs" 2>/dev/null)
  fi
  classifica "$abs"
}

# --- commit -----------------------------------------------------------------------------------------
controlla_commit() { # il commit porta solo il lavoro del compito corrente
  local me f vietati="" altre="" id cambiati
  me="$(postazione)"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    uguale_a_main "$f" || vietati="$vietati $f"     # una modifica identica a main (arrivata con l'unione) va bene
  done < <(git -C "$PROJECT_DIR" status --porcelain --untracked-files=all 2>/dev/null | cut -c4- | sed 's/.* -> //' | \
           grep -E '^(\.claude/|CLAUDE\.md$)' | grep -v -x -F ".claude/registro-compiti-$me.log")
  [ -n "$vietati" ] && block "il commit porterebbe modifiche a file che cambia solo l'utente:$vietati. Non vanno nel commit: chiedi all'utente."
  for id in $(git -C "$PROJECT_DIR" diff HEAD -U0 -- specs 2>/dev/null | grep -oiE '^\+- \[x\] \*\*[A-Z]{3}-T[0-9]{2}[AB]?\*\*' | sed -E 's/.*\*\*(.*)\*\*/\1/' | grep -v -i -x -F "${task:-—}"); do
    sul_main "$id" || altre="$altre $id"
  done
  [ -n "$altre" ] && block "il commit spunterebbe compiti diversi da $task:$altre. Si spunta solo la casella del compito corrente."
  registro_alterato && block "il registro di questa postazione è diverso dalla copia degli hook ($LOG_COPY): così non va nel commit. Chiedi all'utente."
  cambiati="$(test_cambiati | tr '\n' ' ')"
  [ -n "${cambiati// /}" ] && block "i test sono cambiati dopo la fase test: $cambiati. Il commit non li porta: l'utente decide (TORNA AL CODICE e poi TORNA AI TEST, se un test va davvero corretto)."
  return 0
}

# --- git --------------------------------------------------------------------------------------------
analizza_git() { # $1 indice di "git" in argv
  local i="$1" j a sub gdir="$CWD" k
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
  local -a r=("${argv[@]:$((j+1))}") rs=("${segni[@]:$((j+1))}")
  ha() { local x; for x in "${r[@]}"; do [ "$x" = "$1" ] && return 0; done; return 1; }
  case "$sub" in
    push) git_push ;;
    commit|cherry-pick|revert|am|rebase)
      { ha --abort || ha --quit || ha --skip; } && return 0
      [ "$fase" = chiusura ] || block "i commit si fanno in fase chiusura (fase attuale: $fase), con /chiudi-compito."
      controlla_commit ;;
    merge|pull)
      { ha --ff-only || ha --abort; } && return 0
      [ "$fase" = chiusura ] || block "un git $sub che crea un commit si fa solo in chiusura; per allinearsi a main prima si usa git merge --ff-only origin/main."
      controlla_commit ;;
    commit-tree|update-ref|replace|update-index|read-tree|write-tree|symbolic-ref|fast-import|filter-branch|filter-repo|mktree|mktag|unpack-objects|index-pack|notes)
      block "git $sub è un comando di basso livello: nel metodo non serve." ;;
    hash-object) ha -w && block "git hash-object -w scrive nel repository: nel metodo non serve." ;;
    reflog) case "${r[0]:-}" in expire|delete) block "git reflog $sub cancella la storia locale: lo fa l'utente." ;; esac ;;
    config) git_config ;;
    remote) for a in "${r[@]}"; do case "$a" in -*) ;; add|set-url|rename|remove|rm|set-head|set-branches|prune|update) block "i remoti di git li cambia l'utente." ;; *) break ;; esac; done ;;
    reset) ha --hard && block "git reset --hard è distruttivo: se serve davvero, lo esegue l'utente." ;;
    clean) for a in "${r[@]}"; do { [ "$a" = --force ] || [[ "$a" == -* && "$a" != --* && "$a" == *f* ]]; } && block "git clean -f è distruttivo: se serve davvero, lo esegue l'utente."; done ;;
    checkout|restore) git_percorsi ;;
    rm|mv) for k in "${!r[@]}"; do [[ "${r[$k]}" == -* ]] || scrive "${r[$k]}" "${rs[$k]}" "$gdir"; done ;;
    apply) { ha --cached || ha --index; } && block "git apply --cached/--index modifica l'indice: nel metodo non serve."
           case "$fase" in nessuno|piano|chiusura) block "git apply modifica i file del progetto: non in fase $fase." ;; esac ;;
  esac
  return 0
}
git_push() {
  local cur d a k nopz=0; local -a pos=()
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
      -o|--push-option) nopz=1 ;;
      --*) ;;
      -*) [[ "$a" == *f* || "$a" == *d* ]] && block "git push $a non è permesso: si spinge solo il ramo del compito, senza forzare." ;;
      *) pos+=("$a") ;;
    esac
  done
  if [ "${#pos[@]}" -le 1 ]; then
    [ "$(git -C "$gdir" config --get push.default 2>/dev/null)" = matching ] && block "con push.default=matching un git push senza ramo spingerebbe anche main."
    d="$(git -C "$gdir" rev-parse --abbrev-ref --symbolic-full-name '@{push}' 2>/dev/null)"
    case "$d" in main|*/main) block "il ramo corrente si spingerebbe su main: spingilo con il suo nome (git push -u origin <ramo>)." ;; esac
  fi
  for a in "${pos[@]:1}"; do
    [[ "$a" == +* ]] && block "una destinazione con + forza la spinta: non è permesso."
    [[ "$a" == :* ]] && block "una destinazione senza sorgente cancella un ramo remoto: non è permesso."
    [[ "$a" == *'*'* ]] && block "una destinazione con * spingerebbe più rami: non è permesso."
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
git_percorsi() { # checkout e restore: i percorsi sono scritture (dopo "--", o file che esistono; per restore sempre)
  local k=0 a dopo=0 tutti=0
  [ "$sub" = restore ] && tutti=1
  while [ "$k" -lt "${#r[@]}" ]; do
    a="${r[$k]}"
    if [ "$dopo" = 1 ]; then scrive "$a" "${rs[$k]}" "$gdir"; k=$((k+1)); continue; fi
    case "$a" in
      --) dopo=1 ;;
      --pathspec-from-file|--pathspec-from-file=*) block "git $sub --pathspec-from-file non si controlla: scrivi i percorsi per intero." ;;
      -b|-B|--orphan|-s|--source|--conflict) k=$((k+1)) ;;
      -*) ;;
      *) if [ "$tutti" = 1 ] || [ -e "$(risolvi "$a" "$gdir")" ]; then scrive "$a" "${rs[$k]}" "$gdir"; fi ;;
    esac
    k=$((k+1))
  done
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
    pr) for a in "${w[@]:1}"; do [ "$a" = merge ] && block "le pull request le unisce l'utente, su GitHub, dopo aver guardato la CI."; done ;;
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
    repo) case "${w[1]:-}" in edit|delete|rename|archive|unarchive|set-default) block "le impostazioni del repository le cambia l'utente." ;; esac ;;
    secret) case "${w[1]:-}" in set|delete|remove) block "i segreti di GitHub li scrive l'utente: i valori non passano da Claude." ;; esac ;;
    release) case "${w[1]:-}" in create|delete|edit|upload|delete-asset) block "i rilasci li decide e li crea l'utente." ;; esac ;;
    auth) block "gh auth lo usa l'utente: stampa o cambia le credenziali." ;;
    alias|extension|config) case "${w[1]:-}" in set|delete|import|install|upgrade|remove|create|exec|clear-cache) block "gh ${w[0]} ${w[1]} cambia gh: lo fa l'utente." ;; esac ;;
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
analizza_ssh() { # $1 indice, $2 programma
  local i="$1" prog="$2" j a v; local -a pos=() psg=()
  case "$fase" in codice|revisione|chiusura) ;; *) block "i comandi verso i server (ssh, scp, rsync) si usano solo dentro un compito, nelle fasi codice, revisione e chiusura (fase attuale: $fase). Per un controllo in sola lettura chiedi all'utente di eseguirlo." ;; esac
  for ((j=i+1; j<n; j++)); do
    a="${argv[$j]}"
    [[ "${segni[$j]}" == *d* ]] && block "un comando verso i server con argomenti decisi da variabili non si controlla: scrivili per intero."
    case "$prog:$a" in
      ssh:-J*|scp:-J*|sftp:-J*) block "i salti verso altri server (-J) non si usano: vai diretto a test o prod." ;;
      ssh:-o|scp:-o|sftp:-o|rsync:-e|rsync:--rsh) v="${argv[$((j+1))]:-}"; j=$((j+1)) ;;
      ssh:-o?*|scp:-o?*|sftp:-o?*) v="${a#-o}" ;;
      rsync:-e?*|rsync:--rsh=*) v="${a#-e}"; v="${v#--rsh=}" ;;
      ssh:-[bcDEeFIiLlmOpQRSWw]|scp:-[cFilPS]|sftp:-[BbcDFilPRS]) j=$((j+1)); continue ;;   # opzioni con un valore
      *:-*) continue ;;
      *) pos+=("$a"); psg+=("${segni[$j]}"); continue ;;
    esac
    case "${v,,}" in *proxycommand*|*proxyjump*|*localcommand*|*" -j"*) block "ProxyCommand, ProxyJump e LocalCommand non si usano verso i server." ;; esac
  done
  if [ "$prog" = ssh ]; then [ "${#pos[@]}" -gt 0 ] && host_ok "${pos[0]}"; return 0; fi
  local remoti=0 k
  for k in "${!pos[@]}"; do
    a="${pos[$k]}"
    if [[ "$a" =~ ^([^/@:]+@)?[A-Za-z0-9._-]+: ]]; then host_ok "${a%%:*}"; remoti=1; fi
  done
  if [ "$prog" = sftp ]; then [ "${#pos[@]}" -gt 0 ] && [ "$remoti" = 0 ] && host_ok "${pos[0]}"; return 0; fi
  if [ "${#pos[@]}" -ge 2 ]; then   # destinazione locale (copia dal server o copia locale): è una scrittura
    a="${pos[-1]}"; [[ "$a" =~ ^([^/@:]+@)?[A-Za-z0-9._-]+: ]] || scrive "$a" "${psg[-1]}"
  fi
  return 0
}

# --- docker -----------------------------------------------------------------------------------------
monta() { # una cartella dell'host montata in un container non deve contenere i file del metodo
  local abs; abs="$(risolvi "$1")"
  [ "$abs" = "?" ] && block "un volume Docker dopo un cd che non si può risolvere non si controlla: scrivi il percorso per intero."
  protetto "$(rel_path "$abs")" && block "monta in un container i file del metodo ('$1')."
  antenato_protetto "$abs" && block "monta in un container una cartella che contiene i file del metodo ('$1'): monta solo la sottocartella che serve."
  return 0
}
analizza_docker() { # $1 indice
  local i="$1" j a v src; local -a pos=()
  for ((j=i+1; j<n; j++)); do
    a="${argv[$j]}"
    case "$a" in
      -v|--volume|--mount) v="${argv[$((j+1))]:-}"; [[ "${segni[$((j+1))]}" == *d* ]] && block "un volume Docker con un percorso deciso da variabili non si controlla: scrivilo per intero."; j=$((j+1)) ;;
      -v?*|--volume=*|--mount=*) v="${a#-v}"; v="${v#--volume=}"; v="${v#--mount=}"; [[ "${segni[$j]}" == *d* ]] && block "un volume Docker con un percorso deciso da variabili non si controlla: scrivilo per intero." ;;
      -*) continue ;;
      *) pos+=("$a"); continue ;;
    esac
    if [[ "$v" == *source=* || "$v" == *src=* ]]; then src="$(sed -n -E 's/.*(source|src)=([^,]+).*/\2/p' <<< "$v")"; else src="${v%%:*}"; fi
    case "$src" in /*|.*|~*|[A-Za-z]:/*) monta "$src" ;; esac   # un nome senza / è un volume di Docker, non una cartella
  done
  if [ "${pos[0]:-}" = cp ] && [ "${#pos[@]}" -ge 3 ] && [[ "${pos[-1]}" != *:* ]]; then scrive "${pos[-1]}" ""; fi
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
          perl|ruby) case "$a" in --*) ;; *i*) inplace=1 ;; esac; case "$a" in -e|-E|-[a-zA-Z]*e|-[a-zA-Z]*E) script_dato=1; j=$((j+1)) ;; esac ;;
          cp|mv|ln|install) case "$a" in -t|--target-directory) dest="${argv[$((j+1))]:-}"; dsg="${segni[$((j+1))]}"; j=$((j+1)) ;; --target-directory=*) dest="${a#*=}" ;; -S|--suffix|-m|--mode|-o|--owner|-g|--group) j=$((j+1)) ;; esac ;;
          truncate) case "$a" in -s|--size|-r|--reference) j=$((j+1)) ;; esac ;;
          curl) case "$a" in -o|--output) scrive "${argv[$((j+1))]:-}" "${segni[$((j+1))]}"; j=$((j+1)) ;; -O|--remote-name|-J|--remote-header-name) scrive "." "" ;;
                  -H|-d|-X|-u|-A|-e|-b|-c|-F|-T|--header|--user|--url|--data|--data-raw|--data-binary|--form|--upload-file|--request|--cookie|--cookie-jar|--user-agent|--referer) j=$((j+1)) ;; esac ;;
          wget) case "$a" in -O|--output-document|-P|--directory-prefix) scrive "${argv[$((j+1))]:-}" "${segni[$((j+1))]}"; j=$((j+1)) ;; esac ;;
          tar) case "$a" in -C|--directory) tdir="${argv[$((j+1))]:-}"; j=$((j+1)) ;; --directory=*) tdir="${a#*=}" ;; --extract|--get) tx=1 ;; --*) ;; *x*) tx=1 ;; esac ;;
          unzip) case "$a" in -d) tdir="${argv[$((j+1))]:-}"; j=$((j+1)) ;; esac ;;
          python|python3|node|deno|bun|php) case "$a" in -c|-e|--eval|-r) codice_in_linea "${argv[$((j+1))]:-}"; j=$((j+1)) ;; esac ;;
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
codice_in_linea() { # codice passato a python -c, node -e e simili: non deve nominare i file del metodo
  echo "$1" | grep -Eq '\.claude|CLAUDE\.md|compito-corrente|registro-compiti|postazione|corsie\.txt|gestionale-negozi/|\.local/state' && \
    block "un programma in linea che nomina i file del metodo non è permesso."
  return 0
}
analizza_find() { # $1 indice: find con -delete o -exec di un comando che scrive scrive nelle cartelle di partenza
  local i="$1" j a scrive_qui=0; local -a radici=() rsg=()
  for ((j=i+1; j<n; j++)); do a="${argv[$j]}"; case "$a" in -*|'('|'!'|')') break ;; *) radici+=("$a"); rsg+=("${segni[$j]}") ;; esac; done
  for ((; j<n; j++)); do
    case "${argv[$j]}" in
      -delete|-fprint|-fprint0|-fprintf|-fls) scrive_qui=1 ;;
      -exec|-execdir|-ok|-okdir) case "${argv[$((j+1))]##*/}" in rm|rmdir|unlink|mv|cp|ln|install|tee|truncate|touch|chmod|chown|chgrp|sed|perl|dd|shred|git|bash|sh|python|python3|node) scrive_qui=1 ;; esac ;;
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
  if [[ "${segni[$j]}" == *d* || "${segni[$j]}" == *g* || "${argv[$j]}" == - ]]; then CWD="?"; return 0; fi
  CWD="$(risolvi "${argv[$j]}")"
  return 0
}

# --- un comando semplice ----------------------------------------------------------------------------
analizza_da() { # $1 indice del nome del comando in argv
  local i="$1" prog j a ha_example=0 salva
  [[ "${segni[$i]}" == *d* ]] && block "il nome del comando viene da una variabile o da un comando annidato: scrivilo per intero."
  prog="${argv[$i]##*/}"
  # in qualunque comando: il nome della postazione e i file di ambiente reali
  for ((j=i; j<n; j++)); do [[ "${argv[$j]}" == *.example* ]] && ha_example=1; done
  for ((j=i; j<n; j++)); do
    a="${argv[$j]}"
    case "$a" in *imposta-postazione*|*hooks/imposta*) block "il nome della postazione lo imposta l'utente, nel suo terminale, una volta sola." ;; esac
    if [ "$ha_example" = 0 ] && [[ "$a" != -* ]] && [[ "$a" == *.env* || "$a" == */env/* ]]; then
      is_secret_file "$(rel_path "$(risolvi "$a")")" && block "il comando legge o modifica un file di ambiente reale ('$a'). Usa i file *.example."
    fi
  done
  case "$prog" in
    sudo|su|doas|pkexec|runuser) block "i comandi con sudo li esegue l'utente." ;;
    eval) block "eval non è permesso: scrivi il comando per intero." ;;
    env)
      j=$((i+1))
      while [ "$j" -lt "$n" ]; do
        a="${argv[$j]}"
        case "$a" in
          -u|-C|-S|--unset|--chdir|--split-string) j=$((j+2)); continue ;;
          -*) j=$((j+1)); continue ;;
        esac
        if [[ "$a" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
          case "${a%%=*}" in GIT_*|CLAUDE_PROJECT_DIR|GESTIONALE_STATO_DIR|HOME) block "la variabile ${a%%=*} cambia il repository o la cartella degli hook: non si imposta davanti a un comando." ;; esac
          j=$((j+1)); continue
        fi
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
      for ((j=i+1; j<n; j++)); do
        if [[ "${argv[$j]}" == -* && "${argv[$j]}" != --* && "${argv[$j]}" == *c* ]]; then
          [ $((j+1)) -lt "$n" ] || return 0
          [[ "${segni[$((j+1))]}" == *d* ]] && block "bash -c con un testo deciso da variabili o comandi annidati non si controlla: scrivi il comando per intero."
          salva="$CWD"; analizza_testo "${argv[$((j+1))]}"; CWD="$salva"; return 0
        fi
      done
      return 0 ;;
    xargs|parallel)
      for ((j=i+1; j<n; j++)); do
        case "${argv[$j]##*/}" in rm|rmdir|unlink|mv|cp|ln|install|tee|truncate|touch|chmod|chown|chgrp|sed|perl|dd|shred|git|gh|ssh|scp|rsync|docker|bash|sh)
          block "con xargs un comando che scrive riceve argomenti che non si possono controllare: scrivi i percorsi per intero." ;;
        esac
      done
      return 0 ;;
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
analizza_comando() { # usa argv, segni, redir, rsegni del chiamante
  local n=${#argv[@]} i=0 k
  for k in "${!redir[@]}"; do scrive "${redir[$k]}" "${rsegni[$k]}"; done
  [ "$n" -eq 0 ] && return 0
  while [ "$i" -lt "$n" ] && [[ "${argv[$i]}" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; do
    case "${argv[$i]%%=*}" in GIT_*|CLAUDE_PROJECT_DIR|GESTIONALE_STATO_DIR|HOME) block "la variabile ${argv[$i]%%=*} cambia il repository o la cartella degli hook: non si imposta davanti a un comando." ;; esac
    i=$((i+1))
  done
  [ "$i" -lt "$n" ] && analizza_da "$i"
  return 0
}
analizza_testo() { # $1 testo con uno o più comandi
  local -a argv=() segni=() redir=() rsegni=()
  local riga tipo s v attesa=""
  while IFS= read -r riga; do
    tipo="${riga%%$'\t'*}"
    if [ "$tipo" = O ]; then
      v="${riga#O$'\t'}"
      case "$v" in
        '>'|'>>'|'>|'|'<'|'<<'|'<<<'|'>&'|'<&'|'>>&') attesa="$v" ;;
        *) analizza_comando; argv=(); segni=(); redir=(); rsegni=() ;;
      esac
      continue
    fi
    s="${riga#W$'\t'}"; v="${s#*$'\t'}"; s="${s%%$'\t'*}"
    if [ -n "$attesa" ]; then
      case "$attesa" in
        '>'|'>>'|'>|') redir+=("$v"); rsegni+=("$s") ;;
        '>&'|'>>&') [[ "$v" =~ ^([0-9]+|-)$ ]] || { redir+=("$v"); rsegni+=("$s"); } ;;
      esac
      attesa=""; continue
    fi
    argv+=("$v"); segni+=("$s")
  done < <(printf '%s' "$1" | awk -f "$TOKENIZER")
  analizza_comando
  return 0
}

analizza_testo "$cmd"
exit 0
