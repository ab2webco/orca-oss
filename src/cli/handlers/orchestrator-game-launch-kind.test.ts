import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ORCHESTRATION_WORKER_LAUNCH_CHOSEN_BY_RUNTIME_CAPABILITY,
  ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'
import {
  gameKindEffortPlanSeedOf,
  gameKindLaunchParamsOf,
  gameMemberModelParamsOf
} from './orchestrator-game-launch-kind'
import { gameKindEffortPlanOf } from '../../shared/orchestrator-game-effort-plan'
import { parseGameLaunchFlags } from './orchestrator-game-launch-options'
import { fakeClient, launch, stateWith } from './orchestrator-game-launch-test-fixtures'

const CAPABLE = [
  ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY,
  ORCHESTRATION_WORKER_LAUNCH_CHOSEN_BY_RUNTIME_CAPABILITY
]
const claude = { agent: 'claude' }

describe('--kind (ORCA-851)', () => {
  it('reads one of the four kinds and refuses anything else', () => {
    expect(parseGameLaunchFlags(new Map([['kind', 'review']])).kind).toBe('review')
    expect(() => parseGameLaunchFlags(new Map([['kind', 'qa']]))).toThrow(
      /--kind must be audit, implement, review, captures, bug-fix, feature or live-check/
    )
  })
})

describe('gameKindLaunchParamsOf', () => {
  it('starts a Claude member without a chosen model on its kind default, saying why', () => {
    expect(gameKindLaunchParamsOf(claude, { kind: 'audit' }, 'Fix X', CAPABLE)).toEqual({
      model: 'claude-sonnet-5-5',
      effort: 'medium',
      modelChosenBy: { by: 'lead', kind: 'audit', source: 'flag' }
    })
    expect(gameKindLaunchParamsOf(claude, {}, 'Capture the panel', CAPABLE)).toMatchObject({
      modelChosenBy: { kind: 'captures', source: 'ticket' }
    })
    expect(gameKindLaunchParamsOf(claude, {}, 'Sidebar layout', CAPABLE)).toEqual({
      model: 'claude-opus-5-5',
      effort: 'high',
      modelChosenBy: { by: 'lead', kind: 'implement', source: 'default' }
    })
  })

  it('leaves a model a flag or orca.yaml chose, and another agent, as they are', () => {
    expect(
      gameKindLaunchParamsOf(
        { agent: 'claude', model: 'claude-haiku-5-5' },
        { kind: 'review' },
        'x',
        CAPABLE
      )
    ).toEqual({})
    expect(gameKindLaunchParamsOf({ agent: 'codex' }, { kind: 'review' }, 'x', CAPABLE)).toEqual({})
  })

  it('keeps a flag or orca.yaml model, refused on a runtime that cannot pick one', () => {
    const typed = { agent: 'claude', model: 'claude-haiku-5-5', effort: 'low' }
    expect(gameMemberModelParamsOf(typed, { kind: 'review' }, 'x', CAPABLE)).toEqual({
      model: 'claude-haiku-5-5',
      effort: 'low'
    })
    expect(() => gameMemberModelParamsOf(typed, {}, 'x', [])).toThrow(/cannot pick a member model/)
    expect(gameMemberModelParamsOf(claude, {}, 'Audit it', CAPABLE)).toMatchObject({
      modelChosenBy: { kind: 'audit', source: 'ticket' }
    })
  })

  // ORCA-1242: the kind that picked the launch model also seeds the ticket's effort plan.
  it("seeds the kind's effort plan only when the kind picked the model", () => {
    const picked = gameMemberModelParamsOf(claude, { kind: 'review' }, 'x', CAPABLE)
    expect(gameKindEffortPlanSeedOf(picked)).toEqual({ effortPlan: gameKindEffortPlanOf('review') })
    const typed = { agent: 'claude', model: 'claude-haiku-5-5', effort: 'low' }
    expect(gameKindEffortPlanSeedOf(gameMemberModelParamsOf(typed, {}, 'x', CAPABLE))).toEqual({})
    expect(gameKindEffortPlanSeedOf(gameKindLaunchParamsOf(claude, {}, 'x', []))).toEqual({})
  })

  // Why: an older runtime would pin the default, locking a router (Jev) out of the member.
  it('picks nothing on a runtime that cannot launch it unpinned, as before', () => {
    expect(
      gameKindLaunchParamsOf(claude, { kind: 'audit' }, 'x', [
        ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY
      ])
    ).toEqual({})
  })
})

// ORCA-1425: the brief links the kind's playbook; the host still gets a model kind it knows.
describe('--kind playbooks through game launch', () => {
  const saved = { ...process.env }
  // Why: an Orca pane exports these, so the test must set them or it passes only there.
  beforeEach(() => {
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'h1'
    process.env.ORCA_PANE_KEY = 'tab:leaf'
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  const launched = async (lead: Record<string, unknown>, kind: string) => {
    const { client, calls } = fakeClient(
      stateWith({ lead: { ...stateWith().lead, ...lead } }),
      { id: 'run_1' },
      { 'status.get': { capabilities: CAPABLE } }
    )
    await launch(client, 'cin-12', [['kind', kind]])
    const create = calls.find(([m]) => m === 'orchestration.taskCreate')?.[1] as { spec: string }
    const spec = create.spec
    const start = calls.find(([m]) => m === 'orchestration.workerStart')?.[1] as {
      modelChosenBy?: { kind: string }
    }
    return { spec, start }
  }

  it("links the project's playbook for the kind and launches bug-fix as implement", async () => {
    const { spec, start } = await launched({ playbooks: 'docs/reference/playbooks' }, 'bug-fix')
    expect(spec).toContain(
      '\n\nPlaybook: read docs/reference/playbooks/bug-fix.md before you start.'
    )
    expect(spec.indexOf('Playbook:')).toBeLessThan(spec.indexOf('CI: read'))
    expect(start.modelChosenBy?.kind).toBe('implement')
  })

  it('adds no line when the project keeps no playbooks', async () => {
    const { spec } = await launched({}, 'live-check')
    expect(spec).not.toContain('Playbook')
  })
})
