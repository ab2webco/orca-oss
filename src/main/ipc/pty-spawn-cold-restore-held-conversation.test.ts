import { describe, expect, it, vi } from 'vitest'
import { getAgentStatusSnapshotMock } from './pty-ipc-mock-registry'
import { setupPtyIpcSuite } from './pty-ipc-test-harness'
import {
  registerPtyHandlers,
  registerSshPtyProvider,
  setLocalPtyProvider,
  unregisterSshPtyProvider
} from './pty'

vi.mock('electron', () => import('./pty-ipc-mock-registry').then((m) => m.electronModuleMock()))
vi.mock('fs', () => import('./pty-ipc-mock-registry').then((m) => m.fsModuleMock()))
vi.mock('node-pty', () => import('./pty-ipc-mock-registry').then((m) => m.nodePtyModuleMock()))
vi.mock('node:child_process', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).childProcessModuleMock(await importOriginal())
)
vi.mock('../opencode/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.openCodeHookServiceModuleMock())
)
vi.mock('../mimo/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.mimoHookServiceModuleMock())
)
vi.mock('../agent-hooks/server', () =>
  import('./pty-ipc-mock-registry').then((m) => m.agentHookServerModuleMock())
)
vi.mock('../pi/titlebar-extension-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.piTitlebarExtensionModuleMock())
)
vi.mock('../pwsh', () => import('./pty-ipc-mock-registry').then((m) => m.pwshModuleMock()))
vi.mock('../wsl', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).wslModuleMock(await importOriginal())
)
vi.mock('../telemetry/client', () =>
  import('./pty-ipc-mock-registry').then((m) => m.telemetryClientModuleMock())
)
vi.mock('../telemetry/classify-error', () =>
  import('./pty-ipc-mock-registry').then((m) => m.classifyErrorModuleMock())
)
vi.mock('../cli/linux-terminal-orca-cli-shim', () =>
  import('./pty-ipc-mock-registry').then((m) => m.linuxCliShimModuleMock())
)
vi.mock('../memory/pty-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.ptyRegistryModuleMock())
)
vi.mock('../agent-hooks/migration-unsupported-pty-state', () =>
  import('./pty-ipc-mock-registry').then((m) => m.migrationUnsupportedPtyModuleMock())
)
vi.mock('../codex/codex-pane-account-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexPaneAccountRegistryModuleMock())
)
vi.mock('../codex/codex-state-db-backfill-recovery', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexBackfillRecoveryModuleMock())
)

const SESSION = { key: 'session_id' as const, id: 'sess-lead' }
const RESUME = `claude --teammate-mode auto --resume 'sess-lead'`

// The original lead's pane, saved before the restart with its daemon PTY still running.
const STORE = {
  upsertSshRemotePtyLease: () => undefined,
  getWorkspaceSession: () => ({
    terminalLayoutsByTabId: {
      'tab-lead': { ptyIdsByLeafId: { 'leaf-lead': 'pty-lead' } },
      'tab-ssh': { ptyIdsByLeafId: { 'leaf-ssh': 'ssh:ssh-1@@lead-pty' } }
    }
  })
}

const statusOf = (paneKey: string, id: string, connectionId: string | null = null) => ({
  paneKey,
  agentType: 'claude',
  state: 'working',
  providerSession: { key: 'session_id', id },
  connectionId,
  receivedAt: 1,
  stateStartedAt: 1
})

type Controller = { spawn: (args: Record<string, unknown>) => Promise<unknown> }

