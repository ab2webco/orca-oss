import type { PlaneIntakeIssue, PlaneIntakeIssueStatus } from '../shared/plane-types'

const STATUS_LABELS: Record<PlaneIntakeIssueStatus, string> = {
  [-2]: 'pending',
  [-1]: 'rejected',
  0: 'snoozed',
  1: 'accepted',
  2: 'duplicate',
  unknown: 'unknown'
}

function intakeRow(item: PlaneIntakeIssue): string {
  return `${item.id.padEnd(38)} ${STATUS_LABELS[item.status].padEnd(10)} ${(item.priority ?? 'none').padEnd(8)} ${item.title}`
}

export function formatPlaneIntakeList(items: PlaneIntakeIssue[]): string {
  return items.length === 0 ? 'No Plane intake items found.' : items.map(intakeRow).join('\n')
}

export function formatPlaneIntakeCreated(item: PlaneIntakeIssue): string {
  return `Created intake item ${item.id}: ${item.title}`
}
