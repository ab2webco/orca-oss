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
#                            fingerprint (default: HEAD sha + a hash of the working diff)
#   ORCA_WATCHDOG_ASK        message sent to a stalled worktree's terminal (default: none)
set -uo pipefail

ROOT="${ORCA_WATCHDOG_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
INTERVAL="${ORCA_WATCHDOG_INTERVAL:-1800}"
STALL="${ORCA_WATCHDOG_STALL:-2}"
ASK="${ORCA_WATCHDOG_ASK:-}"
STATE="$ROOT/.git/orca-watchdog-state"

# Both halves matter: commits alone miss an agent editing without committing, and the diff
# alone misses one that commits and then idles. It hashes the diff rather than counting
# files because a worker editing one file over and over holds the count at 1 forever, and a
# count-based fingerprint then reads steady work as a stall.
default_probe() {
  echo "$(git rev-parse HEAD 2>/dev/null) $({
    git status --porcelain 2>/dev/null
    git diff HEAD 2>/dev/null
  } | shasum | cut -d' ' -f1)"
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

# A dead session and a session that has not started yet both show zero commits and a clean
# tree, so git cannot separate them — an ORCA-333 worker sat dead on an expired login for an
# hour looking exactly like one warming up, while `orca account list` still reported the
# account authenticated. Reading the pane for a known death marker is sound in this
# direction only: the string being present proves death, and the app failing to answer
# merely falls through to the stall counter.
dead_marker() {
  local handle
  handle=$(orca terminal list --json 2>/dev/null |
    jq -r --arg p "$1" '[.result.terminals[]?|select(.worktreePath==$p and .liveness=="running")][0].handle // empty' 2>/dev/null)
  [ -z "$handle" ] && return 1
  orca terminal read --terminal "$handle" --json 2>/dev/null |
    grep -oiE "Login expired|Please run /login|usage limit reached|Credit balance too low|Failed to start turn|invalid cwd" |
    head -1
}

tick() {
  local reported=0
  while read -r path; do
    [ -d "$path" ] || continue
    [ "$path" = "$ROOT" ] && continue

    local now prev count asks key branch threshold dead
    key=$(basename "$path")
    dead=$(dead_marker "$path")
    if [ -n "$dead" ]; then
      echo "WATCHDOG muerto | $key | $dead"
      reported=1
      continue
    fi
    key=$(basename "$path")
    branch=$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null)
    now=$(cd "$path" && fingerprint)

    # State is count|asks|fingerprint — counters first because the fingerprint contains
    # spaces and would otherwise have to be parsed around.
    prev=$(read_state "$key")
    count=$(cut -d'|' -f1 <<<"$prev"); count=${count:-0}
    asks=$(cut -d'|' -f2 <<<"$prev"); asks=${asks:-0}
    if [ "$(cut -d'|' -f3- <<<"$prev")" = "$now" ]; then
      count=$((count + 1))
    else
      count=0
      asks=0
    fi

    # Why the doubling: git cannot see a long reasoning phase, so a thinking agent keeps
    # crossing the threshold. Each unanswered ask widens the window rather than repeating
    # the question every tick; any real progress resets both counters.
    threshold=$((STALL << asks))
    if [ "$count" -ge "$threshold" ]; then
      local asked
      asked=$(ask_terminal "$path")
      asks=$((asks + 1))
      count=0
      echo "WATCHDOG stalled | $key | branch:${branch:-?} | sin avance ${threshold} ticks | preguntas:${asks}${asked:+ | $asked}"
      reported=1
    fi
    write_state "$key" "$count|$asks|$now"
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
