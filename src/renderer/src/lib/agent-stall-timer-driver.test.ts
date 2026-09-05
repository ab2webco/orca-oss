import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createTestStore } from '../store/slices/store-test-helpers'
import {
  armAgentStallTimer,
  resetAgentStallTimerDriverForTest,
  runDueAgentStallTicks
} from './agent-stall-timer-driver'
import type { WorktreeProgressProbeResult } from '../../../shared/worktree-progress-probe'

type Store = ReturnType<typeof createTestStore>

const REPO_ID = 'repo1'
const WORKTREE_ID = `${REPO_ID}::/repo1/wt`
const TAB_ID = 'tab-1'
const PANE_KEY = `${TAB_ID}:11111111-1111-4111-8111-111111111111`
const MINUTE_MS = 60_000

let store: Store
let progressFingerprint: Mock<(context: unknown) => Promise<unknown>>

vi.mock('../store', () => ({
  get useAppStore() {
    return store
  }
}))

vi.mock('../runtime/runtime-git-client', () => ({
  readRuntimeWorktreeProgressFingerprint: (context: unknown) => progressFingerprint(context)
}))

function seedWorkspace(kind: 'git' | 'folder' = 'git'): void {
  store.setState({
    repos: [
      {
        id: REPO_ID,
        path: '/repo1',
        displayName: 'Repo 1',
        badgeColor: '#000',
        addedAt: 0,
        ...(kind === 'folder' ? { kind: 'folder' as const } : {})
      }
    ],
    tabsByWorktree: { [WORKTREE_ID]: [{ id: TAB_ID, title: 'Terminal', kind: 'terminal' }] }
  } as never)
}

function queueProbes(...results: WorktreeProgressProbeResult[]): void {
  for (const result of results) {
    progressFingerprint.mockResolvedValueOnce(result)
  }
}

const fingerprint = (value: string): WorktreeProgressProbeResult => ({
  kind: 'fingerprint',
  value
})

