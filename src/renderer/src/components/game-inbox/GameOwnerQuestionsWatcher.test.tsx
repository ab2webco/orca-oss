// @vitest-environment happy-dom

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { useGameInboxAppState } from './game-inbox-app-state'
import { useTeamPanelTabStore } from '@/components/team-panel/team-panel-tab-store'
import { GameOwnerQuestionsWatcher } from './GameOwnerQuestionsWatcher'

const question = (id: string) => ({
  id,
  ticket: 'ORCA-12',
  question: `Question ${id}?`,
  options: [],
  context: null,
  askedAt: '2026-11-01T10:00:00.000Z',
  answer: null
})

let projects: { repoId: string; repoName: string; worktreeId: string; questions: unknown[] }[] = []
let pushChange: (() => void) | null = null
let openInbox:
  | ((target: { environmentId: string | null; worktreeId: string | null }) => void)
  | null = null
const call = vi.fn(async (args: { method: string }) => ({
  id: 'r',
  ok: true,
  result: args.method === 'game.ownerQuestionsAll' ? { projects } : {},
  _meta: { runtimeId: 'rt' }
}))
const dispatch = vi.fn(async () => ({ delivered: true }))
const setBadgeCount = vi.fn(async () => undefined)

beforeEach(() => {
  projects = []
  call.mockClear()
  dispatch.mockClear()
  setBadgeCount.mockClear()
  useAppStore.setState({ activeWorktreeId: 'active::/w', activeWorkspaceExecutionHostId: null })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      runtime: {
        call,
        onGameOwnerQuestionsChanged: (callback: () => void) => {
          pushChange = callback
          return () => {
            pushChange = null
          }
        }
      },
      notifications: {
        dispatch,
        setBadgeCount,
        onOpenGameInbox: (callback: typeof openInbox) => {
          openInbox = callback
          return () => {
            openInbox = null
          }
        }
      }
    }
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useGameInboxAppState.setState({ hosts: [] })
  useTeamPanelTabStore.setState({ selected: null })
  Reflect.deleteProperty(window, 'api')
})

describe('GameOwnerQuestionsWatcher', () => {
  it('counts questions already open on the dock without announcing them', async () => {
    projects = [
      { repoId: 'r1', repoName: 'orca', worktreeId: 'r1::/w', questions: [question('oq_1')] }
    ]
    render(<GameOwnerQuestionsWatcher />)

    await waitFor(() => expect(setBadgeCount).toHaveBeenLastCalledWith(1))
    expect(dispatch).not.toHaveBeenCalled()
  })

  // Why the Team panel: the Inbox tab replaced the sidebar entry and its Sheet (ORCA-1072).
  it('announces a question asked in another project and opens its Inbox on click', async () => {
    render(<GameOwnerQuestionsWatcher />)
    await waitFor(() => expect(setBadgeCount).toHaveBeenLastCalledWith(0))

    projects = [
      { repoId: 'r1', repoName: 'orca', worktreeId: 'r1::/w', questions: [question('oq_2')] }
    ]
    pushChange?.()

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        source: 'game-owner-question',
        notificationId: 'game-owner-question:oq_2',
        repoLabel: 'orca',
        ownerQuestion: 'Question oq_2?',
        isActiveWorktree: false,
        gameInbox: { environmentId: null, worktreeId: 'r1::/w' }
      })
    )
    expect(setBadgeCount).toHaveBeenLastCalledWith(1)

    useAppStore.setState({ rightSidebarOpen: false, rightSidebarTab: 'explorer' })
    openInbox?.({ environmentId: null, worktreeId: 'r1::/w' })

    expect(useAppStore.getState().rightSidebarOpen).toBe(true)
    expect(useAppStore.getState().rightSidebarTab).toBe('team')
    expect(useTeamPanelTabStore.getState().selected).toBe('inbox')
  })

  // Why: full-page views suppress the right sidebar, and the Sheet used to open over them.
  it('leaves a full-page view for the Inbox when the question has no workspace to open', async () => {
    render(<GameOwnerQuestionsWatcher />)
    await waitFor(() => expect(setBadgeCount).toHaveBeenLastCalledWith(0))

    useAppStore.setState({ activeView: 'settings', rightSidebarOpen: false })
    openInbox?.({ environmentId: null, worktreeId: null })

    expect(useAppStore.getState().activeView).toBe('terminal')
    expect(useAppStore.getState().rightSidebarOpen).toBe(true)
    expect(useTeamPanelTabStore.getState().selected).toBe('inbox')
  })
})
