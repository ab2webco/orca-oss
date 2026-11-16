import { describe, expect, it } from 'vitest'

import {
  stewardChoiceOf,
  stewardStartPhaseOf,
  stewardMomentOf,
  withPins,
  withQuota,
  type StewardPlanPhase,
  type StewardTrack
} from '../hooks/steward-rules'

const PLAN: StewardPlanPhase[] = [
  {
    phase: 'map',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    why: 'map the runtime'
  },
  {
    phase: 'implement',
    model: 'claude-opus-5-5',
    effort: 'xhigh',
    why: 'risky path'
  },
  { phase: 'pr-ci', model: 'claude-haiku-5-5', effort: 'low', why: 'watch CI' }
]
const SONNET = { model: 'claude-sonnet-5-5', effort: 'medium' } as const
const START: StewardTrack = { phase: null, failing: null, hasEdited: false }

describe('stewardChoiceOf (ORCA-1242)', () => {
  it("follows the plan's phase when the plan has it", () => {
    expect(stewardChoiceOf({ phase: 'implement', plan: PLAN, current: SONNET })).toEqual({
      pick: { model: 'claude-opus-5-5', effort: 'xhigh' },
      source: 'plan',
      isFloored: false
    })
  })

  it('falls back to the kind table when the plan or the phase is missing', () => {
    expect(stewardChoiceOf({ phase: 'captures', plan: PLAN, current: SONNET })).toMatchObject({
      pick: { model: 'claude-sonnet-5-5', effort: 'medium' },
      source: 'default'
    })
    expect(stewardChoiceOf({ phase: 'pr-ci', plan: null, current: SONNET }).pick).toEqual({
      model: 'claude-haiku-5-5',
      effort: 'low'
    })
  })

  it('never edits code or designs below Opus 5.5, whatever the plan says', () => {
    const cheap: StewardPlanPhase[] = [
      {
        phase: 'implement',
        model: 'claude-haiku-5-5',
        effort: 'low',
        why: 'small'
      },
      {
        phase: 'design',
        model: 'claude-sonnet-5-5',
        effort: 'high',
        why: 'quick'
      },
      {
        phase: 'test-fix',
        model: 'claude-sonnet-5-5',
        effort: 'low',
        why: 'flaky'
      }
    ]
    for (const phase of ['implement', 'design', 'test-fix'] as const) {
      const choice = stewardChoiceOf({ phase, plan: cheap, current: SONNET })
      expect(choice.pick.model).toBe('claude-opus-5-5')
      expect(choice.isFloored).toBe(true)
    }
  })

  it('keeps a model above the floor that the plan names', () => {
    const fable: StewardPlanPhase[] = [
      {
        phase: 'implement',
        model: 'claude-fable-5-2',
        effort: 'high',
        why: 'hard'
      }
    ]
    const choice = stewardChoiceOf({ phase: 'implement', plan: fable, current: SONNET })
    expect(choice.pick.model).toBe('claude-fable-5-2')
    expect(choice.isFloored).toBe(false)
  })

  it('a low-confidence judgment only raises, never lowers', () => {
    const opus = { model: 'claude-opus-5-5', effort: 'high' } as const
    const low = stewardChoiceOf({ phase: 'map', plan: null, current: opus, confidence: 0.5 })
    expect(low.pick).toEqual(opus)
    const sure = stewardChoiceOf({ phase: 'map', plan: null, current: opus, confidence: 0.9 })
    expect(sure.pick).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
    const raise = stewardChoiceOf({
      phase: 'implement',
      plan: null,
      current: SONNET,
      confidence: 0.4
    })
    expect(raise.pick).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  })
})

describe('after the first edit', () => {
  it('a later phase lowers only the effort, never the model below Opus 5.5', () => {
    const opus = { model: 'claude-opus-5-5', effort: 'xhigh' } as const
    const choice = stewardChoiceOf({ phase: 'pr-ci', plan: PLAN, current: opus, hasEdited: true })
    expect(choice.pick).toEqual({ model: 'claude-opus-5-5', effort: 'low' })
    expect(choice.isFloored).toBe(true)
    const before = stewardChoiceOf({ phase: 'pr-ci', plan: PLAN, current: opus, hasEdited: false })
    expect(before.pick.model).toBe('claude-haiku-5-5')
  })
})

