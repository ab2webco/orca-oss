import type { DioramaIsland, DioramaLayout } from './team-diorama-layout'
import type { TeamSceneEvent, TeamSceneInput, TeamSceneVerdictTone } from './team-scene-types'

// Why cues outlive a read: the diorama is rebuilt on every read of the team, so a moment that
// just happened is kept by its start time and replayed by the next build until it ends (ORCA-1296).

/**
 * What the diorama plays for a moment of the team:
 * `arrive` a dust puff at the keep's gate and a walk to the plot; `confetti` over a merged build;
 * `flash` a ring of light at a member; `bird` the advisor's messenger bird flying from its tower;
 * `talk` the advisor lowering its spyglass to speak; `rise` a newly connected machine's island
 * coming up out of the sea and building its dock; `attend` the lead setting out to the member who
 * asks (`key`, empty for home) from where it stood (`from`), held until the next one.
 */
export type DioramaCue = {
  kind: 'arrive' | 'confetti' | 'flash' | 'bird' | 'talk' | 'rise' | 'attend'
  /** The member's pane key, `lead`, `advisor`, or an island's machine key for `rise`. */
  key: string
  tone: TeamSceneVerdictTone
  start: number
  until: number
  /** `attend` only: the member the lead walks from, empty for the gate. */
  from?: string
}

const LENGTH: Record<DioramaCue['kind'], number> = {
  arrive: 9,
  confetti: 4.5,
  flash: 2.4,
  bird: 3.2,
  talk: 4,
  rise: 4.5,
  attend: Infinity
}

const cue = (
  kind: DioramaCue['kind'],
  key: string,
  tone: TeamSceneVerdictTone,
  now: number
): DioramaCue => ({ kind, key, tone, start: now, until: now + LENGTH[kind] })

/** The cues the moments between two reads start at `now` (seconds). */
export function dioramaCuesOf(events: readonly TeamSceneEvent[], now: number): DioramaCue[] {
  const out: DioramaCue[] = []
  for (const e of events) {
    if (e.kind === 'join') {
      out.push(cue('arrive', e.key, 'note', now))
    } else if (e.kind === 'merge') {
      out.push(cue('confetti', e.key, 'allow', now))
    } else if (e.kind === 'ciGreen' || e.kind === 'finish') {
      out.push(cue('flash', e.key, 'allow', now))
    } else if (e.kind === 'handoff') {
      out.push(cue('flash', e.key, 'note', now))
    } else if (e.kind === 'stewarded') {
      out.push(cue('flash', e.key, e.move.lift === 'raise' ? 'ask' : 'note', now))
    } else if (e.kind === 'judged') {
      out.push(cue('talk', 'advisor', e.tone, now), cue('bird', e.key, e.tone, now + 0.8))
    } else if (e.kind === 'advisorSpoke') {
      out.push(cue('talk', 'advisor', 'note', now))
    }
  }
  return out
}

const RISEN = 2.8

/**
 * A machine connected since the last read: its island rises, and its members step out once it
 * stands. The first read has nothing to compare, so opening the panel raises nothing.
 */
export function dioramaIslandCuesOf(
  before: readonly string[] | null,
  islands: readonly DioramaIsland[],
  now: number
): DioramaCue[] {
  if (!before) {
    return []
  }
  const known = new Set(before)
  const out: DioramaCue[] = []
  for (const island of islands) {
    if (island.home || known.has(island.key)) {
      continue
    }
    out.push(cue('rise', island.key, 'note', now))
    for (const plot of island.plots) {
      if (plot.key) {
        out.push(cue('arrive', plot.key, 'note', now + RISEN))
      }
    }
  }
  return out
}

/** Keeps the cues still playing at `now`, plus the new ones, one per kind and key. */
export function dioramaCuesLive(
  kept: readonly DioramaCue[],
  added: readonly DioramaCue[],
  now: number
): DioramaCue[] {
  const byId = new Map<string, DioramaCue>()
  for (const c of [...kept, ...added]) {
    if (c.until > now) {
      byId.set(`${c.kind}|${c.key}`, c)
    }
  }
  return [...byId.values()]
}

/** How far along `c` is at `t`: 0 to 1 while it plays, outside that range otherwise. */
export const dioramaCuePhase = (c: DioramaCue, t: number): number =>
  (t - c.start) / (c.until - c.start)

/** The member the lead stands by: the first who asks on a reachable island, unless it cannot work. */
export function dioramaAskerOf(input: TeamSceneInput, layout: DioramaLayout): string | null {
  if (input.lead.activity === 'blocked') {
    return null
  }
  const reachable = new Set(
    layout.islands.flatMap((i) => (i.reachable ? i.plots.flatMap((p) => p.key ?? []) : []))
  )
  return input.members.find((m) => m.activity === 'needsYou' && reachable.has(m.key))?.key ?? null
}

/**
 * The lead's trip after a read at `now`: kept while its asker still asks, else a new one from that
 * asker to the next, or home. None before anyone has asked, so the lead stays at the castle.
 */
export function dioramaAttendCueOf(
  prev: DioramaCue | undefined,
  input: TeamSceneInput,
  layout: DioramaLayout,
  now: number
): DioramaCue | null {
  const to = dioramaAskerOf(input, layout) ?? ''
  if (prev ? prev.key === to : to === '') {
    return prev ?? null
  }
  return { ...cue('attend', to, 'ask', now), from: prev?.key ?? '' }
}
