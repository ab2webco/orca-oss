import { inlineAgentDraftFitsPlatform } from './agent-draft-platform-limit'
import { withAgentLaunchPinEnv } from './agent-launch-pin-env'
import type { StartupCommandDelivery } from './codex-startup-delivery'
import type { SessionOptionValue } from './native-chat-session-options'
import { buildSleepingAgentLaunchConfig } from './sleeping-agent-launch-config'
import type { SleepingAgentLaunchConfig } from './agent-session-resume'
import { TUI_AGENT_CONFIG } from './tui-agent-config'
import type { TuiAgent } from './tui-agent'
import { resolveAgentLaunchCommand } from './tui-agent-launch-command'
import {
  clearEnvCommand,
  commandSeparator,
  quoteStartupArg,
  resolveStartupShell,
  type AgentStartupShell
} from './tui-agent-startup-shell'

export function appliedSessionOptionProps(values: Record<string, SessionOptionValue>) {
  return Object.keys(values).length > 0 ? { sessionOptions: { ...values } } : {}
}

export type AgentDraftLaunchPlan = {
  agent: TuiAgent
  launchCommand: string
  expectedProcess: string
  launchConfig: SleepingAgentLaunchConfig
  env?: Record<string, string>
  startupCommandDelivery?: StartupCommandDelivery
  sessionOptions?: Record<string, SessionOptionValue>
}

export function buildAgentDraftLaunchPlan(args: {
  agent: TuiAgent
  draft: string
  cmdOverrides: Partial<Record<TuiAgent, string>>
  platform: NodeJS.Platform
  shell?: AgentStartupShell
  agentArgs?: string | null
  agentEnv?: Record<string, string> | null
  sessionOptions?: Record<string, SessionOptionValue>
  /** Why: see buildAgentStartupPlan — remote launches use the plain `orca` shim. */
  isRemote?: boolean
}): AgentDraftLaunchPlan | null {
  const { agent, draft, cmdOverrides, platform } = args
  const shell = resolveStartupShell(platform, args.shell)
  const config = TUI_AGENT_CONFIG[agent]
  const trimmed = draft.trim()
  if (!trimmed) {
    return null
  }
  const baseCommand = resolveAgentLaunchCommand({
    agent,
    cmdOverrides,
    platform,
    shell,
    agentArgs: args.agentArgs,
    sessionOptions: args.sessionOptions,
    isRemote: args.isRemote
  })
  if (!baseCommand.ok) {
    return null
  }
  const agentEnv = withAgentLaunchPinEnv(
    args.agentEnv,
    args.sessionOptions,
    baseCommand.appliedSessionOptions
  )
  const launchConfig = buildSleepingAgentLaunchConfig({
    ...args,
    // Why: see the new-session path above — resume must not replay picker flags.
    agentCommand: baseCommand.commandWithoutSessionOptions
  })
  let plan: AgentDraftLaunchPlan | null = null
  if (config.draftPromptFlag) {
    const quoted = quoteStartupArg(trimmed, shell)
    plan = {
      agent,
      launchCommand: `${baseCommand.command} ${config.draftPromptFlag} ${quoted}`,
      expectedProcess: config.expectedProcess,
      launchConfig,
      ...appliedSessionOptionProps(baseCommand.appliedSessionOptions),
      // Why: native draft flags carry user text on argv and must survive rc-file startup.
      ...(agent === 'codex' ? { startupCommandDelivery: 'shell-ready' as const } : {}),
      ...(agentEnv ? { env: agentEnv } : {})
    }
  } else if (config.draftPromptEnvVar) {
    const clearVar = clearEnvCommand(config.draftPromptEnvVar, shell)
    plan = {
      agent,
      launchCommand: `${baseCommand.command}${commandSeparator(shell)}${clearVar}`,
      expectedProcess: config.expectedProcess,
      launchConfig,
      ...appliedSessionOptionProps(baseCommand.appliedSessionOptions),
      env: { ...agentEnv, [config.draftPromptEnvVar]: trimmed }
    }
  }
  if (
    !plan ||
    !inlineAgentDraftFitsPlatform({ command: plan.launchCommand, env: plan.env, platform })
  ) {
    return null
  }
  return plan
}
