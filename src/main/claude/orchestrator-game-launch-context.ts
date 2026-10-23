import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { resolveClaudeCommand } from '../codex-cli/command'
import { getPreferredSystemLocale } from '../i18n/main-i18n'
import { resolveClaudeAgentTeamsShimBin } from '../runtime/claude-agent-teams-shim-env'
import { readWorktreeOrcaYaml } from '../worktree-orca-yaml'
import { parseClaudeCodeVersion } from './hook-event-versions'
import {
  buildOrchestratorGameLaunch,
  orchestratorGameCliPathOf,
  orchestratorGameLocaleOf,
  resolveOrchestratorGamePluginDir,
  type OrchestratorGameLaunch
} from './orchestrator-game-launch'
import { installOrchestratorGamePlugin } from './orchestrator-game-plugin-install'
import {
  resolveOrchestratorGameConfig,
  resolveOrchestratorGameLead
} from '../../shared/orchestrator-game-config'
import type { GlobalSettings } from '../../shared/types'
import { shownOrchestratorGameModeOf } from '../../shared/orchestrator-game-view'

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

let installedPlugin: {
  sourceDir: string
  installRoot: string
  dir: Promise<string | null>
} | null = null

// Why: Claude Code writes .claude-plugin/types/ into the plugin dir; inside the signed bundle that
// breaks the macOS code seal and Gatekeeper reports the app as damaged.
export async function bundledOrchestratorGamePluginDir(): Promise<string | null> {
  const sourceDir = resolveOrchestratorGamePluginDir({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath()
  })
  if (!existsSync(sourceDir)) {
    return null
  }
  if (!app.isPackaged) {
    return sourceDir
  }
  const installRoot = join(app.getPath('userData'), 'claude-plugins')
  const cached =
    installedPlugin?.sourceDir === sourceDir && installedPlugin.installRoot === installRoot
      ? await installedPlugin.dir
      : null
  if (cached !== null && existsSync(cached)) {
    return cached
  }
  // Why null on failure: plain Claude beats handing it the bundle dir it would write into.
  const dir = installOrchestratorGamePlugin({ sourceDir, installRoot }).catch(() => null)
  installedPlugin = { sourceDir, installRoot, dir }
  return dir
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
  platform?: NodeJS.Platform
  role?: 'member'
}): Promise<OrchestratorGameLaunch> {
  const detect = args.detectClaudeVersion ?? detectClaudeCodeVersionCached
  const [claudeVersion, layers] = await Promise.all([
    detect().catch(() => null),
    orchestratorGameLayersOf(args)
  ])
  const resolved = resolveOrchestratorGameConfig(layers)
  return buildOrchestratorGameLaunch({
    resolved,
    claudeVersion,
    pluginDir:
      args.pluginDir === undefined ? await bundledOrchestratorGamePluginDir() : args.pluginDir,
    // Why: the same absolute CLI the Agent Teams tmux shim runs, so Linux never hits the screen reader.
    orcaCli: orchestratorGameCliPathOf(
      args.orcaCli === undefined ? resolveClaudeAgentTeamsShimBin(process.env) : args.orcaCli,
      args.platform ?? process.platform
    ),
    locale: orchestratorGameLocaleOf(
      args.settings?.uiLanguage,
      args.systemLocale ?? getPreferredSystemLocale()
    ),
    ...(args.role === 'member'
      ? { role: 'member' as const, memberGame: resolveOrchestratorGameLead(layers).memberGame }
      : {})
  })
}

type OrchestratorGameLayerSource = {
  settings:
    | Partial<Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>>
    | undefined
  repoId: string | null
  worktreePath: string | null
  connectionId?: string | null
}

async function orchestratorGameLayersOf(args: OrchestratorGameLayerSource) {
  const project = args.worktreePath
    ? await readWorktreeOrcaYaml(args.worktreePath, args.connectionId)
    : null
  return {
    global: args.settings?.orchestratorGame,
    project: project?.orchestratorGame,
    local: args.repoId ? args.settings?.orchestratorGameProjects?.[args.repoId] : undefined
  }
}

/** Whether a project's game members take the game's shape: mode not off and memberGame not false. */
export async function isOrchestratorGameMemberOn(
  args: OrchestratorGameLayerSource
): Promise<boolean> {
  const layers = await orchestratorGameLayersOf(args)
  return (
    shownOrchestratorGameModeOf(resolveOrchestratorGameConfig(layers).config) !== 'off' &&
    resolveOrchestratorGameLead(layers).memberGame !== false
  )
}
