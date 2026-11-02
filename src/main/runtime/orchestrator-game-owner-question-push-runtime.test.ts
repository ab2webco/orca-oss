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
  return { board: runtime.getGameBoard(), pushes, dismissed }
}

// ORCA-940: the board only fires ownerQuestionSettled; this pins that the runtime turns it into the phone's push and its dismissal.
describe('owner question push to the paired phone, through the runtime', () => {
  it('pushes an asked question once and dismisses that push when it is answered', async () => {
    const { board, pushes, dismissed } = runtimeWithPhone('repo:push-1')

    const { question } = await board.askOwner({
      worktreeId: 'repo-push-1::/w',
      question: 'Ship the arcade in lab.112?',
      options: ['Yes', 'Wait']
    })

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

    expect(dismissed).toHaveBeenCalledTimes(1)
    expect(dismissed).toHaveBeenCalledWith(`game-owner-question:${question.id}`)
    expect(pushes()).toHaveLength(1)
  })

  it('neither pushes nor dismisses again when the same answer is repeated', async () => {
    const { board, pushes, dismissed } = runtimeWithPhone('repo:push-2')
    const { question } = await board.askOwner({ worktreeId: 'w', question: 'Merge #838?' })
    await board.answerOwner({ worktreeId: 'w', id: question.id, text: 'Yes' })

    await board.answerOwner({ worktreeId: 'w', id: question.id, text: 'Yes' })

    expect(pushes()).toHaveLength(1)
    expect(dismissed).toHaveBeenCalledTimes(1)
  })
})
