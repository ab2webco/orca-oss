import { describe, expect, it } from 'vitest'

import { isGhPrCreate, memberPrCapDenyOf } from '../hooks/member-pr-cap-guard'

const CREATE = 'gh pr create --title "x" --body-file /tmp/b.md'

describe('memberPrCapDenyOf (ORCA-1301)', () => {
  it("refuses a member's gh pr create once the open PRs reach the cap, naming both", () => {
    const reason = memberPrCapDenyOf({ role: 'member', command: CREATE, open: 1, cap: 1 })

    expect(reason).toContain('1 open PRs already reach the project')
    expect(reason).toContain('cap of 1')
  })

  it('lets a member under the cap, a lead, and an unknown cap or count through', () => {
    expect(memberPrCapDenyOf({ role: 'member', command: CREATE, open: 0, cap: 1 })).toBeNull()
    expect(memberPrCapDenyOf({ role: 'lead', command: CREATE, open: 9, cap: 1 })).toBeNull()
    expect(
      memberPrCapDenyOf({ role: 'member', command: CREATE, open: undefined, cap: 1 })
    ).toBeNull()
    expect(
      memberPrCapDenyOf({ role: 'member', command: CREATE, open: 3, cap: undefined })
    ).toBeNull()
  })

  it('reads gh pr create only at command position', () => {
    expect(isGhPrCreate('cd repo && gh pr create --fill')).toBe(true)
    expect(isGhPrCreate('GH_HOST=github.com gh -R o/r pr create')).toBe(true)
    expect(isGhPrCreate('gh pr view 12 && echo done')).toBe(false)
    expect(isGhPrCreate('grep -n "gh pr create" docs/x.md')).toBe(false)
    expect(isGhPrCreate(undefined)).toBe(false)
  })
})
