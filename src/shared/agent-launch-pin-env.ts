import type { SessionOptionValue } from './native-chat-session-options'

// Why env: a model router outside Orca (Jev) cannot read the agent's argv, so the pin rides the process env.
export const AGENT_MODEL_PINNED_ENV = 'ORCA_AGENT_MODEL_PINNED'
export const AGENT_EFFORT_PINNED_ENV = 'ORCA_AGENT_EFFORT_PINNED'

/**
 * The agent env plus a pin for each model or effort the launch asked for and applied.
 * Why both: a catalog default the launch fills in (Codex's effort) was never chosen, and a value
 * the user's own agent arguments override was not the one that took effect.
 */
export function withAgentLaunchPinEnv(
  env: Record<string, string> | null | undefined,
  requested: Record<string, SessionOptionValue> | undefined,
  applied: Record<string, SessionOptionValue>
): Record<string, string> | null {
  const pinned = (key: 'model' | 'effort'): boolean =>
    requested?.[key] !== undefined && applied[key] !== undefined
  const pins = {
    ...(pinned('model') ? { [AGENT_MODEL_PINNED_ENV]: '1' } : {}),
    ...(pinned('effort') ? { [AGENT_EFFORT_PINNED_ENV]: '1' } : {})
  }
  return env || Object.keys(pins).length > 0 ? { ...env, ...pins } : null
}
