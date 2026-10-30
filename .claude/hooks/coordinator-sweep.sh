#!/usr/bin/env bash
# What the coordinator must not forget: PRs green and unmerged, PRs red and unowned,
# worktrees left behind. --once emits SessionStart JSON; no flag loops for the Monitor.
# Silence would be indistinguishable from a dead monitor, so it always prints a line.
set -uo pipefail

REPO="${ORCA_SWEEP_REPO:-ab2webco/orca-oss}"
ROOT="${ORCA_SWEEP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
PROJECT="${ORCA_SWEEP_PLANE_PROJECT:-e665c0d5-22e7-495e-9ecf-3effee3ae370}"
INTERVAL="${ORCA_SWEEP_INTERVAL:-1800}"

sweep_line() {
  cd "$ROOT" 2>/dev/null || { echo "SWEEP: repo missing at $ROOT"; return; }

  local prs green red pending dirty stale board
  prs=$(gh pr list -R "$REPO" --state open --json number,mergeStateStatus,statusCheckRollup,baseRefName 2>/dev/null) || prs='[]'
  local states='[.statusCheckRollup[]?|(.conclusion//.state)]'

  # Green means every check is conclusively good. A running check reports IN_PROGRESS or
  # QUEUED with no conclusion, so an allowlist is the only safe polarity — a denylist of
  # FAILURE/PENDING called a PR mergeable while its E2E shards were still running.
  local settled='["SUCCESS","SKIPPED","NEUTRAL"]'
  green=$(jq -r "[.[]|select(([$states[]|select(. as \$s|$settled|index(\$s)|not)]|length)==0 and (.mergeStateStatus!=\"DIRTY\"))|\"#\(.number)\"]|join(\" \")" <<<"$prs" 2>/dev/null)
  red=$(jq -r "[.[]|select($states|index(\"FAILURE\"))|\"#\(.number)\"]|join(\" \")" <<<"$prs" 2>/dev/null)
  pending=$(jq -r "[.[]|select(($states|index(\"FAILURE\")|not) and (([$states[]|select(. as \$s|$settled|index(\$s)|not)]|length)>0))|\"#\(.number)\"]|join(\" \")" <<<"$prs" 2>/dev/null)

  # Leftover means: no open PR AND nothing unpushed to show for it. A worker still
  # committing has neither, and main never has a PR — flagging either is noise that
  # trains you to ignore the line.
  local live
  live=$(orca terminal list --json 2>/dev/null |
    jq -r '[.result.terminals[]?|select(.liveness=="running")|.worktreePath]|join("\n")' 2>/dev/null)

  # Unshipped: commits past main, no PR, untouched for a day. Skipping these as "in progress"
  # left ORCA-560 finished and invisible for three days (ORCA-562).
  stale=""
  local unshipped="" now last pr_state based tag
  now=$(date +%s)
  while read -r path branch; do
    [ -z "$branch" ] || [ "$branch" = "main" ] && continue
    [ -n "$(gh pr list -R "$REPO" --head "$branch" --state open --json number --jq '.[].number' 2>/dev/null)" ] && continue
    # A merged PR wins over a live terminal and over commits a squash merge leaves ahead of main.
    if [ -z "$(gh pr list -R "$REPO" --head "$branch" --state merged --json number --jq '.[].number' 2>/dev/null)" ]; then
      grep -qxF "$path" <<<"$live" && continue
      if [ "$(git rev-list --count "origin/main..$branch" 2>/dev/null || echo 0)" -gt 0 ]; then
        last=$(git log -1 --format=%ct "$branch" 2>/dev/null)
        [ -n "$last" ] && [ $((now - last)) -ge 86400 ] &&
          unshipped="$unshipped ${branch##*/}($(((now - last) / 86400))d)"
        continue
      fi
    fi
    # Why: deleting this branch makes GitHub close the open PRs based on it, so name them.
    based=$(jq -r --arg b "$branch" '[.[]|select(.baseRefName==$b)|"#\(.number)"]|join(",")' <<<"$prs" 2>/dev/null)
    tag=""
    [ -n "$based" ] && tag="(base-de-$based)"
    # Uncommitted work is flagged apart, never treated as safe to delete.
    if [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]; then
      stale="$stale ${branch##*/}(sin-commitear)$tag"
      continue
    fi
    stale="$stale ${branch##*/}$tag"
  done < <(git worktree list --porcelain 2>/dev/null |
    awk '/^worktree /{p=$2} /^branch /{sub("refs/heads/","",$2); print p, $2}')

  # A conflicted PR has no failing check and no passing one, so every bucket above misses it
  # — it reads as "nothing to do" while being unmergeable.
  dirty=$(jq -r '[.[]|select(.mergeStateStatus=="DIRTY")|"#\(.number)"]|join(" ")' <<<"$prs" 2>/dev/null)

  # Why `.ok` and not just the count: a failed call still returns parseable JSON with no
  # work items in it, so counting alone renders an outage as a board with zero items open.
  board=$(orca plane list --project "$PROJECT" --json 2>/dev/null |
    jq -r 'if .ok then ([..|objects|select(.identifier?)]|length|tostring) else empty end' 2>/dev/null)

  # Deriva del board: tickets In Progress cuyo PR ya mergeó. El harness sólo mira el
  # board al abrir el PR, así que nadie los mueve — 8 de 11 el día que se midió (ORCA-471).
  # Una sola llamada a `gh` y una a `orca`: N consultas por tick chocan el rate limit.
  local drift merged inprog board_read
  merged=$(gh pr list -R "$REPO" --state merged --limit 60 --json title 2>/dev/null |
    grep -oiE 'ORCA-[0-9]+' | tr 'a-z' 'A-Z' | sort -u)
  # Why `.ok` aparte de la lista: un board sano sin nada en progreso devuelve la misma
  # lista vacía que una caída, y `?` sobre un board sano enseña a ignorar el contador.
  board_read=$(orca plane list --project "$PROJECT" --state "In Progress" --json 2>/dev/null)
  inprog=$(jq -r 'if .ok then ([..|objects|select(.identifier?)|.identifier]|join("\n")) else empty end' <<<"$board_read" 2>/dev/null)
  jq -e '.ok' <<<"$board_read" >/dev/null 2>&1 || board_read=''
  if [ -z "$board_read" ]; then
    drift="?"
  elif [ -z "$inprog" ]; then
    drift=""
  else
    drift=$(comm -12 <(sort -u <<<"$inprog") <(echo "$merged") | tr '\n' ' ' | sed 's/ $//')
  fi

  stale=${stale# } unshipped=${unshipped# }
  echo "SWEEP $(date '+%H:%M') | mergeable:${green:-none} | red:${red:-none} | pending:${pending:-none} | conflictivos:${dirty:-none} | leftover-worktrees:${stale:-none} | unshipped:${unshipped:-none} | board-drift:${drift:-none} | board-open:${board:-?}"
}

if [ "${1:-}" = "--once" ]; then
  # Why: coordination is the lead's; a sweep per member start multiplied its GitHub calls (ORCA-877).
  [ "${ORCA_GAME_ROLE:-}" = "member" ] && exit 0
  jq -n --arg line "$(sweep_line)" '{
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: ("Estado de coordinación al iniciar:\n" + $line +
        "\n\nArma el monitor de barrido con la herramienta Monitor: comando `bash .claude/hooks/coordinator-sweep.sh`, persistent, para que reporte cada 30 minutos. Al PR que verificaste, actívale `gh pr merge <n> --auto --squash`: GitHub lo integra cuando el check requerido `verify` esté verde. No le pidas el merge al dueño. Retoma lo rojo, abre el PR de lo unshipped y borra worktrees y ramas sobrantes.")
    }
  }'
  exit 0
fi

if [ "${1:-}" = "--tick" ]; then
  sweep_line
  exit 0
fi

# Why a child per tick instead of calling sweep_line directly: bash parses the script once
# at start, so a long-lived loop keeps running the version it was launched with. Editing
# this file then silently changed nothing until someone restarted the monitor — twice.
while true; do
  bash "${BASH_SOURCE[0]}" --tick
  sleep "$INTERVAL"
done
