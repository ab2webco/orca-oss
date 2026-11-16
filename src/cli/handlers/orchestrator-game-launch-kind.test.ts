import { describe, expect, it } from 'vitest'
import {
  ORCHESTRATION_WORKER_LAUNCH_CHOSEN_BY_RUNTIME_CAPABILITY,
  ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'
import { gameKindLaunchParamsOf, gameMemberModelParamsOf } from './orchestrator-game-launch-kind'
import { parseGameLaunchFlags } from './orchestrator-game-launch-options'

const CAPABLE = [
  ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY,
  ORCHESTRATION_WORKER_LAUNCH_CHOSEN_BY_RUNTIME_CAPABILITY
]
const claude = { agent: 'claude' }

describe('--kind (ORCA-851)', () => {
  it('reads one of the four kinds and refuses anything else', () => {
    expect(parseGameLaunchFlags(new Map([['kind', 'review']])).kind).toBe('review')
    expect(() => parseGameLaunchFlags(new Map([['kind', 'qa']]))).toThrow(
      /--kind must be audit, implement, review or captures/
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

  // Why: an older runtime would pin the default, locking a router (Jev) out of the member.
  it('picks nothing on a runtime that cannot launch it unpinned, as before', () => {
    expect(
      gameKindLaunchParamsOf(claude, { kind: 'audit' }, 'x', [
        ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY
      ])
    ).toEqual({})
  })
})
