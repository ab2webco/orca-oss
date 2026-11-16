import { describe, expect, it } from 'vitest'
import { gameKindEffortPlanOf, parseGameEffortPlan } from './orchestrator-game-effort-plan'
import {
  GAME_MEMBER_SESSIONS_VERSION,
  mergeGameMemberSession,
  parseGameMemberSessionsFile,
  serializeGameMemberSessions,
  type GameMemberSession
} from './orchestrator-game-member-sessions'

const member = (extra: Partial<GameMemberSession> = {}): GameMemberSession => ({
  ticket: 'ORCA-1',
  name: null,
  runId: 'run_1',
  taskId: 'task_1',
  dispatchId: null,
  worktreeId: null,
  branch: null,
  agent: 'claude',
  accountId: null,
  account: null,
  sessionId: null,
  lastState: null,
  launchedAt: '2026-11-15T10:00:00.000Z',
  updatedAt: '2026-11-15T10:00:00.000Z',
  ...extra
})

const leadPlan = (() => {
  const parsed = parseGameEffortPlan(['implement:opus-5-5:high:risky runtime path'])
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
  return parsed.plan
})()

describe("a member's effort plan on disk (ORCA-1242)", () => {
  it('round-trips with the member', () => {
    const members = [member({ effortPlan: gameKindEffortPlanOf('review') })]
    expect(parseGameMemberSessionsFile(serializeGameMemberSessions(members))).toEqual({
      ok: true,
      members
    })
  })

  // Why: an unreadable plan must cost neither the member nor, on the next write, the plan's bytes.
  it('keeps a plan it cannot read as an unknown key and still reads the member', () => {
    const text = JSON.stringify({
      version: GAME_MEMBER_SESSIONS_VERSION,
      members: [{ ...member(), effortPlan: { source: 'lead', phases: 'soon' } }]
    })
    const read = parseGameMemberSessionsFile(text)
    expect(read).toMatchObject({ ok: true, members: [member()] })
    expect(read.ok && read.members[0]?.effortPlan).toBeUndefined()
    expect(read.ok && read.kept?.members['ORCA-1']).toEqual({
      effortPlan: { source: 'lead', phases: 'soon' }
    })
  })
})

describe('mergeGameMemberSession with an effort plan', () => {
  it('seeds the kind plan on a member that has none', () => {
    const next = mergeGameMemberSession(
      [member()],
      { ticket: 'ORCA-1', effortPlan: gameKindEffortPlanOf('audit') },
      'later'
    )
    expect(next[0]?.effortPlan).toEqual(gameKindEffortPlanOf('audit'))
  })

  it("never lets a relaunch's kind plan replace the lead's own", () => {
    const list = [member({ effortPlan: leadPlan })]
    expect(
      mergeGameMemberSession(
        list,
        { ticket: 'ORCA-1', effortPlan: gameKindEffortPlanOf('implement') },
        'later'
      )
    ).toBe(list)
  })

  it('lets the lead replace a kind plan, and its own, and skips a write that changes nothing', () => {
    const seeded = [member({ effortPlan: gameKindEffortPlanOf('implement') })]
    const written = mergeGameMemberSession(seeded, { ticket: 'ORCA-1', effortPlan: leadPlan }, 'l')
    expect(written[0]?.effortPlan).toEqual(leadPlan)
    expect(
      mergeGameMemberSession(written, { ticket: 'ORCA-1', effortPlan: { ...leadPlan } }, 'l2')
    ).toBe(written)
  })
})
