import type { SectionAppendContext } from './group-sections'
import { resolveSectionFold } from './section-fold'
import { getLatestActivityAt } from './project-activity'
import type { ProjectUrgencyInputs } from './project-activity'
import type { OrderedGroupEntry, WorktreeGroupEntry } from './project-grouping'
import { compareProjectTierEntries, enterProjectTier } from './project-tier-order'
import { classifyProjectUrgency } from './project-urgency-tier'
import type { GroupHeaderRow } from './row-types'

/** Everything a repo header's tier reads, fixed for one buildRows call. */
export type SectionUrgencyContext = ProjectUrgencyInputs & {
  /** projectOrderBy 'needs-you': sort active projects by tier; other orders only show the reason. */
  orderByTier: boolean
}

/** The tier, reason and frozen entry of an active repo section; undefined without tier inputs. */
export function resolveSectionUrgency(
  ctx: SectionAppendContext,
  key: string,
  group: WorktreeGroupEntry
): GroupHeaderRow['urgency'] {
  const urgency = ctx.urgency
  if (!urgency || ctx.groupBy !== 'repo' || !group.repo) {
    return undefined
  }
  const classified = classifyProjectUrgency(
    group.items.map((w) => w.id),
    urgency.signalByWorktreeId,
    (id) => urgency.ciFailingWorktreeIds.has(id)
  )
  const activityAt = getLatestActivityAt(group.items) ?? 0
  const entry = enterProjectTier(key, classified.tier, activityAt, urgency.tierMemory)
  return { ...classified, enteredAt: entry.enteredAt }
}

/** Active sections by tier, then by frozen entry; the incoming order breaks ties. */
export function orderActiveSectionsByTier(
  ctx: SectionAppendContext,
  active: readonly OrderedGroupEntry[]
): OrderedGroupEntry[] {
  return active
    .map((entry, index) => ({ entry, index, urgency: resolveSectionUrgency(ctx, ...entry) }))
    .sort(
      (a, b) =>
        (a.urgency && b.urgency ? compareProjectTierEntries(a.urgency, b.urgency) : 0) ||
        a.index - b.index
    )
    .map(({ entry }) => entry)
}

/** Inside a Project Group idle projects fold in place, so they follow its tiered active ones. */
export function orderGroupSectionsByTier(
  ctx: SectionAppendContext,
  entries: readonly OrderedGroupEntry[]
): OrderedGroupEntry[] {
  const active = entries.filter((entry) => !resolveSectionFold(ctx, ...entry))
  const idle = entries.filter((entry) => resolveSectionFold(ctx, ...entry))
  return [...orderActiveSectionsByTier(ctx, active), ...idle]
}
