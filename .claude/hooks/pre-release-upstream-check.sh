#!/usr/bin/env bash
# PreToolUse(Bash) guard: before dispatching a Lab Release, verify the official
# Orca upstream (origin = stablyai/orca) has no commits we don't have yet.
# Fires only on the release-dispatch command; stays silent otherwise.
set -euo pipefail

cmd="$(jq -r '.tool_input.command // ""')"

# Only act on the release dispatch itself.
case "$cmd" in
  *"gh workflow run"*"Lab Release"*) ;;
  *) exit 0 ;;
esac

git fetch origin --quiet 2>/dev/null || true
behind="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"

if [ "${behind:-0}" -gt 0 ]; then
  reason="STOP: origin/main (stablyai/orca oficial) tiene ${behind} commit(s) que main no tiene. Regla de release: traer upstream ANTES de publicar (git merge --no-edit origin/main), re-correr el gate build:desktop y solo entonces disparar. Confirma que quieres publicar de todos modos."
  jq -n --arg r "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$r}}'
else
  jq -n '{systemMessage:"Upstream check OK: origin/main sin commits nuevos."}'
fi
