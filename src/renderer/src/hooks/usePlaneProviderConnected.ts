import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { useAppStore } from '@/store'

// Why: the Settings sidebar registry and the Settings page must agree on whether
// the Plane section is visible; sharing this selector keeps the nav entry and
// the rendered section from drifting. The context-key guard rejects a status
// fetched for a different runtime environment than the active one.
export function usePlaneProviderConnected(): boolean {
  return useAppStore(
    (state) =>
      state.planeStatusContextKey === getProviderRuntimeContextKey(state.settings) &&
      state.planeStatus.connected
  )
}
