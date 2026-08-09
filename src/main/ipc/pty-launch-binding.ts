import type { SleepingAgentLaunchConfig } from '../../shared/agent-session-resume'
import type { TuiAgent } from '../../shared/types'

export type RegisteredPtyLaunchBinding = {
  launchConfig?: SleepingAgentLaunchConfig
  launchToken?: string
  launchAgent?: TuiAgent
}

/**
 * Splits what a spawn hands main about its launch into the two things it is:
 * the launch *description* the account switch relaunches from, and the launch
 * *token* orchestration authenticates the pane's own messages with.
 *
 * A reattach carries only the description. The renderer mints a fresh token for
 * the fallback spawn it may never make, and main can only "verify" that token
 * against the same request's env — but a reattached child is already running
 * with the token it got at birth, which main forgot at restart. Trusting the
 * new one would mint an orchestration identity for a process that cannot prove
 * it. Dropping the description along with it is what left a restored pane
 * unswitchable (ORCA-187).
 */
export function resolveRegisteredPtyLaunchBinding(args: {
  isReattach: boolean
  launchConfig?: SleepingAgentLaunchConfig
  /** Already proven against the spawn env; still never trusted on a reattach. */
  trustedLaunchToken?: string
  launchAgent?: TuiAgent
}): RegisteredPtyLaunchBinding {
  if (!args.launchConfig) {
    return {}
  }
  if (args.isReattach) {
    return {
      launchConfig: args.launchConfig,
      ...(args.launchAgent ? { launchAgent: args.launchAgent } : {})
    }
  }
  if (!args.trustedLaunchToken) {
    return {}
  }
  return {
    launchConfig: args.launchConfig,
    launchToken: args.trustedLaunchToken,
    ...(args.launchAgent ? { launchAgent: args.launchAgent } : {})
  }
}
