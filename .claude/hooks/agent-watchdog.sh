#!/usr/bin/env bash
# MVP of ORCA-340. Watches every Orca worktree and reports the ones that stopped moving.
#
# Progress is read from git in the worktree, never from the app: a `terminal show` that
# times out under load is indistinguishable from a dead agent, and that false positive has
# already been reported here as WORKER GONE about an agent that was working.
#
# Simple mode: no arguments. Advanced: the env vars below, or --once for a single tick.
#
#   ORCA_WATCHDOG_INTERVAL   seconds between ticks (default 1800)
#   ORCA_WATCHDOG_STALL      ticks without progress before escalating (default 2)
#   ORCA_WATCHDOG_PROBE      command run in the worktree; its stdout is the progress
#                            fingerprint (default: HEAD sha + working-tree line count)
#   ORCA_WATCHDOG_ASK        message sent to a stalled worktree's terminal (default: none)
set -uo pipefail

ROOT="${ORCA_WATCHDOG_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
INTERVAL="${ORCA_WATCHDOG_INTERVAL:-1800}"
STALL="${ORCA_WATCHDOG_STALL:-2}"
ASK="${ORCA_WATCHDOG_ASK:-}"
STATE="$ROOT/.git/orca-watchdog-state"

# Both halves matter: commits alone miss an agent editing without committing, and a dirty
# count alone misses one that commits and then idles.
default_probe() {
  echo "$(git rev-parse HEAD 2>/dev/null) $(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
}

fingerprint() {
  if [ -n "${ORCA_WATCHDOG_PROBE:-}" ]; then
    eval "$ORCA_WATCHDOG_PROBE" 2>/dev/null
  else
    default_probe
  fi
}

read_state() { grep -F "$1|" "$STATE" 2>/dev/null | tail -1 | cut -d'|' -f2-; }

write_state() {
  local key=$1 value=$2 tmp="$STATE.tmp.$$"
  { grep -vF "$key|" "$STATE" 2>/dev/null; echo "$key|$value"; } > "$tmp" && mv "$tmp" "$STATE"
}

# A stalled worktree gets asked once per stall, not once per tick — repeating a question
# an agent is not answering is noise, not accountability.
ask_terminal() {
  local path=$1
  [ -z "$ASK" ] && return
  local handle
  handle=$(orca terminal list --json 2>/dev/null |
    jq -r --arg p "$path" '[.result.terminals[]?|select(.worktreePath==$p and .liveness=="running")][0].handle // empty' 2>/dev/null)
  [ -z "$handle" ] && return
  # --enter is required: without it the text sits unsent and the call still returns ok.
  orca terminal send --terminal "$handle" --enter --json --text "$ASK" >/dev/null 2>&1
  echo "asked"
}

tick() {
  local reported=0
  while read -r path; do
    [ -d "$path" ] || continue
    [ "$path" = "$ROOT" ] && continue

    local now prev count key branch
    key=$(basename "$path")
    branch=$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null)
    now=$(cd "$path" && fingerprint)
    prev=$(read_state "$key")
    count=${prev##*|}
    [ "${prev%|*}" = "$now" ] && count=$((count + 1)) || count=0
    write_state "$key" "$now|$count"

    if [ "$count" -ge "$STALL" ]; then
      local asked=""
      [ "$count" -eq "$STALL" ] && asked=$(ask_terminal "$path")
      echo "WATCHDOG stalled | $key | branch:${branch:-?} | ticks:$count ${asked:+| $asked}"
      reported=1
    fi
  done < <(git -C "$ROOT" worktree list --porcelain 2>/dev/null | sed -n 's|^worktree ||p')

  [ "$reported" -eq 0 ] && echo "WATCHDOG $(date '+%H:%M') | todos los worktrees avanzando"
}

if [ "${1:-}" = "--once" ]; then
  tick
  exit 0
fi

while true; do
  tick
  sleep "$INTERVAL"
done
