import type { PluginCapabilityKind } from '../../shared/plugins/plugin-capabilities'
import type { ValidDiscoveredPlugin } from './plugin-discovery'
import type { PluginWorkerSpawnSpec } from './plugin-worker-startup'

export function buildPluginWorkerSpawnSpec(
  plugin: ValidDiscoveredPlugin,
  grantedCapabilities: readonly PluginCapabilityKind[]
): PluginWorkerSpawnSpec {
  if (!plugin.manifest.main) {
    throw new Error(`plugin ${plugin.pluginKey} has no worker entry`)
  }
  return {
    pluginKey: plugin.pluginKey,
    rootDir: plugin.rootDir,
    mainEntry: plugin.manifest.main,
    // Dev plugins keep one root across manifest edits; include the parsed
    // manifest so hot reload cannot reuse a worker with stale contributions.
    manifestRevision: JSON.stringify(plugin.manifest),
    grantedCapabilities,
    networkHosts: plugin.manifest.capabilities
      .filter((capability) => capability.kind === 'net:fetch')
      .flatMap((capability) => capability.hosts)
  }
}

export function pluginWorkerSpawnSpecsEqual(
  left: PluginWorkerSpawnSpec,
  right: PluginWorkerSpawnSpec
): boolean {
  if (
    left.pluginKey !== right.pluginKey ||
    left.rootDir !== right.rootDir ||
    left.mainEntry !== right.mainEntry ||
    left.manifestRevision !== right.manifestRevision
  ) {
    return false
  }
  const leftCapabilities = [...left.grantedCapabilities].sort()
  const rightCapabilities = [...right.grantedCapabilities].sort()
  const leftNetworkHosts = [...(left.networkHosts ?? [])].sort()
  const rightNetworkHosts = [...(right.networkHosts ?? [])].sort()
  return (
    leftCapabilities.length === rightCapabilities.length &&
    leftCapabilities.every((capability, index) => capability === rightCapabilities[index]) &&
    leftNetworkHosts.length === rightNetworkHosts.length &&
    leftNetworkHosts.every((host, index) => host === rightNetworkHosts[index])
  )
}
