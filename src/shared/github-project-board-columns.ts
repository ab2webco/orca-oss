import { groupRowsByField, sortRows } from './github-project-group-sort'
import type {
  GitHubProjectField,
  GitHubProjectRow,
  GitHubProjectTable
} from './github-project-types'

export type GitHubProjectBoardColumn = {
  key: string
  label: string
  rows: GitHubProjectRow[]
}

export function resolveGitHubProjectBoardGroupField(
  table: GitHubProjectTable
): GitHubProjectField | null {
  const verticalField = table.selectedView.verticalGroupByFields?.[0]
  if (verticalField) {
    return verticalField
  }
  return (
    table.selectedView.fields.find((field) => field.name.toLowerCase() === 'status') ??
    table.selectedView.fields.find((field) => field.kind === 'single-select') ??
    null
  )
}

export function buildGitHubProjectBoardColumns(
  table: GitHubProjectTable
): GitHubProjectBoardColumn[] {
  const rows = sortRows(table, table.rows)
  const field = resolveGitHubProjectBoardGroupField(table)
  if (!field) {
    return [{ key: 'all', label: table.selectedView.name, rows }]
  }

  const grouped = groupRowsByField(field, rows)
  if (field.kind !== 'single-select') {
    return grouped
  }

  const groupsByKey = new Map(grouped.map((group) => [group.key, group]))
  const optionColumns = field.options.map((option) => ({
    key: option.id,
    label: option.name,
    rows: groupsByKey.get(option.id)?.rows ?? []
  }))
  const optionIds = new Set(field.options.map((option) => option.id))
  const orphanedColumns = grouped.filter(
    (group) => group.key !== '__empty__' && !optionIds.has(group.key)
  )
  const emptyColumn = groupsByKey.get('__empty__')

  return [...optionColumns, ...orphanedColumns, ...(emptyColumn ? [emptyColumn] : [])]
}
