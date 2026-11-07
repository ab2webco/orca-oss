import type { ScenePhase } from '../types'
import type { MessageHeadingWords } from './message-heading-words'

export type LiveState = 'working' | 'waiting' | 'done'

/** The main loop's latest turn as the live line reads it; `ask` while it waits on the person. */
export type LiveTurn = { startedAt: number; endedAt?: number; ask?: { at: number; text: string } }

export type LiveStatus = { state: LiveState; elapsedMs: number; step?: string }

export type LiveLine = { glyph: string; name: string; verb: string; time: string; step: string }

// Claude Code's own spinner frames, so the line turns as the spinner it stands in for.
const SPIN = ['·', '✢', '✳', '✶', '✻', '✽'] as const

const two = (value: number): string => String(value).padStart(2, '0')

/** `0:04`, `12:34`, `1:02:05`. */
export const liveTimerOf = (elapsedMs: number): string => {
  const total = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = total % 60
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`
}

// Why done keeps the turn's length: a timer still counting after the turn reads as still working.
export const liveStatusOf = (turn: LiveTurn, now: number): LiveStatus => {
  if (turn.ask !== undefined) {
    return { state: 'waiting', elapsedMs: now - turn.ask.at, step: turn.ask.text }
  }
  if (turn.endedAt !== undefined) {
    return { state: 'done', elapsedMs: turn.endedAt - turn.startedAt }
  }
  return { state: 'working', elapsedMs: now - turn.startedAt }
}

/** What a turn that ended in a question waits on: the last sentence of its last line. */
export const askStepOf = (answer: string): string => {
  const last = answer.trimEnd().split('\n').at(-1)?.trim() ?? ''
  return last.split(/(?<=[.!?…])\s+/u).at(-1) ?? last
}

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

export const liveLineOf = (
  live: {
    state: LiveState
    name: string
    phase: ScenePhase
    elapsedMs: number
    step: string
    frame: number
  },
  words: MessageHeadingWords
): LiveLine => {
  const verb =
    live.state === 'working'
      ? capitalized(words.phases[live.phase])
      : live.state === 'waiting'
        ? words.waiting
        : words.done
  const glyph =
    live.state === 'working' ? SPIN[live.frame % SPIN.length] : live.state === 'waiting' ? '◆' : '✓'
  return {
    glyph: glyph ?? '·',
    name: live.name,
    verb,
    time: liveTimerOf(live.elapsedMs),
    step: live.state === 'done' ? '' : (live.step.split('\n')[0]?.trim() ?? '')
  }
}
