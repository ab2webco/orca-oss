// Shared cursor-pagination loop for Plane's list endpoints (work items,
// projects, states, labels all share the same next_cursor/next_page_results
// envelope), so work-items.ts and plane-work-item-reads.ts both reuse it
// instead of duplicating the walk-until-exhausted logic.
import type { IntegrationPaginationBudget } from '../integration-pagination-budget'

export type PlanePage<T> = {
  results: T[]
  next_cursor: string
  next_page_results: boolean
}

export async function fetchAllPlanePages<T>(
  fetchPage: (cursor: string | undefined) => Promise<PlanePage<T>>,
  budget: IntegrationPaginationBudget,
  maxPages: number
): Promise<T[]> {
  const items: T[] = []
  let cursor: string | undefined
  for (let guard = 0; guard < maxPages; guard += 1) {
    const page = await fetchPage(cursor)
    const pageResults = page.results ?? []
    if (!budget.admitPage(pageResults)) {
      console.warn('[plane] Paginated result exceeded its retained result budget; truncating.')
      break
    }
    items.push(...pageResults)
    if (!page.next_page_results) {
      break
    }
    if (!budget.canRequestPage) {
      console.warn('[plane] Paginated result reached its retained result budget; truncating.')
      break
    }
    cursor = page.next_cursor
  }
  return items
}
