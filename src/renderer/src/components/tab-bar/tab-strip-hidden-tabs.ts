import type { TabBarItem } from './tab-bar-item-model'

// Why: under 120 px the strip fits one tab and scrolls the active one into view, so the rest are hidden.
export function tabsBesideActive<T extends { id: string }>(
  items: readonly T[],
  activeId: string | null,
  labelOf: (item: T) => string
): { item: T; label: string }[] {
  return items
    .filter((item) => item.id !== activeId)
    .map((item) => ({ item, label: labelOf(item) }))
}

export function activateTabBarItem(
  item: Pick<TabBarItem, 'type' | 'id'>,
  handlers: {
    onActivate: (tabId: string) => void
    onActivateFile?: (fileId: string) => void
    onActivateBrowserTab?: (tabId: string) => void
  }
): void {
  if (item.type === 'terminal') {
    handlers.onActivate(item.id)
  } else if (item.type === 'browser') {
    handlers.onActivateBrowserTab?.(item.id)
  } else {
    handlers.onActivateFile?.(item.id)
  }
}
