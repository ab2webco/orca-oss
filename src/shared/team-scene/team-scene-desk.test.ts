import { describe, expect, it } from 'vitest'
import type { TeamMemberCard, TeamPullRequest, TeamQueueEntry } from '../team-panel-model-types'
import { teamSceneDeskOf } from './team-scene-desk'

type Card = Pick<TeamMemberCard, 'paneKey' | 'flowPhase' | 'pr'>
const card = (extra: Partial<Card> = {}): Card => ({
  paneKey: 'm',
  flowPhase: 'code',
  pr: null,
  ...extra
})
const pr = (extra: Partial<TeamPullRequest> = {}): TeamPullRequest => ({
  provider: 'github',
  number: 12,
  title: 't',
  url: 'u',
  state: 'open',
  ci: 'none',
  verdict: null,
  perfectMerge: null,
  ...extra
})
const entry = (extra: Partial<TeamQueueEntry> = {}): TeamQueueEntry => ({
  label: '#12',
  title: 't',
  url: 'u',
  position: 2,
  state: 'checks',
  status: 'working',
  since: null,
  longWaitHours: null,
  memberKey: 'm',
  ...extra
})

describe('teamSceneDeskOf', () => {
  it('shows the flow phase the card names', () => {
    expect(teamSceneDeskOf(card({ flowPhase: 'plan' }), null)).toEqual({ kind: 'plan' })
    expect(teamSceneDeskOf(card({ flowPhase: 'docs' }), null)).toEqual({ kind: 'plan' })
    expect(teamSceneDeskOf(card({ flowPhase: 'tests' }), null)).toEqual({ kind: 'tests' })
    expect(teamSceneDeskOf(card({ flowPhase: 'code' }), null)).toBeUndefined()
    expect(teamSceneDeskOf(card({ flowPhase: null }), null)).toBeUndefined()
  })

  it('shows checks running on an open PR, and its review once a verdict is read', () => {
    expect(teamSceneDeskOf(card({ pr: pr({ ci: 'pending' }) }), null)).toEqual({ kind: 'checks' })
    expect(teamSceneDeskOf(card({ pr: pr({ verdict: 'approved' }) }), null)).toEqual({
      kind: 'review',
      verdict: 'approved'
    })
    expect(teamSceneDeskOf(card({ pr: pr({ verdict: 'changes_requested' }) }), null)).toEqual({
      kind: 'review',
      verdict: 'changes'
    })
    expect(teamSceneDeskOf(card({ pr: pr({ verdict: 'review_required' }) }), null)).toEqual({
      kind: 'review',
      verdict: 'waiting'
    })
  })

  it('reads no CI and no verdict as nothing, never a pass', () => {
    for (const ci of ['none', 'neutral', 'success'] as const) {
      expect(teamSceneDeskOf(card({ flowPhase: 'pr', pr: pr({ ci }) }), null)).toBeUndefined()
    }
    expect(teamSceneDeskOf(card({ pr: pr({ state: 'merged', ci: 'pending' }) }), null)).toBe(
      undefined
    )
  })

  it("puts its merge-queue place first, and only an entry that is this member's", () => {
    const pending = card({ pr: pr({ ci: 'pending', verdict: 'approved' }) })
    expect(teamSceneDeskOf(pending, [entry()])).toEqual({ kind: 'queue', position: 2 })
    expect(teamSceneDeskOf(pending, [entry({ state: 'waiting', position: 1 })])).toEqual({
      kind: 'queue',
      position: 1
    })
    expect(teamSceneDeskOf(pending, [entry({ memberKey: 'other' })])).toEqual({ kind: 'checks' })
    // Why: a failed entry is red CI, which the site already draws.
    expect(teamSceneDeskOf(pending, [entry({ state: 'failed' })])).toEqual({ kind: 'checks' })
  })
})
