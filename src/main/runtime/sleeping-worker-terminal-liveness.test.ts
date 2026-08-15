import { describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { SleepingAgentSessionRecord } from '../../shared/agent-session-resume'
import type { WorkspaceSessionState } from '../../shared/types'
import { OrcaRuntimeService } from './orca-runtime'

// Why: a hibernated worker keeps its pane and its resume record but loses its
// PTY. `terminal.list` used to answer that state with silence (no row) or with
// an undifferentiated `connected: false`, and a coordinator reading either one
// dispatches a second agent onto a branch that already has a live worker.

const REPO_ID = 'repo'
const WORKTREE_PATH = '/worktree'
const WORKTREE_ID = `${REPO_ID}::${WORKTREE_PATH}`
const WORKTREE_SELECTOR = `id:${WORKTREE_ID}`

const WORKER_TAB_ID = 'worker-tab'
const WORKER_LEAF_ID = '11111111-1111-4111-8111-111111111111'
const WORKER_PANE_KEY = `${WORKER_TAB_ID}:${WORKER_LEAF_ID}`
const SHELL_TAB_ID = 'shell-tab'
const SHELL_LEAF_ID = '22222222-2222-4222-8222-222222222222'
const STRANDED_TAB_ID = 'stranded-tab'
const STRANDED_LEAF_ID = '33333333-3333-4333-8333-333333333333'

const LIVE_REPO = {
  id: REPO_ID,
  path: WORKTREE_PATH,
  displayName: 'repo',
  badgeColor: 'blue',
  addedAt: 1
} as const

function sleepingRecord(
  overrides: Partial<SleepingAgentSessionRecord> = {}
): SleepingAgentSessionRecord {
  return {
    paneKey: WORKER_PANE_KEY,
    tabId: WORKER_TAB_ID,
    worktreeId: WORKTREE_ID,
    agent: 'claude',
    providerSession: { key: 'session_id', id: 'worker-session' },
    prompt: 'implement ORCA-186',
    state: 'working',
    capturedAt: 10,
    updatedAt: 20,
    terminalTitle: 'Worker',
    lastAssistantMessage: 'ran the migration',
    origin: 'worktree-sleep',
    ...overrides
  }
}

const WORKTREE_META = {
  displayName: 'worktree',
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0
} as const

function makeRuntime(
  sleeping:
    | Record<string, SleepingAgentSessionRecord>
    | (() => Record<string, SleepingAgentSessionRecord>)
): OrcaRuntimeService {
  const read = typeof sleeping === 'function' ? sleeping : () => sleeping
  const session: WorkspaceSessionState = {
    ...getDefaultWorkspaceSession(),
    get sleepingAgentSessionsByPaneKey() {
      return read()
    }
  }
  return new OrcaRuntimeService({
    getRepos: () => [LIVE_REPO],
    getRepo: (id: string) => (id === REPO_ID ? LIVE_REPO : undefined),
    getAllWorktreeMeta: () => ({ [WORKTREE_ID]: WORKTREE_META }),
    getWorktreeMeta: (worktreeId: string) =>
      worktreeId === WORKTREE_ID ? WORKTREE_META : undefined,
    getWorkspaceSession: () => session,
    setWorkspaceSession: vi.fn(),
    flushOrThrow: vi.fn()
  } as never)
}

/** Same shape as makeRuntime, but with a session the runtime can write back to,
 *  so a test can observe the resume record a close is supposed to retire. */
function makeWritableRuntime(sleeping: Record<string, SleepingAgentSessionRecord>): {
  runtime: OrcaRuntimeService
  getSleeping: () => Record<string, SleepingAgentSessionRecord>
  closeTerminalNotification: ReturnType<typeof vi.fn>
} {
  let session: WorkspaceSessionState = {
    ...getDefaultWorkspaceSession(),
    sleepingAgentSessionsByPaneKey: sleeping
  }
  const runtime = new OrcaRuntimeService({
    getRepos: () => [LIVE_REPO],
    getRepo: (id: string) => (id === REPO_ID ? LIVE_REPO : undefined),
    getAllWorktreeMeta: () => ({ [WORKTREE_ID]: WORKTREE_META }),
    getWorktreeMeta: (worktreeId: string) =>
      worktreeId === WORKTREE_ID ? WORKTREE_META : undefined,
    getWorkspaceSession: () => session,
    setWorkspaceSession: (next: WorkspaceSessionState) => {
      session = next
    },
    flushOrThrow: vi.fn()
  } as never)
  const closeTerminalNotification = vi.fn()
  runtime.setNotifier({ closeTerminal: closeTerminalNotification } as never)
  return {
    runtime,
    getSleeping: () => session.sleepingAgentSessionsByPaneKey ?? {},
    closeTerminalNotification
  }
}

/** Worker pane asleep (no PTY) next to a live shell pane in the same worktree —
 *  the shape a coordinator polls while a worker is mid-task. */
function syncWorkerAsleepBesideLiveShell(runtime: OrcaRuntimeService): void {
  runtime.attachWindow(1)
  runtime.registerPty('pty-shell', WORKTREE_ID)
  runtime.syncWindowGraph(1, {
    tabs: [
      {
        tabId: WORKER_TAB_ID,
        worktreeId: WORKTREE_ID,
        title: 'Worker',
        activeLeafId: WORKER_LEAF_ID,
        layout: null
      },
      {
        tabId: SHELL_TAB_ID,
        worktreeId: WORKTREE_ID,
        title: 'Shell',
        activeLeafId: SHELL_LEAF_ID,
        layout: null
      }
    ],
    leaves: [
      {
        tabId: WORKER_TAB_ID,
        worktreeId: WORKTREE_ID,
        leafId: WORKER_LEAF_ID,
        paneRuntimeId: 1,
        ptyId: null
      },
      {
        tabId: SHELL_TAB_ID,
        worktreeId: WORKTREE_ID,
        leafId: SHELL_LEAF_ID,
        paneRuntimeId: 1,
        ptyId: 'pty-shell'
      }
    ]
  })
}

describe('terminal.list liveness for sleeping workers', () => {
  it('lists the sleeping worker pane that a live sibling PTY used to hide', async () => {
    const runtime = makeRuntime({ [WORKER_PANE_KEY]: sleepingRecord() })
    syncWorkerAsleepBesideLiveShell(runtime)

    const { terminals } = await runtime.listTerminals(WORKTREE_SELECTOR)
    const worker = terminals.find((terminal) => terminal.leafId === WORKER_LEAF_ID)

    expect(worker).toBeDefined()
    expect(worker).toMatchObject({
      liveness: 'sleeping',
      connected: false,
      writable: false,
      ptyId: null,
      sleepingAgent: {
        agent: 'claude',
        paneKey: WORKER_PANE_KEY,
        stateAtSleep: 'working',
        capturedAt: 10
      }
    })
    expect(terminals.find((terminal) => terminal.leafId === SHELL_LEAF_ID)).toMatchObject({
      liveness: 'running',
      connected: true
    })
  })

  it('reports an exited pane gone while an unrelated sibling remains live', async () => {
    const runtime = makeRuntime({})
    syncWorkerAsleepBesideLiveShell(runtime)
    runtime['leaves'].get(`${WORKER_TAB_ID}::${WORKER_LEAF_ID}`)!.lastExitCode = 7

    const { terminals } = await runtime.listTerminals(WORKTREE_SELECTOR)
    const worker = terminals.find((terminal) => terminal.leafId === WORKER_LEAF_ID)

    expect(worker).toMatchObject({
      liveness: 'gone',
      connected: false,
      writable: false,
      ptyId: null
    })
  })

  it('waits on observable binding state until a starting pane becomes writable', async () => {
    const runtime = makeRuntime({})
    syncWorkerAsleepBesideLiveShell(runtime)
    const ptyId = 'ssh:ssh-1@@pty-worker'
    runtime.registerPty(ptyId, WORKTREE_ID, 'ssh-1', {
      tabId: WORKER_TAB_ID,
      leafId: WORKER_LEAF_ID
    })
    runtime.onPtyExit(ptyId, -1)
    const worker = (await runtime.listTerminals(WORKTREE_SELECTOR)).terminals.find(
      (terminal) => terminal.leafId === WORKER_LEAF_ID
    )!

    const waiting = runtime.waitForTerminal(worker.handle, {
      condition: 'writable',
      timeoutMs: 1_000
    })
    runtime.onPtySpawned(ptyId)
    runtime.registerPty('pty-worker', WORKTREE_ID)
    runtime.syncWindowGraph(1, {
      tabs: [
        {
          tabId: WORKER_TAB_ID,
          worktreeId: WORKTREE_ID,
          title: 'Worker',
          activeLeafId: WORKER_LEAF_ID,
          layout: null
        }
      ],
      leaves: [
        {
          tabId: WORKER_TAB_ID,
          worktreeId: WORKTREE_ID,
          leafId: WORKER_LEAF_ID,
          paneRuntimeId: 1,
          ptyId: 'pty-worker'
        }
      ]
    })

    await expect(waiting).resolves.toMatchObject({
      handle: worker.handle,
      condition: 'writable',
      satisfied: true,
      status: 'running'
    })
  })

  it('expires abnormal SSH starting state after the recovery grace', async () => {
    vi.useFakeTimers()
    const runtime = makeRuntime({})
    syncWorkerAsleepBesideLiveShell(runtime)
    const ptyId = 'ssh:ssh-1@@pty-worker-expiring'
    runtime.registerPty(ptyId, WORKTREE_ID, 'ssh-1', {
      tabId: WORKER_TAB_ID,
      leafId: WORKER_LEAF_ID
    })
    runtime.onPtyExit(ptyId, -1)
    const worker = (await runtime.listTerminals(WORKTREE_SELECTOR)).terminals.find(
      (terminal) => terminal.leafId === WORKER_LEAF_ID
    )!

    const waiting = runtime.waitForTerminal(worker.handle, {
      condition: 'writable',
      timeoutMs: 60_000
    })
    await vi.advanceTimersByTimeAsync(30_001)

    expect(
      (await runtime.listTerminals(WORKTREE_SELECTOR)).terminals.find(
        (terminal) => terminal.leafId === WORKER_LEAF_ID
      )?.liveness
    ).toBe('gone')
    await expect(waiting).resolves.toMatchObject({
      handle: worker.handle,
      condition: 'writable',
      satisfied: false
    })
    vi.useRealTimers()
  })

  it('drains a pending writable wait when controller inventory proves its exact PTY gone', async () => {
    const runtime = makeRuntime({})
    syncWorkerAsleepBesideLiveShell(runtime)
    const worker = (await runtime.listTerminals(WORKTREE_SELECTOR)).terminals.find(
      (terminal) => terminal.leafId === WORKER_LEAF_ID
    )!
    runtime.registerPty('pty-worker-missing', WORKTREE_ID, null, {
      tabId: WORKER_TAB_ID,
      leafId: WORKER_LEAF_ID
    })
    runtime.setPtyController({
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null,
      listProcesses: async () => [
        { id: 'pty-shell', worktreeId: WORKTREE_ID, cwd: '/repo', title: 'Shell' }
      ]
    })
    const waiting = runtime.waitForTerminal(worker.handle, {
      condition: 'writable',
      timeoutMs: 1_000
    })

    await runtime.listTerminals(WORKTREE_SELECTOR)

    await expect(waiting).resolves.toMatchObject({ condition: 'writable', satisfied: false })
  })

  it('resolves writable immediately for a connected terminal', async () => {
    const runtime = makeRuntime({})
    syncWorkerAsleepBesideLiveShell(runtime)
    const shell = (await runtime.listTerminals(WORKTREE_SELECTOR)).terminals.find(
      (terminal) => terminal.leafId === SHELL_LEAF_ID
    )!

    await expect(
      runtime.waitForTerminal(shell.handle, { condition: 'writable', timeoutMs: 1_000 })
    ).resolves.toMatchObject({
      handle: shell.handle,
      condition: 'writable',
      satisfied: true,
      status: 'running'
    })
  })

  it('separates a sleeping pane from a stranded one when both report connected: false', async () => {
    const runtime = makeRuntime({ [WORKER_PANE_KEY]: sleepingRecord() })
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, {
      tabs: [
        {
          tabId: WORKER_TAB_ID,
          worktreeId: WORKTREE_ID,
          title: 'Worker',
          activeLeafId: WORKER_LEAF_ID,
          layout: null
        },
        {
          tabId: STRANDED_TAB_ID,
          worktreeId: WORKTREE_ID,
          title: 'Stranded',
          activeLeafId: STRANDED_LEAF_ID,
          layout: null
        }
      ],
      leaves: [
        {
          tabId: WORKER_TAB_ID,
          worktreeId: WORKTREE_ID,
          leafId: WORKER_LEAF_ID,
          paneRuntimeId: 1,
          ptyId: null
        },
        {
          tabId: STRANDED_TAB_ID,
          worktreeId: WORKTREE_ID,
          leafId: STRANDED_LEAF_ID,
          paneRuntimeId: 1,
          ptyId: null
        }
      ]
    })

    const { terminals } = await runtime.listTerminals(WORKTREE_SELECTOR)
    const byLeaf = new Map(terminals.map((terminal) => [terminal.leafId, terminal]))

    // Both rows are `connected: false`; only liveness tells them apart.
    expect(byLeaf.get(WORKER_LEAF_ID)?.connected).toBe(false)
    expect(byLeaf.get(STRANDED_LEAF_ID)?.connected).toBe(false)
    expect(byLeaf.get(WORKER_LEAF_ID)?.liveness).toBe('sleeping')
    expect(byLeaf.get(STRANDED_LEAF_ID)?.liveness).toBe('gone')
  })

  it('reports a sleeping pane whose background tab publishes no graph leaf at all', async () => {
    const runtime = makeRuntime({ [WORKER_PANE_KEY]: sleepingRecord() })
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, { tabs: [], leaves: [] })

    const { terminals, totalCount } = await runtime.listTerminals(WORKTREE_SELECTOR)

    expect(totalCount).toBe(1)
    expect(terminals[0]).toMatchObject({
      liveness: 'sleeping',
      connected: false,
      worktreeId: WORKTREE_ID,
      tabId: WORKER_TAB_ID,
      leafId: WORKER_LEAF_ID,
      title: 'Worker',
      preview: 'ran the migration'
    })
  })

  it('answers terminal.show on a sleeping handle instead of failing it as stale', async () => {
    const runtime = makeRuntime({ [WORKER_PANE_KEY]: sleepingRecord() })
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, { tabs: [], leaves: [] })

    const { terminals } = await runtime.listTerminals(WORKTREE_SELECTOR)
    const handle = terminals[0]!.handle

    await expect(runtime.showTerminal(handle)).resolves.toMatchObject({
      handle,
      liveness: 'sleeping',
      ptyId: null
    })
  })

  it('refuses a write to a sleeping pane as asleep, not as a stale handle', async () => {
    const runtime = makeRuntime({ [WORKER_PANE_KEY]: sleepingRecord() })
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, { tabs: [], leaves: [] })

    const { terminals } = await runtime.listTerminals(WORKTREE_SELECTOR)
    const handle = terminals[0]!.handle

    await expect(runtime.sendTerminal(handle, { text: 'status?' })).rejects.toThrow(
      'terminal_asleep'
    )
    // Why: a `--for tui-idle` wait that hangs on a sleeping pane is the same
    // wrong conclusion as absence, only slower.
    await expect(
      runtime.waitForTerminal(handle, { condition: 'tui-idle', timeoutMs: 50 })
    ).rejects.toThrow('terminal_asleep')
  })

  it('withholds sleeping rows from callers that require fresh PTY liveness', async () => {
    const runtime = makeRuntime({ [WORKER_PANE_KEY]: sleepingRecord() })
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, { tabs: [], leaves: [] })

    await expect(
      runtime.listTerminals(WORKTREE_SELECTOR, 100, { requireFreshPtyLiveness: true })
    ).rejects.toThrow('terminal_liveness_unavailable')
  })

  // Why close breaks with read/send above: `terminal_asleep` tells the caller
  // "wake it and try again", which is the right answer for a read and no answer
  // at all for a close. Refusing it left a pane that `terminal.list` shows, the
  // Claude credential gate counts, and nothing outside the UI could retire —
  // the headless half of ORCA-224.
  it('closes a sleeping pane instead of refusing it as asleep', async () => {
    const { runtime, getSleeping, closeTerminalNotification } = makeWritableRuntime({
      [WORKER_PANE_KEY]: sleepingRecord()
    })
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
    const handle = (await runtime.listTerminals(WORKTREE_SELECTOR)).terminals[0]!.handle

    await expect(runtime.closeTerminal(handle)).resolves.toMatchObject({
      handle,
      tabId: WORKER_TAB_ID,
      ptyKilled: false
    })

    expect(closeTerminalNotification).toHaveBeenCalledWith(WORKER_TAB_ID, undefined)
    // Why the record too: leaving it behind relists the pane as sleeping on the
    // caller's very next poll, so the close would read as a no-op.
    expect(getSleeping()[WORKER_PANE_KEY]).toBeUndefined()
    expect((await runtime.listTerminals(WORKTREE_SELECTOR)).terminals).toEqual([])
  })

  // A sleeping handle is minted only while the pane publishes no graph leaf, but
  // it is cached by paneKey and survives the tab coming back — so the handle a
  // caller is holding can outlive that leafless state.
  it('closes only the pane when the tab republishes with a live sibling', async () => {
    const { runtime, closeTerminalNotification } = makeWritableRuntime({
      [WORKER_PANE_KEY]: sleepingRecord()
    })
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
    const handle = (await runtime.listTerminals(WORKTREE_SELECTOR)).terminals[0]!.handle

    runtime.registerPty('pty-sibling', WORKTREE_ID)
    runtime.syncWindowGraph(1, {
      tabs: [
        {
          tabId: WORKER_TAB_ID,
          worktreeId: WORKTREE_ID,
          title: 'Worker',
          activeLeafId: WORKER_LEAF_ID,
          layout: null
        }
      ],
      leaves: [
        {
          tabId: WORKER_TAB_ID,
          worktreeId: WORKTREE_ID,
          leafId: WORKER_LEAF_ID,
          paneRuntimeId: 7,
          ptyId: null
        },
        {
          tabId: WORKER_TAB_ID,
          worktreeId: WORKTREE_ID,
          leafId: SHELL_LEAF_ID,
          paneRuntimeId: 8,
          ptyId: 'pty-sibling'
        }
      ]
    })

    await runtime.closeTerminal(handle)

    // The pane, not the tab: the live sibling must survive.
    expect(closeTerminalNotification).toHaveBeenCalledWith(WORKER_TAB_ID, 7)
  })

  it('closes a sleeping pane addressed with --tab', async () => {
    const { runtime, getSleeping } = makeWritableRuntime({
      [WORKER_PANE_KEY]: sleepingRecord()
    })
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
    const handle = (await runtime.listTerminals(WORKTREE_SELECTOR)).terminals[0]!.handle

    await expect(runtime.closeTerminalTab(handle)).resolves.toMatchObject({
      handle,
      tabId: WORKER_TAB_ID,
      closeMode: 'tab'
    })
    expect(getSleeping()[WORKER_PANE_KEY]).toBeUndefined()
  })

  it('drops the sleeping handle once the pane wakes', async () => {
    let sleeping: Record<string, SleepingAgentSessionRecord> = {
      [WORKER_PANE_KEY]: sleepingRecord()
    }
    const runtime = makeRuntime(() => sleeping)
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, { tabs: [], leaves: [] })

    const handle = (await runtime.listTerminals(WORKTREE_SELECTOR)).terminals[0]!.handle
    sleeping = {}

    expect((await runtime.listTerminals(WORKTREE_SELECTOR)).terminals).toEqual([])
    await expect(runtime.showTerminal(handle)).rejects.toThrow()
  })
})
