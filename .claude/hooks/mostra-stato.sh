#!/usr/bin/env bash
# Solo lettura: mostra postazione, compito e fase, che stanno nella cartella di stato degli hook (fuori dal progetto).
# Uso, dalla cartella del progetto: bash .claude/hooks/mostra-stato.sh
CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
source "$(dirname "$0")/common.sh" || exit 1
echo "postazione: $(postazione)"
echo "compito: $(current_task)"
echo "fase: $(current_phase)"
echo "registro: $LOG_REL"
