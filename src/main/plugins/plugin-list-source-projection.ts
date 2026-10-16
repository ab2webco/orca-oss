import type { PluginLockEntry } from '../../shared/plugins/plugin-install-lockfile'

/** Where an installed plugin's bytes came from, as the plugin list shows it. */
export type PluginListSource = {
  kind: 'local-path' | 'git' | 'marketplace' | 'bundled'
  reference: string
  resolvedCommit: string | null
  contentHash: string
  marketplace?: { reference: string; resolvedCommit: string }
}

export function projectPluginListSource(lockEntry: PluginLockEntry): PluginListSource {
  const { source } = lockEntry
  return {
    kind: source.kind,
    reference:
      source.kind === 'local-path'
        ? source.path
        : source.kind === 'git'
          ? source.url
          : source.kind === 'marketplace'
            ? source.plugin.url
            : `bundled:${source.bundleId}`,
    resolvedCommit: lockEntry.resolvedCommit,
    contentHash: lockEntry.contentHash,
    ...(source.kind === 'marketplace'
      ? {
          marketplace: {
            reference: source.marketplace.url,
            resolvedCommit: source.marketplace.resolvedCommit
          }
        }
      : {})
  }
}
