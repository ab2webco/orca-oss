import type { Tab } from '../../../../shared/tab-types'

/** Where Esc goes from the Arcade tab: the nearest terminal before it in its group, Claude's usually. */
export function conversationTabOf(tabs: readonly Tab[], arcadeEntityId: string): Tab | null {
  const arcade = tabs.find((one) => one.entityId === arcadeEntityId)
  const terminals = tabs.filter((one) => one.contentType === 'terminal')
  if (!arcade) {
    return terminals[0] ?? null
  }
  const sameGroup = terminals
    .filter((one) => one.groupId === arcade.groupId)
    .toSorted((a, b) => a.sortOrder - b.sortOrder)
  const before = sameGroup.findLast((one) => one.sortOrder < arcade.sortOrder)
  return before ?? sameGroup[0] ?? terminals[0] ?? null
}