describe('stewardStartPhaseOf', () => {
  it('a review plan starts in design, since a review never shows an edit to move it there', () => {
    const review: StewardPlanPhase[] = [
      { phase: 'map', model: 'claude-sonnet-5-5', effort: 'medium', why: 'read' },
      { phase: 'design', model: 'claude-opus-5-5', effort: 'high', why: 'judge' }
    ]
    expect(stewardStartPhaseOf(review)).toBe('design')
    expect(stewardStartPhaseOf(PLAN)).toBe('map')
    expect(stewardStartPhaseOf([])).toBeNull()
  })
})

describe('withPins', () => {
  it('keeps what Orca pinned at launch and changes only the rest', () => {
    const next = { model: 'claude-opus-5-5', effort: 'high' } as const
    expect(withPins(next, SONNET, { model: true, effort: false })).toEqual({
      model: 'claude-sonnet-5-5',
      effort: 'high'
    })
    expect(withPins(next, SONNET, { model: false, effort: true })).toEqual({
      model: 'claude-opus-5-5',
      effort: 'medium'
    })
  })
})

describe('withQuota', () => {
  it('lowers the effort one level from 85 % of a window, never the model', () => {
    const opus = { model: 'claude-opus-5-5', effort: 'high' } as const
    expect(withQuota(opus, 84)).toEqual(opus)
    expect(withQuota(opus, 85)).toEqual({ model: 'claude-opus-5-5', effort: 'medium' })
    expect(withQuota({ model: 'claude-haiku-5-5', effort: 'low' }, 99).effort).toBe('low')
  })
})

describe('stewardMomentOf', () => {
  it('the first edit moves a reading member to implement', () => {
    const read = stewardMomentOf(START, { tool: 'Read', isError: false })
    expect(read.phase).toBeUndefined()
    const edit = stewardMomentOf(read.track, { tool: 'Edit', isError: false })
    expect(edit).toEqual({
      track: { phase: 'implement', failing: null, hasEdited: true },
      phase: 'implement',
      reason: 'edit'
    })
    expect(stewardMomentOf(edit.track, { tool: 'Write', isError: false }).phase).toBeUndefined()
  })

  it('the same test failing twice in a row is a test-fix moment, not one failure', () => {
    const test = { tool: 'Bash', command: 'pnpm vitest run src/a.test.ts', isError: true }
    const once = stewardMomentOf({ phase: 'implement', failing: null, hasEdited: true }, test)
    expect(once.phase).toBeUndefined()
    const twice = stewardMomentOf(once.track, test)
    expect(twice).toMatchObject({ phase: 'test-fix', reason: 'test-loop' })
    const other = stewardMomentOf(once.track, { ...test, command: 'pnpm vitest run src/b.test.ts' })
    expect(other.phase).toBeUndefined()
    const passed = stewardMomentOf(once.track, { ...test, isError: false })
    expect(passed.track.failing).toBeNull()
  })

  it('editing while fixing tests stays in test-fix', () => {
    const fixing: StewardTrack = { phase: 'test-fix', failing: null, hasEdited: true }
    expect(stewardMomentOf(fixing, { tool: 'Edit', isError: false }).phase).toBeUndefined()
  })

  it('pushing or watching CI is pr-ci', () => {
    const working: StewardTrack = { phase: 'implement', failing: null, hasEdited: true }
    const bash = (command: string) => ({ tool: 'Bash', command, isError: false })
    expect(stewardMomentOf(working, bash('git push -u origin x')).phase).toBe('pr-ci')
    expect(stewardMomentOf(working, bash('gh pr checks 12 --watch')).phase).toBe('pr-ci')
    expect(stewardMomentOf(working, bash('gh run list --branch x')).phase).toBeUndefined()
  })

  it('only running a capture script, or reading a shot outside implementing, is captures', () => {
    const reading: StewardTrack = { phase: 'map', failing: null, hasEdited: false }
    const working: StewardTrack = { phase: 'implement', failing: null, hasEdited: true }
    const bash = (command: string) => ({ tool: 'Bash', command, isError: false })
    const shot = { tool: 'Read', path: '/w/tmp/shot-390.png', isError: false }
    expect(stewardMomentOf(reading, bash('pnpm run capture:orca-game-scenes')).phase).toBe(
      'captures'
    )
    expect(stewardMomentOf(reading, shot).phase).toBe('captures')
    expect(stewardMomentOf(working, shot).phase).toBeUndefined()
    for (const command of [
      'ls tmp/captures-1262',
      'git commit -m "add screenshots"',
      'grep -rn screenshot src'
    ]) {
      expect(stewardMomentOf(working, bash(command)).phase).toBeUndefined()
    }
  })
})
