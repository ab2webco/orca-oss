import type { SleepingAgentLaunchConfig } from '../../shared/agent-session-resume'
import type { ClaudeTerminalSwitchReadiness } from '../../shared/claude-terminal-account-switch'

/** The runtime facts the switch's preflight reads, in the order it reads them. */
export type ClaudeTerminalSwitchPreflight = {
  /** Desktop account services are attached; headless `orca serve` has none. */
  servicesAttached: boolean
  /** The pane resolved to a live PTY this runtime owns. */
  paneResolved: boolean
  isWsl: boolean
  remoteConnectionId: string | null
  /** Files the transcript, so the target universe can resolve the session. */
  cwd: string | null
  /** Managed account this runtime can release — injected bindings only. */
  sourceAccountId: string | null
  providerSessionId: string | null
  launchConfig: SleepingAgentLaunchConfig | null | undefined
}

const READY: ClaudeTerminalSwitchReadiness = { state: 'ready' }

/**
 * The single preflight both `startClaudeTerminalAccountSwitch` and the
 * per-terminal account report evaluate. A second copy would eventually disagree
 * with the switch, and reporting a pane ready that then refuses is exactly the
 * silence ORCA-187 removes.
 */
export function resolveClaudeTerminalSwitchReadiness(
  preflight: ClaudeTerminalSwitchPreflight
): ClaudeTerminalSwitchReadiness {
  if (!preflight.servicesAttached) {
    return { state: 'unavailable', reason: 'runtime-unavailable' }
  }
  if (!preflight.paneResolved) {
    return { state: 'unavailable', reason: 'terminal-not-found' }
  }
  if (preflight.isWsl || preflight.remoteConnectionId) {
    return { state: 'unavailable', reason: 'unsupported-runtime' }
  }
  if (!preflight.cwd) {
    return { state: 'unavailable', reason: 'transcript-unavailable' }
  }
  if (!preflight.sourceAccountId) {
    return { state: 'unavailable', reason: 'source-unknown' }
  }
  if (!preflight.providerSessionId) {
    return { state: 'unavailable', reason: 'missing-session' }
  }
  // Why argv and not the whole config: the switch relaunches the CLI, and a
  // config without a command would leave it guessing the launcher.
  if (!preflight.launchConfig?.agentCommand?.trim()) {
    return { state: 'unavailable', reason: 'missing-launch-config' }
  }
  return READY
}
