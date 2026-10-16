import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { app } from 'electron'
import { resolveClaudeCommand } from '../codex-cli/command'
import { loadHooks } from '../hooks'
import { parseClaudeCodeVersion } from './hook-event-versions'
import {
  buildOrchestratorGameLaunch,
  resolveOrchestratorGamePluginDir,
  type OrchestratorGameLaunch
} from './orchestrator-game-launch'
import { resolveOrchestratorGameConfig } from '../../shared/orchestrator-game-config'
import type { GlobalSettings } from '../../shared/types'

const execFileAsync = promisify(execFile)
const VERSION_CACHE_MS = 10 * 60_000

let cachedVersion: { value: string | null; at: number } | null = null

// Why: async and cached so an Agent Teams launch never blocks main on `claude --version`.
export async function detectClaudeCodeVersionCached(): Promise<string | null> {
  if (cachedVersion && Date.now() - cachedVersion.at < VERSION_CACHE_MS) {
    return cachedVersion.value
  }
  let value: string | null = null
  try {
    const { stdout } = await execFileAsync(resolveClaudeCommand(), ['--version'], {
      encoding: 'utf-8',
      timeout: 5000
    })
    value = parseClaudeCodeVersion(stdout)
  } catch {
    value = null
  }
  cachedVersion = { value, at: Date.now() }
  return value
}

export function bundledOrchestratorGamePluginDir(): string | null {
  const dir = resolveOrchestratorGamePluginDir({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath()
  })
  return existsSync(dir) ? dir : null
}

export async function prepareOrchestratorGameLaunch(args: {
  settings: Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'> | undefined
  repoId: string | null
  worktreePath: string | null
  pluginDir?: string | null
  detectClaudeVersion?: () => Promise<string | null>
}): Promise<OrchestratorGameLaunch> {
  const detect = args.detectClaudeVersion ?? detectClaudeCodeVersionCached
  const claudeVersion = await detect().catch(() => null)
  const resolved = resolveOrchestratorGameConfig({
    global: args.settings?.orchestratorGame,
    project: args.worktreePath ? loadHooks(args.worktreePath)?.orchestratorGame : undefined,
    local: args.repoId ? args.settings?.orchestratorGameProjects?.[args.repoId] : undefined
  })
  return buildOrchestratorGameLaunch({
    resolved,
    claudeVersion,
    pluginDir: args.pluginDir === undefined ? bundledOrchestratorGamePluginDir() : args.pluginDir
  })
}
