import { translate } from '@/i18n/i18n'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import { IDLE_PROJECTS_GROUP_KEY, PROJECT_GROUP_META } from './group-keys'
import { appendOrderedGroups, resolveSectionFold } from './group-sections'
import type { SectionAppendContext } from './group-sections'
import { getHostWorktreeIds } from './host-labels'
import type { OrderedGroupEntry } from './project-grouping'
import type { GroupHeaderRow } from './row-types'

type IdleEntry = { entry: OrderedGroupEntry; latest: number }

function buildIdleProjectsHeader(
  ctx: SectionAppendContext,
  idle: readonly IdleEntry[],
  collapsed: boolean
): GroupHeaderRow {
  const projectCountByHost = new Map<ExecutionHostId, number>()
  const idsByHost = new Map<ExecutionHostId, string[]>()
  for (const { entry } of idle) {
    for (const [hostId, ids] of getHostWorktreeIds(
      entry[1].items,
      ctx.repoMap,
      ctx.defaultHostId
    ) ?? []) {
      projectCountByHost.set(hostId, (projectCountByHost.get(hostId) ?? 0) + 1)
      idsByHost.set(hostId, [...(idsByHost.get(hostId) ?? []), ...ids])
    }
  }
  // Why: expanded, the project rows below carry their own counts; collapsed, the header stands in for them.
  const hiddenIds = (ids: readonly string[]): readonly string[] => (collapsed ? ids : [])
  return {
    type: 'header',
    key: IDLE_PROJECTS_GROUP_KEY,
    label: translate('auto.components.sidebar.IdleProjectsGroup.label', 'Idle'),
    count: idle.length,
    tone: PROJECT_GROUP_META.tone,
    idleProjectsGroup: { collapsed },
    worktreeIds: hiddenIds(idle.flatMap(({ entry }) => entry[1].items.map((w) => w.id))),
    // Why project counts: host sections localize `count` from this map, and the header counts projects.
    hostWorktreeCounts: projectCountByHost,
    hostWorktreeIds: new Map([...idsByHost].map(([hostId, ids]) => [hostId, hiddenIds(ids)]))
  }
}

/** Active projects in their order, then one collapsible group of idle projects, newest first. */
export function appendRepoSectionsSplitByActivity(
  ctx: SectionAppendContext,
  entries: OrderedGroupEntry[],
  projectGroupDepth = 0
): void {
  const active: OrderedGroupEntry[] = []
  const idle: IdleEntry[] = []
  for (const entry of entries) {
    const fold = resolveSectionFold(ctx, entry[0], entry[1])
    if (fold) {
      idle.push({ entry, latest: fold.openWorktree.lastActivityAt })
    } else {
      active.push(entry)
    }
  }
  appendOrderedGroups(ctx, active, projectGroupDepth)
  if (idle.length === 0) {
    return
  }
  // Why every sort mode: the owner's order applies to active projects; idle ones stay by age.
  idle.sort((left, right) => right.latest - left.latest)
  const collapsed = ctx.collapsedGroups.has(IDLE_PROJECTS_GROUP_KEY)
  ctx.result.push(buildIdleProjectsHeader(ctx, idle, collapsed))
  if (!collapsed) {
    appendOrderedGroups(
      ctx,
      idle.map(({ entry }) => entry),
      projectGroupDepth
    )
  }
}
