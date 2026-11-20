import type { TeamSceneEvent, TeamSceneVerdictTone } from './team-scene-types'

// Why cues outlive a read: the diorama is rebuilt on every read of the team, so a moment that
// just happened is kept by its start time and replayed by the next build until it ends (ORCA-1296).

/**
 * What the diorama plays for a moment of the team:
 * `arrive` a dust puff at the keep's gate and a walk to the plot; `confetti` over a merged build;
 * `flash` a ring of light at a member; `bird` the advisor's messenger bird flying from its tower;
 * `talk` the advisor lowering its spyglass to speak.
 */
export type DioramaCue = {
  kind: 'arrive' | 'confetti' | 'flash' | 'bird' | 'talk'
  /** The member's pane key, `lead`, or `advisor`. */
  key: string
  tone: TeamSceneVerdictTone
  start: number
  until: number
}

const LENGTH: Record<DioramaCue['kind'], number> = {
  arrive: 9,
  confetti: 4.5,
  flash: 2.4,
  bird: 3.2,
  talk: 4
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
