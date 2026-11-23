import { describe, expect, it } from 'vitest'
import type { GameMemberSteward, GameStewardDecision } from './orchestrator-game-member-steward'
import type { GameAgent } from './orchestrator-game-state'
import {
  gameMemberModelTextOf,
  teamAgentModelOf,
  teamModelCreditTextOf
} from './team-panel-agent-model'
import { teamStewardOf } from './team-panel-steward'

const sonnet = { model: 'claude-sonnet-5-5', effort: 'medium' }
const opus = { model: 'claude-opus-5-5', effort: 'high' }

const decision = (over: Partial<GameStewardDecision> = {}): GameStewardDecision => ({
  at: 1,
  moment: 'edit',
  phase: 'implement',
  from: sonnet,
  to: opus,
  applied: true,
  source: 'plan',
  why: 'editing code',
  ...over
})

const steward = (over: Partial<GameMemberSteward> = {}): GameMemberSteward => ({
  session: 's1',
  ticket: 'ORCA-12',
  model: 'claude-opus-5-5',
  effort: 'high',
  phase: 'implement',
  plan: 'plan',
  standDown: null,
  pinned: { model: false, effort: false },
  stepsSeen: 3,
  decisions: [decision()],
  ...over
})

const jev = { model: 'Opus 5.5', effort: 'high', pinned: { model: false, effort: false } }
const agent = (fields: Pick<GameAgent, 'advisor' | 'launch' | 'steward'>) => fields

describe("a member card's Orca steward (ORCA-1242)", () => {
  it('credits the raise at the first edit, from the model it left', () => {
    const model = teamAgentModelOf(agent({ steward: steward() }))
    expect(model).toMatchObject({ label: 'Opus 5.5', effort: 'high', source: 'steward' })
    expect(model?.credit).toMatchObject({ by: 'steward', from: 'Sonnet 5.5', reason: 'edit' })
    expect(gameMemberModelTextOf(agent({ steward: steward() }))).toEqual({
      model: 'Sonnet 5.5 → Opus 5.5 · high',
      modelBy: 'editing code (Orca steward)'
    })
  })

  it('names the served model once the transcript shows it, still crediting the steward', () => {
    const launch = { model: 'Opus 5.5', effort: 'high', source: 'session' as const }
    expect(teamAgentModelOf(agent({ steward: steward(), launch, advisor: jev }))).toMatchObject({
      label: 'Opus 5.5',
      source: 'session',
      credit: { by: 'steward' }
    })
  })

  it("credits Jev, not the steward, while Jev's router rewrites the steps", () => {
    const routed = steward({ standDown: 'router' })
    const credit = teamAgentModelOf(agent({ steward: routed, advisor: jev }))?.credit
    expect(credit?.by).toBe('advisor')
    expect(teamAgentModelOf(agent({ steward: routed }))).toBeNull()
  })

  it("says it kept a person's /model, a launch pin, or the model when Haiku failed", () => {
    const text = (one: GameMemberSteward) =>
      teamModelCreditTextOf(teamAgentModelOf(agent({ steward: one }))?.credit)
    expect(text(steward({ standDown: 'override' }))).toBe('kept the model you chose (Orca steward)')
    expect(text(steward({ pinned: { model: true, effort: false } }))).toBe(
      'kept the model pinned at launch (Orca steward)'
    )
    const failed = decision({ moment: 'judged', applied: false, to: sonnet, failure: 'aborted' })
    expect(text(steward({ model: 'claude-sonnet-5-5', decisions: [failed] }))).toBe(
      'could not judge, kept the model (Orca steward)'
    )
  })

  it('says when its pick is not served, with no switch shown (risk 4b)', () => {
    const skipped = steward({ skipped: true })
    const launch = { model: 'Sonnet 5.5', effort: 'medium', source: 'session' as const }
    expect(gameMemberModelTextOf(agent({ steward: skipped, launch }))).toEqual({
      model: 'Sonnet 5.5 · medium',
      modelBy: 'picked Opus 5.5, not served: another plugin may skip its hooks (Orca steward)'
    })
  })

  it('a decision not applied shows no switch', () => {
    const kept = steward({ decisions: [decision({ applied: false })] })
    expect(teamAgentModelOf(agent({ steward: kept }))?.credit).toMatchObject({ from: null })
  })
})

describe('teamStewardOf', () => {
  it('follows the plan while its latest pick came from the plan', () => {
    expect(teamStewardOf(steward()).steward?.plan).toBe('following')
  })

  it('a floor, the kind table or Haiku is off the plan; no plan says none', () => {
    const off = (one: Partial<GameStewardDecision>) =>
      teamStewardOf(steward({ decisions: [decision(one)] })).steward?.plan
    expect(off({ isFloored: true })).toBe('deviated')
    expect(off({ source: 'default' })).toBe('deviated')
    expect(off({ source: 'haiku' })).toBe('deviated')
    expect(teamStewardOf(steward({ plan: 'none' })).steward?.plan).toBe('none')
    expect(teamStewardOf(undefined)).toEqual({})
  })

  // Why (ORCA-1350): the card says whether the member's cache was warm and why the model stayed.
  it('carries the cache note of its latest decision that has one', () => {
    const cache = {
      warm: true,
      known: true,
      ttl: '1h' as const,
      contextTokens: 120_000,
      why: 'warm-hold',
      extraUsd: 0.47,
      breakEven: 38
    }
    const cold = { ...cache, warm: false, why: 'cold' }
    const decisions = [
      decision({ at: 1, cache }),
      decision({ at: 2, moment: 'pr-ci', cache: cold }),
      decision({ at: 3, moment: 'stand-down', source: 'router' })
    ]
    expect(teamStewardOf(steward({ decisions })).steward?.cache).toEqual({
      warm: false,
      known: true,
      ttl: '1h',
      contextTokens: 120_000,
      why: 'cold'
    })
    expect(teamStewardOf(steward()).steward).not.toHaveProperty('cache')
  })

  it('keeps its last five moves as the card reads them, without stand-downs', () => {
    const many = Array.from({ length: 7 }, (_, i) => decision({ at: i }))
    const standDown = decision({ at: 99, moment: 'stand-down', source: 'router' })
    const steps = teamStewardOf(steward({ decisions: [...many, standDown] })).steward?.steps
    expect(steps?.map((one) => one.at)).toEqual([2, 3, 4, 5, 6])
    expect(steps?.[0]).toEqual({
      at: 2,
      moment: 'edit',
      from: 'Sonnet 5.5 · medium',
      to: 'Opus 5.5 · high',
      applied: true,
      lift: 'raise'
    })
  })

  it('says whether a move raised or lowered the pick: the model first, then the effort', () => {
    const liftOf = (from: typeof opus, to: typeof opus) =>
      teamStewardOf(steward({ decisions: [decision({ from, to })] })).steward?.steps[0]?.lift
    expect(liftOf(sonnet, opus)).toBe('raise')
    expect(liftOf(opus, sonnet)).toBe('lower')
    expect(liftOf(opus, { ...opus, effort: 'xhigh' })).toBe('raise')
    expect(liftOf({ ...opus, effort: 'xhigh' }, { model: 'claude-haiku-5-5', effort: 'max' })).toBe(
      'lower'
    )
    expect(liftOf(opus, opus)).toBe('same')
  })
})
