import type { GlobalSettings } from '../../../shared/global-settings-types'

// Why no session generation: this identifies WHERE a provider read came from, so
// it stays comparable across renderer launches — the context key cannot, because
// its generation restarts at 0 every launch.
export function getProviderRuntimeScopeKey(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
): string {
  const environmentId = settings?.activeRuntimeEnvironmentId?.trim()
  return environmentId ? `runtime:${environmentId}` : 'local'
}

export function getProviderRuntimeContextKey(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
): string {
  return `${getProviderRuntimeScopeKey(settings)}#${providerRuntimeSessionGeneration}`
}

export function hasRemoteProviderRuntime(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
): boolean {
  return Boolean(settings?.activeRuntimeEnvironmentId?.trim())
}

let providerRuntimeSessionGeneration = 0

export function bumpProviderRuntimeSessionGeneration(): number {
  providerRuntimeSessionGeneration += 1
  return providerRuntimeSessionGeneration
}
