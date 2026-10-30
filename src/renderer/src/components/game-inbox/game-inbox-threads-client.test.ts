import { afterEach, describe, expect, it, vi } from 'vitest'
import { readGameInboxThreads, replyToGameMember } from './game-inbox-threads-client'

const MESSAGE = {
  id: 'msg_1',
  at: '2026-10-29T10:00:00Z',
  from: 'ORCA-1',
  to: 'lead',
  kind: 'question',
  subject: 'Question',
  body: 'Which port?',
  failure: null
}
const WAITING = {
  id: 'msg_1',
  ticket: 'ORCA-1',
  kind: 'question',
  subject: 'Question',
  body: 'Which port?',
  at: '2026-10-29T10:00:00Z',
  answerer: 'lead'
}

function stubRuntime(result: unknown) {
  const call = vi.fn(async (_args: { method: string; params?: unknown }) => ({
    id: 'r1',
    ok: true,
    result,
    _meta: { runtimeId: 'rt' }
  }))
  vi.stubGlobal('window', { api: { runtime: { call } } })
  return call
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readGameInboxThreads', () => {
  it("reads the worktree's project threads and drops what another build sent malformed", async () => {
    const call = stubRuntime({
      threads: [
        { ticket: 'ORCA-1', messages: [MESSAGE, { id: 7 }], last: MESSAGE.at, waiting: 1 },
        { ticket: 3 }
      ],
      waiting: [WAITING, { ...WAITING, kind: 'shout' }],
      answered: 'nope'
    })

    const read = await readGameInboxThreads({ target: { kind: 'local' }, worktreeId: 'repo::wt' })

    expect(read).toEqual({
      threads: [{ ticket: 'ORCA-1', messages: [MESSAGE], last: MESSAGE.at, waiting: 1 }],
      waiting: [WAITING],
      answered: []
    })
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'game.inboxThreads', params: { worktreeId: 'repo::wt' } })
    )
  })
})

describe('replyToGameMember (ORCA-878)', () => {
  it("sends the person's words for a member's message, with its ticket", async () => {
    const call = stubRuntime({ mode: 'override', delivered: true })

    await expect(
      replyToGameMember(
        { target: { kind: 'local' }, worktreeId: 'repo::wt' },
        {
          id: 'msg_1',
          text: 'Yes',
          ticket: 'ORCA-14'
        }
      )
    ).resolves.toEqual({ mode: 'override', delivered: true })
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'game.ownerReplyToMember',
        params: { worktreeId: 'repo::wt', id: 'msg_1', text: 'Yes', ticket: 'ORCA-14' }
      })
    )
  })
})
