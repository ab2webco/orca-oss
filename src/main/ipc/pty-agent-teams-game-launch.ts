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

// Why: a dev build's PATH puts its own `orca` first, but a shell profile can re-prepend
// /usr/local/bin, so a bare `orca` reaches the installed release, which ignores this build's game.
export function withDevOrcaCli(
  command: string | undefined,
  devCli: string | null
): string | undefined {
  if (command === undefined || devCli === null || !/^orca(\s|$)/.test(command)) {
    return command
  }
  return `'${devCli.replace(/'/g, `'\\''`)}'${command.slice('orca'.length)}`
}
