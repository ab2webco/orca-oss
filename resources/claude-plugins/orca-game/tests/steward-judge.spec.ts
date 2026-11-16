import { describe, expect, it } from 'vitest'

import {
  STEWARD_JUDGE_BUDGET,
  stewardJudgeAllowed,
  stewardJudgePromptOf,
  stewardVerdictOf
} from '../hooks/steward-judge'

describe('stewardVerdictOf (ORCA-1242)', () => {
  it("reads Haiku's JSON as a phase with its confidence and why", () => {
    expect(
      stewardVerdictOf('{"kind":"implement","confidence":0.82,"why":"the task edits the runtime"}')
    ).toEqual({ phase: 'implement', confidence: 0.82, why: 'the task edits the runtime' })
    expect(stewardVerdictOf('Sure: {"kind":"read","confidence":0.9,"why":"audit"}')?.phase).toBe(
      'map'
    )
    expect(stewardVerdictOf('{"kind":"stuck","confidence":1,"why":"x"}')?.phase).toBe('test-fix')
    expect(stewardVerdictOf('{"kind":"review-design","confidence":1,"why":"x"}')?.phase).toBe(
      'design'
    )
  })

  it('an unreadable reply is no verdict, so the steward keeps the current model', () => {
    expect(stewardVerdictOf('')).toBeNull()
    expect(stewardVerdictOf('not json')).toBeNull()
    expect(stewardVerdictOf('{"kind":"deploy","confidence":0.9,"why":"x"}')).toBeNull()
    expect(stewardVerdictOf('{"kind":"read","confidence":"high","why":"x"}')).toBeNull()
    expect(stewardVerdictOf('{"kind":"read","confidence":1.4,"why":"x"}')).toBeNull()
  })

  it('cuts a long why to one short line', () => {
    const why = `${'a'.repeat(300)}\nsecond line`
    const verdict = stewardVerdictOf(JSON.stringify({ kind: 'read', confidence: 0.9, why }))
    expect(verdict?.why.length).toBeLessThanOrEqual(120)
    expect(verdict?.why.includes('\n')).toBe(false)
  })
})

describe('stewardJudgeAllowed', () => {
  it('allows 20 calls a ticket, three minutes apart', () => {
    expect(stewardJudgeAllowed({ calls: 0, lastAt: null }, 0)).toBe(true)
    expect(stewardJudgeAllowed({ calls: 1, lastAt: 1000 }, 1000 + 179_000)).toBe(false)
    expect(stewardJudgeAllowed({ calls: 1, lastAt: 1000 }, 1000 + 180_000)).toBe(true)
    expect(stewardJudgeAllowed({ calls: STEWARD_JUDGE_BUDGET, lastAt: 0 }, 10_000_000)).toBe(false)
  })
})

describe('stewardJudgePromptOf', () => {
  it('names the task and the recent tools, and asks for the JSON only', () => {
    const prompt = stewardJudgePromptOf({
      task: 'Fix the sidebar restore',
      tools: ['Read src/a.ts', 'Grep restore']
    })
    expect(prompt).toContain('Fix the sidebar restore')
    expect(prompt).toContain('Read src/a.ts')
    expect(prompt).toContain('"kind"')
  })

  it('keeps only the last ten tools and a bounded task', () => {
    const tools = Array.from({ length: 15 }, (_, i) => `Read f${i}.ts`)
    const prompt = stewardJudgePromptOf({ task: 'x'.repeat(5000), tools })
    expect(prompt).not.toContain('Read f4.ts')
    expect(prompt).toContain('Read f14.ts')
    expect(prompt.length).toBeLessThan(4000)
  })
})
