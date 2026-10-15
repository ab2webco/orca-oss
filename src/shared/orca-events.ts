import type { AgentStatusState } from './agent-status-types'

/**
 * Events `orca events` streams to any local consumer (scripts, agents, status bars).
 * Payloads are bounded projections like the plugin bus: no prompts, tool input or
 * terminal output leave main.
 */
export const ORCA_EVENT_NAMES = [
  'agent.status.changed',
  'terminal.created',
  'terminal.closed',
  'terminal.title.changed',
  'worktree.created',
  'worktree.removed',
  'notification.dispatched'
] as const

export type OrcaEventName = (typeof ORCA_EVENT_NAMES)[number]

export type OrcaAgentStatusChangedPayload = {
  paneKey: string
  state: AgentStatusState
  agentType?: string
  /** A `done` that only marks a connect/resume/clear landing idle, not a finished turn. */
  sessionBoundary?: true
  /** A `done` the user interrupted rather than a completed turn. */
  interrupted?: true
}

export type OrcaTerminalPayload = {
  tabId: string
  leafId: string
  paneKey: string | null
  title: string
}

export type OrcaTerminalTitleChangedPayload = OrcaTerminalPayload & { previousTitle: string }

export type OrcaWorktreeCreatedPayload = { path: string; branch: string }
export type OrcaWorktreeRemovedPayload = { path: string }

export type OrcaNotificationDispatchedPayload = { source: string; title: string; body: string }

type OrcaEventPayloads = {
  'agent.status.changed': OrcaAgentStatusChangedPayload
  'terminal.created': OrcaTerminalPayload
  'terminal.closed': OrcaTerminalPayload
  'terminal.title.changed': OrcaTerminalTitleChangedPayload
  'worktree.created': OrcaWorktreeCreatedPayload
  'worktree.removed': OrcaWorktreeRemovedPayload
  'notification.dispatched': OrcaNotificationDispatchedPayload
}

export type OrcaEvent = {
  [N in OrcaEventName]: {
    name: N
    at: number
    worktreeId: string | null
    /** Terminal handle usable with `orca terminal read|send|switch`; null when none is live. */
    terminal: string | null
    payload: OrcaEventPayloads[N]
  }
}[OrcaEventName]

export type OrcaEventFilter = {
  /** Empty = every event. A trailing `.*` matches a family, e.g. `terminal.*`. */
  names: readonly string[]
  worktreeId?: string
  terminal?: string
}

export function matchesOrcaEventFilter(event: OrcaEvent, filter: OrcaEventFilter): boolean {
  if (filter.worktreeId !== undefined && event.worktreeId !== filter.worktreeId) {
    return false
  }
  if (filter.terminal !== undefined && event.terminal !== filter.terminal) {
    return false
  }
  return matchesOrcaEventNames(event.name, filter.names)
}

export function matchesOrcaEventNames(eventName: OrcaEventName, names: readonly string[]): boolean {
  return names.length === 0 || names.some((name) => matchesName(eventName, name))
}

function matchesName(eventName: string, pattern: string): boolean {
  return pattern.endsWith('.*') ? eventName.startsWith(pattern.slice(0, -1)) : eventName === pattern
}

/** Unknown names are rejected up front so a typo never yields a silent, empty stream. */
export function findUnknownOrcaEventNames(names: readonly string[]): string[] {
  return names.filter((name) => !ORCA_EVENT_NAMES.some((eventName) => matchesName(eventName, name)))
}
