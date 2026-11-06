import { useEffect, useState } from 'react'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'
import { callRuntimeRpc } from '../../runtime/runtime-rpc-client'
import { ensurePluginPanelsLoaded, usePluginPanelsStore } from '../../store/plugin-panels'

const ADVISOR_PLUGIN_KEY = 'ab2web.orca-jev-advisor'

/** `unknown` means the host could not answer; callers keep the row rather than lose a setting. */
export type AdvisorPluginPresence = 'installed' | 'missing' | 'unknown'

function presenceInList(plugins: unknown): AdvisorPluginPresence {
  if (!Array.isArray(plugins)) {
    return 'unknown'
  }
  const isAdvisor = (entry: { pluginKey?: unknown }): boolean =>
    entry?.pluginKey === ADVISOR_PLUGIN_KEY
  return plugins.some(isAdvisor) ? 'installed' : 'missing'
}

/** Whether the Advisor plugin is on the host that runs this project, which may not be this one. */
export function useAdvisorPluginPresence(
  repo: Pick<Repo, 'connectionId' | 'executionHostId'>
): AdvisorPluginPresence {
  const host = parseExecutionHostId(getRepoExecutionHostId(repo))
  const environmentId = host?.kind === 'runtime' ? host.environmentId : null
  const localPlugins = usePluginPanelsStore((state) => state.plugins)
  const localStatus = usePluginPanelsStore((state) => state.fetchStatus)
  const [answer, setAnswer] = useState<{
    environmentId: string
    presence: AdvisorPluginPresence
  } | null>(null)

  useEffect(() => {
    ensurePluginPanelsLoaded()
  }, [])

  useEffect(() => {
    if (!environmentId) {
      return
    }
    let isStale = false
    const settle = (presence: AdvisorPluginPresence): void => {
      if (!isStale) {
        setAnswer({ environmentId, presence })
      }
    }
    callRuntimeRpc<unknown>({ kind: 'environment', environmentId }, 'plugins.list', undefined, {
      timeoutMs: 15_000
    })
      .then((plugins) => settle(presenceInList(plugins)))
      // Why: an older or unreachable host must not take the setting away.
      .catch(() => settle('unknown'))
    return () => {
      isStale = true
    }
  }, [environmentId])

  if (environmentId) {
    return answer?.environmentId === environmentId ? answer.presence : 'unknown'
  }
  // Why: an SSH host runs no Orca runtime, so nothing there can list its plugins.
  if (host?.kind === 'ssh' || !window.api?.plugins || localStatus !== 'ready') {
    return 'unknown'
  }
  return presenceInList(localPlugins)
}
