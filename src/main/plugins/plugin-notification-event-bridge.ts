import {
  NOTIFICATION_DISPATCHED_BODY_MAX_LENGTH,
  NOTIFICATION_DISPATCHED_TITLE_MAX_LENGTH,
  type PluginNotificationDispatchedPayload
} from '../../shared/plugins/plugin-events'
import type { MobileNotificationEvent } from '../runtime/orca-runtime'

type OrcaNotificationBus = {
  onNotificationDispatched(listener: (event: MobileNotificationEvent) => void): () => void
}

/**
 * Feeds `notification.dispatched` from the same fan-out the paired phone reads,
 * so a plugin channel gets exactly what Orca relays: after the enabled and
 * per-source switches and the burst cooldown, never the Settings test banner.
 */
export function forwardOrcaNotificationsToPlugins(
  bus: OrcaNotificationBus,
  emit: (payload: PluginNotificationDispatchedPayload) => void,
  now: () => number = Date.now
): () => void {
  return bus.onNotificationDispatched((event) => {
    const payload = toNotificationDispatchedPayload(event, now())
    if (payload) {
      emit(payload)
    }
  })
}

function toNotificationDispatchedPayload(
  event: MobileNotificationEvent,
  at: number
): PluginNotificationDispatchedPayload | null {
  // Why: plugin-sourced notifications would loop between plugins.
  if (event.type !== 'notification' || event.source === 'plugin') {
    return null
  }
  return {
    source: event.source,
    worktreeId: event.worktreeId || null,
    title: truncate(event.title, NOTIFICATION_DISPATCHED_TITLE_MAX_LENGTH),
    body: truncate(event.body, NOTIFICATION_DISPATCHED_BODY_MAX_LENGTH),
    at
  }
}

// Why: an oversized label would otherwise fail the schema and drop the event.
function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  const cut = value.slice(0, maxLength - 1)
  const lastCode = cut.charCodeAt(cut.length - 1)
  return `${lastCode >= 0xd800 && lastCode <= 0xdbff ? cut.slice(0, -1) : cut}…`
}
