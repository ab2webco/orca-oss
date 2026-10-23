import type { RuntimeTerminalAgentStatusState } from '../../../shared/runtime-types'

/** What the host already knows about a worker terminal, read without asking the agent. */
export type DispatchActivityObservation = {
  /** The freshest agent hook state for the terminal, if its agent reports hooks. */
  hook: { status: NonNullable<RuntimeTerminalAgentStatusState>; updatedAt: number } | null
  /** Null until the PTY prints in this app session. */
  lastOutputAt: number | null
}

export type DispatchActivityProbe = (assigneeHandle: string) => DispatchActivityObservation

// Why: a working hook means a turn is in progress; an idle one dates the turn's end, and TUI repaints after it are not progress.
export function activityAt(observation: DispatchActivityObservation, now: number): number | null {
  if (observation.hook) {
    return observation.hook.status === 'working' ? now : observation.hook.updatedAt
  }
  return observation.lastOutputAt
}
