import { capabilityKinds } from '../../shared/plugins/plugin-capabilities'
import { isPluginEventGranted } from '../../shared/plugins/plugin-events'
import type { PluginEventName } from '../../shared/plugins/plugin-manifest'
import {
  isInvalidDiscoveredPlugin,
  type DiscoveredPlugin,
  type ValidDiscoveredPlugin
} from './plugin-discovery'
import type { PluginEventBus } from './plugin-event-bus'
import type { PluginWorkerController } from './plugin-worker-controller'

export function deliverPluginEvent(options: {
  event: PluginEventName
  payload: unknown
  plugins: readonly DiscoveredPlugin[]
  eventBus: PluginEventBus
  workerController: Pick<PluginWorkerController, 'ensure' | 'deliverEventIfRunning'>
  isRuntimeApproved: (plugin: ValidDiscoveredPlugin) => boolean
  logWarning: (pluginKey: string, line: string) => void
}): void {
  const projected = options.eventBus.projectPayload(options.event, options.payload)
  if (!projected.ok) {
    return
  }
  for (const plugin of options.plugins) {
    if (isInvalidDiscoveredPlugin(plugin) || !options.isRuntimeApproved(plugin)) {
      continue
    }
    // Why: re-checked at delivery, not only at subscribe, so no subscription
    // path can outlive or bypass the consented capability set.
    if (!isPluginEventGranted(capabilityKinds(plugin.manifest.capabilities), options.event)) {
      continue
    }
    const manifestSubscribed = plugin.manifest.contributes.events.some(
      (subscription) => subscription.on === options.event
    )
    if (manifestSubscribed && plugin.manifest.main) {
      void options.workerController
        .ensure(plugin)
        .then((handle) => handle.deliverEvent(options.event, projected.payload))
        .catch((error) => {
          options.logWarning(
            plugin.pluginKey,
            `event ${options.event} dropped: ${error instanceof Error ? error.message : String(error)}`
          )
        })
    } else if (options.eventBus.isDynamicallySubscribed(plugin.pluginKey, options.event)) {
      options.workerController.deliverEventIfRunning(
        plugin.pluginKey,
        options.event,
        projected.payload
      )
    }
  }
}
