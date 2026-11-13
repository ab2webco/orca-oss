import {
  GAME_TODO_ITEMS_MAX,
  gameProjectListOf,
  type GameProjectItem,
  type GameProjectList,
  type OrchestratorGameTodoSource
} from '../../shared/orchestrator-game-project-work'
import type { GameStatusGroup, GameWorkItem } from '../../shared/orchestrator-game-state'

export type TodoSource = Exclude<OrchestratorGameTodoSource, 'off'>

const keyPrefixOf = (identifier: string): string | undefined =>
  /^([A-Za-z][A-Za-z0-9_]*)-\d+$/.exec(identifier)?.[1]

/**
 * Every tracker the To Do reads (ORCA-1168): orca.yaml's first, then the linked Plane project, the
 * worktree's own ticket tracker and the repo's host. Only trackers linked to this project, never
 * every account Orca is connected to. One source per tracker; orca.yaml's wins.
 */
export function todoSourcesOf(args: {
  configured: TodoSource | null
  planeProject: string | null
  workItem: Pick<GameWorkItem, 'provider' | 'identifier'> | null
  host: 'github' | 'gitlab' | null
}): TodoSource[] {
  const item = args.workItem
  const trackerOf = (provider: 'jira' | 'linear'): TodoSource | null => {
    if (item?.provider !== provider) {
      return null
    }
    const project = keyPrefixOf(item.identifier)
    return project ? { provider, project } : { provider }
  }
  // Why no Plane without a project: that read fans out over every project, past Plane's limiter.
  const plane: TodoSource | null = args.planeProject
    ? { provider: 'plane', project: args.planeProject }
    : item?.provider === 'plane'
      ? { provider: 'plane' }
      : null
  const auto = [plane, trackerOf('jira'), trackerOf('linear'), args.host && { provider: args.host }]
  return [args.configured, ...auto].filter(
    (one, at, all): one is TodoSource =>
      !!one && all.findIndex((other) => other?.provider === one.provider) === at
  )
}

/** One item at a time to each list that has one left, so a long list cannot crowd out a short one. */
function sharesOf(lengths: readonly number[], max: number): number[] {
  const shares = lengths.map(() => 0)
  for (let left = max, moved = true; left > 0 && moved; ) {
    moved = false
    for (let at = 0; at < lengths.length && left > 0; at++) {
      if (shares[at] < lengths[at]) {
        shares[at]++
        left--
        moved = true
      }
    }
  }
  return shares
}

/** The trackers' lists as one, under the first one's link; null only when every read failed. */
export function mergeTodoLists(lists: readonly (GameProjectList | null)[]): GameProjectList | null {
  const read = lists.filter((one): one is GameProjectList => one !== null)
  const lead = read.find((one) => one.items.length > 0) ?? read[0]
  if (!lead) {
    return null
  }
  const shares = sharesOf(
    read.map((one) => one.items.length),
    GAME_TODO_ITEMS_MAX
  )
  const seen = new Set<string>()
  const items: GameProjectItem[] = read
    .flatMap((one, at) => gameProjectListOf(one.provider, one.items, null, 0, shares[at]).items)
    .filter((one) => !seen.has(one.id.toUpperCase()) && !!seen.add(one.id.toUpperCase()))
  const groups: Partial<Record<GameStatusGroup, number>> = {}
  for (const [group, count] of read.flatMap((one) => Object.entries(one.groups ?? {}))) {
    groups[group as GameStatusGroup] = (groups[group as GameStatusGroup] ?? 0) + (count ?? 0)
  }
  const total = read.reduce((sum, one) => sum + one.total, 0)
  const merged = gameProjectListOf(lead.provider, items, lead.url, total, GAME_TODO_ITEMS_MAX)
  const { groups: _visible, ...rest } = merged
  return Object.keys(groups).length > 0 ? { ...rest, groups } : rest
}
