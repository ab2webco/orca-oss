import { describe, expect, it } from 'vitest'

import {
  advisorBubbleOf,
  advisorCuesOf,
  cueTicksOf,
  gateCueOf,
  playingCueOf,
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

  it('carries each subagent id on its decision, and none on the main conversation', () => {
    const next = after({
      model: 'Sonnet 5',
      effort: 'medium',
      subagents: [agent('a2', 'lowered', 'Haiku 5', 'baja')]
    })
    expect(next.decisions.map((one) => one.id)).toEqual([null, 'a2'])
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

// Captured live on 2026-10-18 from the classic.PreToolUse chain beneath the game (orca-supervisor 0.13.6).
const HOOK_ERROR = 'PreToolUse:Bash hook error: '
const REFUSED = `${HOOK_ERROR}REFUSED: force push: rewrites the remote — anyone who already pulled breaks. You cannot run this command.`
const adviceOf = (judge: string) =>
  `${HOOK_ERROR}${judge} advice (not a refusal): this command would affect something worth a second look before it runs.\nIt would run: \`rm -rf build-output\`.`

describe('gateCueOf', () => {
  it('stops a command Jev advises against, naming Jev', () => {
    expect(gateCueOf('Bash', 'rm -rf build-output', { deny: adviceOf('Jev') })).toEqual({
      gesture: 'stopped',
      text: 'jev · rm -rf build-output',
      isRoutine: false
    })
  })

  it('stops a command Clef advises against, naming Clef', () => {
    expect(gateCueOf('Bash', 'rm -rf build-output', { deny: adviceOf('Clef') })).toEqual({
      gesture: 'stopped',
      text: 'clef · rm -rf build-output',
      isRoutine: false
    })
  })

  it('stops a command the gate refuses outright, whoever judged it', () => {
    expect(gateCueOf('Bash', 'git push --force origin main', { deny: REFUSED })).toEqual({
      gesture: 'stopped',
      text: 'git push --force origin main',
      isRoutine: false
    })
  })

  it('approves a command the gate judged and let through, as a routine decision', () => {
    expect(gateCueOf('Bash', 'curl -X POST https://x', { allow: true })).toEqual({
      gesture: 'approved',
      text: 'curl -X POST https://x',
      isRoutine: true
    })
  })

  it('acts out nothing the gate did not decide', () => {
    expect(gateCueOf('Bash', 'ls', {})).toBeUndefined()
    expect(
      gateCueOf('Bash', 'gh pr merge 1', { deny: `${HOOK_ERROR}Merging is the owner's call.` })
    ).toBeUndefined()
    expect(gateCueOf('Bash', 'gh pr merge 1', { ask: 'Merge?' })).toBeUndefined()
    expect(gateCueOf('Edit', undefined, { allow: true })).toBeUndefined()
  })

  it('speaks the first line of a long command only', () => {
    expect(gateCueOf('Bash', 'cat <<EOF\nx\nEOF', { allow: true })?.text).toBe('cat <<EOF')
  })
})

describe('playingCueOf', () => {
  const stop = { gesture: 'stopped', text: 'stop', isRoutine: false } as const
  const accept = { gesture: 'approved', text: 'ok', isRoutine: true } as const

  it('keeps a stronger gesture playing over a weaker one that comes during it', () => {
    const playing = playingCueOf(undefined, stop, 10)
    expect(playingCueOf(playing, accept, 20)).toBe(playing)
  })

  it('lets any gesture take over once the one playing has ended', () => {
    const playing = playingCueOf(undefined, stop, 10)
    expect(playingCueOf(playing, accept, 10 + cueTicksOf('stopped'))).toEqual({
      cue: accept,
      at: 50
    })
  })

  it('lets an equal or stronger gesture cut in', () => {
    const playing = playingCueOf(undefined, accept, 10)
    expect(playingCueOf(playing, stop, 11)).toEqual({ cue: stop, at: 11 })
  })
})
