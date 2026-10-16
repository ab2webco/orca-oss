import type { GameProjectItem, GameProjectList, GameStatusGroup } from '../types'

/** A To Do heading; done, cancelled and unknown tickets read as Other. */
export type TodoHeading = 'in_progress' | 'review' | 'todo' | 'backlog' | 'other'

/** `heading` is null for a list with no status groups, such as GitHub or GitLab issues. */
export type TodoSection = { heading: TodoHeading | null; count?: number; items: GameProjectItem[] }

const HEADING_OF: Readonly<Record<GameStatusGroup, TodoHeading>> = {
  in_progress: 'in_progress',
  review: 'review',
  todo: 'todo',
  backlog: 'backlog',
  unknown: 'other',
  done: 'other',
  cancelled: 'other'
}

const GROUPS = Object.keys(HEADING_OF) as GameStatusGroup[]

const countOf = (list: GameProjectList, heading: TodoHeading): { count?: number } => {
  const counts = GROUPS.filter((group) => HEADING_OF[group] === heading).flatMap((group) => {
    const count = list.groups?.[group]
    return count === undefined ? [] : [count]
  })
  return counts.length === 0 ? {} : { count: counts.reduce((sum, one) => sum + one, 0) }
}

/** The To Do's items under one heading per status, in the order Orca sorted them. */
export const todoSectionsOf = (list: GameProjectList): TodoSection[] => {
  if (list.items.every((one) => one.group === undefined)) {
    return list.items.length === 0 ? [] : [{ heading: null, items: list.items }]
  }
  const sections: TodoSection[] = []
  for (const item of list.items) {
    const heading = HEADING_OF[item.group ?? 'unknown']
    const last = sections.at(-1)
    if (last?.heading === heading) {
      last.items.push(item)
    } else {
      sections.push({ heading, ...countOf(list, heading), items: [item] })
    }
  }
  return sections
}
