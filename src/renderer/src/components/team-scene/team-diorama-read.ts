import {
  dioramaPlotViewOf,
  type DioramaPlotView
} from '../../../../shared/team-scene/team-diorama-actions'
import {
  dioramaAttendCueOf,
  dioramaCuesLive,
  dioramaCuesOf,
  dioramaIslandCuesOf,
  type DioramaCue
} from '../../../../shared/team-scene/team-diorama-cues'
import type { DioramaLayout } from '../../../../shared/team-scene/team-diorama-layout'
import { teamSceneEventsBetween } from '../../../../shared/team-scene/team-scene-events'
import type { TeamSceneInput } from '../../../../shared/team-scene/team-scene-types'

// Why shared: the panel and the phone's WebView read the team the same way, read after read.

/** Each member's plot, the free ones spread over fishing, farming and chopping by their order. */
export function dioramaViewsOf(input: TeamSceneInput): Map<string, DioramaPlotView> {
  const out = new Map<string, DioramaPlotView>()
  let idle = 0
  for (const m of input.members) {
    const view = dioramaPlotViewOf(m, idle)
    if (view.action === 'idle') {
      idle += 1
    }
    out.set(m.key, view)
  }
  return out
}

/** What one diorama remembers between reads to tell what just happened. */
export type DioramaMoments = {
  seen: TeamSceneInput | null
  islands: string[] | null
  cues: DioramaCue[]
}

export const dioramaMoments = (): DioramaMoments => ({ seen: null, islands: null, cues: [] })

/**
 * The cues to play after a read at `now`: the team's moments since the last read, then a new
 * machine's rise, so its members step out once its island stands. Under reduced motion, none.
 */
export function dioramaCuesAfter(
  moments: DioramaMoments,
  input: TeamSceneInput,
  layout: DioramaLayout,
  now: number,
  reduced: boolean
): DioramaCue[] {
  const events = teamSceneEventsBetween(moments.seen, input)
  const added = [
    ...dioramaCuesOf(events, now),
    ...dioramaIslandCuesOf(moments.islands, layout.islands, now)
  ]
  moments.seen = input
  moments.islands = layout.islands.map((island) => island.key)
  const live = dioramaCuesLive(moments.cues, added, now)
  // Why kept like a moment: the lead's walk to an asker started at the read that saw it ask.
  const attend = dioramaAttendCueOf(
    live.find((c) => c.kind === 'attend'),
    input,
    layout,
    now
  )
  const others = live.filter((c) => c.kind !== 'attend')
  moments.cues = reduced ? [] : attend ? [...others, attend] : others
  return moments.cues
}
