import { join } from 'node:path'
import { compareAppVersions } from '../../shared/app-version'
import type { ResolvedOrchestratorGameConfig } from '../../shared/orchestrator-game-config'
import { desktopGameTimezoneOf } from '../../shared/orchestrator-game-render'
import { isPluginUiLanguage, normalizeUiLanguage, type UiLanguage } from '../../shared/ui-language'
import {
  DEFAULT_UI_LOCALE,
  normalizeSupportedUiLocale,
  resolveUiLocale,
  type SupportedUiLocale
} from '../../shared/ui-locale'
import { quoteStartupArg, type AgentStartupShell } from '../../shared/tui-agent-startup-shell'
import { quoteCmdToken } from '../claude-accounts/windows-command-invocation'

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

/** The CLI path the game pane gets; Windows gets forward slashes, so Git Bash runs it as a path. */
export function orchestratorGameCliPathOf(
  cli: string | null,
  platform: NodeJS.Platform
): string | null {
  return cli !== null && platform === 'win32' ? cli.replaceAll('\\', '/') : cli
}

/** The ORCA_GAME_CLI a member pane exports: the lead's CLI, or the name its shell resolves over SSH. */
export function orchestratorGameMemberCliOf(args: {
  connectionId: string | null
  orchestrationCommand: 'orca' | 'orca-ide'
  hostCli: string | null
  platform: NodeJS.Platform
}): string | null {
  // Why: over SSH the relay shim answers as `orca`; a WSL pane cannot run the host's absolute path.
  if (args.connectionId !== null) {
    return 'orca'
  }
  if (args.orchestrationCommand === 'orca-ide') {
    return null
  }
  return orchestratorGameCliPathOf(args.hostCli, args.platform)
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
      ORCA_GAME_RENDER: config.render,
      ORCA_GAME_TIMEZONE: desktopGameTimezoneOf(config.timezone),
      ORCA_GAME_LOCALE: args.locale ?? DEFAULT_UI_LOCALE,
      // Why: Team panes carry TMUX, which keeps Claude on the main screen, where the terminal
      // reports no clicks; the fullscreen layout is the only one where the game's buttons click.
      CLAUDE_CODE_NO_FLICKER: '1'
    }
  }
}

/** Quotes one game arg for the shell that parses the pane's command line. */
export function quoteOrchestratorGameArg(arg: string, shell: AgentStartupShell): string {
  // Why not quoteStartupArg for cmd: its carets stay literal inside quotes, and `%` expands there.
  return shell === 'cmd' ? quoteCmdToken(arg) : quoteStartupArg(arg, shell)
}

/** Inserts the game's Claude args after the executable, quoted for the pane's shell. */
export function withOrchestratorGameArgs(
  command: string,
  launch: OrchestratorGameLaunch,
  shell: AgentStartupShell = 'posix'
): string {
  if (launch.args.length === 0) {
    return command
  }
  const quoted = launch.args.map((arg) => quoteOrchestratorGameArg(arg, shell)).join(' ')
  return command.replace(/^(\S+)/, (executable) => `${executable} ${quoted}`)
}
