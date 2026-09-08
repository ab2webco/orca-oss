import type { PlaneMobileMember } from '../tasks/plane-mobile-work-item-read'

export const UNNAMED_MEMBER = 'Unnamed member'

export type PlaneAssigneeOption = {
  member: PlaneMobileMember
  name: string
  assigned: boolean
}

export function memberDisplayName(member: PlaneMobileMember): string {
  return member.displayName || UNNAMED_MEMBER
}

/** First letter of the first two words; `?` when there is no name to draw from. */
export function memberInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return '?'
  }
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
}

export function toggledAssignees(
  assignees: readonly PlaneMobileMember[],
  member: PlaneMobileMember
): PlaneMobileMember[] {
  return assignees.some((assignee) => assignee.id === member.id)
    ? assignees.filter((assignee) => assignee.id !== member.id)
    : [...assignees, member]
}

/** Assigned members first (member order kept within each group), narrowed by the query. */
export function planeAssigneeOptions(
  members: readonly PlaneMobileMember[],
  assignees: readonly PlaneMobileMember[],
  query: string
): PlaneAssigneeOption[] {
  const assignedIds = new Set(assignees.map((assignee) => assignee.id))
  const needle = query.trim().toLowerCase()
  const options = members
    .map((member) => ({
      member,
      name: memberDisplayName(member),
      assigned: assignedIds.has(member.id)
    }))
    .filter((option) => needle === '' || option.name.toLowerCase().includes(needle))
  return [
    ...options.filter((option) => option.assigned),
    ...options.filter((option) => !option.assigned)
  ]
}
