import {
  matchesOrcaEventFilter,
  matchesOrcaEventNames,
  ORCA_EVENT_NAMES,
  type OrcaEvent,
  type OrcaEventFilter
} from '../../../shared/orca-events'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import {
  projectAgentStatusChangedEvent,
  type AgentStatusEventSource
} from '../../plugins/plugin-agent-status-event'
import { forwardOrcaNotificationsToPlugins } from '../../plugins/plugin-notification-event-bridge'
import type { MobileNotificationEvent, RuntimeWorktreeLifecycleEvent } from '../orca-runtime'
import { TerminalTabEventTracker } from './terminal-tab-events'

export type AgentStatusSourceEvent = AgentStatusEventSource

type Unsubscribe = () => void

/** The runtime taps one `orca events` subscription reads; each is attached only when needed. */
export type OrcaEventSources = {
  now: () => number
  handleForPaneKey: (paneKey: string) => string | null
  onAgentStatus: (listener: (event: AgentStatusSourceEvent) => void) => Unsubscribe
  onWorktreeLifecycle: (listener: (event: RuntimeWorktreeLifecycleEvent) => void) => Unsubscribe
  onNotificationDispatched: (listener: (event: MobileNotificationEvent) => void) => Unsubscribe
  listSessionTabs: () => Promise<RuntimeMobileSessionTabsResult[]>
  onSessionTabsChanged: (
    listener: (snapshot: RuntimeMobileSessionTabsResult) => void
  ) => Unsubscribe
}

function wantsFamily(filter: OrcaEventFilter, family: string): boolean {
  return ORCA_EVENT_NAMES.some(
    (name) => name.startsWith(`${family}.`) && matchesOrcaEventNames(name, filter.names)
  )
}

export async function subscribeOrcaEvents(
  sources: OrcaEventSources,
  filter: OrcaEventFilter,
  emit: (event: OrcaEvent) => void
): Promise<Unsubscribe> {
  const unsubscribes: Unsubscribe[] = []
  const deliver = (event: OrcaEvent): void => {
    if (matchesOrcaEventFilter(event, filter)) {
      emit(event)
    }
  }

  if (wantsFamily(filter, 'agent')) {
    unsubscribes.push(
      sources.onAgentStatus((source) => {
        const { worktreeId, paneKey, receivedAt, ...detail } =
          projectAgentStatusChangedEvent(source)
        deliver({
          name: 'agent.status.changed',
          at: receivedAt,
          worktreeId,
          terminal: sources.handleForPaneKey(paneKey),
          payload: { ...detail, paneKey, state: source.payload.state }
        })
      })
    )
  }

  if (wantsFamily(filter, 'worktree')) {
    unsubscribes.push(
      sources.onWorktreeLifecycle((event) => {
        const base = { at: sources.now(), worktreeId: event.worktreeId, terminal: null }
        deliver(
          event.kind === 'created'
            ? {
                ...base,
                name: 'worktree.created',
                payload: { path: event.path, branch: event.branch }
              }
            : { ...base, name: 'worktree.removed', payload: { path: event.path } }
        )
      })
    )
  }

  if (wantsFamily(filter, 'notification')) {
    unsubscribes.push(
      forwardOrcaNotificationsToPlugins(
        { onNotificationDispatched: sources.onNotificationDispatched },
        ({ worktreeId, at, source, title, body }) =>
          deliver({
            name: 'notification.dispatched',
            at,
            worktreeId,
            terminal: null,
            payload: { source, title, body }
          }),
        sources.now
      )
    )
  }

  if (wantsFamily(filter, 'terminal')) {
    const tracker = new TerminalTabEventTracker(sources.handleForPaneKey)
    for (const snapshot of await sources.listSessionTabs()) {
      tracker.seed(snapshot.worktree, snapshot.tabs)
    }
    unsubscribes.push(
      sources.onSessionTabsChanged((snapshot) => {
        for (const event of tracker.update(snapshot.worktree, snapshot.tabs, sources.now())) {
          deliver(event)
        }
      })
    )
  }

  return () => {
    for (const unsubscribe of unsubscribes.splice(0)) {
      unsubscribe()
    }
  }
}
