import {
  withOrchestratorGameArgs,
  type OrchestratorGameLaunch
} from '../claude/orchestrator-game-launch'

// Why: a restored or re-launched command may already carry the plugin dir; adding it twice would load the mod twice.
export function withAgentTeamsGameCommand(
  command: string | undefined,
  game: OrchestratorGameLaunch
): string | undefined {
  const pluginDir = game.args.at(-1)
  if (command === undefined || pluginDir === undefined) {
    return command
  }
  return command.includes(pluginDir) ? command : withOrchestratorGameArgs(command, game)
}