// Why (ORCA-1283): a former tab's cold restore resumed the lead's conversation beside the live lead.
describe('a cold restore of a conversation another live pane runs', () => {
  const { handlers, mainWindow } = setupPtyIpcSuite()

  /** `foregrounds` is what each live PTY runs in front; a PTY left out is gone. */
  function daemonWith(foregrounds: Record<string, string>, runtime?: Record<string, unknown>) {
    const spawn = vi.fn(async (options: { sessionId?: string; command?: string }) => ({
      id: options.sessionId ?? 'pty-new'
    }))
    setLocalPtyProvider({
      spawn,
      supportsGitCredentialGuardHost: () => true,
      supportsAgentSessionClaims: () => true,
      supportsAgentSessionCreateOperations: () => true,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      shutdown: vi.fn(),
      onData: vi.fn(() => vi.fn()),
      onExit: vi.fn(() => vi.fn()),
      listProcesses: vi.fn(async () => []),
      getForegroundProcess: vi.fn(async (id: string) => foregrounds[id] ?? null),
      probePtyLiveness: vi.fn(async (id: string) => id in foregrounds)
    } as never)
    registerPtyHandlers(
      mainWindow as never,
      runtime as never,
      undefined,
      undefined,
      undefined,
      STORE as never
    )
    return spawn
  }

  const coldRestore = async (pane: { tabId?: string; leafId?: string; sessionId?: string } = {}) =>
    (await handlers.get('pty:spawn')!(null, {
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      sessionId: 'pty-old-tab',
      command: RESUME,
      launchAgent: 'claude',
      resumeProviderSession: SESSION,
      // Why: the shared home skips the transcript lookup, which this suite's mocked fs cannot answer.
      claudeAccountId: null,
      ...pane
    })) as { agentResumeUnavailable?: true }

  function sshHost(foreground: () => Promise<string | null>) {
    const sshSpawn = vi.fn(async (options: { command?: string }) => {
      void options
      return { id: 'ssh:ssh-1@@new-pty' }
    })
    registerSshPtyProvider('ssh-1', {
      spawn: sshSpawn,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      shutdown: vi.fn(),
      onData: vi.fn(() => vi.fn()),
      onExit: vi.fn(() => vi.fn()),
      // Why the same answer: a slow relay stalls every read, its listing included.
      listProcesses: vi.fn(async () => {
        await foreground()
        return []
      }),
      getForegroundProcess: vi.fn(foreground)
    } as never)
    return sshSpawn
  }

  const sshRestore = () =>
    handlers.get('pty:spawn')!(null, {
      cols: 80,
      rows: 24,
      cwd: '/r',
      connectionId: 'ssh-1',
      command: RESUME,
      launchAgent: 'claude',
      resumeProviderSession: SESSION
    })

  it('opens a plain shell and says the session was not resumed', async () => {
    getAgentStatusSnapshotMock.mockReturnValue([
      statusOf('tab-lead:leaf-lead', 'sess-lead'),
      statusOf('tab-old:leaf-old', 'sess-lead')
    ])
    const spawn = daemonWith({ 'pty-lead': 'claude' })

    const spawned = await coldRestore()

    expect(spawn.mock.calls.at(-1)![0].command).toBeUndefined()
    expect(spawned.agentResumeUnavailable).toBe(true)
  })

  it('still resumes when the pane that ran it is gone', async () => {
    getAgentStatusSnapshotMock.mockReturnValue([statusOf('tab-lead:leaf-lead', 'sess-lead')])
    const spawn = daemonWith({})

    const spawned = await coldRestore()

    expect(spawn.mock.calls.at(-1)![0].command).toContain('sess-lead')
    expect(spawned.agentResumeUnavailable).toBeUndefined()
  })

  it('still resumes when the live pane runs another conversation', async () => {
    getAgentStatusSnapshotMock.mockReturnValue([statusOf('tab-lead:leaf-lead', 'sess-other')])
    const spawn = daemonWith({ 'pty-lead': 'claude' })

    await coldRestore()

    expect(spawn.mock.calls.at(-1)![0].command).toContain('sess-lead')
  })

  it('opens a plain shell over SSH when the host pane runs it in front', async () => {
    getAgentStatusSnapshotMock.mockReturnValue([statusOf('tab-ssh:leaf-ssh', 'sess-lead', 'ssh-1')])
    daemonWith({})
    const sshSpawn = sshHost(async () => 'claude')
    try {
      await sshRestore()

      expect(sshSpawn.mock.calls.at(-1)![0].command).toBeUndefined()
    } finally {
      unregisterSshPtyProvider('ssh-1')
    }
  })

  // Why: the status row stays after its agent exits to the shell, so the conversation runs nowhere.
  it('still resumes when the other pane is back at its shell', async () => {
    getAgentStatusSnapshotMock.mockReturnValue([statusOf('tab-lead:leaf-lead', 'sess-lead')])
    const spawn = daemonWith({ 'pty-lead': 'zsh' })

    const spawned = await coldRestore()

    expect(spawn.mock.calls.at(-1)![0].command).toContain('sess-lead')
    expect(spawned.agentResumeUnavailable).toBeUndefined()
  })

  it('still resumes when the same session id runs on another host', async () => {
    getAgentStatusSnapshotMock.mockReturnValue([
      statusOf('tab-lead:leaf-lead', 'sess-lead', 'ssh-1')
    ])
    const spawn = daemonWith({ 'pty-lead': 'claude' })

    await coldRestore()

    expect(spawn.mock.calls.at(-1)![0].command).toContain('sess-lead')
  })

  // Why: after a reboot both panes on the conversation restore with dead PTYs and no holder.
  it('resumes only the first of two panes restoring one conversation together', async () => {
    getAgentStatusSnapshotMock.mockReturnValue([
      statusOf('tab-a:leaf-a', 'sess-lead'),
      statusOf('tab-b:leaf-b', 'sess-lead')
    ])
    const spawn = daemonWith({})

    const [first, second] = await Promise.all([
      coldRestore({ tabId: 'tab-a', leafId: 'leaf-a', sessionId: 'pty-a' }),
      coldRestore({ tabId: 'tab-b', leafId: 'leaf-b', sessionId: 'pty-b' })
    ])

    const commands = spawn.mock.calls.map(([options]) => options.command ?? null)
    expect(commands.filter((one) => one?.includes('sess-lead'))).toHaveLength(1)
    expect([first.agentResumeUnavailable, second.agentResumeUnavailable]).toContain(true)
  })

  // Why: a slow relay must not stall the restore; not knowing keeps the resume.
  it('keeps the resume when the SSH host never answers what its pane runs', async () => {
    getAgentStatusSnapshotMock.mockReturnValue([statusOf('tab-ssh:leaf-ssh', 'sess-lead', 'ssh-1')])
    daemonWith({})
    const sshSpawn = sshHost(() => new Promise<string | null>(() => undefined))
    try {
      await sshRestore()

      expect(sshSpawn.mock.calls.at(-1)![0].command).toContain('sess-lead')
    } finally {
      unregisterSshPtyProvider('ssh-1')
    }
  }, 15_000)

  // Why: a paired client and ensureAgentSession restore through the runtime's controller, not pty:spawn.
  it("drops the resume on the runtime's own spawn too", async () => {
    getAgentStatusSnapshotMock.mockReturnValue([statusOf('tab-lead:leaf-lead', 'sess-lead')])
    let controller: Controller | undefined
    const spawn = daemonWith(
      { 'pty-lead': 'claude' },
      {
        setPtyController: vi.fn((next: Controller) => {
          controller = next
        }),
        createPreAllocatedTerminalHandle: vi.fn(() => 'term_restored'),
        registerPreAllocatedHandleForPty: vi.fn(),
        registerPty: vi.fn()
      }
    )

    await controller!
      .spawn({
        cols: 80,
        rows: 24,
        cwd: '/tmp',
        command: RESUME,
        launchAgent: 'claude',
        resumeProviderSession: SESSION,
        claudeAccountId: null
      })
      .catch(() => undefined)

    expect(spawn).toHaveBeenCalled()
    expect(spawn.mock.calls.at(-1)![0].command).toBeUndefined()
  })
})
