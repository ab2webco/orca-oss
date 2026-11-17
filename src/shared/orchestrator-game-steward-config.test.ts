import { describe, expect, it } from 'vitest'
import { parseOrcaYaml } from './orca-yaml'
import { parseGameStewardConfig } from './orchestrator-game-steward-config'
import { isGameStewardSkipped, type GameMemberSteward } from './orchestrator-game-member-steward'

describe('orca.yaml orchestratorGame.steward (ORCA-1242)', () => {
  it('reads the high-risk paths a project adds', () => {
    const parsed = parseOrcaYaml(
      'orchestratorGame:\n  steward:\n    highRiskPaths:\n      - src/main/runtime/\n      - src\\shared\\protocol\n'
    )
    expect(parsed?.orchestratorGame?.steward).toEqual({
      highRiskPaths: ['src/main/runtime/', 'src/shared/protocol']
    })
    expect(parsed?.orchestratorGameWarnings).toBeUndefined()
  })

  it('warns on a shape it cannot read, and drops empty or non-text entries', () => {
    expect(parseGameStewardConfig({ highRiskPaths: 'src' })).toMatchObject({ value: undefined })
    expect(parseGameStewardConfig(['src'])).toMatchObject({ value: undefined })
    const mixed = parseGameStewardConfig({ highRiskPaths: ['a/', '', 3] })
    expect(mixed.value).toEqual({ highRiskPaths: ['a/'] })
    expect(mixed.warnings).toHaveLength(1)
  })
})

describe('isGameStewardSkipped (risk 4b)', () => {
  const MIN = 60_000
  const steward = (over: Partial<GameMemberSteward> = {}): GameMemberSteward => ({
    session: 's1',
    ticket: 'ORCA-12',
    model: 'claude-opus-5-5',
    effort: 'high',
    phase: 'implement',
    plan: 'plan',
    standDown: null,
    pinned: { model: false, effort: false },
    stepsSeen: 0,
    decisions: [
      {
        at: 0,
        moment: 'edit',
        phase: 'implement',
        from: { model: 'claude-sonnet-5-5', effort: 'medium' },
        to: { model: 'claude-opus-5-5', effort: 'high' },
        applied: true,
        source: 'plan',
        why: 'edit'
      }
    ],
    ...over
  })
  const label = (model: string) => (model.includes('opus') ? 'Opus 5.5' : 'Sonnet 5.5')

  it('flags an applied pick the session still does not serve two minutes on', () => {
    expect(isGameStewardSkipped(steward(), 'Sonnet 5.5', label, 2 * MIN)).toBe(true)
  })

  it('waits for the next step, and trusts a served match, a stand-down or no reading', () => {
    expect(isGameStewardSkipped(steward(), 'Sonnet 5.5', label, MIN)).toBe(false)
    expect(isGameStewardSkipped(steward(), 'Opus 5.5', label, 2 * MIN)).toBe(false)
    expect(
      isGameStewardSkipped(steward({ standDown: 'router' }), 'Sonnet 5.5', label, 2 * MIN)
    ).toBe(false)
    expect(isGameStewardSkipped(steward(), null, label, 2 * MIN)).toBe(false)
    const unapplied = steward({
      decisions: steward().decisions.map((one) => ({ ...one, applied: false }))
    })
    expect(isGameStewardSkipped(unapplied, 'Sonnet 5.5', label, 2 * MIN)).toBe(false)
  })
})
