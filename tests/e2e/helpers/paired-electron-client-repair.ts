/**
 * Re-pairing flow for an already-launched paired Electron client — split out
 * of paired-electron-client.ts (launch/dispose lifecycle) because it's a
 * separable concern used by a small subset of specs.
 */
import type { PairedElectronClient, RuntimeDesktopPairingOffer } from './paired-electron-client'

export async function rePairPairedElectronClient(
  client: PairedElectronClient,
  offer: RuntimeDesktopPairingOffer,
  name: string
): Promise<void> {
  await client.captureDirectSshAttempts()
  const environmentId = await client.page.evaluate(
    async ({ currentEnvironmentId, name, pairingUrl }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Paired desktop store is unavailable')
      }
      await window.api.runtimeEnvironments.remove({ selector: currentEnvironmentId })
      const result = await window.api.runtimeEnvironments.addFromPairingCode({
        name,
        pairingCode: pairingUrl
      })
      store.getState().setRuntimeEnvironments(await window.api.runtimeEnvironments.list())
      if (!(await store.getState().refreshRuntimeEnvironmentStatus(result.environment.id))) {
        throw new Error('Re-paired desktop could not reach the HUB runtime')
      }
      if (!(await store.getState().setActiveRuntimeEnvironmentPreference(result.environment.id))) {
        throw new Error('Re-paired desktop could not select the HUB runtime')
      }
      return result.environment.id
    },
    {
      currentEnvironmentId: client.environmentId,
      name,
      pairingUrl: offer.pairingUrl
    }
  )
  client.environmentId = environmentId
  // Why: removing and re-adding the same HUB changes the environment identity; remount so no pane keeps the retired transport wrapper.
  await client.page.reload()
  await client.page.waitForFunction(
    () => window.__store?.getState().workspaceSessionReady === true,
    null,
    { timeout: 30_000 }
  )
  await client.installDirectSshAttemptProbe()
  const reachable = await client.page.evaluate(async (nextEnvironmentId) => {
    const store = window.__store
    if (!store) {
      throw new Error('Re-paired desktop store is unavailable after reload')
    }
    if (!(await store.getState().refreshRuntimeEnvironmentStatus(nextEnvironmentId))) {
      return false
    }
    return store.getState().setActiveRuntimeEnvironmentPreference(nextEnvironmentId)
  }, environmentId)
  if (!reachable) {
    throw new Error('Re-paired desktop could not reach the HUB after reload')
  }
}
