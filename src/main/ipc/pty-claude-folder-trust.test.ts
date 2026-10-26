import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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

type FixtureConfig = 'trusted' | 'untrusted' | 'unparsable' | 'missing'

describe('runtime PTY spawn Claude folder trust (ORCA-776, ORCA-792)', () => {
  const { mainWindow } = setupPtyIpcSuite()
  const tempRoots: string[] = []

  beforeEach(() => {
    // Why: the suite mocks fs, so the worktree folder must report as an existing directory for the spawn to keep its cwd.
    existsSyncMock.mockReturnValue(true)
    statSyncMock.mockReturnValue({ isDirectory: () => true, isFile: () => false })
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  /** A worktree folder and the account config dir Claude reads for it, seeded as asked. */
  async function memberFixture(
    config: FixtureConfig
  ): Promise<{ configDir: string; worktree: string; root: string }> {
    const root = await mkdtemp(join(tmpdir(), 'orca-776-trust-'))
    tempRoots.push(root)
    const configDir = join(root, 'account')
    const worktree = join(root, 'worktree')
    await mkdir(worktree, { recursive: true })
    if (config !== 'missing') {
      await mkdir(configDir, { recursive: true })
      const projects = config === 'trusted' ? { [worktree]: { hasTrustDialogAccepted: true } } : {}
      await writeFile(
        join(configDir, '.claude.json'),
        config === 'unparsable' ? '{not json' : JSON.stringify({ numStartups: 3, projects })
      )
    }
    return { configDir, worktree, root }
  }

  async function readConfig(configDir: string): Promise<{
    numStartups?: number
    projects?: Record<string, { hasTrustDialogAccepted?: boolean }>
  }> {
    return JSON.parse(await readFile(join(configDir, '.claude.json'), 'utf8'))
  }

  /** The runtime's own PTY spawn: the path a worker terminal takes, captured from the controller registration. */
  function runtimeSpawn(prepareClaudeAuth?: unknown): RuntimeSpawn {
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
    registerPtyHandlers(
      mainWindow as never,
      runtime as never,
      undefined,
      undefined,
      prepareClaudeAuth as never
    )
    if (!captured) {
      throw new Error('runtime PTY controller was not registered')
    }
    return captured
  }

  function spawnClaude(args: {
    cwd: string
    configDir?: string
    requireClaudeFolderTrust?: boolean
    prepareClaudeAuth?: unknown
  }): Promise<unknown> {
    return runtimeSpawn(args.prepareClaudeAuth)({
      cols: 80,
      rows: 24,
      cwd: args.cwd,
      connectionId: null,
      worktreeId: `repo-776::${args.cwd}`,
      command: 'claude',
      env: args.configDir ? { CLAUDE_CONFIG_DIR: args.configDir } : {},
      ...(args.requireClaudeFolderTrust === undefined
        ? {}
        : { requireClaudeFolderTrust: args.requireClaudeFolderTrust })
    })
  }

  it('trusts a new worktree in the config dir Claude will read before it starts', async () => {
    spawnMock.mockClear()
    const { configDir, worktree } = await memberFixture('missing')

    await spawnClaude({ cwd: worktree, configDir, requireClaudeFolderTrust: true })

    expect((await readConfig(configDir)).projects?.[worktree]?.hasTrustDialogAccepted).toBe(true)
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the other keys of an existing config', async () => {
    spawnMock.mockClear()
    const { configDir, worktree } = await memberFixture('untrusted')

    await spawnClaude({ cwd: worktree, configDir, requireClaudeFolderTrust: true })

    const config = await readConfig(configDir)
    expect(config.numStartups).toBe(3)
    expect(config.projects?.[worktree]?.hasTrustDialogAccepted).toBe(true)
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('writes a pinned managed account trust into its own config dir, not the default', async () => {
    spawnMock.mockClear()
    const { configDir, worktree, root } = await memberFixture('missing')
    const defaultDir = join(root, 'default')
    await mkdir(defaultDir)
    vi.stubEnv('CLAUDE_CONFIG_DIR', defaultDir)
    const prepareClaudeAuth = vi.fn(async () => ({
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: true,
      provenance: 'managed:account-1'
    }))

    await spawnClaude({ cwd: worktree, requireClaudeFolderTrust: true, prepareClaudeAuth })

    expect(prepareClaudeAuth).toHaveBeenCalledTimes(1)
    expect((await readConfig(configDir)).projects?.[worktree]?.hasTrustDialogAccepted).toBe(true)
    await expect(readFile(join(defaultDir, '.claude.json'), 'utf8')).rejects.toThrow(/ENOENT/)
  })

  it('refuses a worker launch whose config still does not trust the folder', async () => {
    spawnMock.mockClear()
    const { configDir, worktree } = await memberFixture('unparsable')

    await expect(
      spawnClaude({ cwd: worktree, configDir, requireClaudeFolderTrust: true })
    ).rejects.toThrow(`Claude Code has not accepted the folder trust for ${worktree}`)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('launches a worker whose account config already trusts the folder', async () => {
    spawnMock.mockClear()
    const { configDir, worktree } = await memberFixture('trusted')

    await spawnClaude({ cwd: worktree, configDir, requireClaudeFolderTrust: true })

    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('leaves an interactive launch to Claude own prompt when the trust cannot be written', async () => {
    spawnMock.mockClear()
    const { configDir, worktree } = await memberFixture('unparsable')

    await spawnClaude({ cwd: worktree, configDir })

    expect(spawnMock).toHaveBeenCalledTimes(1)
  })
})
