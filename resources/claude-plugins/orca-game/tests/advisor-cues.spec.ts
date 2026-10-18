import { describe, expect, it } from 'vitest'

import {
  advisorBubbleOf,
  advisorCuesOf,
  cueTicksOf,
  strongestCueOf,
  type AdvisorCue
} from '../hooks/advisor-cues'
import { advisorOf, type Advisor } from '../hooks/allies'

const agent = (id: string, why: string, model: string | null, verdict: string) => ({
  id,
  type: 'general-purpose',
  title: `Task ${id}`,
  branch: null,
  worktree: null,
  model,
  effort: model === null ? null : 'medium',
  status: 'running',
  why,
  verdict
})

const run = (id: string, status: string, text: string) => ({
  id,
  sha7: 'abc1234',
  branch: null,
  status,
  done: 1,
  total: 3,
  failed: [],
  running: [],
  text,
  startedAtMs: 1,
  finishedAtMs: null
})

const jev = (patch: Record<string, unknown> = {}): Advisor => {
  const advisor = advisorOf({
    version: 1,
    locale: 'es',
    line: 'jev · 1 agente',
    model: 'Opus 5.5',
    modelId: 'claude-opus-5-5',
    effort: 'high',
    subagents: [agent('a1', 'inherited', null, 'igual')],
    ci: [],
    notices: [],
    ...patch
  })
  if (advisor === null) {
    throw new Error('not a Jev value')
  }
  return advisor
}

const after = (patch: Record<string, unknown>) => {
  const first = advisorCuesOf(null, jev())
  return advisorCuesOf(first.seen, jev(patch))
}

const gestures = (cues: readonly AdvisorCue[]) => cues.map((one) => one.gesture)

