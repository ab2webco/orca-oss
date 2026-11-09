// Counts the sorted worktrees that the sidebar filters left out. `filterable` drops ids no filter
// decides on, such as archived worktrees, which stay hidden whatever the filters say.
export function countWorktreesHiddenByFilters(
  sortedIds: readonly string[],
  visibleIds: readonly string[],
  filterable: (id: string) => boolean = () => true
): number {
  const visible = new Set(visibleIds)
  let hidden = 0
  for (const id of sortedIds) {
    if (!visible.has(id) && filterable(id)) {
      hidden += 1
    }
  }
  return hidden
}
