#!/usr/bin/env bash
# Session start for the project lead: resume paused members, then list pending work.
# Never fails the session; members and PRs are only read, except resume-members.
set -u

cli="${ORCA_GAME_CLI:-}"
[ -n "$cli" ] || exit 0

if ! reason=$(bash "$(dirname "${BASH_SOURCE[0]}")/lead-session.sh"); then
  echo "$reason: no reanudo members."
  exit 0
fi

echo "== Lead: members"
planned=$("$cli" game resume-members --dry-run 2>/dev/null || true)
if [ -n "$planned" ] && ! grep -q "Would resume: none" <<<"$planned"; then
  echo "Reanudando members pausados:"
  "$cli" game resume-members 2>&1 || echo "resume-members fallo: revisa 'game fleet'"
fi
"$cli" game fleet 2>/dev/null | head -n 12

echo "== Pendientes: PRs abiertos"
prs=$(gh pr list --repo ab2webco/orca-oss --state all --limit 100 --json number,state,headRefName 2>/dev/null || echo "[]")
gh pr list --repo ab2webco/orca-oss --state open --json number,title,mergeStateStatus,autoMergeRequest \
  --jq '.[] | "#\(.number) \(.mergeStateStatus) auto=\(if .autoMergeRequest then "on" else "off" end) \(.title[0:90])"' 2>/dev/null || true

echo "== Pendientes: worktrees con trabajo sin integrar"
git worktree list --porcelain 2>/dev/null | awk '/^worktree /{p=$2} /^branch /{b=$2; sub("refs/heads/","",b); print p" "b}' |
while read -r path branch; do
  [ "$path" = "$(git rev-parse --show-toplevel 2>/dev/null)" ] && continue
  pr_state=$(jq -r --arg b "$branch" '[.[] | select(.headRefName==$b)][0].state // "none"' <<<"$prs")
  unpushed=$(git -C "$path" rev-list --count '@{u}..HEAD' 2>/dev/null || echo "?")
  dirty=$(git -C "$path" status --porcelain 2>/dev/null | grep -v -E '^ M \.(claude/|mcp\.json)' | wc -l | tr -d ' ')
  if [ "$pr_state" != "MERGED" ] || [ "$unpushed" != "0" ] || [ "$dirty" != "0" ]; then
    echo "$branch | PR=$pr_state | sin subir=$unpushed | cambios=$dirty | $path"
  fi
done

exit 0
