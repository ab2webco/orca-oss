// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { SidebarGameInboxEntry } from './SidebarGameInboxEntry'

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
const call = vi.fn(async (args: { method: string; params?: unknown }) => ({
  id: 'r',
  ok: true,
  result: args.method === 'game.ownerQuestions' ? { questions: open } : {},
  _meta: { runtimeId: 'rt' }
}))

beforeEach(() => {
  open = []
  call.mockClear()
  useAppStore.setState({ activeWorktreeId: 'repo::wt', activeWorkspaceExecutionHostId: null })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { runtime: { call }, shell: { openUrl: vi.fn() } }
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState(useAppStore.getInitialState(), true)
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
