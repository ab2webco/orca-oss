// Drives the overlay from the mod's own /quest demo script, so the POC adds no new fake data.
import {
  DEMO_FRAMES,
  demoFrameOf
} from '../../../../../resources/claude-plugins/orca-game/hooks/demo'
import type { GameState } from '../../../../../resources/claude-plugins/orca-game/types'
import { daylightOf, type BandMember, type BandModel } from './band-scene'
import { applyLifeEvent, livesOf, type LifeEvent, type LivesBook } from './lives-rules'

export const DEMO_STEP_MS = 6000

const isMerged = (state: GameState): boolean => state.review?.state === 'merged'

export const lifeEventsOfStep = (cycle: number, step: number): LifeEvent[] => {
  if (step === 0) {
    return []
  }
  const before = demoFrameOf(step - 1).state
  const now = demoFrameOf(step).state
  const kinds: LifeEvent['kind'][] = []
  if (before.review?.ci !== now.review?.ci) {
    if (now.review?.ci === 'failure') {
      kinds.push('ci-red')
    } else if (now.review?.ci === 'success') {
      kinds.push('ci-green')
    }
  }
  if (!isMerged(before) && isMerged(now)) {
    kinds.push('merged')
  } else if (isMerged(before) && !isMerged(now)) {
    kinds.push('reverted')
  }
  const working = now.agents.filter((agent) => !agent.isLeader && agent.state === 'working')
  return kinds.flatMap((kind) =>
    working.map((agent) => ({
      id: `${cycle}:${step}:${kind}:${agent.paneKey}`,
      member: agent.paneKey,
      kind
    }))
  )
}

export const bandModelAt = (timeMs: number, now: Date = new Date()): BandModel => {
  const absoluteStep = Math.floor(timeMs / DEMO_STEP_MS)
  const cycle = Math.floor(absoluteStep / DEMO_FRAMES)
  const step = absoluteStep % DEMO_FRAMES
  let book: LivesBook = {}
  const deltas = new Map<string, number>()
  for (let at = 0; at <= step; at += 1) {
    for (const event of lifeEventsOfStep(cycle, at)) {
      const change = applyLifeEvent(book, event)
      book = change.book
      if (at === step && change.delta !== 0) {
        deltas.set(event.member, (deltas.get(event.member) ?? 0) + change.delta)
      }
    }
  }
  const frame = demoFrameOf(step)
  const { state } = frame
  const tickets = [
    state.workItem?.identifier ?? '',
    ...(state.project?.todo?.items.map((item) => item.id) ?? [])
  ]
  const reviews = state.project?.reviews?.items.map((item) => item.id) ?? []
  const ageMs = timeMs - absoluteStep * DEMO_STEP_MS
  const members: BandMember[] = state.agents.map((agent, index) => {
    const { lives, benched } = livesOf(book, agent.paneKey)
    const delta = deltas.get(agent.paneKey)
    return {
      key: agent.paneKey,
      name: agent.displayName,
      isLead: agent.isLeader,
      state: agent.state,
      lives,
      benched,
      lifeChange: delta === undefined ? null : { delta, ageMs },
      ticket: tickets[index % tickets.length] ?? '',
      review: reviews[index % Math.max(1, reviews.length)] ?? `#${state.review?.number ?? 0}`,
      hurt: state.review?.ci === 'failure' && agent.state === 'working'
    }
  })
  return {
    members,
    ci: state.review?.ci ?? 'none',
    merged: isMerged(state),
    caption: frame.caption,
    daylight: daylightOf(now)
  }
}
