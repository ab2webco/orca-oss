#!/usr/bin/env bash
# Exits 0 only in the project lead's session; otherwise prints why not and exits 1.
# Every coordination hook asks here, so a plain session never gets a lead's instructions.
set -u

# Why first and not only `game state`: it reports role=lead for a member whose pane has no parent
# row (ORCA-991). Orca sets ORCA_GAME_ROLE=member in the same launch env as ORCA_GAME_CLI.
if [ "${ORCA_GAME_ROLE:-}" = "member" ]; then
  echo "Sesion de member (ORCA_GAME_ROLE)"
  exit 1
fi

cli="${ORCA_GAME_CLI:-}"
if [ -z "$cli" ]; then
  echo "Sesion sin ORCA_GAME_CLI"
  exit 1
fi

# Why: members run in linked worktrees; the lead runs in the primary checkout.
git_dir=$(cd "$(git rev-parse --git-dir 2>/dev/null || echo .)" 2>/dev/null && pwd -P)
common_dir=$(cd "$(git rev-parse --git-common-dir 2>/dev/null || echo .)" 2>/dev/null && pwd -P)
if [ "$git_dir" != "$common_dir" ]; then
  echo "Sesion en una worktree enlazada"
  exit 1
fi

role=$("$cli" game state --json 2>/dev/null | jq -r '.result.role // empty' 2>/dev/null)
if [ "$role" != "lead" ]; then
  echo "Esta sesion no es el lead del juego"
  exit 1
fi
