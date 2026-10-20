import { describe, expect, it } from 'vitest'
import {
  GAME_MEMBER_SESSIONS_MAX,
  GAME_MEMBER_SESSIONS_VERSION,
  mergeGameMemberSession,
  parseGameMemberSessionsFile,
  pausedMembersOf,
  serializeGameMemberSessions,
  type GameMemberSession
} from './orchestrator-game-member-sessions'

const member = (ticket: string, extra: Partial<GameMemberSession> = {}): GameMemberSession => ({
  ticket,
  name: null,
  runId: 'run_1',
  taskId: `task_${ticket}`,
  dispatchId: null,
  worktreeId: null,
  branch: null,
  agent: 'claude',
  accountId: null,
  account: null,
  sessionId: null,
  lastState: null,
  launchedAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  ...extra
})

describe('parseGameMemberSessionsFile', () => {
  it('round-trips what it serializes', () => {
    const members = [member('ORCA-1', { sessionId: 'abc', worktreeId: 'repo::/w/orca-1' })]
    expect(parseGameMemberSessionsFile(serializeGameMemberSessions(members))).toEqual({
      ok: true,
      members
    })
  })

  it('refuses a file that is not JSON, naming why', () => {
    expect(parseGameMemberSessionsFile('{"version":1,')).toEqual({
      ok: false,
      reason: 'the saved members file is damaged (not JSON)'
    })
  })

  it('refuses a file from a newer Orca instead of reading it as empty', () => {
    const text = JSON.stringify({ version: GAME_MEMBER_SESSIONS_VERSION + 1, members: [] })
    expect(parseGameMemberSessionsFile(text)).toEqual({
      ok: false,
      reason: `the saved members file is from a newer Orca (version ${GAME_MEMBER_SESSIONS_VERSION + 1})`
    })
  })

  it('refuses a file without a version', () => {
    expect(parseGameMemberSessionsFile(JSON.stringify({ members: [] }))).toEqual({
      ok: false,
      reason: 'the saved members file has no version'
    })
  })

  it('refuses the whole file when one member is malformed, so a write never drops it', () => {
    const text = JSON.stringify({
      version: GAME_MEMBER_SESSIONS_VERSION,
      members: [member('ORCA-1'), { ticket: 'ORCA-2', taskId: 7 }]
    })
    expect(parseGameMemberSessionsFile(text)).toEqual({
      ok: false,
      reason: 'the saved members file has a malformed member (entry 2)'
    })
  })
})

describe('mergeGameMemberSession', () => {
  it('adds a member and keeps its launch time when later patches arrive', () => {
    const first = mergeGameMemberSession([], member('ORCA-1'), '2026-10-20T10:00:00.000Z')
    const next = mergeGameMemberSession(
      first,
      { ticket: 'orca-1', sessionId: 'abc', launchedAt: '2026-10-20T12:00:00.000Z' },
      '2026-10-20T11:00:00.000Z'
    )
    expect(next).toEqual([
      member('ORCA-1', { sessionId: 'abc', updatedAt: '2026-10-20T11:00:00.000Z' })
    ])
  })

  it('returns the same list when a patch changes nothing', () => {
    const list = [member('ORCA-1', { sessionId: 'abc' })]
    expect(mergeGameMemberSession(list, { ticket: 'ORCA-1', sessionId: 'abc' }, 'later')).toBe(list)
  })

  it('needs a task and a run to add a member it does not hold yet', () => {
    expect(mergeGameMemberSession([], { ticket: 'ORCA-1', sessionId: 'abc' }, 'now')).toEqual([])
  })

  it('keeps the newest members past the bound', () => {
    let list: GameMemberSession[] = []
    for (let i = 0; i <= GAME_MEMBER_SESSIONS_MAX; i++) {
      list = mergeGameMemberSession(list, member(`ORCA-${i}`), 'now')
    }
    expect(list).toHaveLength(GAME_MEMBER_SESSIONS_MAX)
    expect(list[0]?.ticket).toBe('ORCA-1')
  })
})

describe('pausedMembersOf', () => {
  it('lists saved members not live now, skipping the finished ones', () => {
    const members = [
      member('ORCA-1', { sessionId: 'abc', worktreeId: 'wt-1', lastState: 'working' }),
      member('ORCA-2', { lastState: 'idle' }),
      member('ORCA-3', { lastState: 'finished' }),
      member('ORCA-4', { lastState: 'working' }),
      member('ORCA-5', { worktreeId: 'wt-5', lastState: 'working' })
    ]
    const live = { tickets: new Set(['ORCA-4']), worktreeIds: new Set(['wt-5']) }
    expect(pausedMembersOf(members, live)).toEqual([
      {
        ticket: 'ORCA-1',
        name: null,
        agent: 'claude',
        account: null,
        branch: null,
        lastState: 'working',
        resumable: true,
        since: '2026-10-20T10:00:00.000Z'
      },
      expect.objectContaining({ ticket: 'ORCA-2', resumable: false })
    ])
  })
})

describe('mergeGameMemberSession clipping', () => {
  it('clips a long field so the saved file stays readable', () => {
    const list = mergeGameMemberSession([], { ...member('ORCA-1'), name: 'x'.repeat(500) }, 'now')
    expect(list[0]?.name).toHaveLength(200)
    expect(parseGameMemberSessionsFile(serializeGameMemberSessions(list)).ok).toBe(true)
  })
})
