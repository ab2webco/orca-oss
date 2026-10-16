import { join } from 'node:path'
import { compareAppVersions } from '../../shared/app-version'
import type { ResolvedOrchestratorGameConfig } from '../../shared/orchestrator-game-config'

// Why: Claude Code loads plugin hook modules ("mods") from this version on.
export const ORCHESTRATOR_GAME_MIN_CLAUDE_VERSION = '2.1.287'

export type OrchestratorGameLaunch = { args: string[]; env: Record<string, string> }

export function resolveOrchestratorGamePluginDir(options: {
  isPackaged: boolean
  resourcesPath: string
  appPath: string
}): string {
  return options.isPackaged
    ? join(options.resourcesPath, 'claude-plugins', 'orca-game')
    : join(options.appPath, 'resources', 'claude-plugins', 'orca-game')
}

export function buildOrchestratorGameLaunch(args: {
  resolved: ResolvedOrchestratorGameConfig
  claudeVersion: string | null
  pluginDir: string | null
}): OrchestratorGameLaunch {
  const { config } = args.resolved
  // Why: an unknown or older Claude Code would reject or ignore the mod; plain Claude is the safe launch.
  if (
    config.mode === 'off' ||
    args.pluginDir === null ||
    args.claudeVersion === null ||
    compareAppVersions(args.claudeVersion, ORCHESTRATOR_GAME_MIN_CLAUDE_VERSION) < 0
  ) {
    return { args: [], env: {} }
  }
  return {
    args: ['--plugin-dir', args.pluginDir],
    env: {
      ORCA_GAME_MODE: config.mode,
      ORCA_GAME_SCENE: config.scene,
      ORCA_GAME_HUD: config.hud ? '1' : '0',
      ORCA_GAME_REWARDS: config.rewards ? '1' : '0'
    }
  }
}
