import type { EngineInterface } from 'claude-code'

import { askStepOf } from './live-line'
import { isQuestionToPerson } from './message-heading'
import { gameConfig, quest } from './quest-state'

// What the live line reads: the main loop's turn and whether it waits on the person.

const LIVE = { plugin: 'orca-game', key: 'live' } as const
// Why every other scene tick: the glyph turns about four times a second, near Claude Code's spinner.
export const LIVE_EVERY_TICKS = 2

let beats = 0

/** Redraws the live line: the AbovePrompt hook reads this atom, so nothing else redraws. */
export async function bumpLive($: EngineInterface): Promise<void> {
  beats += 1
  await $.state.set(LIVE, beats).catch(() => undefined)
}

/** Subscribes a drawing to the live line's beat. */
export async function readLiveBeat($: EngineInterface): Promise<void> {
  await $.state.get(LIVE).catch(() => undefined)
}

export const isLiveTicking = (): boolean =>
  gameConfig().mode !== 'off' &&
  quest.turn !== undefined &&
  (quest.turn.endedAt === undefined || quest.turn.ask !== undefined)

export function liveTurnStart(now: number): void {
  quest.turn = { startedAt: now }
}

// Why an interrupt clears it: Orca must not call a turn the person stopped done.
export function liveTurnEnd(end: { answer: string; isAborted: boolean }, now: number): void {
  if (quest.turn === undefined) {
    return
  }
  if (end.isAborted) {
    quest.turn = undefined
    return
  }
  const isAsking = isQuestionToPerson(end.answer)
  quest.turn = {
    startedAt: quest.turn.startedAt,
    endedAt: now,
    ...(isAsking ? { ask: { at: now, text: askStepOf(end.answer) } } : {})
  }
}

const questionOf = (input: unknown): string => {
  const questions: unknown = Reflect.get(Object(input), 'questions')
  const first: unknown = Array.isArray(questions) ? questions[0] : undefined
  const text: unknown = Reflect.get(Object(first), 'question')
  return typeof text === 'string' ? text : ''
}

/** While AskUserQuestion is open the turn waits on the person; returns the undo for when it closes. */
export function liveAsk(input: unknown, now: number): () => void {
  const turn = quest.turn
  if (turn === undefined) {
    return () => undefined
  }
  quest.turn = { ...turn, ask: { at: now, text: questionOf(input) } }
  return () => {
    if (quest.turn?.ask !== undefined && quest.turn.startedAt === turn.startedAt) {
      quest.turn = { startedAt: turn.startedAt }
    }
  }
}
