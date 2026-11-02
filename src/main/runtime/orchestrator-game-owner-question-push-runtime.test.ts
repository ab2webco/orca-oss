import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => userData.dir) }
}))

import { OrcaRuntimeService } from './orca-runtime'

userData.dir = mkdtempSync(join(tmpdir(), 'orca-owner-question-push-'))
afterAll(() => rmSync(userData.dir, { recursive: true, force: true }))

// Why the cast: the project lookup is private, and a real one needs a scanned repo.
type Internals = {
  gameBoardProjectOf: () => Promise<{
    key: string
    isMember: boolean
    memberTicket: string | null
    lead: null
  }>
}

function runtimeWithPhone(projectKey: string) {
  const runtime = new OrcaRuntimeService(null)
  vi.spyOn(runtime as unknown as Internals, 'gameBoardProjectOf').mockResolvedValue({
    key: projectKey,
    isMember: false,
    memberTicket: null,
    lead: null
  })
  const dispatched = vi.spyOn(runtime, 'dispatchMobileNotification')
  const dismissed = vi.spyOn(runtime, 'dismissMobileNotification')
  // Why filter: a dismissal also goes out through dispatchMobileNotification, as a `dismiss` event.
  const pushes = () => dispatched.mock.calls.filter(([event]) => event.type === 'notification')
  // Why: the push waits on the lead lookup, and the dismiss queues behind it.
  const settled = () =>
    (runtime as unknown as { ownerQuestionPushes: Promise<void> }).ownerQuestionPushes
  return { runtime, board: runtime.getGameBoard(), pushes, dismissed, dispatched, settled }
}

// ORCA-940: the board only fires ownerQuestionSettled; this pins that the runtime turns it into the phone's push and its dismissal.
describe('owner question push to the paired phone, through the runtime', () => {
  it('pushes an asked question once and dismisses that push when it is answered', async () => {
    const { board, pushes, dismissed, settled } = runtimeWithPhone('repo:push-1')

    const { question } = await board.askOwner({
      worktreeId: 'repo-push-1::/w',
      question: 'Ship the arcade in lab.112?',
      options: ['Yes', 'Wait']
    })
    await settled()

    expect(pushes()).toEqual([
      [
        {
          type: 'notification',
          source: 'game-owner-question',
          title: 'The lead asks you',
          body: 'Ship the arcade in lab.112?',
          notificationId: `game-owner-question:${question.id}`
        }
      ]
    ])
    expect(dismissed).not.toHaveBeenCalled()

    await board.answerOwner({ worktreeId: 'repo-push-1::/w', id: question.id, option: 1 })
    await settled()

    expect(dismissed).toHaveBeenCalledTimes(1)
    expect(dismissed).toHaveBeenCalledWith(`game-owner-question:${question.id}`)
    expect(pushes()).toHaveLength(1)
  })

  it('neither pushes nor dismisses again when the same answer is repeated', async () => {
    const { board, pushes, dismissed, settled } = runtimeWithPhone('repo:push-2')
    const { question } = await board.askOwner({ worktreeId: 'w', question: 'Merge #838?' })
    await board.answerOwner({ worktreeId: 'w', id: question.id, text: 'Yes' })

    await board.answerOwner({ worktreeId: 'w', id: question.id, text: 'Yes' })
    await settled()

    expect(pushes()).toHaveLength(1)
    expect(dismissed).toHaveBeenCalledTimes(1)
  })

  it("names the live lead's terminal, and dismisses only after the push it answers", async () => {
    const { runtime, board, dispatched, settled } = runtimeWithPhone('repo:push-3')
    type Lead = { worktreeId: string; terminal: string } | null
    const internals = runtime as unknown as {
      gameOwnerQuestionLeadTerminal: (projectKey: string) => Promise<Lead>
    }
    let release: (lead: Lead) => void = () => {}
    const lookup = vi
      .spyOn(internals, 'gameOwnerQuestionLeadTerminal')
      .mockReturnValue(new Promise((done) => (release = done)))

    const { question } = await board.askOwner({ worktreeId: 'w', question: 'Tag lab.113?' })
    await board.answerOwner({ worktreeId: 'w', id: question.id, text: 'Yes' })
    release({ worktreeId: 'repo-push-3::/lead', terminal: 'term_lead' })
    await settled()

    expect(lookup).toHaveBeenCalledWith('repo:push-3')
    expect(dispatched.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({
        type: 'notification',
        worktreeId: 'repo-push-3::/lead',
        terminal: 'term_lead'
      }),
      { type: 'dismiss', notificationId: `game-owner-question:${question.id}` }
    ])
  })

  it('keeps pushing after one push throws', async () => {
    const { board, dispatched, pushes, settled } = runtimeWithPhone('repo:push-4')
    dispatched.mockImplementationOnce(() => {
      throw new Error('relay_down')
    })

    await board.askOwner({ worktreeId: 'w', question: 'First?' })
    await settled()
    await board.askOwner({ worktreeId: 'w', question: 'Second?' })
    await settled()

    expect(pushes().map(([event]) => event.type === 'notification' && event.body)).toEqual([
      'First?',
      'Second?'
    ])
  })

  it("places the lead by its live handle's worktree, and gives up quietly when it cannot", async () => {
    const runtime = new OrcaRuntimeService(null)
    const internals = runtime as unknown as {
      gameLeads: { liveLeadOf: (key: string) => Promise<string | null> }
      gameOwnerQuestionLeadTerminal: (
        key: string
      ) => Promise<{ worktreeId: string; terminal: string } | null>
    }
    vi.spyOn(internals.gameLeads, 'liveLeadOf').mockResolvedValue('term_lead')
    const show = vi.spyOn(runtime, 'showTerminal').mockResolvedValue({
      worktreeId: 'repo::/lead'
    } as Awaited<ReturnType<typeof runtime.showTerminal>>)

    await expect(internals.gameOwnerQuestionLeadTerminal('repo:x')).resolves.toEqual({
      worktreeId: 'repo::/lead',
      terminal: 'term_lead'
    })
    show.mockRejectedValue(new Error('terminal_gone'))
    await expect(internals.gameOwnerQuestionLeadTerminal('repo:x')).resolves.toBeNull()
  })
})
