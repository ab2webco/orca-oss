import { killedPluginKeys, type PluginKillList } from '../../shared/plugins/plugin-kill-list'

// Why this exists: the plugin safety list is published by upstream, for a
// marketplace (stablyai/orca-plugins) this fork consumes but does not curate.
// We cannot host that data — only upstream sees the advisories that fill it —
// so the fetch stays. What the fork was missing is the other half: upstream
// could revoke a plugin inside a Lab build and nothing here could disagree.
//
// A key listed below is ignored wherever it appears in the fetched or cached
// list, so the plugin keeps running in this build. It is deliberately a
// build-time constant and not a setting: a revocation is a safety signal, and
// overriding one must cost a code review and a release, not a toggle a user
// can flip while reading a plugin's install prompt.
//
// Empty is the correct steady state. Add a key only with the advisory read and
// the reason recorded next to it, and remove it once upstream's entry is gone.
export const FORK_KILL_LIST_EXEMPTIONS: ReadonlySet<string> = new Set<string>()

export type KillListExemptionResult = {
  /** The list as enforced: fetched/cached entries minus this fork's exemptions. */
  effective: PluginKillList
  /** Exempted keys that the incoming list actually revoked, for logging. */
  exempted: string[]
}

export function applyKillListExemptions(
  killList: PluginKillList,
  exemptions: ReadonlySet<string> = FORK_KILL_LIST_EXEMPTIONS
): KillListExemptionResult {
  if (exemptions.size === 0) {
    return { effective: killList, exempted: [] }
  }
  const kept = killList.plugins.filter((entry) => !exemptions.has(entry.pluginKey))
  if (kept.length === killList.plugins.length) {
    return { effective: killList, exempted: [] }
  }
  return {
    effective: { ...killList, plugins: kept },
    exempted: killList.plugins
      .filter((entry) => exemptions.has(entry.pluginKey))
      .map((entry) => entry.pluginKey)
  }
}

/** Keys revoked by `next` that `previous` did not revoke. `previous` being null
 *  means there was no list at all, so every entry is newly in force. */
export function newlyRevokedPluginKeys(
  previous: PluginKillList | null,
  next: PluginKillList
): string[] {
  const before = previous ? killedPluginKeys(previous) : new Set<string>()
  return [...killedPluginKeys(next)].filter((pluginKey) => !before.has(pluginKey))
}
