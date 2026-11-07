import { describe, expect, it } from 'vitest'

import { MESSAGE_HEADING_WORDS } from '../hooks/message-heading-words'
import { askStepOf, liveLineOf, liveStatusOf, liveTimerOf } from '../hooks/live-line'

const EN = MESSAGE_HEADING_WORDS.en
const ES = MESSAGE_HEADING_WORDS.es

describe('live line timer', () => {
  it('counts minutes and seconds, then hours', () => {
    expect(liveTimerOf(4_000)).toBe('0:04')
    expect(liveTimerOf(754_000)).toBe('12:34')
    expect(liveTimerOf(3_725_000)).toBe('1:02:05')
    expect(liveTimerOf(-5)).toBe('0:00')
  })
})

describe('live line', () => {
  const working = {
    state: 'working',
    name: 'Castillo',
    phase: 'verify',
    elapsedMs: 4_000,
    step: 'gh pr view 923',
    frame: 0
  } as const

  it('while working: a turning glyph, the name, the phase, the timer and the step', () => {
    expect(liveLineOf(working, ES)).toEqual({
      glyph: '·',
      name: 'Castillo',
      verb: 'Revisando',
      time: '0:04',
      step: 'gh pr view 923'
    })
    expect(liveLineOf({ ...working, frame: 4 }, EN).glyph).toBe('✻')
    expect(liveLineOf(working, EN).verb).toBe('Reviewing')
  })

  it('while waiting it says so, with the question as its step', () => {
    const line = liveLineOf({ ...working, state: 'waiting', step: 'Merge #923?' }, ES)
    expect(line).toMatchObject({ glyph: '◆', verb: 'Esperándote', step: 'Merge #923?' })
    expect(liveLineOf({ ...working, state: 'waiting' }, EN).verb).toBe('Waiting on you')
  })

  it('done shows a check and no step', () => {
    expect(liveLineOf({ ...working, state: 'done' }, ES)).toMatchObject({
      glyph: '✓',
      verb: 'Listo',
      step: ''
    })
    expect(liveLineOf({ ...working, state: 'done' }, EN).verb).toBe('Done')
  })

  it('keeps the step to its first line', () => {
    expect(liveLineOf({ ...working, step: 'npm test\n  --run' }, EN).step).toBe('npm test')
  })
})

describe('live status of a turn', () => {
  it('works from the turn start until it ends', () => {
    expect(liveStatusOf({ startedAt: 1_000 }, 5_000)).toEqual({
      state: 'working',
      elapsedMs: 4_000
    })
  })

  it('waits from the moment it asked, with the question as its step', () => {
    const turn = { startedAt: 1_000, ask: { at: 3_000, text: 'Merge #923?' } }
    expect(liveStatusOf(turn, 10_000)).toEqual({
      state: 'waiting',
      elapsedMs: 7_000,
      step: 'Merge #923?'
    })
  })

  it('done keeps the turn length, however long ago it ended', () => {
    expect(liveStatusOf({ startedAt: 1_000, endedAt: 9_000 }, 99_000)).toEqual({
      state: 'done',
      elapsedMs: 8_000
    })
  })
})

describe('the step a question waits on', () => {
  it('is the last sentence of the last line, so a long paragraph still shows the question', () => {
    const answer =
      'Done.\n\nNothing else has changed: no members are running and nothing waits. Which ticket should I start?'
    expect(askStepOf(answer)).toBe('Which ticket should I start?')
    expect(askStepOf('¿Abro el PR?  \n')).toBe('¿Abro el PR?')
  })
})