describe('advisorCuesOf', () => {
  it('takes the first value it sees as where things stand, with no gesture', () => {
    const first = advisorCuesOf(null, jev())
    expect(first.cues).toEqual([])
    expect(first.decisions.map((one) => one.key)).toEqual(['a1|inherited|null|null'])
    expect(advisorCuesOf(first.seen, jev()).cues).toEqual([])
  })

  it('points down at a lowered model, with Jev’s own model and verdict as its words', () => {
    const next = after({
      subagents: [
        agent('a1', 'inherited', null, 'igual'),
        agent('a2', 'lowered', 'Sonnet 5', 'Sonnet basta')
      ]
    })
    expect(next.cues).toEqual([
      { gesture: 'lowered', text: 'Sonnet 5 · Sonnet basta', isRoutine: false }
    ])
    expect(next.decisions).toEqual([
      expect.objectContaining({
        title: 'Task a2',
        model: 'Sonnet 5',
        effort: 'medium',
        verdict: 'Sonnet basta',
        gesture: 'lowered'
      })
    ])
  })

  it.each([
    ['raised', 'raised', false],
    ['chosen', 'approved', true],
    ['same', 'approved', true],
    ['explicit', 'approved', false],
    ['inherited', 'approved', false],
    ['kept-unsure', 'unsure', false],
    ['measuring', 'unsure', false]
  ])('acts out %s as %s', (why, gesture, isRoutine) => {
    const next = after({ subagents: [agent('a9', why, 'Opus 5.5', 'v')] })
    expect(next.cues).toEqual([{ gesture, text: 'Opus 5.5 · v', isRoutine }])
  })

  it('logs a decision it has no gesture for, and acts nothing out', () => {
    const next = after({ subagents: [agent('a9', 'teammate', null, 'compañero')] })
    expect(next.cues).toEqual([])
    expect(next.decisions.map((one) => one.gesture)).toEqual([null])
  })

  it('reads the same agent with a new verdict as a new decision', () => {
    const next = after({ subagents: [agent('a1', 'measuring', null, 'midiendo')] })
    expect(gestures(next.cues)).toEqual(['unsure'])
  })

  it('shows a red card for a new block notice, and nothing for a warning', () => {
    const block = after({ notices: [{ id: 'n1', level: 'block', text: 'Escalado', at: 1 }] })
    expect(block.cues).toEqual([{ gesture: 'escalated', text: 'Escalado', isRoutine: false }])
    const warn = after({ notices: [{ id: 'n2', level: 'warn', text: 'ojo', at: 1 }] })
    expect(warn.cues).toEqual([])
  })

  it('follows a CI run from the stopwatch to its flag', () => {
    const first = advisorCuesOf(null, jev())
    const watching = advisorCuesOf(first.seen, jev({ ci: [run('c1', 'watching', 'CI 1/3')] }))
    expect(watching.cues).toEqual([{ gesture: 'ciRunning', text: 'CI 1/3', isRoutine: false }])
    const again = advisorCuesOf(watching.seen, jev({ ci: [run('c1', 'watching', 'CI 2/3')] }))
    expect(again.cues).toEqual([])
    const green = advisorCuesOf(again.seen, jev({ ci: [run('c1', 'success', 'CI ok')] }))
    expect(gestures(green.cues)).toEqual(['ciPassed'])
    const red = advisorCuesOf(again.seen, jev({ ci: [run('c1', 'failure', 'CI lint')] }))
    expect(gestures(red.cues)).toEqual(['ciFailed'])
  })

  // Why: a drawing can read a value older than the one already acted out; it must not replay it.
  it('never replays a decision or CI state it already acted out', () => {
    const first = advisorCuesOf(null, jev())
    const failed = advisorCuesOf(first.seen, jev({ ci: [run('c1', 'failure', 'CI lint')] }))
    expect(gestures(failed.cues)).toEqual(['ciFailed'])
    const cleared = advisorCuesOf(failed.seen, jev())
    expect(cleared.cues).toEqual([])
    expect(
      advisorCuesOf(cleared.seen, jev({ ci: [run('c1', 'failure', 'CI lint')] })).cues
    ).toEqual([])
  })

  // Why: a subagent that got the model is the decision; a main row for the same model is the wrong attribution.
  it('attributes a model change that came with a new subagent to that subagent, not the main conversation', () => {
    const next = after({
      model: 'Sonnet 5',
      effort: 'medium',
      subagents: [
        agent('a1', 'inherited', null, 'igual'),
        agent('a2', 'lowered', 'Sonnet 5', 'baja')
      ]
    })
    expect(next.decisions.map((one) => one.title)).toEqual(['Task a2'])
    expect(next.cues).toEqual([{ gesture: 'lowered', text: 'Sonnet 5 · baja', isRoutine: false }])
  })

  it('whistles when the main conversation changes model or effort', () => {
    const next = after({ model: 'Sonnet 5', effort: 'medium' })
    expect(next.cues).toEqual([{ gesture: 'approved', text: 'Sonnet 5·medium', isRoutine: false }])
    expect(next.decisions).toEqual([
      expect.objectContaining({ title: null, model: 'Sonnet 5', effort: 'medium' })
    ])
  })
})

describe('strongestCueOf', () => {
  it('plays the most important of several cues that came at once', () => {
    const next = after({
      subagents: [agent('a2', 'lowered', 'Sonnet 5', 'baja')],
      notices: [{ id: 'n1', level: 'block', text: 'Escalado', at: 1 }],
      ci: [run('c1', 'watching', 'CI')]
    })
    expect(strongestCueOf(next.cues)?.gesture).toBe('escalated')
    expect(strongestCueOf([])).toBeUndefined()
    expect(cueTicksOf('escalated')).toBeGreaterThan(cueTicksOf('lowered'))
  })
})

describe('advisorBubbleOf', () => {
  it('keeps only what the pixel art can draw', () => {
    const cue = { gesture: 'lowered', text: 'Opus → Sonnet 考え ok', isRoutine: false } as const
    expect(advisorBubbleOf(cue, false)).toBe('Opus Sonnet ok')
  })

  it('stays quiet in zen for a routine decision, and speaks for any other', () => {
    expect(advisorBubbleOf({ gesture: 'approved', text: 'same', isRoutine: true }, true)).toBe('')
    expect(advisorBubbleOf({ gesture: 'approved', text: 'same', isRoutine: true }, false)).toBe(
      'same'
    )
    expect(advisorBubbleOf({ gesture: 'lowered', text: 'baja', isRoutine: false }, true)).toBe(
      'baja'
    )
  })
})
