import type { SleepingAgentLaunchConfig } from '../../shared/agent-session-resume'
import { isDirectClaudeCommand } from '../../shared/claude-agent-teams-tmux-compat'
import type { AgentStartupShell } from '../../shared/tui-agent-startup-shell'
import { withOrchestratorGameArgs, type OrchestratorGameLaunch } from './orchestrator-game-launch'

/** The game a member loads and the shell its command line is quoted for. */
export type OrchestratorGameMemberLaunch = {
  game: OrchestratorGameLaunch
  shell: AgentStartupShell
}

type MemberStartup = {
  launchCommand: string
  env?: Record<string, string>
  launchConfig?: SleepingAgentLaunchConfig
}

/** A game member's Claude startup with the mod loaded; any other launch comes back unchanged. */
export function withOrchestratorGameMemberLaunch<T extends MemberStartup>(
  startup: T,
  game: OrchestratorGameLaunch,
  shell: AgentStartupShell
): T {
  // Why direct claude only: the args go after the first word, which a wrapper or codex does not take.
  if (game.args.length === 0 || !isDirectClaudeCommand(startup.launchCommand)) {
    return startup
  }
  const config = startup.launchConfig
  return {
    ...startup,
    launchCommand: withOrchestratorGameArgs(startup.launchCommand, game, shell),
    env: { ...startup.env, ...game.env },
    ...(config
      ? {
          launchConfig: {
            ...config,
            ...(isDirectClaudeCommand(config.agentCommand)
              ? { agentCommand: withOrchestratorGameArgs(config.agentCommand ?? '', game, shell) }
              : {}),
            agentEnv: { ...config.agentEnv, ...game.env }
          }
        }
      : {})
  }
}
