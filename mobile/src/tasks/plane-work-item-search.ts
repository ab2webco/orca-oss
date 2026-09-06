import type { PlaneMobileWorkItem } from './plane-mobile-work-item-read'

// Why: the "Search Plane tasks…" field takes what a human types — a card number or
// part of a title — and plane.searchWorkItems is a PQL parser that rejects free text
// by design. The match runs here, over the rows plane.listWorkItems already returned
// (ORCA-416).

function collapse(value: string): string {
  return value.replace(/[\s_-]+/g, '')
}

/** Matches the card's identifier and its title, case-insensitively. "169" and
 *  "orca 169" both reach ORCA-169; separators in either side are ignored. */
export function matchesPlaneWorkItemQuery(item: PlaneMobileWorkItem, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return true
  }
  if (item.title.toLowerCase().includes(needle)) {
    return true
  }
  const identifier = item.identifier.toLowerCase()
  return identifier.length > 0 && collapse(identifier).includes(collapse(needle))
}

export function filterPlaneWorkItemsByQuery(
  items: readonly PlaneMobileWorkItem[],
  query: string
): PlaneMobileWorkItem[] {
  if (!query.trim()) {
    return [...items]
  }
  return items.filter((item) => matchesPlaneWorkItemQuery(item, query))
}
