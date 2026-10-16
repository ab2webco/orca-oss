import type { GameAction, GameState } from '../types'
import { fitCells } from './cell-width'
import { reviewKindOf } from './band-chips'
import { activityLinksOf, activityTextOf, linkOfKind } from './fleet-labels'
import { gameStrings } from './game-strings'
import { httpUrlOf } from './http-url'
import { todoActionOf } from './lead-actions'
import { reviewLabelOf } from './rewards'

/** A link the fleet pane opens on a hotkey. */
export type PaneLink = {
  key: string
  hotkey: string
  label: string
  url: string
  /** Pressing it runs this action instead; `url` is then empty. */
  action?: GameAction
}

const MAX_LABEL_CELLS = 32

type Candidate = {
  key: string
  hotkey: string
  label: string | undefined
  url: unknown
  action?: GameAction
}

/** The work item, review, CI, first project link, own activity, then my PRs and To Do lists. */
export const paneLinksOf = (state: GameState): PaneLink[] => {
  const linked = (kind: Parameters<typeof linkOfKind>[1]) => linkOfKind(state.links, kind)
  const own = state.activity
  const activity = own === null ? activityLinksOf(state)[0] : undefined
  const reviews = state.project?.reviews ?? undefined
  const todo = state.project?.todo ?? undefined
  const candidates: Candidate[] = [
    {
      key: 'open-work-item',
      hotkey: 'i',
      label: linked('workItem')?.label ?? state.workItem?.identifier,
      url: linked('workItem')?.url ?? state.workItem?.url
    },
    {
      key: 'open-review',
      hotkey: 'o',
      label:
        linked('review')?.label ??
        (state.review === null ? undefined : reviewLabelOf(state.review)),
      url: linked('review')?.url ?? state.review?.url
    },
    { key: 'open-ci', hotkey: 'c', label: linked('ci')?.label, url: linked('ci')?.url },
    {
      key: 'open-project',
      hotkey: 'w',
      label: linked('project')?.label,
      url: linked('project')?.url
    },
    {
      key: 'open-activity',
      hotkey: 'a',
      label:
        own === null
          ? activity && activityTextOf(activity)
          : activityTextOf({ name: own.name, label: own.id, running: own.running }),
      url: own?.url ?? activity?.url
    },
    {
      key: 'open-reviews',
      hotkey: 'g',
      label: reviews && gameStrings().text.myReviews(reviewKindOf(reviews), reviews.total),
      url: reviews?.url
    },
    {
      key: 'open-todo',
      hotkey: 't',
      label: todo && gameStrings().text.todo(todo.total),
      url: todo?.url,
      action: todoActionOf(state)
    }
  ]
  return candidates.flatMap(({ key, hotkey, label, url, action }) => {
    if (label === undefined) {
      return []
    }
    const fitted = fitCells(label, MAX_LABEL_CELLS)
    if (action !== undefined) {
      return [{ key, hotkey, label: fitted, url: '', action }]
    }
    const href = httpUrlOf(url)
    return href === undefined ? [] : [{ key, hotkey, label: fitted, url: href }]
  })
}
