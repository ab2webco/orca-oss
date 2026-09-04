import {
  filterAvailableTaskProviders as filterAvailableSharedTaskProviders,
  isTaskProvider as isSharedTaskProvider,
  normalizeVisibleTaskProviders as normalizeSharedVisibleTaskProviders,
  resolveVisibleTaskProvider as resolveSharedVisibleTaskProvider,
  type TaskProvider as SharedTaskProvider,
  type TaskProviderAvailability
} from '../../../src/shared/task-providers'

export type { TaskProviderAvailability }

// Why: the shared union also carries providers mobile has no render path for
// (jira). Widening to it directly would surface a tab that fails every request,
// so mobile declares what it can render and filters the shared result by it.
export const MOBILE_RENDERABLE_TASK_PROVIDERS = [
  'github',
  'gitlab',
  'linear',
  'plane'
] as const satisfies readonly SharedTaskProvider[]

export type TaskProvider = (typeof MOBILE_RENDERABLE_TASK_PROVIDERS)[number]

const RENDERABLE_SET = new Set<SharedTaskProvider>(MOBILE_RENDERABLE_TASK_PROVIDERS)

export function isTaskProvider(value: unknown): value is TaskProvider {
  return isSharedTaskProvider(value) && RENDERABLE_SET.has(value)
}

function keepRenderable(providers: readonly SharedTaskProvider[]): TaskProvider[] {
  return providers.filter((provider): provider is TaskProvider => RENDERABLE_SET.has(provider))
}

export function normalizeVisibleTaskProviders(value: unknown): TaskProvider[] {
  const renderable = keepRenderable(normalizeSharedVisibleTaskProviders(value))

  // Why: at least one provider must remain visible so the Tasks surface always
  // has a valid source to select after settings hydration or manual edits.
  return renderable.length > 0 ? renderable : [...MOBILE_RENDERABLE_TASK_PROVIDERS]
}

export function filterAvailableTaskProviders(
  visibleProviders: readonly TaskProvider[],
  availability: TaskProviderAvailability
): TaskProvider[] {
  return keepRenderable(filterAvailableSharedTaskProviders(visibleProviders, availability))
}

export function resolveVisibleTaskProvider(
  preferred: TaskProvider | null | undefined,
  visibleProviders: readonly TaskProvider[]
): TaskProvider {
  const resolved = resolveSharedVisibleTaskProvider(preferred, visibleProviders)
  return isTaskProvider(resolved) ? resolved : 'github'
}
