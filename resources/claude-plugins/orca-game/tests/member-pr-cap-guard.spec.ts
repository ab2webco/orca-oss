import { describe, expect, it } from 'vitest'

import { PR_CAP_REFUSE_EXIT } from '../../../../src/shared/orchestrator-game-pr-cap'
import { isGhPrCreate, memberPrCapDenyOf, prCapCheckArgvOf } from '../hooks/member-pr-cap-guard'

const REFUSAL = 'Orca refused gh pr create: this project has 6 open PRs and its cap is 6.'

describe('memberPrCapDenyOf (ORCA-1301)', () => {
  it("refuses with the host's line only when pr-cap-check exits with the wrapper's refuse code", () => {
    expect(memberPrCapDenyOf({ exitCode: PR_CAP_REFUSE_EXIT, stderr: `${REFUSAL}\n` })).toBe(
      REFUSAL
    )
    expect(memberPrCapDenyOf({ exitCode: PR_CAP_REFUSE_EXIT, stderr: '' })).toContain('cap')
  })

  it('lets gh run on a pass, an unchecked cap, an older CLI, or no CLI at all', () => {
    expect(memberPrCapDenyOf({ exitCode: 0, stderr: '' })).toBeNull()
    expect(memberPrCapDenyOf({ exitCode: 4, stderr: 'Orca did not check' })).toBeNull()
    expect(memberPrCapDenyOf({ exitCode: 1, stderr: 'unknown command' })).toBeNull()
    expect(memberPrCapDenyOf(undefined)).toBeNull()
  })

  it('asks pr-cap-check only through an absolute CLI path', () => {
    expect(prCapCheckArgvOf('/opt/orca/bin/orca')).toEqual([
      '/opt/orca/bin/orca',
      'game',
      'pr-cap-check'
    ])
    expect(prCapCheckArgvOf('C:\\Orca\\orca.cmd')?.slice(1)).toEqual(['game', 'pr-cap-check'])
    expect(prCapCheckArgvOf('orca')).toBeUndefined()
    expect(prCapCheckArgvOf(undefined)).toBeUndefined()
  })

  it('reads gh pr create only at command position', () => {
    expect(isGhPrCreate('cd repo && gh pr create --fill')).toBe(true)
    expect(isGhPrCreate('GH_HOST=github.com gh -R o/r pr create')).toBe(true)
    expect(isGhPrCreate('gh pr view 12 && echo done')).toBe(false)
    expect(isGhPrCreate('grep -n "gh pr create" docs/x.md')).toBe(false)
    expect(isGhPrCreate(undefined)).toBe(false)
  })
})