/** One armed interval: run the poll at the moment the deadline lands. */
async function advanceOneInterval(minutes: number): Promise<void> {
  vi.setSystemTime(new Date(Date.now() + minutes * MINUTE_MS))
  await runDueAgentStallTicks()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-05T10:00:00Z'))
  store = createTestStore()
  resetAgentStallTimerDriverForTest()
  progressFingerprint = vi.fn<(context: unknown) => Promise<unknown>>()
  seedWorkspace()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('agent stall timer driver', () => {
  it('does not escalate while the worktree keeps moving', async () => {
    const markWorktreeUnread = vi.fn()
    store.setState({ markWorktreeUnread } as never)
    queueProbes(fingerprint('base'), fingerprint('a'), fingerprint('b'), fingerprint('c'))

    armAgentStallTimer(PANE_KEY, 15)
    await Promise.resolve()

    for (let i = 0; i < 3; i += 1) {
      await advanceOneInterval(15)
    }

    expect(markWorktreeUnread).not.toHaveBeenCalled()
    expect(store.getState().agentStallTimerByPaneKey[PANE_KEY]?.status).toBe('watching')
  })

  it('escalates exactly once when progress stops, not on every tick', async () => {
    const markWorktreeUnread = vi.fn()
    store.setState({ markWorktreeUnread } as never)
    queueProbes(
      fingerprint('frozen'),
      fingerprint('frozen'),
      fingerprint('frozen'),
      fingerprint('frozen')
    )

    armAgentStallTimer(PANE_KEY, 30)
    await Promise.resolve()

    // The baseline is captured at arming time, so the very first interval can already escalate.
    await advanceOneInterval(30)
    expect(markWorktreeUnread).toHaveBeenCalledTimes(1)

    await advanceOneInterval(30)
    await advanceOneInterval(30)

    expect(markWorktreeUnread).toHaveBeenCalledTimes(1)
    expect(markWorktreeUnread).toHaveBeenCalledWith(WORKTREE_ID)
    expect(store.getState().agentStallTimerByPaneKey[PANE_KEY]?.status).toBe('stalled')
  })

  it('escalates again after progress resumes and stops a second time', async () => {
    const markWorktreeUnread = vi.fn()
    store.setState({ markWorktreeUnread } as never)
    queueProbes(
      fingerprint('a'),
      fingerprint('a'),
      fingerprint('b'),
      fingerprint('b'),
      fingerprint('b')
    )

    armAgentStallTimer(PANE_KEY, 15)
    await Promise.resolve()

    await advanceOneInterval(15)
    await advanceOneInterval(15)
    await advanceOneInterval(15)
    await advanceOneInterval(15)

    expect(markWorktreeUnread).toHaveBeenCalledTimes(2)
  })

  it('does not read the worktree before its interval has elapsed', async () => {
    queueProbes(fingerprint('base'))

    armAgentStallTimer(PANE_KEY, 60)
    await Promise.resolve()
    expect(progressFingerprint).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date(Date.now() + 59 * MINUTE_MS))
    await runDueAgentStallTicks()

    expect(progressFingerprint).toHaveBeenCalledTimes(1)
  })

  it('does not escalate when the reading fails', async () => {
    const markWorktreeUnread = vi.fn()
    store.setState({ markWorktreeUnread } as never)
    queueProbes(fingerprint('base'))
    progressFingerprint.mockRejectedValue(new Error('git timed out'))

    armAgentStallTimer(PANE_KEY, 15)
    await Promise.resolve()

    await advanceOneInterval(15)
    await advanceOneInterval(15)

    expect(markWorktreeUnread).not.toHaveBeenCalled()
    expect(store.getState().agentStallTimerByPaneKey[PANE_KEY]?.status).toBe('unreadable')
  })

  it('a failed reading does not hide a stall that was there all along', async () => {
    const markWorktreeUnread = vi.fn()
    store.setState({ markWorktreeUnread } as never)
    queueProbes(fingerprint('frozen'), { kind: 'unreadable' }, fingerprint('frozen'))

    armAgentStallTimer(PANE_KEY, 15)
    await Promise.resolve()

    await advanceOneInterval(15)
    expect(markWorktreeUnread).not.toHaveBeenCalled()

    await advanceOneInterval(15)
    expect(markWorktreeUnread).toHaveBeenCalledTimes(1)
  })

  it('disarms rather than staying armed when the workspace has no git', async () => {
    queueProbes(fingerprint('base'), { kind: 'unsupported', reason: 'folder-workspace' })

    // Armed against a git repo, then the pane's workspace answers that it has no git.
    armAgentStallTimer(PANE_KEY, 15)
    await Promise.resolve()
    await advanceOneInterval(15)

    expect(store.getState().agentStallTimerByPaneKey[PANE_KEY]).toBeUndefined()
  })

  it('never reads a folder workspace, so arming there stays inert', async () => {
    seedWorkspace('folder')

    armAgentStallTimer(PANE_KEY, 15)
    await Promise.resolve()
    await advanceOneInterval(15)

    expect(progressFingerprint).not.toHaveBeenCalled()
    expect(store.getState().agentStallTimerByPaneKey[PANE_KEY]?.detector.lastFingerprint).toBeNull()
  })

  it('treats an answer with no reading in it as unreadable rather than crashing', async () => {
    const markWorktreeUnread = vi.fn()
    store.setState({ markWorktreeUnread } as never)
    queueProbes(fingerprint('base'))
    progressFingerprint.mockResolvedValue(undefined)

    armAgentStallTimer(PANE_KEY, 15)
    await Promise.resolve()
    await advanceOneInterval(15)

    expect(markWorktreeUnread).not.toHaveBeenCalled()
    expect(store.getState().agentStallTimerByPaneKey[PANE_KEY]?.status).toBe('unreadable')
  })

  it('bounds how many worktrees it reads at once', async () => {
    const tabs = Array.from({ length: 20 }, (_, index) => ({
      id: `tab-${index}`,
      title: 'Terminal',
      kind: 'terminal'
    }))
    store.setState({ tabsByWorktree: { [WORKTREE_ID]: tabs } } as never)
    let inFlight = 0
    let peak = 0
    progressFingerprint.mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return fingerprint('a')
    })
    for (const tab of tabs) {
      armAgentStallTimer(`${tab.id}:11111111-1111-4111-8111-111111111111`, 15)
    }
    await vi.waitFor(() => expect(progressFingerprint).toHaveBeenCalledTimes(20))
    peak = 0

    await advanceOneInterval(15)

    expect(progressFingerprint).toHaveBeenCalledTimes(40)
    expect(peak).toBeLessThanOrEqual(8)
  })

  it('disarms the pane when the timer is turned off', async () => {
    queueProbes(fingerprint('base'), fingerprint('base'))

    armAgentStallTimer(PANE_KEY, 15)
    await Promise.resolve()
    armAgentStallTimer(PANE_KEY, null)

    await advanceOneInterval(15)

    expect(store.getState().agentStallTimerByPaneKey[PANE_KEY]).toBeUndefined()
    expect(progressFingerprint).toHaveBeenCalledTimes(1)
  })
})
