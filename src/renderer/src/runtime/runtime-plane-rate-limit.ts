import type { PlaneRateLimitWait } from '../../../shared/plane-rate-limit-wait'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import type { RuntimePlaneSettings } from './runtime-plane-client'

export async function planeRateLimitWait(
  settings: RuntimePlaneSettings
): Promise<PlaneRateLimitWait | null> {
  const target = getActiveRuntimeTarget(settings)
  try {
    return target.kind === 'environment'
      ? await callRuntimeRpc<PlaneRateLimitWait | null>(target, 'plane.rateLimitWait', undefined, {
          timeoutMs: 5_000
        })
      : await window.api.plane.rateLimitWait()
  } catch {
    // Why: an older host has no such method; the page keeps its plain loading state.
    return null
  }
}
