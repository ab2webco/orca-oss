import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerPtyHandlers } from './pty'
import { existsSyncMock, spawnMock, statSyncMock } from './pty-ipc-mock-registry'
import { setupPtyIpcSuite } from './pty-ipc-test-harness'

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

type RuntimeSpawn = (args: {
  cols: number
  rows: number
  cwd?: string
  connectionId: string | null
  worktreeId?: string
  command?: string
  env?: Record<string, string>
  requireClaudeFolderTrust?: boolean
}) => Promise<unknown>

describe('runtime PTY spawn Claude folder trust (ORCA-776)', () => {
  const { mainWindow } = setupPtyIpcSuite()
  const tempRoots: string[] = []

  beforeEach(() => {
    // Why: the suite mocks fs, so the worktree folder must report as an existing directory for the spawn to keep its cwd.
    existsSyncMock.mockReturnValue(true)
    statSyncMock.mockReturnValue({ isDirectory: () => true, isFile: () => false })
  })

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  /** A worktree folder and the account config dir Claude reads for it; the config trusts the folder only when asked. */
  async function memberFixture(
    trustFolder: boolean
  ): Promise<{ configDir: string; worktree: string }> {
    const root = await mkdtemp(join(tmpdir(), 'orca-776-trust-'))
    tempRoots.push(root)
    const configDir = join(root, 'account')
    const worktree = join(root, 'worktree')
    await mkdir(configDir, { recursive: true })
    await mkdir(worktree, { recursive: true })
    const projects = trustFolder ? { [worktree]: { hasTrustDialogAccepted: true } } : {}
    await writeFile(join(configDir, '.claude.json'), JSON.stringify({ projects }))
    return { configDir, worktree }
  }

  /** The runtime's own PTY spawn: the path a worker terminal takes, captured from the controller registration. */
  function runtimeSpawn(): RuntimeSpawn {
    let captured: RuntimeSpawn | undefined
    const methods: Record<string, unknown> = {
      setPtyController: (controller: { spawn?: RuntimeSpawn }) => {
        captured = controller.spawn
      }
    }
    // Why: registration only needs the controller hook; every other runtime call the spawn makes is a no-op here.
    const runtime = new Proxy(methods, {
      get: (target, key: string) => target[key] ?? (() => undefined)
    })
    registerPtyHandlers(mainWindow as never, runtime as never)
    if (!captured) {
      throw new Error('runtime PTY controller was not registered')
    }
    return captured
  }

  function spawnClaude(args: {
    cwd: string
    configDir: string
    requireClaudeFolderTrust?: boolean
  }): Promise<unknown> {
    return runtimeSpawn()({
      cols: 80,
      rows: 24,
      cwd: args.cwd,
      connectionId: null,
      worktreeId: `repo-776::${args.cwd}`,
      command: 'claude',
      env: { CLAUDE_CONFIG_DIR: args.configDir },
      ...(args.requireClaudeFolderTrust === undefined
        ? {}
        : { requireClaudeFolderTrust: args.requireClaudeFolderTrust })
    })
  }

  it('refuses a game member launch whose account config does not trust the folder', async () => {
    spawnMock.mockClear()
    const { configDir, worktree } = await memberFixture(false)

    await expect(
      spawnClaude({ cwd: worktree, configDir, requireClaudeFolderTrust: true })
    ).rejects.toThrow(`Claude Code has not accepted the folder trust for ${worktree}`)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('launches a game member whose account config trusts the folder', async () => {
    spawnMock.mockClear()
    const { configDir, worktree } = await memberFixture(true)

    await spawnClaude({ cwd: worktree, configDir, requireClaudeFolderTrust: true })

    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('leaves an interactive Claude launch to Claude own trust prompt', async () => {
    spawnMock.mockClear()
    const { configDir, worktree } = await memberFixture(false)

    await spawnClaude({ cwd: worktree, configDir })

    expect(spawnMock).toHaveBeenCalledTimes(1)
  })
})
