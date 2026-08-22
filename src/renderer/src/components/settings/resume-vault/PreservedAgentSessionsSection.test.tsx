// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { TEST_REPO, makeWorktree } from '@/store/slices/store-test-helpers'
import type { SleepingAgentSessionRecord } from '../../../../../shared/agent-session-resume'
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import { PreservedAgentSessionsSection } from './PreservedAgentSessionsSection'

const confirmMock = vi.fn()

vi.mock('@/components/confirmation-dialog-context', () => ({
  useConfirmationDialog: () => confirmMock
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

function makeRecord(overrides: Partial<SleepingAgentSessionRecord> = {}): SleepingAgentSessionRecord {
  return {
    paneKey: 'tab-1:leaf-1',
    tabId: 'tab-1',
    worktreeId: 'repo1::/tmp/a',
    agent: 'claude',
    providerSession: { key: 'session_id', id: 'sess-1' },
    prompt: 'implement the resume vault',
    terminalTitle: 'claude — resume vault',
    state: 'done',
    interrupted: true,
    capturedAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
    ...overrides
  }
}

function makeAgentStatusEntry(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'working',
    prompt: 'still going',
    updatedAt: Date.now(),
    stateStartedAt: Date.now(),
    paneKey: 'tab-1:leaf-1',
    stateHistory: [],
    ...overrides
  }
}

const initialState = useAppStore.getState()

afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
  confirmMock.mockReset()
})

async function openManageSheet(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /manage/i }))
}

describe('PreservedAgentSessionsSection', () => {
  it('groups preserved records by project and renders identifying detail', async () => {
    const worktreeA = makeWorktree({
      id: 'repo1::/tmp/a',
      repoId: 'repo1',
      path: '/tmp/a',
      displayName: 'feature-a'
    })
    const worktreeB = makeWorktree({
      id: 'repo1::/tmp/b',
      repoId: 'repo1',
      path: '/tmp/b',
      displayName: 'feature-b'
    })
    const recordA = makeRecord({ paneKey: 'tab-a:leaf-1', worktreeId: 'repo1::/tmp/a' })
    const recordB = makeRecord({
      paneKey: 'tab-b:leaf-1',
      worktreeId: 'repo1::/tmp/b',
      agent: 'codex',
      terminalTitle: 'codex — other project',
      providerSession: { key: 'session_id', id: 'sess-2' }
    })
    useAppStore.setState({
      repos: [{ ...TEST_REPO, executionHostId: 'local' }],
      worktreesByRepo: { repo1: [worktreeA, worktreeB] },
      sleepingAgentSessionsByPaneKey: {
        [recordA.paneKey]: recordA,
        [recordB.paneKey]: recordB
      }
    })

    render(<PreservedAgentSessionsSection />)
    await openManageSheet()

    expect(screen.getByText('feature-a')).toBeInTheDocument()
    expect(screen.getByText('feature-b')).toBeInTheDocument()
    expect(screen.getByText('claude — resume vault')).toBeInTheDocument()
    expect(screen.getByText('codex — other project')).toBeInTheDocument()
  })

  it('releasing one record removes exactly that record and leaves the others', async () => {
    const worktree = makeWorktree({ id: 'repo1::/tmp/a', repoId: 'repo1', path: '/tmp/a' })
    const target = makeRecord({ paneKey: 'tab-a:leaf-1', terminalTitle: 'release-me' })
    const sibling = makeRecord({
      paneKey: 'tab-a:leaf-2',
      terminalTitle: 'keep-me',
      providerSession: { key: 'session_id', id: 'sess-2' }
    })
    useAppStore.setState({
      repos: [{ ...TEST_REPO, executionHostId: 'local' }],
      worktreesByRepo: { repo1: [worktree] },
      sleepingAgentSessionsByPaneKey: {
        [target.paneKey]: target,
        [sibling.paneKey]: sibling
      }
    })
    confirmMock.mockResolvedValue(true)

    render(<PreservedAgentSessionsSection />)
    await openManageSheet()

    const targetRow = screen.getByText('release-me').closest('div.rounded-md')
    expect(targetRow).not.toBeNull()
    fireEvent.click(within(targetRow as HTMLElement).getByRole('button', { name: /release/i }))

    await screen.findByText('keep-me')
    expect(screen.queryByText('release-me')).not.toBeInTheDocument()
    const state = useAppStore.getState()
    expect(state.sleepingAgentSessionsByPaneKey[target.paneKey]).toBeUndefined()
    expect(state.sleepingAgentSessionsByPaneKey[sibling.paneKey]).toEqual(sibling)
  })

  it('does not release when the confirmation is declined', async () => {
    const worktree = makeWorktree({ id: 'repo1::/tmp/a', repoId: 'repo1', path: '/tmp/a' })
    const record = makeRecord()
    useAppStore.setState({
      repos: [{ ...TEST_REPO, executionHostId: 'local' }],
      worktreesByRepo: { repo1: [worktree] },
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record }
    })
    confirmMock.mockResolvedValue(false)

    render(<PreservedAgentSessionsSection />)
    await openManageSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))

    await Promise.resolve()
    expect(useAppStore.getState().sleepingAgentSessionsByPaneKey[record.paneKey]).toEqual(record)
  })

  it('never renders a release control for a currently-working agent', async () => {
    const worktree = makeWorktree({ id: 'repo1::/tmp/a', repoId: 'repo1', path: '/tmp/a' })
    const record = makeRecord({ terminalTitle: 'busy-agent' })
    useAppStore.setState({
      repos: [{ ...TEST_REPO, executionHostId: 'local' }],
      worktreesByRepo: { repo1: [worktree] },
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record },
      agentStatusByPaneKey: { [record.paneKey]: makeAgentStatusEntry({ state: 'working' }) }
    })

    render(<PreservedAgentSessionsSection />)
    await openManageSheet()

    const row = screen.getByText('busy-agent').closest('div.rounded-md') as HTMLElement
    expect(within(row).queryByRole('button', { name: /^release$/i })).not.toBeInTheDocument()
    expect(within(row).getByText('Working')).toBeInTheDocument()

    // Guarded at the release layer too, not just hidden in the UI.
    const { releaseResumeVaultRecord } = await import('@/lib/release-resume-vault-record')
    const outcome = releaseResumeVaultRecord({
      paneKey: record.paneKey,
      agent: record.agent,
      providerSession: record.providerSession
    })
    expect(outcome).toEqual({ released: false, reason: 'currently-working' })
  })

  it('releasing a record does not call any main-process API, so the transcript is untouched', async () => {
    const worktree = makeWorktree({ id: 'repo1::/tmp/a', repoId: 'repo1', path: '/tmp/a' })
    const record = makeRecord({
      terminalTitle: 'release-me',
      providerSession: {
        key: 'session_id',
        id: 'sess-1',
        transcriptPath: '/home/user/.claude/projects/repo1/sess-1.jsonl'
      }
    })
    useAppStore.setState({
      repos: [{ ...TEST_REPO, executionHostId: 'local' }],
      worktreesByRepo: { repo1: [worktree] },
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record }
    })
    confirmMock.mockResolvedValue(true)

    const apiSpy = vi.fn()
    const api = new Proxy(
      {},
      {
        get: (_target, prop) => {
          apiSpy(prop)
          return new Proxy(() => {}, { apply: () => apiSpy(prop) })
        }
      }
    )
    const previousApi = window.api
    window.api = api as typeof window.api

    render(<PreservedAgentSessionsSection />)
    await openManageSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))

    await screen.findByText(/no preserved resume records/i)
    expect(apiSpy).not.toHaveBeenCalled()
    window.api = previousApi
  })
})
