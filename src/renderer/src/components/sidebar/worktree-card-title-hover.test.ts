import { describe, expect, it } from 'vitest'
import { worktreeCardTitleHoverShown } from './worktree-card-title-hover'

const base = {
  compactCards: false,
  activityViewOpen: false,
  showBranchIdentityHover: false,
  hasDetails: false,
  hasPorts: false,
  hasLiveAgent: false
}

describe('worktreeCardTitleHoverShown', () => {
  it('keeps the default card with nothing to show free of a hover', () => {
    expect(worktreeCardTitleHoverShown(base)).toBe(false)
  })

  it('gives a live agent a way to its model when the default card has no badge to hover', () => {
    expect(worktreeCardTitleHoverShown({ ...base, hasLiveAgent: true })).toBe(true)
  })

  it('leaves a default card with badges to their own hover', () => {
    expect(worktreeCardTitleHoverShown({ ...base, hasLiveAgent: true, hasDetails: true })).toBe(
      false
    )
    expect(worktreeCardTitleHoverShown({ ...base, hasLiveAgent: true, hasPorts: true })).toBe(false)
  })

  it('hovers a compact title for its identity, details, ports or a live agent', () => {
    const compact = { ...base, compactCards: true }
    expect(worktreeCardTitleHoverShown(compact)).toBe(false)
    expect(worktreeCardTitleHoverShown({ ...compact, showBranchIdentityHover: true })).toBe(true)
    expect(worktreeCardTitleHoverShown({ ...compact, hasDetails: true })).toBe(true)
    expect(worktreeCardTitleHoverShown({ ...compact, hasLiveAgent: true })).toBe(true)
  })

  it('stays off while the Activity view shows the same facts', () => {
    expect(
      worktreeCardTitleHoverShown({ ...base, hasLiveAgent: true, activityViewOpen: true })
    ).toBe(false)
  })
})
