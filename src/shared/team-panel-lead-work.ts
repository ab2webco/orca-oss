import type { GameAction } from './orchestrator-game-actions'
import type { GameProjectItem, GameProjectList } from './orchestrator-game-project-work'
import type { GameStatusGroup, OrchestratorGameState } from './orchestrator-game-state'

export type TeamLeadAction = { id: string; label: string; prompt: string }

export type TeamTodoHeading = 'in_progress' | 'review' | 'todo' | 'backlog' | 'other'

export type TeamTodoRow = { id: string; title: string; url: string; prompt: string | null }

export type TeamTodoGroup = {
  heading: TeamTodoHeading | null
  count: number | null
  rows: TeamTodoRow[]
}

/** `hidden` is what `total` holds beyond the rows drawn; `listAction` replaces opening `listUrl`. */
export type TeamTodoList = {
  groups: TeamTodoGroup[]
  total: number
  hidden: number
  listUrl: string | null
  listAction: TeamLeadAction | null
}

/** `todo` is null with the tracker off or from an older host. */
export type TeamLeadWork = { todo: TeamTodoList | null; actions: TeamLeadAction[] }

const HEADING_OF: Readonly<Record<GameStatusGroup, TeamTodoHeading>> = {
  in_progress: 'in_progress',
  review: 'review',
  todo: 'todo',
  backlog: 'backlog',
  unknown: 'other',
  done: 'other',
  cancelled: 'other'
}

const STATUS_GROUPS = Object.keys(HEADING_OF) as GameStatusGroup[]
const GROUP_ROWS_MAX = 3
const UNGROUPED_ROWS_MAX = 5

const rowOf = (item: GameProjectItem): TeamTodoRow => ({
  id: item.id,
  title: item.title,
  url: item.url,
  prompt: item.prompt ?? null
})

function countOf(list: GameProjectList, heading: TeamTodoHeading): number | null {
  const counts = STATUS_GROUPS.filter((group) => HEADING_OF[group] === heading).flatMap((group) => {
    const count = list.groups?.[group]
    return count === undefined ? [] : [count]
  })
  return counts.length === 0 ? null : counts.reduce((sum, one) => sum + one, 0)
}

function groupsOf(list: GameProjectList): TeamTodoGroup[] {
  if (list.items.length === 0) {
    return []
  }
  if (list.items.every((one) => one.group === undefined)) {
    return [
      { heading: null, count: null, rows: list.items.slice(0, UNGROUPED_ROWS_MAX).map(rowOf) }
    ]
  }
  const groups: TeamTodoGroup[] = []
  for (const item of list.items) {
    const heading = HEADING_OF[item.group ?? 'unknown']
    const last = groups.at(-1)
    if (last?.heading !== heading) {
      groups.push({ heading, count: countOf(list, heading), rows: [rowOf(item)] })
    } else if (last.rows.length < GROUP_ROWS_MAX) {
      last.rows.push(rowOf(item))
    }
  }
  return groups
}

// Why prompts only: an MCP action runs through the mod's `$.mcp`, which has no native path yet.
function promptActionOf(action: GameAction): TeamLeadAction | null {
  return 'prompt' in action ? { id: action.id, label: action.label, prompt: action.prompt } : null
}

/** The action a list says its link runs; null keeps the link, so the list is never out of reach. */
export function teamListActionOf(
  list: Pick<GameProjectList, 'actionId'>,
  actions: readonly GameAction[]
): TeamLeadAction | null {
  const named = actions.find((one) => one.id === list.actionId)
  return named ? promptActionOf(named) : null
}

function todoOf(list: GameProjectList, actions: readonly GameAction[]): TeamTodoList {
  const groups = groupsOf(list)
  const drawn = groups.reduce((sum, one) => sum + one.rows.length, 0)
  return {
    groups,
    total: list.total,
    hidden: Math.max(0, list.total - drawn),
    listUrl: list.url,
    listAction: teamListActionOf(list, actions)
  }
}

/** The lead's To Do and the buttons that send it a turn, for the Team tab. */
export function teamLeadWorkOf(state: OrchestratorGameState): TeamLeadWork {
  const actions = state.actions ?? []
  const list = state.project?.todo
  return {
    todo: list ? todoOf(list, actions) : null,
    actions: actions.flatMap((one) => promptActionOf(one) ?? [])
  }
}
