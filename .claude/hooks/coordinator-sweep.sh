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

  local prs green red pending stale board
  prs=$(gh pr list -R "$REPO" --state open --json number,mergeStateStatus,statusCheckRollup 2>/dev/null) || prs='[]'
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

  stale=""
  while read -r path branch; do
    [ -z "$branch" ] || [ "$branch" = "main" ] && continue
    grep -qxF "$path" <<<"$live" && continue
    [ -n "$(gh pr list -R "$REPO" --head "$branch" --state open --json number --jq '.[].number' 2>/dev/null)" ] && continue
    [ "$(git rev-list --count "origin/main..$branch" 2>/dev/null || echo 0)" -gt 0 ] && continue
    stale="$stale ${branch##*/}"
  done < <(git worktree list --porcelain 2>/dev/null |
    awk '/^worktree /{p=$2} /^branch /{sub("refs/heads/","",$2); print p, $2}')

  board=$(orca plane list --project "$PROJECT" --json 2>/dev/null | jq -r '[..|objects|select(.identifier?)]|length' 2>/dev/null)

  echo "SWEEP $(date '+%H:%M') | mergeable:${green:-none} | red:${red:-none} | pending:${pending:-none} | leftover-worktrees:${stale:-none} | board-open:${board:-?}"
}

if [ "${1:-}" = "--once" ]; then
  jq -n --arg line "$(sweep_line)" '{
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: ("Estado de coordinación al iniciar:\n" + $line +
        "\n\nArmá el monitor de barrido con la herramienta Monitor: comando `bash .claude/hooks/coordinator-sweep.sh`, persistent, para que reporte cada 30 minutos. Mergeá lo que esté verde después de verificarlo, retomá lo rojo, y borrá worktrees y ramas sobrantes.")
    }
  }'
  exit 0
fi

while true; do
  sweep_line
  sleep "$INTERVAL"
done
