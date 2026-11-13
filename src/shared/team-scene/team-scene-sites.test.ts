import { describe, expect, it } from 'vitest'
import { grownSite, teamSceneSiteOf } from './team-scene-sites'
import type { TeamPullRequest } from '../team-panel-model-types'

const pr = (state: TeamPullRequest['state'], ci: TeamPullRequest['ci']): TeamPullRequest => ({
  provider: 'github',
  number: 12,
  title: 'x',
  url: 'https://example.test/12',
  state,
  ci,
  verdict: null,
  perfectMerge: null
})

describe('team scene site', () => {
  it('starts at the foundation while the member plans', () => {
    expect(teamSceneSiteOf({ flowPhase: null, pr: null })).toEqual({ stage: 0, broken: false })
    expect(teamSceneSiteOf({ flowPhase: 'plan', pr: null }).stage).toBe(0)
    expect(teamSceneSiteOf({ flowPhase: 'docs', pr: null }).stage).toBe(0)
  })

  it('raises the walls with code and the scaffold with tests', () => {
    expect(teamSceneSiteOf({ flowPhase: 'code', pr: null }).stage).toBe(1)
    expect(teamSceneSiteOf({ flowPhase: 'tests', pr: null }).stage).toBe(2)
  })

  it('puts up the scaffold while an open PR runs CI, nearly done once CI is green', () => {
    expect(teamSceneSiteOf({ flowPhase: 'code', pr: pr('open', 'pending') })).toEqual({
      stage: 2,
      broken: false
    })
    expect(teamSceneSiteOf({ flowPhase: 'pr', pr: pr('draft', 'none') }).stage).toBe(2)
    expect(teamSceneSiteOf({ flowPhase: 'pr', pr: pr('open', 'success') }).stage).toBe(3)
    expect(teamSceneSiteOf({ flowPhase: 'pr', pr: null }).stage).toBe(2)
  })

  it('is done once it merges', () => {
    expect(teamSceneSiteOf({ flowPhase: 'merge', pr: pr('merged', 'success') })).toEqual({
      stage: 4,
      broken: false
    })
  })

  it('grows only, but starts over when merged work is followed by new work', () => {
    const walls = { stage: 1, broken: false } as const
    expect(grownSite({ stage: 2, broken: true }, walls)).toEqual({ stage: 2, broken: false })
    expect(grownSite(null, walls)).toEqual(walls)
    expect(grownSite({ stage: 4, broken: false }, walls)).toEqual(walls)
  })

  it('breaks while the open PR has red CI, and only then', () => {
    expect(teamSceneSiteOf({ flowPhase: 'pr', pr: pr('open', 'failure') }).broken).toBe(true)
    expect(teamSceneSiteOf({ flowPhase: 'pr', pr: pr('open', 'success') }).broken).toBe(false)
    expect(teamSceneSiteOf({ flowPhase: 'merge', pr: pr('merged', 'failure') }).broken).toBe(false)
  })
})
