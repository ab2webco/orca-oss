import { join } from 'node:path'
import { compareAppVersions } from '../../shared/app-version'
import type { ResolvedOrchestratorGameConfig } from '../../shared/orchestrator-game-config'
import { isPluginUiLanguage, normalizeUiLanguage, type UiLanguage } from '../../shared/ui-language'
import {
  DEFAULT_UI_LOCALE,
  normalizeSupportedUiLocale,
  resolveUiLocale,
  type SupportedUiLocale
} from '../../shared/ui-locale'
import { quotePosixShell } from '../../shared/wsl-login-shell-command'

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

/** The game's language: Orca's UI language as the renderer resolves it, else English. */
export function orchestratorGameLocaleOf(
  language: UiLanguage | undefined,
  systemLocale: string
): SupportedUiLocale {
  const chosen = normalizeUiLanguage(language)
  // Why: a plugin language pack names its tag after the slash; the game only ships the built-ins.
  if (isPluginUiLanguage(chosen)) {
    return normalizeSupportedUiLocale(chosen.slice(chosen.lastIndexOf('/') + 1))
  }
  return normalizeSupportedUiLocale(resolveUiLocale(chosen, systemLocale))
}

export function buildOrchestratorGameLaunch(args: {
  resolved: ResolvedOrchestratorGameConfig
  claudeVersion: string | null
  pluginDir: string | null
  /** Absolute Orca CLI the mod polls for `game state`. */
  orcaCli?: string | null
  locale?: SupportedUiLocale
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
      ...(args.orcaCli ? { ORCA_GAME_CLI: args.orcaCli } : {}),
      ORCA_GAME_MODE: config.mode,
      ORCA_GAME_SCENE: config.scene,
      ORCA_GAME_HUD: config.hud ? '1' : '0',
      ORCA_GAME_REWARDS: config.rewards ? '1' : '0',
      ORCA_GAME_LOCALE: args.locale ?? DEFAULT_UI_LOCALE
    }
  }
}

/** Inserts the game's Claude args after the executable of a POSIX shell command line. */
export function withOrchestratorGameArgs(command: string, launch: OrchestratorGameLaunch): string {
  if (launch.args.length === 0) {
    return command
  }
  const quoted = launch.args.map(quotePosixShell).join(' ')
  return command.replace(/^(\S+)/, (executable) => `${executable} ${quoted}`)
}
