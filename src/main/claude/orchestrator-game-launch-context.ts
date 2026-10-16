import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { app } from 'electron'
import { resolveClaudeCommand } from '../codex-cli/command'
import { getMainSystemLocale } from '../i18n/main-i18n'
import { resolveClaudeAgentTeamsShimBin } from '../runtime/claude-agent-teams-shim-env'
import { readWorktreeOrcaYaml } from '../worktree-orca-yaml'
import { parseClaudeCodeVersion } from './hook-event-versions'
import {
  buildOrchestratorGameLaunch,
  orchestratorGameLocaleOf,
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
  settings:
    | Partial<Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects' | 'uiLanguage'>>
    | undefined
  repoId: string | null
  worktreePath: string | null
  /** SSH connection of the worktree's repo; its orca.yaml is read from that host. */
  connectionId?: string | null
  pluginDir?: string | null
  orcaCli?: string | null
  /** The OS locale behind a `system` UI language; defaults to Electron's. */
  systemLocale?: string
  detectClaudeVersion?: () => Promise<string | null>
}): Promise<OrchestratorGameLaunch> {
  const detect = args.detectClaudeVersion ?? detectClaudeCodeVersionCached
  const [claudeVersion, project] = await Promise.all([
    detect().catch(() => null),
    args.worktreePath ? readWorktreeOrcaYaml(args.worktreePath, args.connectionId) : null
  ])
  const resolved = resolveOrchestratorGameConfig({
    global: args.settings?.orchestratorGame,
    project: project?.orchestratorGame,
    local: args.repoId ? args.settings?.orchestratorGameProjects?.[args.repoId] : undefined
  })
  return buildOrchestratorGameLaunch({
    resolved,
    claudeVersion,
    pluginDir: args.pluginDir === undefined ? bundledOrchestratorGamePluginDir() : args.pluginDir,
    // Why: the same absolute CLI the Agent Teams tmux shim runs, so Linux never hits the screen reader.
    orcaCli:
      args.orcaCli === undefined ? resolveClaudeAgentTeamsShimBin(process.env) : args.orcaCli,
    locale: orchestratorGameLocaleOf(
      args.settings?.uiLanguage,
      args.systemLocale ?? getMainSystemLocale()
    )
  })
}
