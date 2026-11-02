// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { SidebarGameInboxEntry } from './SidebarGameInboxEntry'
import { useGameInboxAppState } from './game-inbox-app-state'

const question = (id: string, text: string) => ({
  id,
  ticket: 'ORCA-12',
  question: text,
  options: ['Yes'],
  context: null,
  askedAt: '2026-10-29T10:00:00.000Z',
  answer: null
})

let open: ReturnType<typeof question>[] = []
const answerRuntime = async (args: { method: string; params?: unknown }) => ({
  id: 'r',
  ok: true,
  result: args.method === 'game.ownerQuestions' ? { questions: open } : {},
  _meta: { runtimeId: 'rt' }
})
const call = vi.fn(answerRuntime)

beforeEach(() => {
  open = []
  call.mockClear()
  // Why: a test that swaps the runtime's answers must not leak them into the next.
  call.mockImplementation(answerRuntime)
  useAppStore.setState({ activeWorktreeId: 'repo::wt', activeWorkspaceExecutionHostId: null })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { runtime: { call }, shell: { openUrl: vi.fn() } }
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useGameInboxAppState.setState({ hosts: [], open: false })
  Reflect.deleteProperty(window, 'api')
})

describe('SidebarGameInboxEntry', () => {
  it('stays out of the sidebar while nothing waits for the person', async () => {
    const view = render(<SidebarGameInboxEntry />)
    await waitFor(() => expect(call).toHaveBeenCalled())

    expect(view.queryByRole('button', { name: /Inbox/ })).toBeNull()
  })

  it('counts the open questions and lists them under For you when opened', async () => {
    open = [question('oq_1', 'Ship it?'), question('oq_2', 'Which account?')]
    const view = render(<SidebarGameInboxEntry />)

    const entry = await view.findByRole('button', { name: /Inbox/ })
    expect(entry.textContent).toContain('2')
    expect(call).toHaveBeenCalledWith({
      method: 'game.ownerQuestions',
      params: { worktreeId: 'repo::wt' }
    })
    act(() => fireEvent.click(entry))

    expect(await view.findByText('For you')).toBeTruthy()
    expect(view.getByText('Ship it?')).toBeTruthy()
    expect(view.getByText('Which account?')).toBeTruthy()
  })
})

describe('SidebarGameInboxEntry with a team (ORCA-878)', () => {
  it('shows the entry without a count when members talk but nothing waits for the person', async () => {
    call.mockImplementation(async (args: { method: string; params?: unknown }) => ({
      id: 'r',
      ok: true,
      result:
        args.method === 'game.inboxThreads'
          ? {
              threads: [
                { ticket: 'ORCA-12', messages: [], last: '2026-10-29T10:00:00Z', waiting: 1 }
              ],
              waiting: [],
              answered: []
            }
          : { questions: [] },
      _meta: { runtimeId: 'rt' }
    }))
    const view = render(<SidebarGameInboxEntry />)

    const entry = await view.findByRole('button', { name: /Inbox/ })
    expect(entry.textContent).toBe('Inbox')
  })
})

describe('SidebarGameInboxEntry across projects (ORCA-940)', () => {
  it("counts another project's questions and lists them under its name", async () => {
    open = [question('oq_1', 'Ship it?')]
    useGameInboxAppState.setState({
      hosts: [
        {
          environmentId: null,
          status: 'ok',
          projects: [
            { repoId: 'repo', repoName: 'active', worktreeId: 'repo::wt', questions: [open[0]] },
            {
              repoId: 'other',
              repoName: 'billing-api',
              worktreeId: 'other::/w',
              questions: [question('oq_9', 'Rotate the key?')]
            }
          ]
        }
      ]
    })
    const view = render(<SidebarGameInboxEntry />)

    const entry = await view.findByRole('button', { name: /Inbox/ })
    await waitFor(() => expect(entry.textContent).toContain('2'))
    act(() => fireEvent.click(entry))

    expect(await view.findByText('Ship it?')).toBeTruthy()
    expect(view.getByText('billing-api')).toBeTruthy()
    expect(view.getByText('Rotate the key?')).toBeTruthy()
  })
})
