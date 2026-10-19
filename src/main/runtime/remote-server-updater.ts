import type {
  MobileInstallRequestResult,
  MobileInstallRequestState,
  RemoteServerUpdateInstallResult,
  RemoteServerUpdaterSnapshot
} from '../../shared/remote-server-update'
import type { UpdateCheckOptions } from '../../shared/update-status-types'

type RemoteServerUpdaterAdapter = {
  getSnapshot: (runtimeId: string) => RemoteServerUpdaterSnapshot
  check: (runtimeId: string, options?: UpdateCheckOptions) => RemoteServerUpdaterSnapshot
  download: (runtimeId: string) => RemoteServerUpdaterSnapshot
  install: (runtimeId: string) => RemoteServerUpdateInstallResult
  requestMobileInstall: (pairedDeviceId: string) => MobileInstallRequestResult
  cancelMobileInstall: (requestId: string) => boolean
  restartMobileInstallNow: (requestId: string) => boolean
  getMobileInstallRequest: () => MobileInstallRequestState | null
}

const unavailableSnapshot = (runtimeId: string): RemoteServerUpdaterSnapshot => ({
  appVersion: process.env.ORCA_APP_VERSION ?? '0.0.0-dev',
  runtimeId,
  support: {
    installMode: 'unsupported-headless-serve',
    automatic: false,
    reason: 'updater-unavailable'
  },
  status: { state: 'idle' },
  mobileInstallRequest: null
})

const manualRequired = (): never => {
  throw new Error('remote_update_manual_required')
}

let adapter: RemoteServerUpdaterAdapter = {
  getSnapshot: unavailableSnapshot,
  check: manualRequired,
  download: manualRequired,
  install: manualRequired,
  requestMobileInstall: manualRequired,
  cancelMobileInstall: () => false,
  restartMobileInstallNow: () => false,
  getMobileInstallRequest: () => null
}

export function configureRemoteServerUpdater(next: RemoteServerUpdaterAdapter): void {
  adapter = next
}

export function getRemoteServerUpdaterSnapshot(runtimeId: string): RemoteServerUpdaterSnapshot {
  return {
    ...adapter.getSnapshot(runtimeId),
    mobileInstallRequest: adapter.getMobileInstallRequest()
  }
}

export function checkRemoteServerUpdater(
  runtimeId: string,
  options?: UpdateCheckOptions
): RemoteServerUpdaterSnapshot {
  return options ? adapter.check(runtimeId, options) : adapter.check(runtimeId)
}

export function downloadRemoteServerUpdater(runtimeId: string): RemoteServerUpdaterSnapshot {
  return adapter.download(runtimeId)
}

export function installRemoteServerUpdater(runtimeId: string): RemoteServerUpdateInstallResult {
  return adapter.install(runtimeId)
}

export function requestRemoteServerMobileInstall(
  pairedDeviceId: string
): MobileInstallRequestResult {
  return adapter.requestMobileInstall(pairedDeviceId)
}

export function cancelRemoteServerMobileInstall(requestId: string): boolean {
  return adapter.cancelMobileInstall(requestId)
}

export function restartRemoteServerMobileInstallNow(requestId: string): boolean {
  return adapter.restartMobileInstallNow(requestId)
}
