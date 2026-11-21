import { describe, expect, it } from 'vitest'
import { gamePrCapVerdictOf } from './orchestrator-game-pr-cap'

describe('gamePrCapVerdictOf (ORCA-1301)', () => {
  it('refuses a member at the cap, naming its open PRs, the cap and what to do', () => {
    const verdict = gamePrCapVerdictOf({ member: true, open: 6, cap: 6 })
    expect(verdict.kind).toBe('refuse')
    expect(verdict).toMatchObject({
      line: expect.stringMatching(
        /6 open PRs and its cap is 6\. Finish one of your open PRs.*ask your lead/
      )
    })
  })

  it('passes a member under the cap, and always passes the lead or a plain session', () => {
    expect(gamePrCapVerdictOf({ member: true, open: 5, cap: 6 })).toEqual({ kind: 'pass' })
    expect(gamePrCapVerdictOf({ member: false, open: 50, cap: 6 })).toEqual({ kind: 'pass' })
  })

  it('says it did not check when the host cannot read the cap, never refusing silently', () => {
    expect(gamePrCapVerdictOf({ member: true, unknown: 'its lead runs on another host' })).toEqual({
      kind: 'unchecked',
      line: expect.stringContaining(
        "did not check this project's open-PR cap (its lead runs on another host), so gh pr create runs"
      )
    })
  })
})
