import type { GameState } from '../types'
import { fitCells } from './cell-width'
import { activityLinksOf, activityTextOf, linkOfKind } from './fleet-labels'
import { httpUrlOf } from './http-url'
import { reviewLabelOf } from './rewards'

/** A link the fleet pane opens on a hotkey. */
export type PaneLink = { key: string; hotkey: string; label: string; url: string }

const MAX_LABEL_CELLS = 32

type Candidate = { key: string; hotkey: string; label: string | undefined; url: unknown }

/** The work item, review, CI, first project link and own activity; a host with no links still has the first two. */
export const paneLinksOf = (state: GameState): PaneLink[] => {
  const linked = (kind: Parameters<typeof linkOfKind>[1]) => linkOfKind(state.links, kind)
  const own = state.activity
  const activity = own === null ? activityLinksOf(state)[0] : undefined
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
    }
  ]
  return candidates.flatMap(({ key, hotkey, label, url }) => {
    const href = httpUrlOf(url)
    return label === undefined || href === undefined
      ? []
      : [{ key, hotkey, label: fitCells(label, MAX_LABEL_CELLS), url: href }]
  })
}
