import { describe, expect, it } from 'vitest'
import {
  GAME_MEMBER_STEWARD_DECISIONS_MAX,
  parseGameMemberSteward,
  parseRelayedGameMemberSteward
} from './orchestrator-game-member-steward'
import { parseRemoteMemberAgent } from './orchestrator-game-remote-agent'

const decision = (at: number, extra: Record<string, unknown> = {}) => ({
  at,
  moment: 'edit',
  phase: 'implement',
  from: { model: 'claude-sonnet-5-5', effort: 'medium' },
  to: { model: 'claude-opus-5-5', effort: 'high' },
  applied: true,
  source: 'plan',
  why: 'editing code',
  ...extra
})

const report = (extra: Record<string, unknown> = {}) => ({
  version: 1,
  session: 's1',
  ticket: 'ORCA-12',
  model: 'claude-opus-5-5',
  effort: 'high',
  phase: 'implement',
  plan: 'plan',
  standDown: null,
  pinned: { model: false, effort: false },
  stepsSeen: 7,
  decisions: [decision(1)],
  ...extra
})

describe('parseGameMemberSteward', () => {
  it('reads a version 1 report', () => {
    expect(parseGameMemberSteward(report())).toEqual({
      session: 's1',
      ticket: 'ORCA-12',
      model: 'claude-opus-5-5',
      effort: 'high',
      phase: 'implement',
      plan: 'plan',
      standDown: null,
      pinned: { model: false, effort: false },
      stepsSeen: 7,
      decisions: [decision(1)]
    })
  })

  it('null says the steward stopped; another version or shape is ignored', () => {
    expect(parseGameMemberSteward(null)).toBeNull()
    expect(parseGameMemberSteward(report({ version: 2 }))).toBeUndefined()
    expect(parseGameMemberSteward('steward')).toBeUndefined()
  })

  it('drops one unreadable decision alone and keeps only the latest', () => {
    const many = Array.from({ length: GAME_MEMBER_STEWARD_DECISIONS_MAX + 3 }, (_, i) =>
      decision(i)
    )
    const parsed = parseGameMemberSteward(report({ decisions: [...many, { at: 'x' }] }))
    expect(parsed?.decisions).toHaveLength(GAME_MEMBER_STEWARD_DECISIONS_MAX - 1)
    expect(parsed?.decisions.at(-1)?.at).toBe(GAME_MEMBER_STEWARD_DECISIONS_MAX + 2)
  })

  it('keeps a judgment, its failure and tokens; strips terminal control from the why', () => {
    const judged = decision(2, {
      source: 'haiku',
      confidence: 0.4,
      failure: 'aborted',
      tokens: { input: 180, output: 42 },
      why: '\u001b[31mmap\u001b[0m   first'
    })
    expect(parseGameMemberSteward(report({ decisions: [judged] }))?.decisions[0]).toEqual({
      ...judged,
      why: 'map first'
    })
  })

  it('an unknown plan state or stand-down reads as the safe default', () => {
    const parsed = parseGameMemberSteward(report({ plan: 'later', standDown: 'other' }))
    expect(parsed).toMatchObject({ plan: 'none-yet', standDown: null })
  })
})

describe('a remote host relaying the steward (ORCA-1242)', () => {
  const agent = { state: 'working', agentType: 'claude', updatedAt: 5 }

  it('an older host that sends no steward still parses', () => {
    const parsed = parseRemoteMemberAgent(agent)
    expect(parsed).toEqual({ state: 'working', agentType: 'claude', updatedAt: 5 })
    expect(parsed).not.toHaveProperty('steward')
  })

  it('relays the steward the host holds, which carries no version', () => {
    const { version: _version, ...held } = report()
    expect(parseRemoteMemberAgent({ ...agent, steward: held })?.steward).toEqual(
      parseGameMemberSteward(report())
    )
    expect(parseRelayedGameMemberSteward('x')).toBeNull()
  })
})
