import { compareAppVersions } from '../../shared/app-version'
import type { OrchestratorGameConfig } from '../../shared/orchestrator-game-config'
import { ORCHESTRATOR_GAME_MIN_CLAUDE_VERSION } from '../../shared/orchestrator-game-min-claude-version'

/** Why a Claude lead pane lacks the game mod: `missing` could have had it, the others never can. */
export type GameLeadPaneGap = 'missing' | 'remote' | 'wsl' | 'off' | 'old'

type Env = Record<string, string | undefined>

/** Null when the pane has the mod, or is no Claude at all (the mod is Claude-only). */
export function gameLeadPaneGapOf(
  env: Env,
  config: Pick<OrchestratorGameConfig, 'mode'> & Partial<Pick<OrchestratorGameConfig, 'show'>>
): GameLeadPaneGap | null {
  // Why ORCA_GAME_MODE: Orca sets it only beside --plugin-dir, so it marks a Claude that loaded the mod.
  if (env.CLAUDECODE !== '1' || env.ORCA_GAME_MODE) {
    return null
  }
  if (env.ORCA_RELAY_SOCKET_PATH || env.ORCA_REMOTE_CLI_BIN_DIR) {
    return 'remote'
  }
  // Why: Orca exports ORCA_CLI_COMMAND only into WSL panes, which get no game.
  if (env.ORCA_CLI_COMMAND) {
    return 'wsl'
  }
  // Why show: an older host sends none, and Show the game off launches every pane plain.
  if (config.mode === 'off' || config.show === false) {
    return 'off'
  }
  // Why: Orca launches an older Claude plain even in Agent Teams, so sending it there would loop.
  const version = claudeVersionOf(env.AI_AGENT)
  return version !== null && compareAppVersions(version, ORCHESTRATOR_GAME_MIN_CLAUDE_VERSION) < 0
    ? 'old'
    : 'missing'
}

/** Claude Code names itself `claude-code_2-1-319_agent` in AI_AGENT; null when it does not. */
function claudeVersionOf(agent: string | undefined): string | null {
  const match = agent?.match(/^claude-code_(\d+)-(\d+)-(\d+)(?:_|$)/)
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null
}

/** The CLI the lead's rules name: never a bare `orca` where Orca named another (Linux's is a screen reader). */
export const gameLeadCliOf = (env: Env): string =>
  env.ORCA_GAME_CLI || env.ORCA_CLI_COMMAND || 'orca'

export const GAME_LEAD_PLAIN_PANE_TEXT =
  "this Claude pane was started without Orca's game mod, so as lead it would have no Advisor row in the Team panel" +
  ' and no /orca-game commands. Open a new tab in this project with the Claude Agent Teams agent and run' +
  ' /orca-game:lead there. Keep working here as a plain session.'

const WHERE: Record<Exclude<GameLeadPaneGap, 'missing'>, string> = {
  remote: 'which never loads over SSH',
  wsl: 'which never loads in WSL',
  off: 'because the game is off for this project',
  old: `because it needs Claude Code ${ORCHESTRATOR_GAME_MIN_CLAUDE_VERSION} or newer (update Claude Code, then open a Claude Agent Teams tab)`
}

export const gameLeadNoModNoteOf = (gap: Exclude<GameLeadPaneGap, 'missing'>): string =>
  `This pane leads without Orca's game mod, ${WHERE[gap]}: the Team panel shows no Advisor row for it and /orca-game commands are not available here.`
