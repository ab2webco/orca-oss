import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerSshFilesystemProvider,
  unregisterSshFilesystemProvider
} from '../providers/ssh-filesystem-dispatch'
import type { IFilesystemProvider } from '../providers/types'
import { prepareOrchestratorGameLaunch } from './orchestrator-game-launch-context'

const electronApp = vi.hoisted(() => ({
  isPackaged: false,
  appPath: '',
  userData: ''
}))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronApp.isPackaged
    },
    getAppPath: () => electronApp.appPath,
    getPath: (name: string) => (name === 'userData' ? electronApp.userData : '')
  }
}))

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  unregisterSshFilesystemProvider('ssh-1')
  electronApp.isPackaged = false
})

function worktreeWith(orcaYaml: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-'))
  dirs.push(dir)
  if (orcaYaml !== null) {
    writeFileSync(join(dir, 'orca.yaml'), orcaYaml)
  }
  return dir
}

const base = {
  pluginDir: '/plugins/orca-game',
  orcaCli: '/app/bin/orca',
  detectClaudeVersion: async () => '2.1.301'
}

describe('prepareOrchestratorGameLaunch', () => {
  it('merges global settings, the worktree orca.yaml and the local project override', async () => {
    const launch = await prepareOrchestratorGameLaunch({
      ...base,
      settings: {
        orchestratorGame: { hud: false },
        orchestratorGameProjects: { repo1: { rewards: false } }
      },
      repoId: 'repo1',
      worktreePath: worktreeWith('orchestratorGame:\n  mode: zen\n')
    })

    expect(launch.args).toEqual(['--plugin-dir', '/plugins/orca-game'])
    expect(launch.env).toMatchObject({
      ORCA_GAME_CLI: '/app/bin/orca',
      ORCA_GAME_MODE: 'zen',
      ORCA_GAME_HUD: '0',
      ORCA_GAME_REWARDS: '0'
    })
  })

  it('hands a Windows pane the Orca CLI with forward slashes for Git Bash', async () => {
    const launch = await prepareOrchestratorGameLaunch({
      ...base,
      orcaCli: 'C:\\Program Files\\Orca\\resources\\bin\\orca.exe',
      platform: 'win32',
      settings: undefined,
      repoId: null,
      worktreePath: null
    })

    expect(launch.env.ORCA_GAME_CLI).toBe('C:/Program Files/Orca/resources/bin/orca.exe')
  })

  // Why: app-launched panes and `orca claude-teams` both resolve here, so both get the language.
  it("passes Orca's UI language, resolving the system choice from the OS locale", async () => {
    const chosen = await prepareOrchestratorGameLaunch({
      ...base,
      settings: { uiLanguage: 'en' },
      repoId: null,
      worktreePath: null,
      systemLocale: 'es-ES'
    })
    const system = await prepareOrchestratorGameLaunch({
      ...base,
      settings: { uiLanguage: 'system' },
      repoId: null,
      worktreePath: null,
      systemLocale: 'es-ES'
    })

    expect(chosen.env.ORCA_GAME_LOCALE).toBe('en')
    expect(system.env.ORCA_GAME_LOCALE).toBe('es')
  })

  it('lets the local override turn the game off for a project that enables it', async () => {
    const launch = await prepareOrchestratorGameLaunch({
      ...base,
      settings: { orchestratorGameProjects: { repo1: { mode: 'off' } } },
      repoId: 'repo1',
      worktreePath: worktreeWith('orchestratorGame:\n  mode: on\n')
    })

    expect(launch).toEqual({ args: [], env: {} })
  })

  it('uses the defaults for a folder without orca.yaml or a repo id', async () => {
    const launch = await prepareOrchestratorGameLaunch({
      ...base,
      settings: undefined,
      repoId: null,
      worktreePath: worktreeWith(null)
    })

    expect(launch.env.ORCA_GAME_MODE).toBe('on')
  })

  it('launches plain Claude when the version probe fails', async () => {
    const launch = await prepareOrchestratorGameLaunch({
      ...base,
      detectClaudeVersion: async () => {
        throw new Error('spawn claude ENOENT')
      },
      settings: undefined,
      repoId: null,
      worktreePath: null
    })

    expect(launch).toEqual({ args: [], env: {} })
  })

  it("honors an SSH worktree's orca.yaml read from its host", async () => {
    const reads: string[] = []
    // Why: only readFile is reached; the rest of the contract stays unimplemented on purpose.
    registerSshFilesystemProvider('ssh-1', {
      readFile: async (filePath: string) => {
        reads.push(filePath)
        return { content: 'orchestratorGame:\n  mode: off\n', isBinary: false }
      }
    } as IFilesystemProvider)

    const launch = await prepareOrchestratorGameLaunch({
      ...base,
      settings: undefined,
      repoId: 'repo1',
      worktreePath: '/srv/repo',
      connectionId: 'ssh-1'
    })

    expect(reads).toEqual(['/srv/repo/orca.yaml'])
    expect(launch).toEqual({ args: [], env: {} })
  })
})

describe('prepareOrchestratorGameLaunch plugin dir', () => {
  const originalResourcesPath = process.resourcesPath
  const setResourcesPath = (value: string): void => {
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value })
  }
  afterEach(() => setResourcesPath(originalResourcesPath))

  function bundledPlugin(root: string): void {
    const dir = join(root, 'claude-plugins', 'orca-game', '.claude-plugin')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'plugin.json'), '{"name":"orca-game"}')
  }

  const launchArgs = { ...base, settings: undefined, repoId: null, worktreePath: null }

  // Why: Claude Code writes .claude-plugin/types/ into the plugin dir, which breaks the macOS code seal.
  it('never hands a packaged Claude a plugin dir inside the app resources', async () => {
    const resourcesPath = worktreeWith(null)
    const userData = worktreeWith(null)
    bundledPlugin(resourcesPath)
    setResourcesPath(resourcesPath)
    Object.assign(electronApp, {
      isPackaged: true,
      appPath: join(resourcesPath, 'app.asar'),
      userData
    })

    const { pluginDir: _omitted, ...withoutPluginDir } = launchArgs
    const launch = await prepareOrchestratorGameLaunch(withoutPluginDir)

    const pluginDir = launch.args[1]
    expect(launch.args[0]).toBe('--plugin-dir')
    expect(relative(resourcesPath, pluginDir).startsWith('..')).toBe(true)
    expect(relative(userData, pluginDir).startsWith('..')).toBe(false)
    expect(existsSync(join(pluginDir, '.claude-plugin', 'plugin.json'))).toBe(true)
  })

  it('keeps the dev checkout plugin dir so edits load live', async () => {
    const appPath = worktreeWith(null)
    bundledPlugin(join(appPath, 'resources'))
    Object.assign(electronApp, { isPackaged: false, appPath, userData: worktreeWith(null) })

    const { pluginDir: _omitted, ...withoutPluginDir } = launchArgs
    const launch = await prepareOrchestratorGameLaunch(withoutPluginDir)

    expect(launch.args).toEqual([
      '--plugin-dir',
      join(appPath, 'resources', 'claude-plugins', 'orca-game')
    ])
  })
})
