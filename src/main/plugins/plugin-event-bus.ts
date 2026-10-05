import type { PluginCapabilityKind } from '../../shared/plugins/plugin-capabilities'
import {
  isPluginEventGranted,
  PLUGIN_EVENT_PAYLOAD_SCHEMAS
} from '../../shared/plugins/plugin-events'
import type { PluginEventName } from '../../shared/plugins/plugin-manifest'

/**
 * Server-side event filtering: plugins receive only events they subscribed
 * to (manifest `contributes.events` or a runtime `events.subscribe` call) —
 * never a firehose. Manifest subscriptions are durable activation triggers;
 * dynamic subscriptions live only as long as the worker that made them.
 */

export class PluginEventBus {
  private readonly dynamicSubscriptions = new Map<string, Set<PluginEventName>>()

  private readonly grantedCapabilities: (
    pluginKey: string
  ) => readonly PluginCapabilityKind[] | null

  /** `grantedCapabilities` returns null for an unknown, disabled or
   *  stale-consent plugin, which subscribes to nothing. */
  constructor(grantedCapabilities: (pluginKey: string) => readonly PluginCapabilityKind[] | null) {
    this.grantedCapabilities = grantedCapabilities
  }

  /** Records only the events the plugin's consented capabilities allow, so the
   *  returned list tells the plugin what it will actually receive. */
  subscribe(pluginKey: string, events: PluginEventName[]): PluginEventName[] {
    const existing = this.dynamicSubscriptions.get(pluginKey) ?? new Set<PluginEventName>()
    const grantedCapabilities = this.grantedCapabilities(pluginKey)
    for (const event of events) {
      if (isPluginEventGranted(grantedCapabilities, event)) {
        existing.add(event)
      }
    }
    this.dynamicSubscriptions.set(pluginKey, existing)
    return [...existing]
  }

  isDynamicallySubscribed(pluginKey: string, event: PluginEventName): boolean {
    return this.dynamicSubscriptions.get(pluginKey)?.has(event) ?? false
  }

  /** Dynamic subscriptions die with the worker that registered them. */
  clear(pluginKey: string): void {
    this.dynamicSubscriptions.delete(pluginKey)
  }

  /** Validates and bounds an event payload before it reaches any plugin. */
  projectPayload(
    event: PluginEventName,
    payload: unknown
  ): { ok: true; payload: unknown } | { ok: false; error: string } {
    const parsed = PLUGIN_EVENT_PAYLOAD_SCHEMAS[event].safeParse(payload)
    return parsed.success
      ? { ok: true, payload: parsed.data }
      : { ok: false, error: `malformed ${event} payload` }
  }
}
