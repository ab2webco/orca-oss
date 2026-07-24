import type { PlaneWorkItem } from '../../../shared/plane-types'

// Client-side text filter for Plane work items. The self-hosted Plane REST API
// ignores PQL passed as a free-text query, so search narrows the already-loaded
// (preset-filtered) items here instead. Case-insensitive substring match on the
// identifier or title; an empty/whitespace query returns every item unchanged.
export function filterPlaneItemsBySearch(items: PlaneWorkItem[], query: string): PlaneWorkItem[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) {
    return items
  }
  return items.filter(
    (item) =>
      item.identifier.toLowerCase().includes(needle) || item.title.toLowerCase().includes(needle)
  )
}
