// Client-side PQL filtering for `orca plane search`. Plane's self-hosted REST
// API v1 ignores the ?pql= query param (see plane-work-item-filter.ts), so a
// server-side search silently returns every item. Rather than fail silently
// with plausible data, parse a small, well-defined query subset and filter the
// already-fetched items here — and throw loudly on anything unsupported.
import type { PlaneWorkItem } from '../../shared/plane-types'

const SUPPORTED_FIELDS = ['state', 'priority', 'assignee', 'label'] as const
type QueryField = (typeof SUPPORTED_FIELDS)[number]
type QueryOperator = '=' | '!='

export type ParsedQueryClause = {
  field: QueryField
  op: QueryOperator
  value: string
}

// Thrown for any query we cannot honor precisely. The CLI surfaces its message
// as an error so an agent never mistakes an unfiltered set for a filtered one.
export class PlaneUnsupportedQueryError extends Error {
  readonly code = 'plane_unsupported_query'
  constructor(message: string) {
    super(message)
    this.name = 'PlaneUnsupportedQueryError'
  }
}

const CLAUSE_RE = /^([A-Za-z_]+)\s*(!=|=)\s*(.+)$/
const SUPPORTED_LIST = SUPPORTED_FIELDS.join(', ')

function stripQuotes(raw: string): string {
  const value = raw.trim()
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
  return quoted ? value.slice(1, -1) : value
}

// Parses `field = "value" [AND field = "value"]...` into clauses, or throws
// PlaneUnsupportedQueryError for an unknown field, bad operator, or free text.
export function parsePlaneQuery(query: string): ParsedQueryClause[] {
  const trimmed = query.trim()
  if (!trimmed) {
    throw new PlaneUnsupportedQueryError('Empty search query.')
  }
  const clauses = trimmed.split(/\s+AND\s+/i).map((part) => {
    const match = CLAUSE_RE.exec(part.trim())
    if (!match) {
      throw new PlaneUnsupportedQueryError(
        `Could not parse query clause "${part.trim()}". Use: field = "value" [AND field = "value"] with fields ${SUPPORTED_LIST}.`
      )
    }
    const field = match[1].toLowerCase()
    if (!(SUPPORTED_FIELDS as readonly string[]).includes(field)) {
      throw new PlaneUnsupportedQueryError(
        `Unsupported query field "${field}". Supported fields: ${SUPPORTED_LIST}.`
      )
    }
    const value = stripQuotes(match[3])
    if (!value) {
      throw new PlaneUnsupportedQueryError(`Empty value for "${field}".`)
    }
    return { field: field as QueryField, op: match[2] as QueryOperator, value }
  })
  return clauses
}

// True when any clause needs the connected user resolved (`assignee = me`).
export function queryNeedsViewer(clauses: readonly ParsedQueryClause[]): boolean {
  return clauses.some(
    (clause) => clause.field === 'assignee' && clause.value.toLowerCase() === 'me'
  )
}

function clauseMatches(
  item: PlaneWorkItem,
  clause: ParsedQueryClause,
  viewerId: string | null
): boolean {
  const value = clause.value.toLowerCase()
  if (clause.field === 'state') {
    return item.state.name.toLowerCase() === value
  }
  if (clause.field === 'priority') {
    return (item.priority ?? 'none').toLowerCase() === value
  }
  if (clause.field === 'label') {
    return item.labels.some((label) => label.toLowerCase() === value)
  }
  // assignee
  const assignees = item.assignees ?? []
  if (value === 'me') {
    if (!viewerId) {
      throw new PlaneUnsupportedQueryError(
        'Cannot resolve the connected Plane user for "assignee = me".'
      )
    }
    return assignees.some((assignee) => assignee.id === viewerId)
  }
  return assignees.some(
    (assignee) =>
      assignee.id.toLowerCase() === value ||
      assignee.displayName.toLowerCase() === value ||
      (assignee.email ?? '').toLowerCase() === value
  )
}

// Applies the parsed clauses (AND) to already-fetched items. `!=` inverts the
// match. Throws if `assignee = me` is used but `viewerId` is null.
export function applyPlaneQuery(
  items: PlaneWorkItem[],
  clauses: readonly ParsedQueryClause[],
  viewerId: string | null
): PlaneWorkItem[] {
  return items.filter((item) =>
    clauses.every((clause) => {
      const matched = clauseMatches(item, clause, viewerId)
      return clause.op === '=' ? matched : !matched
    })
  )
}
