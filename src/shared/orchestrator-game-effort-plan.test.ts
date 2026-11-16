import { describe, expect, it } from 'vitest'
import {
  gameKindEffortPlanOf,
  gameEffortPlanText,
  parseGameEffortPlan,
  parseGamePlanPhase
} from './orchestrator-game-effort-plan'

describe('parseGamePlanPhase', () => {
  it('reads name, model, effort and a why that may itself hold colons', () => {
    expect(parseGamePlanPhase('implement:opus-5-5:high:risky path: src/main/runtime')).toEqual({
      ok: true,
      phase: {
        phase: 'implement',
        model: 'claude-opus-5-5',
        effort: 'high',
        why: 'risky path: src/main/runtime'
      }
    })
    expect(parseGamePlanPhase(' map : claude-sonnet-5-5 : medium : map the runtime ')).toEqual({
      ok: true,
      phase: { phase: 'map', model: 'claude-sonnet-5-5', effort: 'medium', why: 'map the runtime' }
    })
  })

  it('refuses an unknown phase, a non-Claude model, an unknown effort or a missing why', () => {
    expect(parseGamePlanPhase('deploy:opus-5-5:high:ship it')).toMatchObject({
      ok: false,
      error: expect.stringContaining('map, design, implement, test-fix, captures, pr-ci')
    })
    expect(parseGamePlanPhase('map:gpt-5:high:read')).toMatchObject({
      ok: false,
      error: expect.stringContaining('gpt-5')
    })
    expect(parseGamePlanPhase('map:sonnet-5-5:huge:read')).toMatchObject({
      ok: false,
      error: expect.stringContaining('low, medium, high, xhigh, max')
    })
    expect(parseGamePlanPhase('map:sonnet-5-5:medium:')).toMatchObject({ ok: false })
    expect(parseGamePlanPhase('map:sonnet-5-5')).toMatchObject({ ok: false })
  })
})

describe('parseGameEffortPlan', () => {
  it('keeps the lead order and refuses a phase named twice', () => {
    const plan = parseGameEffortPlan([
      'map:sonnet-5-5:medium:read the runtime',
      'implement:opus-5-5:high:risky path'
    ])
    expect(plan).toMatchObject({
      ok: true,
      plan: { source: 'lead', phases: [{ phase: 'map' }, { phase: 'implement' }] }
    })
    expect(parseGameEffortPlan(['map:sonnet-5-5:medium:a', 'map:opus-5-5:high:b'])).toMatchObject({
      ok: false,
      error: expect.stringContaining('map')
    })
    expect(parseGameEffortPlan([])).toMatchObject({ ok: false })
  })
})

describe('gameKindEffortPlanOf', () => {
  // Why: the launch table stays the one source; a kind's plan reuses its rows per phase.
  it('seeds an implement ticket with every phase, each on the kind table row it maps to', () => {
    const plan = gameKindEffortPlanOf('implement')
    expect(plan.source).toBe('kind')
    expect(plan.kind).toBe('implement')
    expect(plan.phases.map(({ phase, model, effort }) => [phase, model, effort])).toEqual([
      ['map', 'claude-sonnet-5-5', 'medium'],
      ['design', 'claude-opus-5-5', 'high'],
      ['implement', 'claude-opus-5-5', 'high'],
      ['test-fix', 'claude-opus-5-5', 'high'],
      ['captures', 'claude-sonnet-5-5', 'medium'],
      ['pr-ci', 'claude-haiku-5-5', 'low']
    ])
  })

  it('seeds the narrower kinds with only the phases they run', () => {
    expect(gameKindEffortPlanOf('audit').phases.map(({ phase }) => phase)).toEqual(['map'])
    expect(gameKindEffortPlanOf('review').phases.map(({ phase }) => phase)).toEqual([
      'map',
      'design'
    ])
    expect(gameKindEffortPlanOf('captures').phases.map(({ phase }) => phase)).toEqual([
      'map',
      'captures'
    ])
  })
})

describe('gameEffortPlanText', () => {
  it('prints one line per phase with short model names', () => {
    expect(gameEffortPlanText(gameKindEffortPlanOf('review'))).toBe(
      [
        'plan: review ticket default',
        '  map     Sonnet 5.5 · medium  read and map the code before changing it',
        '  design  Opus 5.5 · high      review and design judgement'
      ].join('\n')
    )
  })
})
