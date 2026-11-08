#!/usr/bin/env bash
# PreToolUse su Bash: blocca i comandi che aggirerebbero il metodo o metterebbero a rischio il repository.
source "$(dirname "$0")/common.sh"

input="$(cat)"
cmd="$(echo "$input" | jq -r '.tool_input.command // ""')"
# Su Windows: barre rovesciate e maiuscole non devono aggirare i controlli sui percorsi
[ "$ON_WINDOWS" = 1 ] && { cmd="${cmd//\\//}"; cmd="${cmd,,}"; }

block() { echo "BLOCCATO dal metodo di lavoro: $*" >&2; exit 2; }

# File di stato e hook: non si toccano da terminale
if echo "$cmd" | grep -Eq 'compito-corrente\.json|registro-compiti|\.claude/hooks|\.claude/settings\.json|\.claude/postazione'; then
  if echo "$cmd" | grep -Eq '(>|tee|sed -i|rm |mv |cp |chmod|truncate|jq .*>)'; then
    block "il file di stato, la postazione, il registro e gli hook del metodo non si modificano da terminale."
  fi
fi
echo "$cmd" | grep -q 'imposta-postazione' && block "il nome della postazione lo imposta l'utente, a mano, una volta sola."

# Segreti
if echo "$cmd" | grep -Eq '(^|[[:space:]/])(\.env(\.[a-z]+)?|[a-z]+\.env)([[:space:]]|$)' && ! echo "$cmd" | grep -q 'example'; then
  block "il comando legge o modifica un file di ambiente reale. Usa i file *.example."
fi

# Git pericolosi
echo "$cmd" | grep -Eq 'git[[:space:]]+push.*(--force|-f([[:space:]]|$))' && block "git push --force non è permesso."
echo "$cmd" | grep -Eq 'git[[:space:]]+push.*[[:space:]](origin[[:space:]]+)?main([[:space:]]|$)' && block "non si spinge su main: si apre una pull request dal ramo del compito."
echo "$cmd" | grep -Eq -- '--no-verify' && block "--no-verify salta i controlli e non è permesso."
echo "$cmd" | grep -Eq 'git[[:space:]]+(reset[[:space:]]+--hard|clean[[:space:]]+-[a-z]*f)' && block "comando git distruttivo: chiedi all'utente di eseguirlo lui se serve davvero."

# Commit solo in fase chiusura
if echo "$cmd" | grep -Eq 'git[[:space:]]+commit'; then
  fase="$(current_phase)"
  [ "$fase" = "chiusura" ] || block "i commit si fanno in fase chiusura (fase attuale: $fase), con /chiudi-compito."
fi

# Scrittura di file da terminale per aggirare le regole di fase (es. echo > src/...)
fase="$(current_phase)"
if echo "$cmd" | grep -Eq '(>|tee |sed -i)[^|&;]*(src/|drizzle/|tests/|\.test\.ts)'; then
  case "$fase" in
    codice|revisione) echo "$cmd" | grep -Eq '(>|tee |sed -i)[^|&;]*(tests/|\.test\.ts)' && block "in fase $fase i test non si modificano, nemmeno da terminale." ;;
    test) echo "$cmd" | grep -Eq '(>|tee |sed -i)[^|&;]*(src/|drizzle/)' && block "in fase test il codice non si modifica, nemmeno da terminale." ;;
    *) block "in fase $fase non si modificano file del progetto da terminale." ;;
  esac
fi

exit 0
