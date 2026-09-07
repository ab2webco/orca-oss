import type { PlaneMobileWorkItem } from './plane-mobile-work-item-read'
import { PLANE_PRIORITY_LABELS } from './plane-priority-label'
import type { PlaneTaskDisplayProperty } from './provider-task-display-properties'
import { formatUpdatedAt } from './task-updated-at-time'

/** The facts a Plane row or card says after its title, in the order the sheet lists them.
 *  The identifier is always there: it is the row's name, not a property. */
export function planeWorkItemDisplayFacts(
  item: PlaneMobileWorkItem,
  display: ReadonlySet<PlaneTaskDisplayProperty>
): string[] {
  const facts: string[] = [item.identifier || item.project.identifier]
  if (display.has('project')) {
    facts.push(item.project.name || item.project.identifier)
  }
  if (display.has('priority') && item.priority !== 'none') {
    facts.push(PLANE_PRIORITY_LABELS[item.priority])
  }
  if (display.has('assignee')) {
    facts.push(...item.assignees.map((assignee) => assignee.displayName))
  }
  if (display.has('updated')) {
    facts.push(formatUpdatedAt(item.updatedAt))
  }
  return facts.filter(Boolean)
}
