import type { SleepingAgentLaunchConfig } from '../../shared/agent-session-resume'
import { buildClaudeInPlaceResumeCommand } from '../../shared/claude-in-place-resume-command'
import { buildAgentResumeStartupPlan } from '../../shared/tui-agent-startup'
import type { AgentStartupShell } from '../../shared/tui-agent-startup-shell'

export type BuildClaudeTerminalSwitchLaunchCommandResult =
  | { ok: true; command: string }
  | { ok: false; reason: 'missing-launch-config' | 'launch-command-unbuildable' }

/**
 * Rebuilds the launch line from the captured configuration only. No settings
 * defaults and no `cmdOverrides` are consulted: `launchConfig.agentCommand`
 * already carries the user's flags (including
 * `--dangerously-skip-permissions`), so reintroducing either source would
 * duplicate them or silently drop a custom command.
 *
 * `configDir` prefixes a CLAUDE_CONFIG_DIR export for the destination universe;
 * pass null when the shell already exports the universe being relaunched.
 */
export function buildClaudeTerminalSwitchLaunchCommand(args: {
  sessionId: string
  launchConfig: SleepingAgentLaunchConfig
  shell: AgentStartupShell
  platform: NodeJS.Platform
  configDir: string | null
}): BuildClaudeTerminalSwitchLaunchCommandResult {
  const agentCommand = args.launchConfig.agentCommand?.trim()
  if (!agentCommand) {
    return { ok: false, reason: 'missing-launch-config' }
  }
  const plan = buildAgentResumeStartupPlan({
    agent: 'claude',
    providerSession: { key: 'session_id', id: args.sessionId },
    cmdOverrides: {},
    platform: args.platform,
    shell: args.shell,
    agentCommand,
    agentArgs: args.launchConfig.agentArgs,
    agentEnv: args.launchConfig.agentEnv
  })
  if (!plan) {
    return { ok: false, reason: 'launch-command-unbuildable' }
  }
  return {
    ok: true,
    command: args.configDir
      ? buildClaudeInPlaceResumeCommand({
          configDir: args.configDir,
          resumeCommand: plan.launchCommand,
          shell: args.shell
        })
      : plan.launchCommand
  }
}
