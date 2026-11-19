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

const statusOf = (paneKey: string, id: string) => ({
  paneKey,
  agentType: 'claude',
  state: 'working',
  providerSession: { key: 'session_id', id },
  connectionId: null,
  receivedAt: 1,
  stateStartedAt: 1
})

// Why (ORCA-1283): a former tab's cold restore resumed the lead's conversation beside the live lead.
describe('a cold restore of a conversation another live pane runs', () => {
  const { handlers, mainWindow } = setupPtyIpcSuite()

  function daemonWith(livePtyIds: string[]) {
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
      getForegroundProcess: vi.fn(async () => null),
      probePtyLiveness: vi.fn(async (id: string) => livePtyIds.includes(id))
    } as never)
    registerPtyHandlers(
      mainWindow as never,
      undefined,
      undefined,
      undefined,
      undefined,
      STORE as never
    )
    return spawn
  }

  const coldRestore = async () =>
    (await handlers.get('pty:spawn')!(null, {
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      sessionId: 'pty-old-tab',
      command: RESUME,
      launchAgent: 'claude',
      resumeProviderSession: SESSION,
      // Why: the shared home skips the transcript lookup, which this suite's mocked fs cannot answer.
      claudeAccountId: null
    })) as { agentResumeUnavailable?: true }

  it('opens a plain shell and says the session was not resumed', async () => {
    getAgentStatusSnapshotMock.mockReturnValue([
      statusOf('tab-lead:leaf-lead', 'sess-lead'),
      statusOf('tab-old:leaf-old', 'sess-lead')
    ])
    const spawn = daemonWith(['pty-lead'])

    const spawned = await coldRestore()

    expect(spawn.mock.calls.at(-1)![0].command).toBeUndefined()
    expect(spawned.agentResumeUnavailable).toBe(true)
  })

  it('still resumes when the pane that ran it is gone', async () => {
    getAgentStatusSnapshotMock.mockReturnValue([statusOf('tab-lead:leaf-lead', 'sess-lead')])
    const spawn = daemonWith([])

    const spawned = await coldRestore()

    expect(spawn.mock.calls.at(-1)![0].command).toContain('sess-lead')
    expect(spawned.agentResumeUnavailable).toBeUndefined()
  })

  it('still resumes when the live pane runs another conversation', async () => {
    getAgentStatusSnapshotMock.mockReturnValue([statusOf('tab-lead:leaf-lead', 'sess-other')])
    const spawn = daemonWith(['pty-lead'])

    await coldRestore()

    expect(spawn.mock.calls.at(-1)![0].command).toContain('sess-lead')
  })

  // Why: an SSH provider has no liveness probe; its listing is what proves the lead's pane is up.
  it('opens a plain shell over SSH when the host lists the pane that runs it', async () => {
    getAgentStatusSnapshotMock.mockReturnValue([statusOf('tab-ssh:leaf-ssh', 'sess-lead')])
    daemonWith([])
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
      listProcesses: vi.fn(async () => [{ id: 'ssh:ssh-1@@lead-pty', cwd: '/r', title: 'claude' }]),
      getForegroundProcess: vi.fn(async () => null)
    } as never)
    try {
      await handlers.get('pty:spawn')!(null, {
        cols: 80,
        rows: 24,
        cwd: '/r',
        connectionId: 'ssh-1',
        command: RESUME,
        launchAgent: 'claude',
        resumeProviderSession: SESSION
      })

      expect(sshSpawn.mock.calls.at(-1)![0].command).toBeUndefined()
    } finally {
      unregisterSshPtyProvider('ssh-1')
    }
  })
})
